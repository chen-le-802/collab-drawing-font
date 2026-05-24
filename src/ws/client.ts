import type { GraphicVO } from '@/types/graphic'
import type { MemberVO } from '@/types/session'
import {
  type BaseClientMessage,
  type ClientMessageType,
  type ClientLifecycleEventDataMap,
  type ClientLifecycleEventType,
  type ConnectedEventData,
  type CreateGraphicData,
  type DeleteGraphicData,
  type DisconnectedEventData,
  type CursorMoveData,
  type GraphicCreatedData,
  type GraphicDeletedData,
  type GraphicUpdatedData,
  type PresenceCursorData,
  type PresenceSelectionData,
  type RawGraphicCreatedData,
  type RawGraphicDeletedData,
  type RawGraphicUpdatedData,
  type RawMemberEventData,
  type RawSessionPausedData,
  type RawPresenceCursorData,
  type RawPresenceSelectionData,
  type ReconnectFailedEventData,
  type ReconnectingEventData,
  type SessionPausedData,
  type SelectionChangeData,
  type ServerMessage,
  type ServerMessageDataMap,
  type ServerMessageType,
  type UndoRedoData,
  type UpdateGraphicData,
  type WebSocketClientEventDataMap,
  type WebSocketClientEventType,
  type WsErrorData,
} from './types'

// 统一事件处理器类型：根据事件名自动约束 data 的类型。
type EventHandler<K extends WebSocketClientEventType> = (
  data: WebSocketClientEventDataMap[K],
) => void

// 内部统一存储的“弱类型”处理器，用于消息分发表。
type AnyEventHandler = (data: unknown) => void

// 连接相关默认参数。
const RECONNECT_INTERVAL = 3000
const MAX_RECONNECT_ATTEMPTS = 5
const HEARTBEAT_INTERVAL = 20000
// 白名单：仅允许识别并处理这些服务端消息类型。
const SERVER_MESSAGE_TYPES: ReadonlySet<ServerMessageType> = new Set([
  'session_joined',
  'session_left',
  'session_paused',
  'member_joined',
  'member_left',
  'member_status_changed',
  'presence_cursor',
  'presence_selection',
  'graphic_created',
  'graphic_updated',
  'graphic_deleted',
  'operation_resolved',
  'undo_result',
  'redo_result',
  'error',
  'pong',
])

// 运行时类型守卫与基础转换工具，用于消息归一化。
const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

