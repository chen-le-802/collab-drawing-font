import type { GraphicVO } from '@/types/graphic'

export type SessionStatus = 0 | 1

export interface MemberVO {
  userId: number
  username: string
  avatar?: string
  role: number
  onlineStatus: number
  joinedAt: string
  membershipStatus?: 'active' | 'left' | 'removed'
  leftAt?: string
  removedAt?: string
}

export interface SessionMemberPreviewVO {
  userId: number
  username: string
  avatar?: string
  isOnline: boolean
}

// 会话列表卡片使用的数据结构。
export interface SessionVO {
  sessionId: number
  sessionKey: string
  name: string
  thumbnail?: string
  status: SessionStatus
  isPaused?: boolean
  creatorId: number
  creatorName?: string
  memberCount?: number
  onlineMemberCount?: number
  memberPreviews?: SessionMemberPreviewVO[]
  currentVersion?: number
  lastOperationAt?: string
  lastOperationUserId?: number
  lastOperationUserName?: string
  createdAt: string
  updatedAt: string
}

// 会话详情在基础字段上补充成员信息。
export interface SessionDetailVO extends SessionVO {
  members: MemberVO[]
  currentVersion: number
}

// 加入会话后返回会话基础信息和当前画布全量数据。
export interface SessionJoinVO {
  sessionId: number
  sessionKey: string
  name: string
  currentVersion: number
  // 初次加入会话时返回的全量图形数据。
  graphics: GraphicVO[]
}

export interface SessionInviteCreateVO {
  sessionId: number
  sessionKey: string
  inviteToken: string
  role: 0 | 1 | 2
  maxUses: number | null
  expiresAt: string
  invitePath: string
}

export type SessionInviteStatus = 'active' | 'used' | 'expired' | 'revoked'

export interface SessionInviteItemVO {
  id: number
  inviteToken: string
  role: 0 | 1 | 2
  status: SessionInviteStatus
  maxUses: number | null
  usedCount: number
  createdBy: number
  createdAt: string
  expiresAt?: string
  invitePath?: string
}

export interface SessionInviteListVO {
  sessionId: number
  sessionKey: string
  list: SessionInviteItemVO[]
}

export interface SessionImageUploadVO {
  sessionId: number
  sessionKey: string
  url: string
}

export interface SessionListVO {
  list: SessionVO[]
  total: number
  page: number
  pageSize: number
}

export type CollaborationConflictType =
  | 'none'
  | 'field_merge'
  | 'field_conflict'
  | 'delete_wins'
  | 'duplicate_operation'

export type SessionOperationType = 'create' | 'update' | 'delete'

export interface SessionOperationItemVO {
  id: number
  operationId?: string
  sessionId: number
  userId: number
  objectKey: string
  operationType: SessionOperationType
  operationData: Record<string, unknown>
  baseVersion: number
  serverVersion: number
  lamportTime: number
  clientId?: string
  resolvedResult?: Record<string, unknown>
  conflictType: CollaborationConflictType
  timestamp: number
}

export interface SessionOperationsSyncVO {
  sessionId: number
  sessionKey: string
  sinceVersion: number
  currentVersion: number
  operations: SessionOperationItemVO[]
}

export interface SessionOperationTimelineQuery {
  fromVersion?: number
  toVersion?: number
  userId?: number
  operationType?: SessionOperationType | 'restore'
  conflictType?: CollaborationConflictType
  page?: number
  pageSize?: number
}

export interface SessionOperationTimelineVO {
  sessionId: number
  sessionKey: string
  currentVersion: number
  page: number
  pageSize: number
  total: number
  list: SessionOperationItemVO[]
}

export interface SessionConflictLogItemVO {
  id: number
  operationRefId?: number
  operationId?: string
  sessionId: number
  objectKey: string
  conflictType: CollaborationConflictType
  fieldName?: string
  currentValue?: unknown
  incomingValue?: unknown
  resolvedValue?: unknown
  resolveStrategy: string
  createdAt: string
}

export interface SessionConflictLogsVO {
  sessionId: number
  sessionKey: string
  sinceId: number
  limit: number
  conflicts: SessionConflictLogItemVO[]
}

export interface SessionSnapshotItemVO {
  id: number
  sessionId: number
  version: number
  snapshotName?: string
  graphicCount: number
  createdBy?: number
  createdByName?: string
  createdAt: string
}

export interface SessionSnapshotsVO {
  sessionId: number
  sessionKey: string
  currentVersion: number
  snapshots: SessionSnapshotItemVO[]
}

export interface SessionReplayVO {
  sessionId: number
  sessionKey: string
  targetVersion: number
  baseSnapshot?: SessionSnapshotItemVO
  baseSnapshotData?: {
    version: number
    graphics: Record<string, unknown>[]
  }
  operations: SessionOperationItemVO[]
}

export interface SessionRestoreVersionVO {
  sessionId: number
  sessionKey: string
  targetVersion: number
  previousVersion: number
  restoredVersion: number
  createdCount: number
  updatedCount: number
  deletedCount: number
}

export interface SessionPauseVO {
  sessionId: number
  sessionKey: string
  isPaused: boolean
}

export interface SessionCloseVO {
  sessionId: number
  sessionKey: string
  status: SessionStatus
}
