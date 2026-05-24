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

// 统一把业务错误码转换为异常抛出，调用侧只需要处理成功/失败分支。
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
  // 创建会话。
  // 用于在首页/会话列表中新建一个协作画布会话，返回会话基础信息（含 sessionKey）。
  async create(name: string): Promise<SessionVO> {
    // 对齐后端路由：POST /api/v1/sessions
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
    // 查询会话列表（支持分页 + 状态筛选 + 创建者筛选）。
    // 典型场景：主页显示“进行中/已归档/我创建”的会话清单。
    // 对齐后端路由：GET /api/v1/sessions?page=&pageSize=&status=&creatorId=
    const res = await http.get<ApiResponse<SessionListVO>>('v1/sessions', {
      params: { page, pageSize, status, creatorId },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    // 当后端 data 为 null 时提供分页兜底，减少页面判空分支。
    return res.data.data ?? { list: [], total: 0, page, pageSize }
  },

  async listMyCreated(page = 1, pageSize = 12, creatorId?: number): Promise<SessionListVO> {
    // 复用通用 list 接口，通过 creatorId 过滤“我创建的会话”。
    return sessionApi.list(page, pageSize, undefined, creatorId)
  },

  // 获取会话详情。
  // 返回会话名称、版本、成员列表、权限相关信息；可选附带历史成员。
  async getDetail(sessionKey: string, includeHistory = false): Promise<SessionDetailVO> {
    // 对齐后端路由：GET /api/v1/sessions/:sessionKey
    const res = await http.get<ApiResponse<SessionDetailVO>>(`v1/sessions/${sessionKey}`, {
      params: { includeHistory: includeHistory ? 1 : 0 },
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  // 拉取会话操作流（按 sinceVersion 增量同步）。
  // 典型场景：重连后追平遗漏操作，恢复到最新画布状态。
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
    // 查询“操作历史时间线”。
    // 支持按版本范围、操作者、操作类型、冲突类型筛选，并分页返回。
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

  // 查询冲突日志。
  // 按 sinceId 增量获取冲突记录，供冲突面板实时或手动刷新展示。
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

  // 创建画布快照。
  // 可选传快照名称；用于版本留档、演示回滚、误操作恢复。
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

  // 获取快照列表。
  // 返回当前会话已有快照（含版本号、图元数量、创建者等信息）。
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

  // 获取指定版本的回放数据。
  // 后端返回从基快照到目标版本的操作序列，供前端进行版本回放/导出预览。
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

  // 恢复到指定版本。
  // 会覆盖当前画布状态，并在服务端生成新的版本推进结果。
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
    // 创建邀请链接（邀请码）。
    // 可配置入会角色、最大使用次数、过期时间，返回可分享的 inviteToken/path。
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

  // 获取邀请列表。
  // 默认返回可用邀请；可选 includeUsed=1 以包含已使用/失效历史。
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

  // 撤销（禁用）某条邀请。
  // 撤销后该 inviteToken 不可再用于加入会话。
  async revokeInvite(sessionKey: string, inviteId: number): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/invites/${inviteId}/revoke`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  // 上传会话内图片资源。
  // 返回图片可访问 URL，前端据此创建 image 图元并同步到画布。
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

  // 加入会话。
  // 可携带 inviteToken 通过邀请加入；返回当前成员在会话中的基础上下文。
  async join(sessionKey: string, inviteToken?: string): Promise<SessionJoinVO> {
    // 对齐后端路由：POST /api/v1/sessions/:sessionKey/join
    const payload = inviteToken ? { inviteToken } : undefined
    const res = await http.post<ApiResponse<SessionJoinVO>>(`v1/sessions/${sessionKey}/join`, payload)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  // 会话心跳。
  // 用于维持在线状态、刷新最后活跃时间，通常由前端定时器周期调用。
  async heartbeat(sessionKey: string): Promise<void> {
    // 对齐后端路由：POST /api/v1/sessions/:sessionKey/heartbeat
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/heartbeat`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  // 主动离开会话。
  // 服务端会更新成员关系与在线状态；调用成功后前端应退出会话页。
  async leave(sessionKey: string): Promise<void> {
    // 对齐后端路由：POST /api/v1/sessions/:sessionKey/leave
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/leave`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    // 成功时无业务数据，调用侧只关心是否抛错。
  },

  // 移除成员。
  // 由管理员/房主对目标成员执行移除，移除后目标用户失去该会话访问权限。
  async removeMember(sessionKey: string, targetUserId: number): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/members/${targetUserId}/remove`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  // 更新成员角色。
  // 可将目标成员设置为 viewer/editor/manager（具体受服务端权限规则约束）。
  async updateMemberRole(sessionKey: string, targetUserId: number, role: 0 | 1 | 2): Promise<void> {
    const res = await http.post<ApiResponse<null>>(`v1/sessions/${sessionKey}/members/${targetUserId}/role`, { role })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },

  // 更新会话暂停状态。
  // 暂停后通常进入只读协作态，恢复后可继续编辑。
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

  // 关闭会话。
  // 会话关闭后不再允许正常编辑，列表中通常转为“已归档/已结束”状态。
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

  // 删除会话。
  // 高风险操作，删除后会话入口与其核心数据将不可继续按正常流程访问。
  async deleteSession(sessionKey: string): Promise<void> {
    // 对齐后端路由：DELETE /api/v1/sessions/:sessionKey
    const res = await http.delete<ApiResponse<null>>(`v1/sessions/${sessionKey}`)
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
  },
}
