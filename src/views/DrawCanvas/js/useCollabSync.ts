import type { Ref } from 'vue'

import WebSocketClient from '@/ws/client'
import type {
  ConnectedEventData,
  DisconnectedEventData,
  GraphicCreatedData,
  GraphicDeletedData,
  GraphicUpdatedData,
  MemberJoinedData,
  MemberStatusChangedData,
  OperationResolvedData,
  PresenceCursorData,
  PresenceSelectionData,
  ReconnectFailedEventData,
  ReconnectingEventData,
  SessionPausedData,
  SessionJoinedData,
  SessionLeftData,
  RedoResultData,
  UndoResultData,
  WsErrorData,
} from '@/ws/types'

// WS 协作绑定模块：
// 负责把 WebSocketClient 事件绑定到页面状态更新与业务回调，
// 同时维护连接状态、重连提示与最近同步时间。
type UseCollabSyncOptions = {
  wsConnected: Ref<boolean>
  reconnecting: Ref<boolean>
  reconnectFailed: Ref<boolean>
  reconnectAttempt: Ref<number>
  reconnectMaxAttempts: Ref<number>
  reconnectDelay: Ref<number>
  reconnectTotalCount: Ref<number>
  lastSyncText: Ref<string>
  replayOnReconnect: () => Promise<void>
  onErrorMessage: (message: string) => void
  onSessionJoined: (payload: SessionJoinedData) => void
  onSessionLeft: (payload: SessionLeftData) => void
  onSessionPaused: (payload: SessionPausedData) => void
  onMemberJoined: (payload: MemberJoinedData) => void
  onMemberLeft: (payload: MemberJoinedData) => void
  onMemberStatusChanged: (payload: MemberStatusChangedData) => void
  onGraphicCreated: (payload: GraphicCreatedData) => void
  onGraphicUpdated: (payload: GraphicUpdatedData) => void
  onGraphicDeleted: (payload: GraphicDeletedData) => void
  onPresenceCursor: (payload: PresenceCursorData) => void
  onPresenceSelection: (payload: PresenceSelectionData) => void
  onOperationResolved: (payload: OperationResolvedData) => void
  onUndoResult: (payload: UndoResultData) => void
  onRedoResult: (payload: RedoResultData) => void
}

const nowTimeText = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export const useCollabSync = (options: UseCollabSyncOptions) => {
  // 连接建立：重置重连状态，必要时触发断线期间回放。
  const handleWsConnected = (payload: ConnectedEventData) => {
    options.wsConnected.value = true
    options.reconnecting.value = false
    options.reconnectFailed.value = false
    options.reconnectAttempt.value = 0
    options.reconnectMaxAttempts.value = 0
    options.reconnectDelay.value = 0
    if (payload.reconnectAttempt > 0) {
      options.reconnectTotalCount.value += 1
      void options.replayOnReconnect()
    }
    options.lastSyncText.value = nowTimeText()
  }

  const handleWsDisconnected = (_payload: DisconnectedEventData) => {
    options.wsConnected.value = false
  }

  // 重连中：更新提示条中的次数与延迟。
  const handleWsReconnecting = (payload: ReconnectingEventData) => {
    options.reconnecting.value = true
    options.reconnectFailed.value = false
    options.reconnectAttempt.value = payload.attempt
    options.reconnectMaxAttempts.value = payload.maxAttempts
    options.reconnectDelay.value = payload.delay
  }

  // 重连失败：切换失败态，允许用户手动重试。
  const handleWsReconnectFailed = (payload: ReconnectFailedEventData) => {
    options.reconnecting.value = false
    options.reconnectFailed.value = true
    options.reconnectAttempt.value = payload.attempts
    options.reconnectMaxAttempts.value = payload.maxAttempts
  }

  // 仅对关键错误码给用户提示，减少噪音。
  const handleWsError = (payload: WsErrorData) => {
    if (payload.code >= 3000 || payload.code === 2001 || payload.code === 2002) {
      options.onErrorMessage(payload.message || 'WebSocket 出错')
    }
  }

  // 统一事件绑定入口。
  const bindWs = (client: WebSocketClient) => {
    client.on('connected', handleWsConnected)
    client.on('disconnected', handleWsDisconnected)
    client.on('reconnecting', handleWsReconnecting)
    client.on('reconnect_failed', handleWsReconnectFailed)
    client.on('error', handleWsError)
    client.on('session_joined', options.onSessionJoined)
    client.on('session_left', options.onSessionLeft)
    client.on('session_paused', options.onSessionPaused)
    client.on('member_joined', options.onMemberJoined)
    client.on('member_left', options.onMemberLeft)
    client.on('member_status_changed', options.onMemberStatusChanged)
    client.on('presence_cursor', options.onPresenceCursor)
    client.on('presence_selection', options.onPresenceSelection)
    client.on('graphic_created', options.onGraphicCreated)
    client.on('graphic_updated', options.onGraphicUpdated)
    client.on('graphic_deleted', options.onGraphicDeleted)
    client.on('operation_resolved', options.onOperationResolved)
    client.on('undo_result', options.onUndoResult)
    client.on('redo_result', options.onRedoResult)
  }

  // 与 bindWs 成对的解绑入口，避免重复绑定和内存泄漏。
  const unbindWs = (client: WebSocketClient) => {
    client.off('connected', handleWsConnected)
    client.off('disconnected', handleWsDisconnected)
    client.off('reconnecting', handleWsReconnecting)
    client.off('reconnect_failed', handleWsReconnectFailed)
    client.off('error', handleWsError)
    client.off('session_joined', options.onSessionJoined)
    client.off('session_left', options.onSessionLeft)
    client.off('session_paused', options.onSessionPaused)
    client.off('member_joined', options.onMemberJoined)
    client.off('member_left', options.onMemberLeft)
    client.off('member_status_changed', options.onMemberStatusChanged)
    client.off('presence_cursor', options.onPresenceCursor)
    client.off('presence_selection', options.onPresenceSelection)
    client.off('graphic_created', options.onGraphicCreated)
    client.off('graphic_updated', options.onGraphicUpdated)
    client.off('graphic_deleted', options.onGraphicDeleted)
    client.off('operation_resolved', options.onOperationResolved)
    client.off('undo_result', options.onUndoResult)
    client.off('redo_result', options.onRedoResult)
  }

  // 手动重试连接（通常由 UI 的“重试”按钮触发）。
  const handleRetryConnect = (client: WebSocketClient | null) => {
    if (!client) {
      return
    }
    options.reconnecting.value = false
    options.reconnectFailed.value = false
    options.reconnectAttempt.value = 0
    options.reconnectMaxAttempts.value = 0
    options.reconnectDelay.value = 0
    client.connect()
  }

  const setLastSyncNow = () => {
    options.lastSyncText.value = nowTimeText()
  }

  return {
    bindWs,
    unbindWs,
    handleRetryConnect,
    setLastSyncNow,
  }
}