const toPathPoints = (value: unknown): Array<{ x: number; y: number }> | null => {
  if (!Array.isArray(value)) {
    return null
  }
  const points = value
    .filter(isObject)
    .map((item) => ({ x: toNumber(item.x), y: toNumber(item.y) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
  return points.length > 0 ? points : null
}

const toMemberArray = (value: unknown): MemberVO[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isObject).map((item) => {
    return {
      userId: toNumber(item.userId),
      username: toString(item.username),
      ...(toString(item.avatar).length > 0 ? { avatar: toString(item.avatar) } : {}),
      role: toNumber(item.role),
      onlineStatus: toNumber(item.onlineStatus),
      joinedAt: toString(item.joinedAt),
    }
  })
}

const toGraphic = (value: unknown): GraphicVO | null => {
  if (!isObject(value)) {
    return null
  }
  const objectKey = toString(value.objectKey)
  const objectType = toString(value.objectType) as GraphicVO['objectType']
  if (!objectKey || !objectType) {
    return null
  }
  return {
    id: toNumber(value.id),
    sessionId: toNumber(value.sessionId),
    objectKey,
    objectType,
    positionX: toNumber(value.positionX),
    positionY: toNumber(value.positionY),
    width: typeof value.width === 'number' ? value.width : null,
    height: typeof value.height === 'number' ? value.height : null,
    strokeColor: toString(value.strokeColor),
    lineStyle: value.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillColor: typeof value.fillColor === 'string' ? value.fillColor : null,
    strokeWidth: toNumber(value.strokeWidth),
    textContent: typeof value.textContent === 'string' ? value.textContent : null,
    fontSize: typeof value.fontSize === 'number' ? value.fontSize : null,
    pathPoints: toPathPoints(value.pathPoints),
    isLocked: value.isLocked === true || value.isLocked === 1,
    rotation: toNumber(value.rotation),
    zIndex: toNumber(value.zIndex),
    version: toNumber(value.version),
    creatorId: toNumber(value.creatorId),
    createdAt: toString(value.createdAt),
    updatedAt: toString(value.updatedAt),
  }
}

const decodeReason = (reason?: string): string => {
  if (typeof reason === 'string') {
    return reason
  }
  return ''
}

const isServerMessageType = (value: string): value is ServerMessageType => {
  return SERVER_MESSAGE_TYPES.has(value as ServerMessageType)
}

// WebSocket 客户端封装：
// 1) 管理连接/重连/心跳
// 2) 提供业务消息发送方法
// 3) 统一解析并归一化服务端消息后对外分发事件
export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private sessionKey: string
  private reconnectInterval: number = RECONNECT_INTERVAL
  private reconnectTimer: number | null = null
  private reconnectAttempts: number = 0
  private readonly maxReconnectAttempts: number = MAX_RECONNECT_ATTEMPTS
  private messageHandlers: Map<string, AnyEventHandler[]> = new Map()
  private isManualClose: boolean = false
  private heartbeatTimer: number | null = null
  private connecting: boolean = false

  constructor(url: string, token: string, sessionKey: string) {
    this.url = url
    this.token = token
    this.sessionKey = sessionKey
  }

  // 建立连接。若已连接或正在连接则直接返回，避免重复建连。
  connect(): void {
    if (this.connecting || this.isConnected()) {
      return
    }

    this.isManualClose = false
    this.connecting = true
    this.clearReconnectTimer()

    const wsUrl = this.buildSocketUrl()
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      // 建连成功后：清理重连状态、开启心跳、通知上层 connected。
      this.connecting = false
      const connectedAttempt = this.reconnectAttempts
      this.reconnectAttempts = 0
      this.startHeartbeat()
      const payload: ConnectedEventData = {
        url: wsUrl,
        reconnectAttempt: connectedAttempt,
      }
      this.emit('connected', payload)
    }

    this.ws.onmessage = (event: MessageEvent<string>) => {
      this.handleMessage(event.data)
    }

    this.ws.onerror = () => {
      // 交由 onclose 统一做状态清理和重连决策。
    }

    this.ws.onclose = (event: CloseEvent) => {
      // 统一收口断开处理：停心跳、发 disconnected、必要时进入重连。
      this.connecting = false
      this.stopHeartbeat()
      this.ws = null

      const disconnectedPayload: DisconnectedEventData = {
        code: event.code,
        reason: decodeReason(event.reason),
        wasClean: event.wasClean,
        manual: this.isManualClose,
      }
      this.emit('disconnected', disconnectedPayload)

      if (!this.isManualClose) {
        this.tryReconnect()
      }
    }
  }

  // 主动断开：标记为 manual，后续 onclose 不再触发自动重连。
  disconnect(): void {
    this.isManualClose = true
    this.connecting = false
    this.clearReconnectTimer()
    this.stopHeartbeat()

    if (!this.ws) {
      return
    }

    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, 'manual disconnect')
    }
    this.ws = null
  }

  send<T = unknown>(type: ClientMessageType, data: T): void {
    //普通业务消息固定走 silentWhenDisconnected=false
    this.sendInternal(type, data, false)
  }

  // 底层发送函数：
  // - silentWhenDisconnected=true：离线时静默丢弃（用于心跳 ping）
  // - false：离线时回调 error 事件，方便 UI 给出提示
  private sendInternal<T = unknown>(type: ClientMessageType, data: T, silentWhenDisconnected: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (silentWhenDisconnected) {
        return
      }
      const err: WsErrorData = {
        code: 2001,
        message: 'WebSocket 未连接，消息已忽略',
        originalType: type,
      }
      this.emit('error', err)
      return
    }

    const payload: BaseClientMessage<T> = {
      type,
      data,
      timestamp: Date.now(),
    }
    // 统一客户端消息协议结构后再发送。
    this.ws.send(JSON.stringify(payload))
  }

  // 注册事件处理器。
  on<K extends WebSocketClientEventType>(type: K, handler: EventHandler<K>): void {
    const key = type as string
    const queue = this.messageHandlers.get(key) ?? []
    queue.push(handler as AnyEventHandler)
    this.messageHandlers.set(key, queue)
  }

  // 注销事件处理器。
  off<K extends WebSocketClientEventType>(type: K, handler: EventHandler<K>): void {
    const key = type as string
    const queue = this.messageHandlers.get(key)
    if (!queue || queue.length === 0) {
      return
    }
    const filtered = queue.filter((item) => item !== (handler as AnyEventHandler))
    if (filtered.length === 0) {
      this.messageHandlers.delete(key)
      return
    }
    this.messageHandlers.set(key, filtered)
  }

  // 以下为业务语义发送函数：对上层屏蔽具体 WS type 字符串。
  // 作用：页面调用更直观，不用手写 type 字符串。
  sendCreateGraphic(data: CreateGraphicData): void {
    this.send('create_graphic', data)
  }

  sendUpdateGraphic(data: UpdateGraphicData): void {
    this.send('update_graphic', data)
  }

  sendDeleteGraphic(sessionKey: string, objectKey: string): void {
    const payload: DeleteGraphicData = { sessionKey, objectKey }
    this.send('delete_graphic', payload)
  }

  sendDeleteGraphicWithMeta(data: DeleteGraphicData): void {
    this.send('delete_graphic', data)
  }

  sendUndo(sessionKey: string): void {
    const payload: UndoRedoData = { sessionKey }
    this.send('undo', payload)
  }

  sendUndoWithMeta(data: UndoRedoData): void {
    this.send('undo', data)
  }

  sendRedo(sessionKey: string): void {
    const payload: UndoRedoData = { sessionKey }
    this.send('redo', payload)
  }

  sendRedoWithMeta(data: UndoRedoData): void {
    this.send('redo', data)
  }

  sendCursorMove(data: CursorMoveData): void {
    this.send('cursor_move', data)
  }

  sendSelectionChange(data: SelectionChangeData): void {
    this.send('selection_change', data)
  }

  // 连接是否处于 OPEN 状态。
  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  // 在 ws 地址后拼接 token / sessionKey 作为握手鉴权参数。
  private buildSocketUrl(): string {
    const parsed = new URL(this.url)
    parsed.searchParams.set('token', this.token)
    parsed.searchParams.set('sessionKey', this.sessionKey)
    return parsed.toString()
  }

  private emit<K extends WebSocketClientEventType>(
    type: K,
    data: WebSocketClientEventDataMap[K],
  ): void {
    const queue = this.messageHandlers.get(type)
    if (!queue || queue.length === 0) {
      return
    }

    queue.forEach((handler) => {
      try {
        handler(data)
      } catch (error) {
        // 保证单个 handler 异常不影响其它订阅者。
        // eslint-disable-next-line no-console
        console.error('[WebSocketClient] handler error:', error)
      }
    })
  }

  // 自动重连策略：固定间隔，最多重试 maxReconnectAttempts 次。
  private tryReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const payload: ReconnectFailedEventData = {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      }
      this.emit('reconnect_failed', payload)
      return
    }

    this.reconnectAttempts += 1
    const payload: ReconnectingEventData = {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delay: this.reconnectInterval,
    }
    this.emit('reconnecting', payload)

    this.clearReconnectTimer()
    this.reconnectTimer = window.setTimeout(() => {
      this.connect()
    }, this.reconnectInterval)
  }

  // 清除重连计时器。
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // 开启应用层心跳：定时发 ping 保活连接。
 // 服务端回 pong，并用最近活动时间判断僵尸连接。
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      this.sendInternal('ping', {}, true)
    }, HEARTBEAT_INTERVAL)
  }

  // 停止心跳。
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // 接收原始文本消息并执行：
  // 1) JSON 解析
  // 2) 协议结构校验
  // 3) 消息类型白名单校验
  // 4) 调 normalizeServerMessage 归一化
  // 5) 触发对应事件：emit(type, normalized) 分发给页面
  private handleMessage(rawText: string): void {
    let message: ServerMessage<unknown>
    try {
      message = JSON.parse(rawText) as ServerMessage<unknown>
    } catch (_error) {
      const err: WsErrorData = {
        code: 1001,
        message: '消息解析失败',
        originalType: 'unknown',
      }
      this.emit('error', err)
      return
    }

    if (!message || typeof message.type !== 'string') {
      const err: WsErrorData = {
        code: 1001,
        message: '消息结构错误',
        originalType: 'unknown',
      }
      this.emit('error', err)
      return
    }

    if (!isServerMessageType(message.type)) {
      const err: WsErrorData = {
        code: 1001,
        message: `未知消息类型: ${message.type}`,
        originalType: message.type,
      }
      this.emit('error', err)
      return
    }

    const type = message.type
    const normalized = this.normalizeServerMessage(type, message.data)
    this.emit(type, normalized as never)
  }
  // 根据消息类型路由到具体 normalize 函数。
  private normalizeServerMessage<K extends ServerMessageType>(
    type: K,
    data: unknown,
  ): ServerMessageDataMap[K] {
    switch (type) {
      case 'session_joined':
        return this.normalizeSessionJoined(data) as ServerMessageDataMap[K]
      case 'session_left':
        return this.normalizeSessionLeft(data) as ServerMessageDataMap[K]
      case 'session_paused':
        return this.normalizeSessionPaused(data) as ServerMessageDataMap[K]
      case 'member_joined':
      case 'member_left':
        return this.normalizeMemberEvent(data) as ServerMessageDataMap[K]
      case 'member_status_changed':
        return this.normalizeMemberStatusChanged(data) as ServerMessageDataMap[K]
      case 'presence_cursor':
        return this.normalizePresenceCursor(data) as ServerMessageDataMap[K]
      case 'presence_selection':
        return this.normalizePresenceSelection(data) as ServerMessageDataMap[K]
      case 'graphic_created':
        return this.normalizeGraphicCreated(data) as ServerMessageDataMap[K]
      case 'graphic_updated':
        return this.normalizeGraphicUpdated(data) as ServerMessageDataMap[K]
      case 'graphic_deleted':
        return this.normalizeGraphicDeleted(data) as ServerMessageDataMap[K]
      case 'operation_resolved':
        return this.normalizeOperationResolved(data) as ServerMessageDataMap[K]
      case 'undo_result':
        return this.normalizeUndoResult(data) as ServerMessageDataMap[K]
      case 'redo_result':
        return this.normalizeRedoResult(data) as ServerMessageDataMap[K]
      case 'pong':
        return { timestamp: Date.now() } as ServerMessageDataMap[K]
      case 'error':
      default:
        // error 或未覆盖分支统一走错误消息归一化。
        return this.normalizeError(data) as ServerMessageDataMap[K]
    }
  }

  // session_joined：把 session_joined 统一成标准对象（session+members+graphics）。
  private normalizeSessionJoined(data: unknown) {
    const record = isObject(data) ? data : {}
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      sessionId: toNumber(record.sessionId),
      name: toString(record.name),
      currentVersion: toNumber(record.currentVersion),
      graphics: Array.isArray(record.graphics)
        ? record.graphics.map((item) => toGraphic(item)).filter((item): item is GraphicVO => !!item)
        : [],
      members: toMemberArray(record.members),
    }
  }

  // session_left：离开会话事件。
  private normalizeSessionLeft(data: unknown) {
    const record = isObject(data) ? data : {}
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
    }
  }

  // session_paused：暂停状态广播（含操作者信息）。
  private normalizeSessionPaused(data: unknown): SessionPausedData {
    const record = (isObject(data) ? data : {}) as RawSessionPausedData
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      isPaused: record.isPaused === true,
      operatorUserId: typeof record.operatorUserId === 'number' ? record.operatorUserId : undefined,
      operatorUsername: typeof record.operatorUsername === 'string' ? record.operatorUsername : undefined,
    }
  }

  // member_joined / member_left：成员变更事件。
  private normalizeMemberEvent(data: unknown) {
    const record = (isObject(data) ? data : {}) as RawMemberEventData
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      userId: toNumber(record.userId),
      username: toString(record.username),
      members: toMemberArray(record.members),
    }
  }

  // member_status_changed：在线状态变化事件。
  private normalizeMemberStatusChanged(data: unknown) {
    const record = (isObject(data) ? data : {}) as RawMemberEventData
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      userId: toNumber(record.userId),
      username: toString(record.username),
      onlineStatus: toNumber(record.onlineStatus),
      members: toMemberArray(record.members),
    }
  }

  // presence_cursor：协作者光标位置。
  private normalizePresenceCursor(data: unknown): PresenceCursorData {
    const record = (isObject(data) ? data : {}) as RawPresenceCursorData
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      userId: toNumber(record.userId),
      username: toString(record.username),
      x: toNumber(record.x),
      y: toNumber(record.y),
    }
  }

  // presence_selection：协作者当前选中对象。
  private normalizePresenceSelection(data: unknown): PresenceSelectionData {
    const record = (isObject(data) ? data : {}) as RawPresenceSelectionData
    const objectKeys = Array.isArray(record.objectKeys)
      ? record.objectKeys.map((item) => toString(item)).filter((item) => item.length > 0)
      : []
    const objectKey = typeof record.objectKey === 'string' && record.objectKey.length > 0
      ? record.objectKey
      : (objectKeys[0] ?? null)
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      userId: toNumber(record.userId),
      username: toString(record.username),
      objectKey,
      objectKeys,
    }
  }

  // graphic_created：兼容“包裹结构”和“直接图元结构”两种数据形态。
  private normalizeGraphicCreated(data: RawGraphicCreatedData): GraphicCreatedData {
    const wrapped = isObject(data) ? data : {}
    const maybeGraphic = isObject(wrapped.graphic) ? wrapped.graphic : wrapped
    const graphic = toGraphic(maybeGraphic) ?? this.buildFallbackGraphic(maybeGraphic)
    return {
      sessionKey: toString(wrapped.sessionKey, this.sessionKey),
      userId: toNumber(wrapped.userId, graphic.creatorId),
      graphic,
      currentVersion: toNumber(wrapped.currentVersion, graphic.version),
    }
  }

  // graphic_updated：兼容“包裹结构”和“直接图元结构”两种数据形态。
  private normalizeGraphicUpdated(data: RawGraphicUpdatedData): GraphicUpdatedData {
    const wrapped = isObject(data) ? data : {}
    const maybeGraphic = isObject(wrapped.graphic) ? wrapped.graphic : wrapped
    const graphic = toGraphic(maybeGraphic) ?? this.buildFallbackGraphic(maybeGraphic)
    return {
      sessionKey: toString(wrapped.sessionKey, this.sessionKey),
      userId: toNumber(wrapped.userId, graphic.creatorId),
      graphic: {
        ...graphic,
      },
      currentVersion: toNumber(wrapped.currentVersion, graphic.version),
    }
  }

  // graphic_deleted：删除事件数据归一化。
  private normalizeGraphicDeleted(data: unknown): GraphicDeletedData {
    const record = isObject(data) ? data : {}
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      userId: toNumber(record.userId),
      objectKey: toString(record.objectKey),
      currentVersion: toNumber(record.currentVersion),
    }
  }

  // operation_resolved：服务端冲突裁决结果（用于前端提示和日志展示），规范conflictType/operationType。
  private normalizeOperationResolved(data: unknown) {
    const record = isObject(data) ? data : {}
    const conflictTypeRaw = toString(record.conflictType, 'none')
    const conflictType =
      conflictTypeRaw === 'field_merge' ||
      conflictTypeRaw === 'field_conflict' ||
      conflictTypeRaw === 'delete_wins' ||
      conflictTypeRaw === 'duplicate_operation'
        ? conflictTypeRaw
        : 'none'
    const operationTypeRaw = toString(record.operationType, 'update_graphic')
    const operationType =
      operationTypeRaw === 'create_graphic' ||
      operationTypeRaw === 'update_graphic' ||
      operationTypeRaw === 'delete_graphic'
        ? operationTypeRaw
        : 'update_graphic'
    return {
      operationId: toString(record.operationId),
      objectKey: toString(record.objectKey),
      operationType,
      serverVersion: toNumber(record.serverVersion),
      conflictType,
      appliedFields: Array.isArray(record.appliedFields)
        ? record.appliedFields.map((item) => toString(item)).filter((item) => item.length > 0)
        : [],
      rejectedFields: Array.isArray(record.rejectedFields)
        ? record.rejectedFields.map((item) => toString(item)).filter((item) => item.length > 0)
        : [],
      resolveReason: toString(record.resolveReason),
    }
  }

  // undo_result：撤销结果（兼容单条与批量返回），统一 appliedCount/canUndo/canRedo。
  private normalizeUndoResult(data: unknown) {
    const record = isObject(data) ? data : {}
    const operations = Array.isArray(record.operations)
      ? record.operations.filter((item): item is Record<string, unknown> => isObject(item))
      : []
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      success: typeof record.success === 'boolean' ? record.success : true,
      operation: isObject(record.operation) ? (record.operation as unknown) : undefined,
      operations: operations.length > 0 ? (operations as unknown) : undefined,
      operationId: toNumber(record.operationId),
      undoOperationId: toNumber(record.undoOperationId),
      canUndo: !!record.canUndo,
      canRedo: !!record.canRedo,
      appliedCount: toNumber(record.appliedCount, 1),
    }
  }

  // redo_result：重做结果（兼容单条与批量返回）。
  private normalizeRedoResult(data: unknown) {
    const record = isObject(data) ? data : {}
    const operations = Array.isArray(record.operations)
      ? record.operations.filter((item): item is Record<string, unknown> => isObject(item))
      : []
    return {
      sessionKey: toString(record.sessionKey, this.sessionKey),
      success: typeof record.success === 'boolean' ? record.success : true,
      operation: isObject(record.operation) ? (record.operation as unknown) : undefined,
      operations: operations.length > 0 ? (operations as unknown) : undefined,
      operationId: toNumber(record.operationId),
      redoOperationId: toNumber(record.redoOperationId),
      canUndo: !!record.canUndo,
      canRedo: !!record.canRedo,
      appliedCount: toNumber(record.appliedCount, 1),
    }
  }

  // error：服务端或协议层错误。
  private normalizeError(data: unknown): WsErrorData {
    const record = isObject(data) ? data : {}
    return {
      code: toNumber(record.code, 4001),
      message: toString(record.message, 'WebSocket 错误'),
      originalType: toString(record.originalType, 'unknown'),
    }
  }

  // 当服务端消息缺字段时，构造一个可渲染的兜底图元，避免前端直接崩溃。
  private buildFallbackGraphic(source: Record<string, unknown>): GraphicVO {
    const objectKey = toString(source.objectKey, '')
    return {
      id: toNumber(source.id),
      sessionId: toNumber(source.sessionId),
      objectKey,
      objectType: (toString(source.objectType, 'line') as GraphicVO['objectType']) || 'line',
      positionX: toNumber(source.positionX),
      positionY: toNumber(source.positionY),
      width: typeof source.width === 'number' ? source.width : null,
      height: typeof source.height === 'number' ? source.height : null,
      strokeColor: toString(source.strokeColor, '#000000'),
      lineStyle: source.lineStyle === 'dashed' ? 'dashed' : 'solid',
      fillColor: typeof source.fillColor === 'string' ? source.fillColor : null,
      strokeWidth: toNumber(source.strokeWidth, 1),
      textContent: typeof source.textContent === 'string' ? source.textContent : null,
      fontSize: typeof source.fontSize === 'number' ? source.fontSize : null,
      pathPoints: toPathPoints(source.pathPoints),
      isLocked: source.isLocked === true || source.isLocked === 1,
      rotation: toNumber(source.rotation),
      zIndex: toNumber(source.zIndex),
      version: toNumber(source.version),
      creatorId: toNumber(source.creatorId),
      createdAt: toString(source.createdAt),
      updatedAt: toString(source.updatedAt),
    }
  }
}

export default WebSocketClient
