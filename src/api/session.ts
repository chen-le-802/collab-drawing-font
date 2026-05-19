import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { ApiResponse } from '@/types/api'
import type {
  SessionDetailVO,
  SessionInviteCreateVO,
  SessionInviteListVO,
  SessionImageUploadVO,
  SessionConflictLogsVO,
  SessionJoinVO,
  SessionListVO,
  SessionOperationTimelineQuery,
  SessionOperationTimelineVO,
  SessionOperationsSyncVO,
  SessionReplayVO,
  SessionCloseVO,
  SessionPauseVO,
  SessionRestoreVersionVO,
  SessionSnapshotItemVO,
  SessionSnapshotsVO,
  SessionStatus,
  SessionVO,
} from '@/types/session'

// 统一将业务错误码转换为抛错，保持调用侧只处理异常分支。
function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

export interface SessionAPI {
  create(name: string): Promise<SessionVO>
  list(
    page?: number,
    pageSize?: number,
    status?: SessionStatus,
    creatorId?: number,
  ): Promise<SessionListVO>
  listMyCreated(page?: number, pageSize?: number, creatorId?: number): Promise<SessionListVO>
  getDetail(sessionKey: string, includeHistory?: boolean): Promise<SessionDetailVO>
  getOperations(sessionKey: string, sinceVersion?: number): Promise<SessionOperationsSyncVO>
  getOperationTimeline(sessionKey: string, query?: SessionOperationTimelineQuery): Promise<SessionOperationTimelineVO>
  getConflictLogs(sessionKey: string, sinceId?: number, limit?: number): Promise<SessionConflictLogsVO>
  createSnapshot(sessionKey: string, snapshotName?: string): Promise<SessionSnapshotItemVO>
  getSnapshots(sessionKey: string, limit?: number): Promise<SessionSnapshotsVO>
  getReplay(sessionKey: string, targetVersion: number): Promise<SessionReplayVO>
  restoreVersion(sessionKey: string, targetVersion: number): Promise<SessionRestoreVersionVO>
  join(sessionKey: string, inviteToken?: string): Promise<SessionJoinVO>
  createInvite(
    sessionKey: string,
    role: 0 | 1 | 2,
    options?: { maxUses?: number; expiresInHours?: number },
  ): Promise<SessionInviteCreateVO>
  getInviteList(sessionKey: string, includeUsed?: boolean): Promise<SessionInviteListVO>
  revokeInvite(sessionKey: string, inviteId: number): Promise<void>
  uploadSessionImage(sessionKey: string, file: File): Promise<SessionImageUploadVO>
  heartbeat(sessionKey: string): Promise<void>
  leave(sessionKey: string): Promise<void>
  removeMember(sessionKey: string, targetUserId: number): Promise<void>
  updateMemberRole(sessionKey: string, targetUserId: number, role: 0 | 1 | 2): Promise<void>
  updatePausedStatus(sessionKey: string, isPaused: boolean): Promise<SessionPauseVO>
  closeSession(sessionKey: string): Promise<SessionCloseVO>
  deleteSession(sessionKey: string): Promise<void>
}

