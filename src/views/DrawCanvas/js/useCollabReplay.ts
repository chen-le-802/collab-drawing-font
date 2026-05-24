import { graphicApi } from '@/api/graphic'
import { sessionApi } from '@/api/session'
import type { GraphicVO } from '@/types/graphic'
import type { SessionOperationItemVO } from '@/types/session'

// 协作补偿同步模块：
// 用于断线重连或版本追平场景，支持“拉图元快照”和“按操作增量回放”两种策略。
type UseCollabReplayOptions = {
  getSessionKey: () => string
  getCurrentVersion: () => number
  getSessionIdFallback: () => number
  parseString: (value: unknown, fallback?: string) => string
  parseNumber: (value: unknown, fallback?: number) => number
  isRecord: (value: unknown) => value is Record<string, unknown>
  scheduleRender: () => void
  onSyncError: (error: unknown) => void
  setGraphics: (graphics: GraphicVO[]) => void
  mergeGraphics: (graphics: GraphicVO[]) => void
  updateSessionVersion: (version: number) => void
  setClientVersion: (version: number) => void
  removeGraphic: (objectKey: string) => void
  upsertGraphic: (graphic: GraphicVO) => void
  patchGraphic: (patch: Partial<GraphicVO> & { objectKey: string }) => void
  pushReplayHistory: (operationCount: number, conflictCount: number) => void
}

type PathPoint = { x: number; y: number }

// 兼容后端历史数据中的 objectType 字段，兜底到 line。
const toOperationGraphicType = (parseString: UseCollabReplayOptions['parseString'], value: unknown): GraphicVO['objectType'] => {
  const normalized = parseString(value, 'line')
  if (
    normalized === 'line' ||
    normalized === 'rect' ||
    normalized === 'circle' ||
    normalized === 'text' ||
    normalized === 'path' ||
    normalized === 'image'
  ) {
    return normalized
  }
  return 'line'
}

