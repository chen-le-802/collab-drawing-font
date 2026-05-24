import { sessionApi } from '@/api/session'
import type { SessionDetailVO } from '@/types/session'

// 会话生命周期模块：
// 处理心跳保活、页面可见性切换、成员列表刷新调度等“会话运行态”能力。
type UseSessionLifecycleOptions = {
  getSessionKey: () => string
  getJoined: () => boolean
  isWsConnected: () => boolean
  reconnectWs: () => void
  getIncludeHistoryMembers: () => boolean
  getSessionDetail: () => SessionDetailVO | null
  setSessionDetail: (detail: SessionDetailVO) => void
  setLoadingMembers: (loading: boolean) => void
  onMemberRefreshError: (error: unknown) => void
}

const HEARTBEAT_MS = 20_000

export const useSessionLifecycle = (options: UseSessionLifecycleOptions) => {
  let heartbeatTimer: number | null = null
  let membersRefreshTimer: number | null = null
  let membersRefreshRequestId = 0

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const sendHeartbeat = async () => {
    const sessionKey = options.getSessionKey()
    if (!options.getJoined() || !sessionKey) {
      return
    }
    try {
      await sessionApi.heartbeat(sessionKey)
    } catch {
      // 忽略心跳异常，避免临时网络波动打断交互。
    }
  }

  const startHeartbeat = () => {
    clearHeartbeat()
    void sendHeartbeat()
    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat()
      }
    }, HEARTBEAT_MS)
  }

  const onVisibilityChange = () => {
    // 页面回到前台时，若 WS 已断开则尝试重连，并恢复心跳。
    if (document.visibilityState === 'visible') {
      if (options.getJoined() && !options.isWsConnected()) {
        options.reconnectWs()
      }
      startHeartbeat()
      return
    }
    clearHeartbeat()
  }

  const refreshSessionMembers = async () => {
    const sessionKey = options.getSessionKey()
    const currentDetail = options.getSessionDetail()
    if (!sessionKey || !currentDetail) {
      return
    }
    const requestId = ++membersRefreshRequestId
    // requestId 防抖：只接收最后一次请求结果，避免旧响应覆盖新状态。
    options.setLoadingMembers(true)
    try {
      const detail = await sessionApi.getDetail(sessionKey, options.getIncludeHistoryMembers())
      if (requestId !== membersRefreshRequestId) {
        return
      }
      options.setSessionDetail({
        ...currentDetail,
        ...detail,
        members: detail.members,
        memberCount: detail.members.length,
        onlineMemberCount: detail.members.filter((item) => item.onlineStatus === 1).length,
      })
    } catch (error) {
      options.onMemberRefreshError(error)
    } finally {
      options.setLoadingMembers(false)
    }
  }

  const scheduleMembersRefresh = (delay = 250) => {
    if (membersRefreshTimer !== null) {
      window.clearTimeout(membersRefreshTimer)
    }
    membersRefreshTimer = window.setTimeout(() => {
      membersRefreshTimer = null
      void refreshSessionMembers()
    }, delay)
  }

  const clearMembersRefreshTimer = () => {
    if (membersRefreshTimer !== null) {
      window.clearTimeout(membersRefreshTimer)
      membersRefreshTimer = null
    }
  }

  const cleanup = () => {
    clearHeartbeat()
    clearMembersRefreshTimer()
  }

  return {
    clearHeartbeat,
    startHeartbeat,
    onVisibilityChange,
    refreshSessionMembers,
    scheduleMembersRefresh,
    clearMembersRefreshTimer,
    cleanup,
  }
}