export const sessionApi: SessionAPI = {
  async create(name: string): Promise<SessionVO> {
    // 对齐后端：POST /api/v1/sessions
    const res = await http.post<ApiResponse<SessionVO>>('v1/sessions', { name })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  async list(
    page = 1,
    pageSize = 12,
    status?: SessionStatus,
    creatorId?: number,
  ): Promise<SessionListVO> {
    // 对齐后端：GET /api/v1/sessions?page=&pageSize=&status=&creatorId=
    const res = await http.get<ApiResponse<SessionListVO>>('v1/sessions', {
      params: { page, pageSize, status, creatorId },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    // 后端返回 null 时进行分页字段兜底，减少页面侧判空分支。
    return res.data.data ?? { list: [], total: 0, page, pageSize }
  },

  async listMyCreated(page = 1, pageSize = 12, creatorId?: number): Promise<SessionListVO> {
    // 我的会话通过 creatorId 过滤，返回“我创建的会话”。
    return sessionApi.list(page, pageSize, undefined, creatorId)
  },

  async getDetail(sessionKey: string, includeHistory = false): Promise<SessionDetailVO> {
    // 对齐后端：GET /api/v1/sessions/:sessionKey
    const res = await http.get<ApiResponse<SessionDetailVO>>(`v1/sessions/${sessionKey}`, {
      params: { includeHistory: includeHistory ? 1 : 0 },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  async getOperations(sessionKey: string, sinceVersion = 0): Promise<SessionOperationsSyncVO> {
    const res = await http.get<ApiResponse<SessionOperationsSyncVO>>(`v1/sessions/${sessionKey}/operations`, {
      params: { sinceVersion },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        sinceVersion,
        currentVersion: sinceVersion,
        operations: [],
      }
    )
  },

  async getOperationTimeline(
    sessionKey: string,
    query: SessionOperationTimelineQuery = {},
  ): Promise<SessionOperationTimelineVO> {
    const params = {
      fromVersion: query.fromVersion,
      toVersion: query.toVersion,
      userId: query.userId,
      operationType: query.operationType,
      conflictType: query.conflictType,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    }
    const res = await http.get<ApiResponse<SessionOperationTimelineVO>>(`v1/sessions/${sessionKey}/operation-timeline`, {
      params,
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        currentVersion: 0,
        page: params.page,
        pageSize: params.pageSize,
        total: 0,
        list: [],
      }
    )
  },

  async getConflictLogs(sessionKey: string, sinceId = 0, limit = 100): Promise<SessionConflictLogsVO> {
    const res = await http.get<ApiResponse<SessionConflictLogsVO>>(`v1/sessions/${sessionKey}/conflicts`, {
      params: { sinceId, limit },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        sinceId,
        limit,
        conflicts: [],
      }
    )
  },

  async createSnapshot(sessionKey: string, snapshotName?: string): Promise<SessionSnapshotItemVO> {
    const payload = typeof snapshotName === 'string' && snapshotName.trim().length > 0
      ? { snapshotName: snapshotName.trim() }
      : undefined
    const res = await http.post<ApiResponse<SessionSnapshotItemVO>>(`v1/sessions/${sessionKey}/snapshots`, payload)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        id: 0,
        sessionId: 0,
        version: 0,
        graphicCount: 0,
        createdAt: new Date().toISOString(),
      }
    )
  },

  async getSnapshots(sessionKey: string, limit = 20): Promise<SessionSnapshotsVO> {
    const res = await http.get<ApiResponse<SessionSnapshotsVO>>(`v1/sessions/${sessionKey}/snapshots`, {
      params: { limit },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        currentVersion: 0,
        snapshots: [],
      }
    )
  },

  async getReplay(sessionKey: string, targetVersion: number): Promise<SessionReplayVO> {
    const res = await http.get<ApiResponse<SessionReplayVO>>(`v1/sessions/${sessionKey}/replay`, {
      params: { targetVersion },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        targetVersion,
        operations: [],
      }
    )
  },

  async restoreVersion(sessionKey: string, targetVersion: number): Promise<SessionRestoreVersionVO> {
    const res = await http.post<ApiResponse<SessionRestoreVersionVO>>(`v1/sessions/${sessionKey}/restore-version`, {
      targetVersion,
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        targetVersion,
        previousVersion: 0,
        restoredVersion: 0,
        createdCount: 0,
        updatedCount: 0,
        deletedCount: 0,
      }
    )
  },

  async createInvite(
    sessionKey: string,
    role: 0 | 1 | 2,
    options?: { maxUses?: number; expiresInHours?: number },
  ): Promise<SessionInviteCreateVO> {
    const payload = {
      role,
      ...(typeof options?.maxUses === 'number' ? { maxUses: options.maxUses } : {}),
      ...(typeof options?.expiresInHours === 'number' ? { expiresInHours: options.expiresInHours } : {}),
    }
    const res = await http.post<ApiResponse<SessionInviteCreateVO>>(`v1/sessions/${sessionKey}/invites`, payload)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        inviteToken: '',
        role,
        maxUses: 1,
        expiresAt: new Date().toISOString(),
        invitePath: `/session/${sessionKey}`,
      }
    )
  },

  async getInviteList(sessionKey: string, includeUsed = false): Promise<SessionInviteListVO> {
    const res = await http.get<ApiResponse<SessionInviteListVO>>(`v1/sessions/${sessionKey}/invites`, {
      params: { includeUsed: includeUsed ? 1 : 0 },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        list: [],
      }
    )
  },

  async revokeInvite(sessionKey: string, inviteId: number): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/invites/${inviteId}/revoke`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  async uploadSessionImage(sessionKey: string, file: File): Promise<SessionImageUploadVO> {
    const formData = new FormData()
    formData.append('file', file)
    const res = await http.post<ApiResponse<SessionImageUploadVO>>(`v1/sessions/${sessionKey}/images`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  async join(sessionKey: string, inviteToken?: string): Promise<SessionJoinVO> {
    // 对齐后端：POST /api/v1/sessions/:sessionKey/join
    const payload = inviteToken ? { inviteToken } : undefined
    const res = await http.post<ApiResponse<SessionJoinVO>>(`v1/sessions/${sessionKey}/join`, payload)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  async heartbeat(sessionKey: string): Promise<void> {
    // 对齐后端：POST /api/v1/sessions/:sessionKey/heartbeat
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/heartbeat`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  async leave(sessionKey: string): Promise<void> {
    // 对齐后端：POST /api/v1/sessions/:sessionKey/leave
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/leave`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    // 该接口成功时无业务数据，调用侧只关心是否抛错。
  },

  async removeMember(sessionKey: string, targetUserId: number): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/members/${targetUserId}/remove`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  async updateMemberRole(sessionKey: string, targetUserId: number, role: 0 | 1 | 2): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/members/${targetUserId}/role`, { role })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  async updatePausedStatus(sessionKey: string, isPaused: boolean): Promise<SessionPauseVO> {
    const res = await http.post<ApiResponse<SessionPauseVO>>(`v1/sessions/${sessionKey}/pause`, { isPaused })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        isPaused,
      }
    )
  },

  async closeSession(sessionKey: string): Promise<SessionCloseVO> {
    const res = await http.post<ApiResponse<SessionCloseVO>>(`v1/sessions/${sessionKey}/close`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return (
      res.data.data ?? {
        sessionId: 0,
        sessionKey,
        status: 0,
      }
    )
  },

  async deleteSession(sessionKey: string): Promise<void> {
    // 对齐后端：DELETE /api/v1/sessions/:sessionKey
    const res = await http.delete<ApiResponse<null>>(`v1/sessions/${sessionKey}`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },
}
