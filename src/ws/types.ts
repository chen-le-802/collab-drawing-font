import type { GraphicVO } from '@/types/graphic'
import type { MemberVO } from '@/types/session'

// 客户端 -> 服务端消息类型。
// 覆盖会话加入离开、图元增改删、撤销重做、协作态（光标/选中）和心跳。
// 作用：防止消息名乱写，前后端统一词典。
export type ClientMessageType =
  | 'join_session'
  | 'leave_session'
  | 'create_graphic'
  | 'update_graphic'
  | 'delete_graphic'
  | 'undo'
  | 'redo'
  | 'cursor_move'
  | 'selection_change'
  | 'ping'

// 客户端发送消息统一包结构。
export interface BaseClientMessage<T = unknown> {
  type: ClientMessageType
  data: T
  timestamp: number
}

export interface JoinSessionData {
  sessionKey: string
}

export interface LeaveSessionData {
  sessionKey: string
}

//协作元信息：operationId/baseVersion/lamportTime/clientId/batch*
//定义图元增加的业务载荷字段
export interface CreateGraphicData {
  sessionKey: string
  // 协作元信息：用于幂等、因果排序、冲突裁决和批量聚合。
  operationId?: string
  clientId?: string
  baseVersion?: number
  lamportTime?: number
  batchId?: string
  batchIndex?: number
  batchSize?: number
  batchLabel?: string
  objectKey: string
  objectType: 'line' | 'rect' | 'circle' | 'text' | 'path' | 'image'
  positionX: number
  positionY: number
  width?: number
  height?: number
  strokeColor: string
  lineStyle?: 'solid' | 'dashed'
  fillColor?: string | null
  strokeWidth: number
  zIndex: number
  textContent?: string
  fontSize?: number
  pathPoints?: Array<{ x: number; y: number }>
  isLocked?: boolean
  rotation?: number
}

//定义图元更改的业务载荷字段
export interface UpdateGraphicData {
  sessionKey: string
  // 协作元信息：用于幂等、因果排序、冲突裁决和批量聚合。
  operationId?: string
  clientId?: string
  baseVersion?: number
  lamportTime?: number
  batchId?: string
  batchIndex?: number
  batchSize?: number
  batchLabel?: string
  objectKey: string
  // 推荐使用 patch 提交变更字段；后面的同名扁平字段用于兼容旧形态。
  patch?: {
    positionX?: number
    positionY?: number
    width?: number
    height?: number
    strokeColor?: string
    lineStyle?: 'solid' | 'dashed'
    fillColor?: string | null
    strokeWidth?: number
    zIndex?: number
    textContent?: string
    fontSize?: number
    pathPoints?: Array<{ x: number; y: number }>
    isLocked?: boolean
    rotation?: number
  }
  positionX?: number
  positionY?: number
  width?: number
  height?: number
  strokeColor?: string
  lineStyle?: 'solid' | 'dashed'
  fillColor?: string | null
  strokeWidth?: number
  zIndex?: number
  textContent?: string
  fontSize?: number
  pathPoints?: Array<{ x: number; y: number }>
  isLocked?: boolean
  rotation?: number
}

//定义图元删除的业务载荷字段
export interface DeleteGraphicData {
  sessionKey: string
  // 协作元信息：用于幂等、因果排序、冲突裁决和批量聚合。
  operationId?: string
  clientId?: string
  baseVersion?: number
  lamportTime?: number
  batchId?: string
  batchIndex?: number
  batchSize?: number
  batchLabel?: string
  objectKey: string
}
//定义撤销重做消息（也带协作元字段）
export interface UndoRedoData {
  sessionKey: string
  // 协作元信息：用于幂等、因果排序和撤销链对齐。
  operationId?: string
  clientId?: string
  baseVersion?: number
  lamportTime?: number
  times?: number
}

export interface CursorMoveData {
  sessionKey: string
  x: number
  y: number
}

