import { sessionApi } from '@/api/session'
import type { SessionDetailVO, SessionJoinVO } from '@/types/session'
import { resolveSessionErrorMessage } from '@/utils/sessionError'
import WebSocketClient from '@/ws/client'

// 会话加入/退出/删除模块：
// 负责从页面侧发起会话生命周期动作，并在 join 成功后建立 WS 实时连接。
type UseSessionJoinLeaveOptions = {
  getSessionKey: () => string
  getInviteToken: () => string | undefined
  getJoining: () => boolean
  getJoined: () => boolean
  getIncludeHistoryMembers: () => boolean
  getIsCreator: () => boolean
  getWsUrl: () => string
  getToken: () => string | null
  ensureCurrentUserId: () => Promise<number | null>
  setJoining: (value: boolean) => void
  setJoined: (value: boolean) => void
  setNavigatingAway: (value: boolean) => void
  setSessionInfo: (value: SessionJoinVO) => void
  setSessionDetail: (value: SessionDetailVO) => void
  setWsClient: (value: WebSocketClient) => void
  bindWs: (client: WebSocketClient) => void
  bindCanvasSession: (joinedData: SessionJoinVO, client: WebSocketClient) => void
  startHeartbeat: () => void
  confirmAction: (message: string, title: string, confirmButtonText: string) => Promise<boolean>
  onError: (error: unknown, fallback: string) => void
  onSuccess: (message: string) => void
  navigate: (path: string) => Promise<void>
}

export const useSessionJoinLeave = (options: UseSessionJoinLeaveOptions) => {
  // 加入会话流程：
  // 1) 先做状态校验，避免重复发起 join。
  // 2) 通过 HTTP 加入会话并拉取完整会话详情。
  // 3) 创建并绑定 WS 客户端，建立实时同步连接。
  // 4) 启动心跳并跳转到标准会话路由。
  const joinSession = async () => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey || options.getJoining() || options.getJoined()) {
      return
    }
    options.setJoining(true)
    try {
      await options.ensureCurrentUserId()
      const joinedData = await sessionApi.join(sessionKey, options.getInviteToken())
      const detail = await sessionApi.getDetail(sessionKey, options.getIncludeHistoryMembers())
      options.setSessionInfo(joinedData)
      options.setSessionDetail(detail)
      options.setJoined(true)

      const token = options.getToken()
      if (!token) {
        throw new Error('未登录')
      }
      // 只有在 HTTP join 成功后才创建 WS 客户端，
      // 可确保服务端成员状态已就绪，再开始接收实时事件。
      const client = new WebSocketClient(options.getWsUrl(), token, sessionKey)
      options.bindWs(client)
      options.setWsClient(client)
      options.bindCanvasSession(joinedData, client)
      client.connect()

      options.startHeartbeat()
      await options.navigate(`/session/${sessionKey}`)
    } catch (error) {
      options.onError(error, resolveSessionErrorMessage(error, '加入会话失败'))
      await options.navigate('/')
    } finally {
      options.setJoining(false)
    }
  }

  // 退出会话流程：
  // 二次确认 -> 调用 leave 接口 -> 返回首页。
  const handleLeaveSession = async () => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    try {
      const confirmed = await options.confirmAction('确认退出当前会话吗？', '退出会话', '确认退出')
      if (!confirmed) {
        return
      }
      options.setNavigatingAway(true)
      await sessionApi.leave(sessionKey)
      options.onSuccess('已退出会话')
      await options.navigate('/')
    } catch (error) {
      options.onError(error, '退出会话失败')
    }
  }

  // 删除会话流程（仅创建者可执行）：
  // 确认高风险操作 -> 调用删除接口 -> 跳转会话列表。
  const handleDeleteSession = async () => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey || !options.getIsCreator()) {
      return
    }
    try {
      const confirmed = await options.confirmAction('确认删除当前会话吗？删除后不可恢复。', '删除会话', '确认删除')
      if (!confirmed) {
        return
      }
      options.setNavigatingAway(true)
      await sessionApi.deleteSession(sessionKey)
      options.onSuccess('会话已删除')
      await options.navigate('/my-sessions')
    } catch (error) {
      options.onError(error, '删除会话失败')
    }
  }

  return {
    joinSession,
    handleLeaveSession,
    handleDeleteSession,
  }
}
