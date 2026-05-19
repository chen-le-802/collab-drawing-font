import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type { GraphicVO } from '@/types/graphic'
import type { SessionJoinVO } from '@/types/session'
import type { OperationVO, RedoResultData, UndoRedoData, UndoResultData } from '@/ws/types'
import type WebSocketClient from '@/ws/client'

export interface UndoRedoState {
  undoStack: OperationVO[]
  redoStack: OperationVO[]
  canUndo: boolean
  canRedo: boolean
}

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

const toNullableNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null
}

const toGraphicFromOperationData = (payload: Record<string, unknown>): Omit<Partial<GraphicVO>, 'objectKey'> & { objectKey: string } => {
  return {
    objectKey: toString(payload.objectKey),
    objectType: (toString(payload.objectType, 'line') as GraphicVO['objectType']) || 'line',
    positionX: toNumber(payload.positionX),
    positionY: toNumber(payload.positionY),
    width: toNullableNumber(payload.width),
    height: toNullableNumber(payload.height),
    strokeColor: toString(payload.strokeColor, '#000000'),
    lineStyle: payload.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillColor: toNullableString(payload.fillColor),
    strokeWidth: toNumber(payload.strokeWidth, 1),
    zIndex: toNumber(payload.zIndex),
    textContent: toNullableString(payload.textContent),
    fontSize: toNullableNumber(payload.fontSize),
    pathPoints: Array.isArray(payload.pathPoints)
      ? payload.pathPoints
          .filter((item): item is Record<string, unknown> => isObject(item))
          .map((item) => ({ x: toNumber(item.x), y: toNumber(item.y) }))
      : null,
    isLocked: payload.isLocked === true || payload.isLocked === 1,
    rotation: toNumber(payload.rotation),
    version: toNumber(payload.version),
    sessionId: toNumber(payload.sessionId),
    creatorId: toNumber(payload.creatorId),
    id: toNumber(payload.id),
    createdAt: toString(payload.createdAt),
    updatedAt: toString(payload.updatedAt),
  }
}

