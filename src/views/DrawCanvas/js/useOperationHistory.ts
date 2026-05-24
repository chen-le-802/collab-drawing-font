import { computed, ref, type Ref } from 'vue'

import type { GraphicVO } from '@/types/graphic'
import type { SessionConflictLogItemVO, SessionOperationItemVO } from '@/types/session'

export type OperationHistorySource = 'local' | 'remote' | 'system'

export interface OperationHistoryItem {
  id: string
  operationType: 'create_graphic' | 'update_graphic' | 'delete_graphic' | 'undo' | 'redo'
  objectKey: string
  userId: number | null
  userLabel: string
  source: OperationHistorySource
  detail?: string
  timestamp: number
  timeText: string
}

type UseOperationHistoryOptions = {
  graphicsRef: Ref<GraphicVO[]>
  selectedObjectKeyRef: Ref<string | null>
  selectedObjectKeysRef: Ref<string[]>
  focusedObjectKeyRef: Ref<string | null>
  conflictFocusMapRef: Ref<Record<string, { fields: string[]; updatedAt: number }>>
  conflictHistoryVisibleRef: Ref<boolean>
  focusHighlightTimerRef: Ref<number | null>
  canvasRef: Ref<HTMLCanvasElement | null>
  zoomScaleRef: Ref<number>
  viewportOffsetRef: Ref<{ x: number; y: number }>
  findMemberNameByUserId: (userId: number | null) => string | null
  formatFieldNameLabel: (field: string) => string
  getGraphicBounds: (graphic: GraphicVO) => { x: number; y: number; width: number; height: number }
  scheduleRender: () => void
  onWarning: (message: string) => void
}

// 本地操作历史模块：
// 负责维护简版历史列表，并提供“定位到图元”能力给时间线/冲突面板复用。
export const useOperationHistory = (options: UseOperationHistoryOptions) => {
  const operationHistory = ref<OperationHistoryItem[]>([])

  const operationHistoryForDisplay = computed(() => {
    return [...operationHistory.value].sort((a, b) => b.timestamp - a.timestamp)
  })

  const formatOperationTypeLabel = (operationType: OperationHistoryItem['operationType']) => {
    switch (operationType) {
      case 'create_graphic':
        return '创建图元'
      case 'update_graphic':
        return '更新图元'
      case 'delete_graphic':
        return '删除图元'
      case 'undo':
        return '撤销'
      case 'redo':
        return '重做'
      default:
        return operationType
    }
  }

  const formatOperationSourceLabel = (source: OperationHistorySource) => {
    switch (source) {
      case 'local':
        return '本地'
      case 'remote':
        return '协同'
      case 'system':
        return '系统'
      default:
        return source
    }
  }

  const canLocateHistoryObject = (objectKey: string) => {
    if (!objectKey) {
      return false
    }
    return options.graphicsRef.value.some((item) => item.objectKey === objectKey)
  }

  // 将视口平移到目标图元中心，并高亮一段时间。
  const locateHistoryObject = (item: OperationHistoryItem) => {
    if (!item.objectKey) {
      options.onWarning('该记录没有关联图元对象')
      return
    }
    const target = options.graphicsRef.value.find((graphic) => graphic.objectKey === item.objectKey)
    if (!target) {
      options.onWarning('该图元已不存在，无法定位')
      return
    }

    const canvas = options.canvasRef.value
    if (canvas) {
      const bounds = options.getGraphicBounds(target)
      const centerX = bounds.x + bounds.width / 2
      const centerY = bounds.y + bounds.height / 2
      options.viewportOffsetRef.value = {
        x: canvas.width / (2 * options.zoomScaleRef.value) - centerX,
        y: canvas.height / (2 * options.zoomScaleRef.value) - centerY,
      }
    }

    options.selectedObjectKeyRef.value = target.objectKey
    options.focusedObjectKeyRef.value = target.objectKey
    if (options.focusHighlightTimerRef.value !== null) {
      window.clearTimeout(options.focusHighlightTimerRef.value)
    }
    options.focusHighlightTimerRef.value = window.setTimeout(() => {
      options.focusedObjectKeyRef.value = null
      options.focusHighlightTimerRef.value = null
      options.scheduleRender()
    }, 3000)
    options.scheduleRender()
  }

  // 将后端时间线记录适配为本地定位输入结构。
  const locateTimelineObject = (item: SessionOperationItemVO) => {
    locateHistoryObject({
      id: String(item.id),
      operationType: item.operationType === 'create' ? 'create_graphic' : item.operationType === 'update' ? 'update_graphic' : 'delete_graphic',
      objectKey: item.objectKey,
      userId: item.userId,
      userLabel: '',
      source: 'system',
      timestamp: item.timestamp,
      timeText: new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour12: false }),
    })
  }

  // 冲突记录定位：除定位图元外，还会写入冲突焦点字段用于高亮提示。
  const locateConflictObject = (item: SessionConflictLogItemVO) => {
    const fields = item.fieldName ? [options.formatFieldNameLabel(item.fieldName)] : []
    locateHistoryObject({
      id: `conflict_${item.id}`,
      operationType: 'update_graphic',
      objectKey: item.objectKey,
      userId: null,
      userLabel: '',
      source: 'system',
      timestamp: Date.now(),
      timeText: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    })
    if (options.graphicsRef.value.some((graphic) => graphic.objectKey === item.objectKey)) {
      options.conflictFocusMapRef.value[item.objectKey] = {
        fields,
        updatedAt: Date.now(),
      }
      options.conflictHistoryVisibleRef.value = false
      options.scheduleRender()
    }
  }

  // 追加一条本地历史（用于 UI 快速反馈，不替代后端审计日志）。
  const pushOperationHistory = (payload: {
    operationType: OperationHistoryItem['operationType']
    objectKey: string
    userId: number | null
    source: OperationHistorySource
    detail?: string
  }) => {
    const now = Date.now()
    const userName = options.findMemberNameByUserId(payload.userId)
    const labelPrefix = formatOperationTypeLabel(payload.operationType)
    const userLabel = userName ? `${labelPrefix} · ${userName}` : labelPrefix
    const item: OperationHistoryItem = {
      id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
      operationType: payload.operationType,
      objectKey: payload.objectKey,
      userId: payload.userId,
      userLabel,
      source: payload.source,
      ...(payload.detail ? { detail: payload.detail } : {}),
      timestamp: now,
      timeText: new Date(now).toLocaleTimeString('zh-CN', { hour12: false }),
    }
    operationHistory.value = [item, ...operationHistory.value].slice(0, 20)
  }

  return {
    operationHistory,
    operationHistoryForDisplay,
    formatOperationTypeLabel,
    formatOperationSourceLabel,
    canLocateHistoryObject,
    locateHistoryObject,
    locateTimelineObject,
    locateConflictObject,
    pushOperationHistory,
  }
}
