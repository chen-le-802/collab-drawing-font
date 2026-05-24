import { computed, ref } from 'vue'

import { sessionApi } from '@/api/session'
import type {
  CollaborationConflictType,
  MemberVO,
  SessionConflictLogItemVO,
  SessionOperationItemVO,
  SessionOperationTimelineVO,
  SessionOperationType,
} from '@/types/session'
import { feedback } from '@/utils/feedback'

type UseOperationConflictLogsOptions = {
  getSessionKey: () => string
  getSessionMembers: () => MemberVO[]
  getOperationActorLabel: (userId: number) => string
  isRecord: (value: unknown) => value is Record<string, unknown>
  parseNumber: (value: unknown, fallback?: number) => number
}

const timelineUpdateFieldOrder: string[] = [
  'positionX',
  'positionY',
  'width',
  'height',
  'rotation',
  'pathPoints',
  'strokeColor',
  'fillColor',
  'strokeWidth',
  'lineStyle',
  'textContent',
  'fontSize',
  'zIndex',
  'isLocked',
]

// 操作时间线与冲突日志模块：
// 负责筛选查询、分页、技术详情展开状态、以及展示文案格式化。
// 目标是把 index.vue 中“日志面板逻辑”独立出来，保持主页面可读性。
export const useOperationConflictLogs = (options: UseOperationConflictLogsOptions) => {
  const operationTimelineLoading = ref(false)
  const operationTimeline = ref<SessionOperationTimelineVO | null>(null)
  const operationTimelineFilterUserId = ref<number | null>(null)
  const operationTimelineFilterOperationType = ref<SessionOperationType | 'all' | 'restore'>('all')
  const operationTimelineFilterConflictType = ref<CollaborationConflictType | 'all'>('all')
  const operationTimelineFilterFromVersion = ref<number | null>(null)
  const operationTimelineFilterToVersion = ref<number | null>(null)
  const operationTimelinePage = ref(1)
  const operationTimelinePageSize = ref(20)
  const operationTimelineTechnicalExpandedIds = ref<number[]>([])

  const conflictLogs = ref<SessionConflictLogItemVO[]>([])
  const conflictTechnicalExpandedIds = ref<number[]>([])
  const loadingConflictLogs = ref(false)
  const conflictSinceId = ref(0)

  const operationTimelineForDisplay = computed(() => operationTimeline.value?.list ?? [])
  const operationTimelineTotal = computed(() => operationTimeline.value?.total ?? 0)
  const operationTimelineUserOptions = computed(() => {
    const members = options.getSessionMembers()
    return members.map((item) => ({
      label: item.username,
      value: item.userId,
    }))
  })

  const isOperationTimelineTechnicalExpanded = (id: number) => {
    return operationTimelineTechnicalExpandedIds.value.includes(id)
  }

  const toggleOperationTimelineTechnical = (id: number) => {
    if (isOperationTimelineTechnicalExpanded(id)) {
      operationTimelineTechnicalExpandedIds.value = operationTimelineTechnicalExpandedIds.value.filter((item) => item !== id)
      return
    }
    operationTimelineTechnicalExpandedIds.value = [...operationTimelineTechnicalExpandedIds.value, id]
  }

  const isConflictTechnicalExpanded = (id: number) => {
    return conflictTechnicalExpandedIds.value.includes(id)
  }

  const toggleConflictTechnical = (id: number) => {
    if (isConflictTechnicalExpanded(id)) {
      conflictTechnicalExpandedIds.value = conflictTechnicalExpandedIds.value.filter((item) => item !== id)
      return
    }
    conflictTechnicalExpandedIds.value = [...conflictTechnicalExpandedIds.value, id]
  }

  const loadOperationTimeline = async () => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey || operationTimelineLoading.value) {
      return
    }
    operationTimelineLoading.value = true
    try {
      operationTimeline.value = await sessionApi.getOperationTimeline(sessionKey, {
        ...(typeof operationTimelineFilterFromVersion.value === 'number'
          ? { fromVersion: operationTimelineFilterFromVersion.value }
          : {}),
        ...(typeof operationTimelineFilterToVersion.value === 'number'
          ? { toVersion: operationTimelineFilterToVersion.value }
          : {}),
        ...(typeof operationTimelineFilterUserId.value === 'number' ? { userId: operationTimelineFilterUserId.value } : {}),
        ...(operationTimelineFilterOperationType.value !== 'all'
          ? { operationType: operationTimelineFilterOperationType.value }
          : {}),
        ...(operationTimelineFilterConflictType.value !== 'all'
          ? { conflictType: operationTimelineFilterConflictType.value }
          : {}),
        page: operationTimelinePage.value,
        pageSize: operationTimelinePageSize.value,
      })
    } catch (error) {
      feedback.errorFrom(error, '加载操作时间线失败')
    } finally {
      operationTimelineLoading.value = false
    }
  }

  // 打开时间线：重置页码与展开态后再加载。
  const openOperationTimeline = async () => {
    operationTimelinePage.value = 1
    operationTimelineTechnicalExpandedIds.value = []
    await loadOperationTimeline()
  }

  // 重置筛选条件并回到第一页。
  const resetOperationTimelineFilters = async () => {
    operationTimelineFilterUserId.value = null
    operationTimelineFilterOperationType.value = 'all'
    operationTimelineFilterConflictType.value = 'all'
    operationTimelineFilterFromVersion.value = null
    operationTimelineFilterToVersion.value = null
    operationTimelinePage.value = 1
    operationTimelineTechnicalExpandedIds.value = []
    await loadOperationTimeline()
  }

  const searchOperationTimeline = async () => {
    operationTimelinePage.value = 1
    await loadOperationTimeline()
  }

  const changeOperationTimelinePage = async (page: number) => {
    operationTimelinePage.value = page
    await loadOperationTimeline()
  }

  const refreshConflictLogs = async (forceFromStart = false) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey || loadingConflictLogs.value) {
      return
    }
    loadingConflictLogs.value = true
    try {
      const sinceId = forceFromStart ? 0 : conflictSinceId.value
      const result = await sessionApi.getConflictLogs(sessionKey, sinceId, 100)
      if (forceFromStart) {
        conflictLogs.value = result.conflicts
      } else {
        conflictLogs.value = [...conflictLogs.value, ...result.conflicts]
      }
      const maxId = result.conflicts.reduce((max, item) => Math.max(max, item.id), forceFromStart ? 0 : conflictSinceId.value)
      conflictSinceId.value = maxId
    } catch (error) {
      feedback.errorFrom(error, '加载冲突日志失败')
    } finally {
      loadingConflictLogs.value = false
    }
  }

  const formatSessionOperationTypeLabel = (operationType: SessionOperationType) => {
    if (operationType === 'create') return '创建图元'
    if (operationType === 'update') return '更新图元'
    return '删除图元'
  }

  const formatFieldNamesText = (fields: string[]) => (fields.length > 0 ? fields.join(', ') : '-')

  const formatObjectTypeLabel = (value: unknown) => {
    const type = typeof value === 'string' ? value : ''
    const map: Record<string, string> = {
      rect: '矩形',
      circle: '圆形',
      ellipse: '椭圆',
      line: '直线',
      path: '路径',
      text: '文本',
      image: '图片',
    }
    return map[type] ?? (type || '图元')
  }

  const getResolvedFieldList = (item: SessionOperationItemVO, key: 'appliedFields' | 'rejectedFields') => {
    if (!item.resolvedResult || typeof item.resolvedResult !== 'object') {
      return [] as string[]
    }
    const resolved = item.resolvedResult as Record<string, unknown>
    const value = resolved[key]
    if (!Array.isArray(value)) {
      return [] as string[]
    }
    return value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
  }

  const extractTimelineUpdateFieldKeys = (item: SessionOperationItemVO): string[] => {
    // 优先从 operationData 提取字段；兜底用 resolvedResult.appliedFields。
    const payload = options.isRecord(item.operationData) ? item.operationData : {}
    const fromPayload = timelineUpdateFieldOrder.filter((key) => typeof payload[key] !== 'undefined')
    if (fromPayload.length > 0) {
      return fromPayload
    }
    const applied = getResolvedFieldList(item, 'appliedFields')
    return timelineUpdateFieldOrder.filter((key) => applied.includes(key))
  }

  const isRestoreTimelineEvent = (item: SessionOperationItemVO): boolean => {
    const payload = options.isRecord(item.operationData) ? item.operationData : {}
    return payload.__systemEvent === 'restore_version'
  }

  const getRestoreTimelineMeta = (item: SessionOperationItemVO) => {
    const payload = options.isRecord(item.operationData) ? item.operationData : {}
    const resolved = options.isRecord(item.resolvedResult) ? item.resolvedResult : {}
    const targetVersion = options.parseNumber(payload.targetVersion ?? resolved.targetVersion, 0)
    const previousVersion = options.parseNumber(payload.previousVersion ?? resolved.previousVersion ?? item.baseVersion, item.baseVersion)
    const restoredVersion = options.parseNumber(payload.restoredVersion ?? resolved.restoredVersion ?? item.serverVersion, item.serverVersion)
    const createdCount = options.parseNumber(payload.createdCount ?? resolved.createdCount, 0)
    const updatedCount = options.parseNumber(payload.updatedCount ?? resolved.updatedCount, 0)
    const deletedCount = options.parseNumber(payload.deletedCount ?? resolved.deletedCount, 0)
    return { targetVersion, previousVersion, restoredVersion, createdCount, updatedCount, deletedCount }
  }

  const formatConflictTypeLabel = (conflictType: CollaborationConflictType) => {
    if (conflictType === 'none') return '无冲突'
    if (conflictType === 'field_merge') return '字段合并'
    if (conflictType === 'field_conflict') return '字段冲突'
    if (conflictType === 'delete_wins') return '删除优先'
    return '重复操作'
  }

  const formatFieldNameLabel = (field: string) => {
    const map: Record<string, string> = {
      positionX: 'X坐标',
      positionY: 'Y坐标',
      width: '宽度',
      height: '高度',
      strokeColor: '描边颜色',
      fillColor: '填充颜色',
      strokeWidth: '线宽',
      lineStyle: '线型',
      textContent: '文本内容',
      fontSize: '字体大小',
      pathPoints: '路径点',
      zIndex: '图层',
      rotation: '旋转角度',
      isLocked: '锁定状态',
    }
    return map[field] ?? field
  }

  const formatTimelineActivityText = (item: SessionOperationItemVO) => {
    const actor = options.getOperationActorLabel(item.userId)
    const payload = options.isRecord(item.operationData) ? item.operationData : {}
    const resolved = options.isRecord(item.resolvedResult) ? item.resolvedResult : {}
    const resolvedGraphic = options.isRecord(resolved.graphic) ? resolved.graphic : {}
    const objectType = formatObjectTypeLabel(payload.objectType ?? resolvedGraphic.objectType)

    if (isRestoreTimelineEvent(item)) {
      const meta = getRestoreTimelineMeta(item)
      return `${actor} 恢复到历史版本 V${meta.targetVersion}（V${meta.previousVersion} → V${meta.restoredVersion}）`
    }
    if (item.operationType === 'create') return `${actor} 创建了${objectType}（${item.objectKey || '对象'}）`
    if (item.operationType === 'delete') return `${actor} 删除了${objectType}（${item.objectKey || '对象'}）`

    const updateFields = extractTimelineUpdateFieldKeys(item)
      .map((field) => formatFieldNameLabel(field))
      .filter((field, index, arr) => field && arr.indexOf(field) === index)
    if (updateFields.length === 0) {
      return `${actor} 更新了${objectType}（${item.objectKey || '对象'}）`
    }
    return `${actor} 更新了${objectType}（${item.objectKey || '对象'}），更新字段：${updateFields.join('、')}`
  }

  const formatTimelineConflictHint = (item: SessionOperationItemVO) => {
    if (isRestoreTimelineEvent(item)) {
      const meta = getRestoreTimelineMeta(item)
      return `恢复结果：新增 ${meta.createdCount}，更新 ${meta.updatedCount}，删除 ${meta.deletedCount}。`
    }
    if (item.conflictType === 'none') return '该操作未触发冲突。'
    const applied = formatFieldNamesText(getResolvedFieldList(item, 'appliedFields'))
    const rejected = formatFieldNamesText(getResolvedFieldList(item, 'rejectedFields'))
    return `冲突类型：${formatConflictTypeLabel(item.conflictType)}；采用字段：${applied}；拒绝字段：${rejected}`
  }

  const formatResolveReasonLabel = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length > 0) return value
    return '-'
  }

  const formatConflictResolveStrategyLabel = (strategy: string) => (strategy ? strategy : '-')

  const formatConflictValue = (value: unknown): string => {
    if (value === null || typeof value === 'undefined') return '-'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return '[复杂对象]'
    }
  }

  const formatConflictLogSummary = (item: SessionConflictLogItemVO) => {
    const field = formatFieldNameLabel(item.fieldName || '-')
    const strategy = formatConflictResolveStrategyLabel(item.resolveStrategy)
    if (item.conflictType === 'field_merge') return `字段 ${field} 与并发修改可合并，已采用传入值。`
    if (item.conflictType === 'field_conflict') return `字段 ${field} 发生并发冲突，系统已按 ${strategy} 选择最终值。`
    if (item.conflictType === 'delete_wins') return `目标图元已被删除，本次字段 ${field} 的修改未生效（删除优先）。`
    if (item.conflictType === 'duplicate_operation') return '检测到重复操作提交，系统已按幂等策略忽略重复执行。'
    return `字段 ${field} 无冲突，按策略 ${strategy} 正常处理。`
  }

  return {
    operationTimelineLoading,
    operationTimelineFilterUserId,
    operationTimelineFilterOperationType,
    operationTimelineFilterConflictType,
    operationTimelineFilterFromVersion,
    operationTimelineFilterToVersion,
    operationTimelinePage,
    operationTimelinePageSize,
    operationTimelineForDisplay,
    operationTimelineTotal,
    operationTimelineUserOptions,
    conflictLogs,
    loadingConflictLogs,
    isOperationTimelineTechnicalExpanded,
    toggleOperationTimelineTechnical,
    isConflictTechnicalExpanded,
    toggleConflictTechnical,
    openOperationTimeline,
    resetOperationTimelineFilters,
    searchOperationTimeline,
    changeOperationTimelinePage,
    refreshConflictLogs,
    formatSessionOperationTypeLabel,
    formatFieldNamesText,
    formatConflictTypeLabel,
    formatFieldNameLabel,
    formatTimelineActivityText,
    formatTimelineConflictHint,
    getResolvedFieldList,
    formatResolveReasonLabel,
    formatConflictResolveStrategyLabel,
    formatConflictValue,
    formatConflictLogSummary,
    // 暴露展开 id 集，供对话框每次打开时显式重置。
    operationTimelineTechnicalExpandedIds,
    conflictTechnicalExpandedIds,
  }
}
