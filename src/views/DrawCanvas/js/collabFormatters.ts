import type { CollaborationConflictType, SessionConflictLogItemVO, SessionOperationItemVO, SessionOperationType } from '@/types/session'

// 协作日志/冲突日志文案格式化模块：
// 负责把后端技术字段转成人类可读描述，供时间线和冲突面板复用。
const FIELD_NAME_MAP: Record<string, string> = {
  positionX: 'X 坐标',
  positionY: 'Y 坐标',
  width: '宽度',
  height: '高度',
  strokeColor: '描边颜色',
  fillColor: '填充颜色',
  strokeWidth: '线宽',
  textContent: '文本内容',
  fontSize: '字体大小',
  pathPoints: '路径点',
  zIndex: '层级',
  delete: '删除标记',
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const next = Number(value)
    return Number.isFinite(next) ? next : null
  }
  return null
}

const isRestoreOperation = (item: SessionOperationItemVO): boolean => {
  if (isRecord(item.operationData) && item.operationData.__systemEvent === 'restore_version') {
    return true
  }
  if (typeof item.clientId === 'string' && item.clientId.startsWith('restore_')) {
    return true
  }
  return typeof item.operationId === 'string' && item.operationId.startsWith('rs_')
}

const resolveCircleTypeLabel = (operationData: Record<string, unknown>): string => {
  const width = toNumber(operationData.width)
  const height = toNumber(operationData.height)
  if (width === null || height === null) {
    return '圆形'
  }
  return Math.abs(width - height) <= 0.5 ? '圆形' : '椭圆形'
}

export const formatSessionOperationTypeLabel = (operationType: SessionOperationType) => {
  if (operationType === 'create') {
    return '创建图元'
  }
  if (operationType === 'update') {
    return '更新图元'
  }
  return '删除图元'
}

// 图元类型显示文案（用于日志摘要）。
export const formatGraphicTypeLabel = (value: unknown): string => {
  if (value === 'rect') {
    return '矩形'
  }
  if (value === 'circle') {
    return '圆形'
  }
  if (value === 'text') {
    return '文本'
  }
  if (value === 'path') {
    return '自由路径'
  }
  if (value === 'image') {
    return '图片'
  }
  return '线条'
}

export const formatFieldNameLabel = (fieldName: string): string => {
  return FIELD_NAME_MAP[fieldName] || fieldName
}

export const formatFieldNamesText = (fieldNames: string[]): string => {
  if (fieldNames.length === 0) {
    return '无'
  }
  return fieldNames.map((item) => formatFieldNameLabel(item)).join('、')
}

export const formatResolveReasonLabel = (reason: unknown): string => {
  if (reason === 'created') {
    return '创建成功'
  }
  if (reason === 'no_conflict') {
    return '无冲突直接应用'
  }
  if (reason === 'outdated_base_version_merged') {
    return '基线版本落后，已自动合并'
  }
  if (reason === 'field_conflict_resolved_by_lamport') {
    return '同字段并发冲突，按 Lamport + clientId 裁决'
  }
  if (reason === 'delete_tombstone_applied') {
    return '删除墓碑生效（Delete-Wins）'
  }
  if (reason === 'duplicate_operation_ignored') {
    return '重复操作已忽略'
  }
  if (typeof reason === 'string' && reason.trim().length > 0) {
    return reason
  }
  return '-'
}

// 从 resolvedResult 中提取“采用字段/拒绝字段”列表。
export const getResolvedFieldList = (item: SessionOperationItemVO, key: 'appliedFields' | 'rejectedFields'): string[] => {
  if (!isRecord(item.resolvedResult)) {
    return []
  }
  const raw = item.resolvedResult[key]
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
}

// 时间线主摘要（谁做了什么）。
export const formatTimelineActivitySummary = (item: SessionOperationItemVO, actor: string): string => {
  const appliedFields = getResolvedFieldList(item, 'appliedFields')
  const restorePrefix = isRestoreOperation(item) ? '【恢复】' : ''
  if (item.operationType === 'create') {
    let objectType = '图元'
    if (isRecord(item.operationData)) {
      if (item.operationData.objectType === 'circle') {
        objectType = resolveCircleTypeLabel(item.operationData)
      } else {
        objectType = formatGraphicTypeLabel(item.operationData.objectType)
      }
    }
    return `${restorePrefix}${actor} 创建了${objectType}`
  }
  if (item.operationType === 'delete') {
    return `${restorePrefix}${actor} 删除了一个图元`
  }
  if (appliedFields.length > 0) {
    return `${restorePrefix}${actor} 更新了 ${formatFieldNamesText(appliedFields)}`
  }
  return `${restorePrefix}${actor} 更新了图元`
}

// 时间线冲突提示（发生了什么冲突，系统如何处理）。
export const formatTimelineConflictHint = (item: SessionOperationItemVO): string => {
  if (item.conflictType === 'none') {
    return '已同步完成，未发生冲突。'
  }
  if (item.conflictType === 'field_merge') {
    return '并发修改了不同属性，系统已自动合并。'
  }
  if (item.conflictType === 'field_conflict') {
    return '多人同时修改同一属性，系统已按逻辑时钟自动裁决。'
  }
  if (item.conflictType === 'delete_wins') {
    return '对象已被删除，旧更新不会重新恢复该对象。'
  }
  return '重复操作已自动去重并忽略。'
}

export const formatConflictTypeLabel = (conflictType: CollaborationConflictType) => {
  if (conflictType === 'none') {
    return '无冲突'
  }
  if (conflictType === 'field_merge') {
    return '字段合并'
  }
  if (conflictType === 'field_conflict') {
    return '字段冲突'
  }
  if (conflictType === 'delete_wins') {
    return '删除优先'
  }
  return '重复操作'
}

export const formatConflictValue = (value: unknown): string => {
  if (value === null || typeof value === 'undefined') {
    return '-'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '[复杂对象]'
  }
}

export const formatConflictResolveStrategyLabel = (strategy: string): string => {
  if (strategy === 'lamport_then_client_id') {
    return '按 Lamport + clientId 裁决'
  }
  return strategy || '-'
}

// 冲突日志摘要（用于快速浏览列表）。
export const formatConflictLogSummary = (item: SessionConflictLogItemVO): string => {
  const fieldLabel = formatFieldNameLabel(item.fieldName || '-')
  if (item.conflictType === 'field_merge') {
    return `并发修改了不同属性（${fieldLabel}），系统已自动合并。`
  }
  if (item.conflictType === 'field_conflict') {
    return `多人同时修改同一属性（${fieldLabel}），系统已自动裁决。`
  }
  if (item.conflictType === 'delete_wins') {
    return '对象已被删除，旧更新不会重新恢复该对象。'
  }
  if (item.conflictType === 'duplicate_operation') {
    return '检测到重复提交，系统已自动忽略重复操作。'
  }
  return '系统已完成同步处理。'
}