export interface SelectionChangeData {
  sessionKey: string
  // objectKey 为单选，objectKeys 为多选。两者按业务场景可同时或单独出现。
  objectKey?: string | null
  objectKeys?: string[]
}

// 服务端 -> 客户端消息类型。
export type ServerMessageType =
  | 'session_joined'
  | 'session_left'
  | 'session_restored'
  | 'session_paused'
  | 'member_joined'
  | 'member_left'
  | 'member_status_changed'
  | 'presence_cursor'
  | 'presence_selection'
  | 'graphic_created'
  | 'graphic_updated'
  | 'graphic_deleted'
  | 'operation_resolved'
  | 'undo_result'
  | 'redo_result'
  | 'error'
  | 'pong'

// 服务端消息统一包结构。
export interface ServerMessage<T = unknown> {
  type: ServerMessageType
  data: T
  timestamp: number
}

//会话加入成功后的初始化数据（成员、图元快照、当前版本）。
//作用：新连接快速同步到当前画布状态。
export interface SessionJoinedData {
  sessionKey: string
  sessionId: number
  name: string
  currentVersion: number
  graphics: GraphicVO[]
  members: MemberVO[]
}

export interface SessionLeftData {
  sessionKey: string
}

export interface SessionPausedData {
  sessionKey: string
  isPaused: boolean
  operatorUserId?: number
  operatorUsername?: string
}

export interface SessionRestoredData {
  sessionKey: string
  targetVersion: number
  restoredVersion: number
  operatorUserId: number
  operatorUsername: string
  createdCount: number
  updatedCount: number
  deletedCount: number
}

export interface MemberJoinedData {
  sessionKey: string
  userId: number
  username: string
  members: MemberVO[]
}

export interface MemberStatusChangedData {
  sessionKey: string
  userId: number
  username: string
  onlineStatus: number
  members: MemberVO[]
}

export interface GraphicCreatedData {
  sessionKey: string
  userId: number
  graphic: GraphicVO
  currentVersion: number
}

export interface GraphicUpdatedData {
  sessionKey: string
  userId: number
  graphic: { objectKey: string } & Partial<GraphicVO>
  currentVersion: number
}

export interface GraphicDeletedData {
  sessionKey: string
  userId: number
  objectKey: string
  currentVersion: number
}

export interface PresenceCursorData {
  sessionKey: string
  userId: number
  username: string
  x: number
  y: number
}

export interface PresenceSelectionData {
  sessionKey: string
  userId: number
  username: string
  // objectKey 为主选中对象，objectKeys 为多选全集。
  objectKey: string | null
  objectKeys: string[]
}

//后端冲突裁决结果：conflictType/appliedFields/rejectedFields/resolveReason
export interface OperationResolvedData {
  operationId: string
  objectKey: string
  operationType: OperationType
  serverVersion: number
  // 冲突类型由后端统一裁决，前端据此提示用户并记录日志。
  conflictType: 'none' | 'field_merge' | 'field_conflict' | 'delete_wins' | 'duplicate_operation'
  appliedFields: string[]
  rejectedFields: string[]
  resolveReason: string
}

export type OperationType = 'create_graphic' | 'update_graphic' | 'delete_graphic'

export interface OperationVO {
  operationId: number
  sessionId: number
  userId: number
  objectKey: string
  operationType: OperationType
  version: number
  timestamp: number
  data: Record<string, unknown>
}

export interface UndoResultData {
  sessionKey: string
  // success 缺省时按成功处理，兼容部分历史消息形态。
  success?: boolean
  operation?: OperationVO
  operations?: OperationVO[]
  operationId: number
  undoOperationId: number
  canUndo: boolean
  canRedo: boolean
  appliedCount?: number
}

export interface RedoResultData {
  sessionKey: string
  // success 缺省时按成功处理，兼容部分历史消息形态。
  success?: boolean
  operation?: OperationVO
  operations?: OperationVO[]
  operationId: number
  redoOperationId: number
  canUndo: boolean
  canRedo: boolean
  appliedCount?: number
}