// 把未知 pathPoints 转为安全点数组，避免脏数据影响回放。
const toOperationPathPoints = (
  isRecord: UseCollabReplayOptions['isRecord'],
  parseNumber: UseCollabReplayOptions['parseNumber'],
  value: unknown,
): PathPoint[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  const points = value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({ x: parseNumber(item.x), y: parseNumber(item.y) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
  return points.length > 0 ? points : null
}

// 把 unknown 数据归一化为前端可用 GraphicVO。
const toGraphicFromUnknown = (
  options: Pick<UseCollabReplayOptions, 'isRecord' | 'parseNumber' | 'parseString' | 'getSessionIdFallback'>,
  value: unknown,
  fallbackObjectKey?: string,
): GraphicVO | null => {
  if (!options.isRecord(value)) {
    return null
  }
  const objectKey = options.parseString(value.objectKey, fallbackObjectKey ?? '')
  if (!objectKey) {
    return null
  }
  return {
    id: options.parseNumber(value.id),
    sessionId: options.parseNumber(value.sessionId, options.getSessionIdFallback()),
    objectKey,
    objectType: toOperationGraphicType(options.parseString, value.objectType),
    positionX: options.parseNumber(value.positionX),
    positionY: options.parseNumber(value.positionY),
    width: typeof value.width === 'number' ? value.width : null,
    height: typeof value.height === 'number' ? value.height : null,
    strokeColor: options.parseString(value.strokeColor, '#000000'),
    lineStyle: value.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillColor: typeof value.fillColor === 'string' ? value.fillColor : null,
    strokeWidth: options.parseNumber(value.strokeWidth, 1),
    textContent: typeof value.textContent === 'string' ? value.textContent : null,
    fontSize: typeof value.fontSize === 'number' ? value.fontSize : null,
    pathPoints: toOperationPathPoints(options.isRecord, options.parseNumber, value.pathPoints),
    isLocked: value.isLocked === true || value.isLocked === 1,
    rotation: options.parseNumber(value.rotation),
    zIndex: options.parseNumber(value.zIndex),
    version: options.parseNumber(value.version),
    creatorId: options.parseNumber(value.creatorId),
    createdAt: options.parseString(value.createdAt, new Date().toISOString()),
    updatedAt: options.parseString(value.updatedAt, new Date().toISOString()),
  }
}

export const useCollabReplay = (options: UseCollabReplayOptions) => {
  // 图元同步：可按版本增量拉取，也可强制全量覆盖。
  const syncGraphicsFromServer = async (forceFull = false) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    try {
      const sinceVersion = forceFull ? undefined : options.getCurrentVersion()
      const result = await graphicApi.getGraphics(sessionKey, sinceVersion)
      if (forceFull || typeof sinceVersion !== 'number' || sinceVersion <= 0) {
        options.setGraphics([...result.graphics])
      } else {
        options.mergeGraphics(result.graphics)
      }
      options.updateSessionVersion(result.currentVersion)
      options.setClientVersion(result.currentVersion)
      options.scheduleRender()
    } catch (error) {
      options.onSyncError(error)
    }
  }

  // 重放单条操作：delete 直接删，create/update 按 resolvedResult 或 operationData 回放。
  const applyOperationReplayItem = (operation: SessionOperationItemVO) => {
    if (operation.operationType === 'delete') {
      options.removeGraphic(operation.objectKey)
      return
    }

    const resolved = options.isRecord(operation.resolvedResult) ? operation.resolvedResult : null
    const resolvedGraphic = toGraphicFromUnknown(options, resolved?.graphic, operation.objectKey)
    if (resolvedGraphic) {
      options.upsertGraphic(resolvedGraphic)
      return
    }

    const patchSource = options.isRecord(operation.operationData) ? operation.operationData : {}
    if (operation.operationType === 'create') {
      const createdGraphic = toGraphicFromUnknown(options, patchSource, operation.objectKey)
      if (createdGraphic) {
        options.upsertGraphic(createdGraphic)
      }
      return
    }

    options.patchGraphic({
      objectKey: operation.objectKey,
      positionX: typeof patchSource.positionX === 'number' ? patchSource.positionX : undefined,
      positionY: typeof patchSource.positionY === 'number' ? patchSource.positionY : undefined,
      width: typeof patchSource.width === 'number' ? patchSource.width : undefined,
      height: typeof patchSource.height === 'number' ? patchSource.height : undefined,
      strokeColor: typeof patchSource.strokeColor === 'string' ? patchSource.strokeColor : undefined,
      lineStyle: patchSource.lineStyle === 'dashed' || patchSource.lineStyle === 'solid' ? patchSource.lineStyle : undefined,
      fillColor: typeof patchSource.fillColor === 'string' ? patchSource.fillColor : undefined,
      strokeWidth: typeof patchSource.strokeWidth === 'number' ? patchSource.strokeWidth : undefined,
      textContent: typeof patchSource.textContent === 'string' ? patchSource.textContent : undefined,
      fontSize: typeof patchSource.fontSize === 'number' ? patchSource.fontSize : undefined,
      pathPoints: toOperationPathPoints(options.isRecord, options.parseNumber, patchSource.pathPoints) ?? undefined,
      isLocked: typeof patchSource.isLocked === 'boolean' ? patchSource.isLocked : undefined,
      rotation: typeof patchSource.rotation === 'number' ? patchSource.rotation : undefined,
      zIndex: typeof patchSource.zIndex === 'number' ? patchSource.zIndex : undefined,
      version: operation.serverVersion,
    })
  }

  // 操作增量回放：按 currentVersion 拉取后续操作并依次应用。
  const syncOperationsFromServer = async (): Promise<boolean> => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return false
    }
    try {
      const result = await sessionApi.getOperations(sessionKey, options.getCurrentVersion())
      if (result.operations.length > 0) {
        result.operations.forEach((operation) => {
          applyOperationReplayItem(operation)
        })
        const conflictCount = result.operations.filter((operation) => operation.conflictType !== 'none').length
        options.pushReplayHistory(result.operations.length, conflictCount)
      }
      options.updateSessionVersion(result.currentVersion)
      options.setClientVersion(result.currentVersion)
      options.scheduleRender()
      return true
    } catch {
      return false
    }
  }

  return {
    syncGraphicsFromServer,
    syncOperationsFromServer,
    toOperationPathPoints: (value: unknown) => toOperationPathPoints(options.isRecord, options.parseNumber, value),
    toGraphicFromUnknown: (value: unknown, fallbackObjectKey?: string) => toGraphicFromUnknown(options, value, fallbackObjectKey),
  }
}
