import type { GraphicVO } from '@/types/graphic'
import type { MemberVO } from '@/types/session'

export type ClientMessageType =
  | 'join_session'
  | 'leave_session'
  | 'create_graphic'
  | 'update_graphic'
  | 'delete_graphic'
  | 'undo'
  | 'redo'
  | 'ping'

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

export interface CreateGraphicData {
  sessionKey: string
  objectKey: string
  objectType: 'line' | 'rect' | 'circle' | 'text'
  positionX: number
  positionY: number
  width?: number
  height?: number
  strokeColor: string
  fillColor?: string
  strokeWidth: number
  zIndex: number
  textContent?: string
  fontSize?: number
}

export interface UpdateGraphicData {
  sessionKey: string
  objectKey: string
  positionX?: number
  positionY?: number
  width?: number
  height?: number
  strokeColor?: string
  fillColor?: string
  strokeWidth?: number
  zIndex?: number
  textContent?: string
  fontSize?: number
}

export interface DeleteGraphicData {
  sessionKey: string
  objectKey: string
}

export interface UndoRedoData {
  sessionKey: string
}

export type ServerMessageType =
  | 'session_joined'
  | 'session_left'
  | 'member_joined'
  | 'member_left'
  | 'member_status_changed'
  | 'graphic_created'
  | 'graphic_updated'
  | 'graphic_deleted'
  | 'undo_result'
  | 'redo_result'
  | 'error'
  | 'pong'

export interface ServerMessage<T = unknown> {
  type: ServerMessageType
  data: T
  timestamp: number
}

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

export interface UndoResultData {
  sessionKey: string
  operationId: number
  undoOperationId: number
  canUndo: boolean
  canRedo: boolean
}

export interface RedoResultData {
  sessionKey: string
  operationId: number
  redoOperationId: number
  canUndo: boolean
  canRedo: boolean
}

export interface WsErrorData {
  code: number
  message: string
  originalType: string
}

export interface PongData {
  timestamp?: number
}

export type ServerMessageDataMap = {
  session_joined: SessionJoinedData
  session_left: SessionLeftData
  member_joined: MemberJoinedData
  member_left: MemberJoinedData
  member_status_changed: MemberStatusChangedData
  graphic_created: GraphicCreatedData
  graphic_updated: GraphicUpdatedData
  graphic_deleted: GraphicDeletedData
  undo_result: UndoResultData
  redo_result: RedoResultData
  error: WsErrorData
  pong: PongData
}

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

export type WebSocketClientEventType = ServerMessageType | ClientLifecycleEventType

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