export interface WsErrorData {
  code: number
  message: string
  originalType: string
}

export interface PongData {
  timestamp?: number
}

// 服务端消息类型 -> 具体 data 类型映射。
export type ServerMessageDataMap = {
  session_joined: SessionJoinedData
  session_left: SessionLeftData
  session_restored: SessionRestoredData
  session_paused: SessionPausedData
  member_joined: MemberJoinedData
  member_left: MemberJoinedData
  member_status_changed: MemberStatusChangedData
  presence_cursor: PresenceCursorData
  presence_selection: PresenceSelectionData
  graphic_created: GraphicCreatedData
  graphic_updated: GraphicUpdatedData
  graphic_deleted: GraphicDeletedData
  operation_resolved: OperationResolvedData
  undo_result: UndoResultData
  redo_result: RedoResultData
  error: WsErrorData
  pong: PongData
}

// 客户端连接生命周期事件（非服务端业务消息）。
export type ClientLifecycleEventType =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'reconnect_failed'

export interface ConnectedEventData {
  url: string
  reconnectAttempt: number
}

export interface DisconnectedEventData {
  code?: number
  reason?: string
  wasClean?: boolean
  manual: boolean
}

export interface ReconnectingEventData {
  attempt: number
  maxAttempts: number
  delay: number
}

export interface ReconnectFailedEventData {
  attempts: number
  maxAttempts: number
}

export type ClientLifecycleEventDataMap = {
  connected: ConnectedEventData
  disconnected: DisconnectedEventData
  reconnecting: ReconnectingEventData
  reconnect_failed: ReconnectFailedEventData
}

// 对外可订阅事件 = 服务端业务消息 + 客户端连接生命周期事件。
export type WebSocketClientEventType = ServerMessageType | ClientLifecycleEventType

// 对外事件类型 -> data 类型映射。
export type WebSocketClientEventDataMap = ServerMessageDataMap & ClientLifecycleEventDataMap

// 文档形态：data = { sessionKey, userId, graphic, currentVersion }。
export interface RawGraphicCreatedWrapped {
  sessionKey?: string
  userId?: number
  graphic?: unknown
  currentVersion?: number
}

// 后端现状：data = GraphicVO。
export type RawGraphicCreatedData = RawGraphicCreatedWrapped | unknown

// 文档形态：data = { sessionKey, userId, graphic, currentVersion }。
export interface RawGraphicUpdatedWrapped {
  sessionKey?: string
  userId?: number
  graphic?: unknown
  currentVersion?: number
}

// 后端现状：data = GraphicVO。
export type RawGraphicUpdatedData = RawGraphicUpdatedWrapped | unknown

// 文档形态：data = { sessionKey, userId, objectKey, currentVersion }。
// 后端现状：data = { objectKey }。
export interface RawGraphicDeletedData {
  sessionKey?: string
  userId?: number
  objectKey?: string
  currentVersion?: number
}

// 后端现状 member_joined/member_left 最小字段：{ sessionKey, userId, username }。
// 文档形态可包含 members。
export interface RawMemberEventData {
  sessionKey?: string
  userId?: number
  username?: string
  members?: unknown
  onlineStatus?: number
}

// 以下 Raw* 类型用于“协议兼容层”：
// 后端/文档/历史实现可能存在字段差异，client.ts 会先做归一化再抛出强类型事件。
export interface RawSessionPausedData {
  sessionKey?: string
  isPaused?: boolean
  operatorUserId?: number
  operatorUsername?: string
}

export interface RawPresenceCursorData {
  sessionKey?: string
  userId?: number
  username?: string
  x?: number
  y?: number
}

export interface RawPresenceSelectionData {
  sessionKey?: string
  userId?: number
  username?: string
  objectKey?: string | null
  objectKeys?: unknown
}
