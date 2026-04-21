import { sessionApi } from '@/api/session'
import type { SessionJoinVO } from '@/types/session'

export const wsClient = {
  async joinSession(sessionKey: string): Promise<SessionJoinVO> {
    // 当前阶段先复用 HTTP join 接口完成“邀请链接自动加入”。
    // 后续接入 WebSocket 时仅需替换该实现，不影响页面调用方。
    return sessionApi.join(sessionKey)
  },
}