export const useCanvasStore = defineStore('canvas', () => {
  const wsClient = ref<WebSocketClient | null>(null)
  const currentSession = ref<SessionJoinVO | null>(null)
  const graphics = ref<GraphicVO[]>([])

  const undoStack = ref<OperationVO[]>([])
  const redoStack = ref<OperationVO[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  const bindSession = (session: SessionJoinVO, client: WebSocketClient) => {
    currentSession.value = session
    wsClient.value = client
    graphics.value = [...session.graphics]
    undoStack.value = []
    redoStack.value = []
  }

  const clearSession = () => {
    currentSession.value = null
    wsClient.value = null
    graphics.value = []
    undoStack.value = []
    redoStack.value = []
  }

  const applyOperation = (operation: OperationVO): void => {
    if (!operation || !isObject(operation.data)) {
      return
    }
    const payload = operation.data
    const objectKey = toString(operation.objectKey || payload.objectKey)
    if (!objectKey) {
      return
    }

    if (operation.operationType === 'delete_graphic') {
      graphics.value = graphics.value.filter((item) => item.objectKey !== objectKey)
      return
    }

    const patch = toGraphicFromOperationData(payload)
    const index = graphics.value.findIndex((item) => item.objectKey === objectKey)
    if (operation.operationType === 'create_graphic') {
      const nextGraphic: GraphicVO = {
        id: patch.id ?? 0,
        sessionId: patch.sessionId ?? (currentSession.value?.sessionId ?? 0),
        objectKey,
        objectType: patch.objectType ?? 'line',
        positionX: patch.positionX ?? 0,
        positionY: patch.positionY ?? 0,
        width: typeof patch.width === 'number' ? patch.width : null,
        height: typeof patch.height === 'number' ? patch.height : null,
        strokeColor: patch.strokeColor ?? '#000000',
        lineStyle: patch.lineStyle ?? 'solid',
        fillColor: typeof patch.fillColor === 'string' ? patch.fillColor : null,
        strokeWidth: patch.strokeWidth ?? 1,
        textContent: typeof patch.textContent === 'string' ? patch.textContent : null,
        fontSize: typeof patch.fontSize === 'number' ? patch.fontSize : null,
        pathPoints: Array.isArray(patch.pathPoints) ? patch.pathPoints : null,
        isLocked: patch.isLocked === true,
        rotation: toNumber(patch.rotation),
        zIndex: patch.zIndex ?? 0,
        version: patch.version ?? 0,
        creatorId: patch.creatorId ?? operation.userId,
        createdAt: patch.createdAt ?? new Date().toISOString(),
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      }

      if (index === -1) {
        graphics.value.push(nextGraphic)
      } else {
        graphics.value[index] = nextGraphic
      }
      return
    }

    if (index !== -1) {
      const previous = graphics.value[index]
      if (!previous) {
        return
      }
      graphics.value[index] = {
        id: previous.id,
        sessionId: patch.sessionId ?? previous.sessionId,
        objectKey,
        objectType: patch.objectType ?? previous.objectType,
        positionX: patch.positionX ?? previous.positionX,
        positionY: patch.positionY ?? previous.positionY,
        width: typeof patch.width === 'number' ? patch.width : previous.width,
        height: typeof patch.height === 'number' ? patch.height : previous.height,
        strokeColor: patch.strokeColor ?? previous.strokeColor,
        lineStyle: patch.lineStyle ?? previous.lineStyle,
        fillColor: typeof patch.fillColor === 'string' ? patch.fillColor : previous.fillColor,
        strokeWidth: patch.strokeWidth ?? previous.strokeWidth,
        textContent: typeof patch.textContent === 'string' ? patch.textContent : previous.textContent,
        fontSize: typeof patch.fontSize === 'number' ? patch.fontSize : previous.fontSize,
        pathPoints: Array.isArray(patch.pathPoints) ? patch.pathPoints : previous.pathPoints,
        isLocked: typeof patch.isLocked === 'boolean' ? patch.isLocked : previous.isLocked,
        rotation: typeof patch.rotation === 'number' ? patch.rotation : previous.rotation,
        zIndex: patch.zIndex ?? previous.zIndex,
        version: patch.version ?? previous.version,
        creatorId: patch.creatorId ?? previous.creatorId,
        createdAt: patch.createdAt ?? previous.createdAt,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      }
    }
  }

  const updateUndoRedoStateFromResult = (operation: OperationVO | undefined, nextCanUndo: boolean, nextCanRedo: boolean) => {
    if (operation) {
      if (nextCanUndo) {
        undoStack.value = [...undoStack.value, operation]
      }
      if (!nextCanRedo) {
        redoStack.value = []
      }
    }
    if (!nextCanUndo) {
      undoStack.value = []
    }
    if (!nextCanRedo) {
      redoStack.value = []
    }
  }

  const handleUndoResult = (data: UndoResultData) => {
    const success = typeof data.success === 'boolean' ? data.success : true
    if (!success) {
      return
    }
    const operations = Array.isArray(data.operations) && data.operations.length > 0
      ? data.operations
      : (data.operation ? [data.operation] : [])
    if (operations.length > 0) {
      operations.forEach((operation) => {
        applyOperation(operation)
      })
      redoStack.value = [...redoStack.value, ...operations]
    }
    if (!data.canUndo) {
      undoStack.value = []
    } else if (undoStack.value.length > 0) {
      const popCount = Math.max(1, operations.length || 1)
      undoStack.value = undoStack.value.slice(0, Math.max(0, undoStack.value.length - popCount))
    }
    if (!data.canRedo && redoStack.value.length > 0) {
      redoStack.value = []
    }
  }

  const handleRedoResult = (data: RedoResultData) => {
    const success = typeof data.success === 'boolean' ? data.success : true
    if (!success) {
      return
    }
    const operations = Array.isArray(data.operations) && data.operations.length > 0
      ? data.operations
      : (data.operation ? [data.operation] : [])
    if (operations.length > 0) {
      operations.forEach((operation) => {
        applyOperation(operation)
      })
      undoStack.value = [...undoStack.value, ...operations]
    }
    if (!data.canRedo && redoStack.value.length > 0) {
      redoStack.value = []
    } else if (redoStack.value.length > 0) {
      const popCount = Math.max(1, operations.length || 1)
      redoStack.value = redoStack.value.slice(0, Math.max(0, redoStack.value.length - popCount))
    }
    if (!data.canUndo) {
      undoStack.value = []
    }
  }

  const pushLocalOperation = (operation: OperationVO) => {
    undoStack.value = [...undoStack.value, operation]
    redoStack.value = []
  }

  const undo = async (meta?: Omit<UndoRedoData, 'sessionKey'>) => {
    if (!wsClient.value?.isConnected() || !currentSession.value || !canUndo.value) {
      return
    }
    if (meta) {
      wsClient.value.sendUndoWithMeta({
        sessionKey: currentSession.value.sessionKey,
        ...meta,
      })
      return
    }
    wsClient.value.sendUndo(currentSession.value.sessionKey)
  }

  const redo = async (meta?: Omit<UndoRedoData, 'sessionKey'>) => {
    if (!wsClient.value?.isConnected() || !currentSession.value || !canRedo.value) {
      return
    }
    if (meta) {
      wsClient.value.sendRedoWithMeta({
        sessionKey: currentSession.value.sessionKey,
        ...meta,
      })
      return
    }
    wsClient.value.sendRedo(currentSession.value.sessionKey)
  }

  const undoRedoState = computed<UndoRedoState>(() => ({
    undoStack: undoStack.value,
    redoStack: redoStack.value,
    canUndo: canUndo.value,
    canRedo: canRedo.value,
  }))

  return {
    wsClient,
    currentSession,
    graphics,
    undoRedoState,
    canUndo,
    canRedo,
    bindSession,
    clearSession,
    applyOperation,
    handleUndoResult,
    handleRedoResult,
    updateUndoRedoStateFromResult,
    pushLocalOperation,
    undo,
    redo,
  }
})
