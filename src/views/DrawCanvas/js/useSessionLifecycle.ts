import { sessionApi } from '@/api/session'
import type { SessionDetailVO } from '@/types/session'

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
      // ignore heartbeat error
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
