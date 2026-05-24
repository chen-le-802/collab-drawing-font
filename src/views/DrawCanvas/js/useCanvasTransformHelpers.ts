import type { GraphicVO } from '@/types/graphic'
import { normalizeRect } from '@/views/DrawCanvas/js/canvasGeometry'

// 图元变换模块：
// 负责单选/多选的缩放、旋转、锚点命中、群组变换等核心数学过程。
// index.vue 只维护交互状态，具体变换计算由本模块完成。
export type CanvasPoint = { x: number; y: number }
export type ResizeHandleKey = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
export type RectBounds = { x: number; y: number; width: number; height: number }

interface CanvasTransformHelperDeps {
  getGraphicBounds: (graphic: GraphicVO) => RectBounds
  getGraphicCenter: (graphic: GraphicVO) => CanvasPoint
  getLocalResizeBounds: (graphic: GraphicVO) => RectBounds
  getGraphicSelectionRotationRad: (graphic: GraphicVO) => number
  getPathSelectionOutlinePoints: (graphic: GraphicVO) => CanvasPoint[]
  isArrowPathGraphic: (graphic: GraphicVO) => boolean
  getArrowEndpoints: (graphic: GraphicVO) => { start: CanvasPoint; end: CanvasPoint } | null
  buildArrowPathPoints: (start: CanvasPoint, end: CanvasPoint, strokeWidthValue: number) => CanvasPoint[]
  resizeHandleHitSize: number
  rotateHandleHitSize: number
  rotateHandleOffset: number
  resizeMinSize: number
  textMinFontSize: number
  textMaxFontSize: number
}

export const createCanvasTransformHelpers = (deps: CanvasTransformHelperDeps) => {
  // 将点绕指定中心旋转，供旋转命中、旋转变换、局部坐标转换复用。
  const rotatePointAround = (point: CanvasPoint, center: CanvasPoint, angle: number): CanvasPoint => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const dx = point.x - center.x
    const dy = point.y - center.y
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    }
  }

  const isPointInRect = (point: CanvasPoint, rect: RectBounds) => {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    )
  }

  const isPointInRotatedRect = (point: CanvasPoint, rect: RectBounds, rotationRad: number) => {
    if (!rotationRad) {
      return isPointInRect(point, rect)
    }
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const local = rotatePointAround(point, center, -rotationRad)
    return isPointInRect(local, rect)
  }

  const getRectIntersectionArea = (a: RectBounds, b: RectBounds) => {
    const left = Math.max(a.x, b.x)
    const top = Math.max(a.y, b.y)
    const right = Math.min(a.x + a.width, b.x + b.width)
    const bottom = Math.min(a.y + a.height, b.y + b.height)
    const width = right - left
    const height = bottom - top
    if (width <= 0 || height <= 0) {
      return 0
    }
    return width * height
  }

  // 获取图元 8 个缩放锚点坐标（已考虑 path 特殊轮廓与旋转）。
  const getResizeHandlePoints = (graphic: GraphicVO): Record<ResizeHandleKey, CanvasPoint> => {
    if (graphic.objectType === 'path' && !deps.isArrowPathGraphic(graphic)) {
      const outline = deps.getPathSelectionOutlinePoints(graphic)
      const nw = outline[0]
      const ne = outline[1]
      const se = outline[2]
      const sw = outline[3]
      if (nw && ne && se && sw) {
        return {
          n: { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 },
          s: { x: (sw.x + se.x) / 2, y: (sw.y + se.y) / 2 },
          e: { x: (ne.x + se.x) / 2, y: (ne.y + se.y) / 2 },
          w: { x: (nw.x + sw.x) / 2, y: (nw.y + sw.y) / 2 },
          nw,
          ne,
          sw,
          se,
        }
      }
    }
    const local = deps.getLocalResizeBounds(graphic)
    const rotation = deps.getGraphicSelectionRotationRad(graphic)
    const center = deps.getGraphicCenter(graphic)
    const localHandles: Record<ResizeHandleKey, CanvasPoint> = {
      n: { x: local.x + local.width / 2, y: local.y },
      s: { x: local.x + local.width / 2, y: local.y + local.height },
      e: { x: local.x + local.width, y: local.y + local.height / 2 },
      w: { x: local.x, y: local.y + local.height / 2 },
      nw: { x: local.x, y: local.y },
      ne: { x: local.x + local.width, y: local.y },
      sw: { x: local.x, y: local.y + local.height },
      se: { x: local.x + local.width, y: local.y + local.height },
    }
    if (!rotation) {
      return localHandles
    }
    return {
      n: rotatePointAround(localHandles.n, center, rotation),
      s: rotatePointAround(localHandles.s, center, rotation),
      e: rotatePointAround(localHandles.e, center, rotation),
      w: rotatePointAround(localHandles.w, center, rotation),
      nw: rotatePointAround(localHandles.nw, center, rotation),
      ne: rotatePointAround(localHandles.ne, center, rotation),
      sw: rotatePointAround(localHandles.sw, center, rotation),
      se: rotatePointAround(localHandles.se, center, rotation),
    }
  }

  // 旋转手柄点：以北侧锚点向外偏移固定距离得到。
  const getRotateHandlePoint = (graphic: GraphicVO): CanvasPoint => {
    const handles = getResizeHandlePoints(graphic)
    const center = deps.getGraphicCenter(graphic)
    const north = handles.n
    const vx = north.x - center.x
    const vy = north.y - center.y
    const len = Math.hypot(vx, vy) || 1
    return {
      x: north.x + (vx / len) * deps.rotateHandleOffset,
      y: north.y + (vy / len) * deps.rotateHandleOffset,
    }
  }

  const hitRotateHandle = (point: CanvasPoint, graphic: GraphicVO): boolean => {
    const rotatePoint = getRotateHandlePoint(graphic)
    return (
      Math.abs(point.x - rotatePoint.x) <= deps.rotateHandleHitSize &&
      Math.abs(point.y - rotatePoint.y) <= deps.rotateHandleHitSize
    )
  }

  // 针对“多选整体框”的锚点与命中逻辑。
  const getBoundsResizeHandles = (bounds: RectBounds, rotationRad = 0): Record<ResizeHandleKey, CanvasPoint> => {
    const local: Record<ResizeHandleKey, CanvasPoint> = {
      n: { x: bounds.x + bounds.width / 2, y: bounds.y },
      s: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      e: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      w: { x: bounds.x, y: bounds.y + bounds.height / 2 },
      nw: { x: bounds.x, y: bounds.y },
      ne: { x: bounds.x + bounds.width, y: bounds.y },
      sw: { x: bounds.x, y: bounds.y + bounds.height },
      se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    }
    if (!rotationRad) {
      return local
    }
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    return {
      n: rotatePointAround(local.n, center, rotationRad),
      s: rotatePointAround(local.s, center, rotationRad),
      e: rotatePointAround(local.e, center, rotationRad),
      w: rotatePointAround(local.w, center, rotationRad),
      nw: rotatePointAround(local.nw, center, rotationRad),
      ne: rotatePointAround(local.ne, center, rotationRad),
      sw: rotatePointAround(local.sw, center, rotationRad),
      se: rotatePointAround(local.se, center, rotationRad),
    }
  }

  const hitResizeHandleByBounds = (
    point: CanvasPoint,
    bounds: RectBounds,
    rotationRad = 0,
  ): ResizeHandleKey | null => {
    const handles = getBoundsResizeHandles(bounds, rotationRad)
    for (const key of Object.keys(handles) as ResizeHandleKey[]) {
      const handle = handles[key]
      if (
        Math.abs(point.x - handle.x) <= deps.resizeHandleHitSize &&
        Math.abs(point.y - handle.y) <= deps.resizeHandleHitSize
      ) {
        return key
      }
    }
    return null
  }

  const hitRotateHandleByBounds = (point: CanvasPoint, bounds: RectBounds, rotationRad = 0) => {
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const handles = getBoundsResizeHandles(bounds, rotationRad)
    const topMid = handles.n
    const vx = topMid.x - center.x
    const vy = topMid.y - center.y
    const len = Math.hypot(vx, vy) || 1
    const rotate = {
      x: topMid.x + (vx / len) * deps.rotateHandleOffset,
      y: topMid.y + (vy / len) * deps.rotateHandleOffset,
    }
    return Math.abs(point.x - rotate.x) <= deps.rotateHandleHitSize && Math.abs(point.y - rotate.y) <= deps.rotateHandleHitSize
  }

  // 单图元锚点命中：line/arrow/text/path/rect 等类型有不同规则。
  const hitResizeHandle = (point: CanvasPoint, graphic: GraphicVO): ResizeHandleKey | null => {
    const arrowEndpoints = deps.getArrowEndpoints(graphic)
    if (arrowEndpoints) {
      const startHit =
        Math.abs(point.x - arrowEndpoints.start.x) <= deps.resizeHandleHitSize &&
        Math.abs(point.y - arrowEndpoints.start.y) <= deps.resizeHandleHitSize
      const endHit =
        Math.abs(point.x - arrowEndpoints.end.x) <= deps.resizeHandleHitSize &&
        Math.abs(point.y - arrowEndpoints.end.y) <= deps.resizeHandleHitSize
      if (startHit) {
        return 'nw'
      }
      if (endHit) {
        return 'se'
      }
      return null
    }
    if (graphic.objectType === 'line') {
      const start = { x: graphic.positionX, y: graphic.positionY }
      const end = { x: graphic.positionX + (graphic.width ?? 0), y: graphic.positionY + (graphic.height ?? 0) }
      const startHit =
        Math.abs(point.x - start.x) <= deps.resizeHandleHitSize && Math.abs(point.y - start.y) <= deps.resizeHandleHitSize
      const endHit =
        Math.abs(point.x - end.x) <= deps.resizeHandleHitSize && Math.abs(point.y - end.y) <= deps.resizeHandleHitSize
      if (startHit) {
        return 'nw'
      }
      if (endHit) {
        return 'se'
      }
      return null
    }
    if (graphic.objectType === 'text') {
      const se = getResizeHandlePoints(graphic).se
      if (Math.abs(point.x - se.x) <= deps.resizeHandleHitSize && Math.abs(point.y - se.y) <= deps.resizeHandleHitSize) {
        return 'se'
      }
      return null
    }
    const handles = getResizeHandlePoints(graphic)
    for (const key of Object.keys(handles) as ResizeHandleKey[]) {
      const handle = handles[key]
      if (
        Math.abs(point.x - handle.x) <= deps.resizeHandleHitSize &&
        Math.abs(point.y - handle.y) <= deps.resizeHandleHitSize
      ) {
        return key
      }
    }
    return null
  }

  const normalizeResizeRectFromHandle = (anchor: CanvasPoint, moving: CanvasPoint) => {
    const left = Math.min(anchor.x, moving.x)
    const right = Math.max(anchor.x, moving.x)
    const top = Math.min(anchor.y, moving.y)
    const bottom = Math.max(anchor.y, moving.y)
    const width = Math.max(deps.resizeMinSize, right - left)
    const height = Math.max(deps.resizeMinSize, bottom - top)
    return {
      x: left,
      y: top,
      width,
      height,
    }
  }

  const resizeBoundsByHandle = (bounds: RectBounds, handle: ResizeHandleKey, moving: CanvasPoint) => {
    let left = bounds.x
    let right = bounds.x + bounds.width
    let top = bounds.y
    let bottom = bounds.y + bounds.height

    if (handle.includes('w')) {
      left = moving.x
    }
    if (handle.includes('e')) {
      right = moving.x
    }
    if (handle.includes('n')) {
      top = moving.y
    }
    if (handle.includes('s')) {
      bottom = moving.y
    }
    if (handle === 'n' || handle === 's') {
      left = bounds.x
      right = bounds.x + bounds.width
    }
    if (handle === 'e' || handle === 'w') {
      top = bounds.y
      bottom = bounds.y + bounds.height
    }

    const normalized = normalizeRect(left, top, right - left, bottom - top)
    return {
      x: normalized.x,
      y: normalized.y,
      width: Math.max(deps.resizeMinSize, normalized.width),
      height: Math.max(deps.resizeMinSize, normalized.height),
    }
  }

  // 将 sourceBounds 到 targetBounds 的变换映射到具体图元字段（位置/尺寸/path 点等）。
  const applyTransformToGraphic = (original: GraphicVO, sourceBounds: RectBounds, targetBounds: RectBounds): GraphicVO => {
    const sx = sourceBounds.width === 0 ? 1 : targetBounds.width / sourceBounds.width
    const sy = sourceBounds.height === 0 ? 1 : targetBounds.height / sourceBounds.height
    const graphicBounds = deps.getGraphicBounds(original)
    const originalCenter = deps.getGraphicCenter(original)
    const relX = graphicBounds.x - sourceBounds.x
    const relY = graphicBounds.y - sourceBounds.y
    const nextX = targetBounds.x + relX * sx
    const nextY = targetBounds.y + relY * sy
    const nextWidth = Math.max(1, graphicBounds.width * sx)
    const nextHeight = Math.max(1, graphicBounds.height * sy)

    if (original.objectType === 'circle') {
      return {
        ...original,
        positionX: nextX + nextWidth / 2,
        positionY: nextY + nextHeight / 2,
        width: nextWidth,
        height: nextHeight,
      }
    }
    if (original.objectType === 'text') {
      const fontScale = Math.max(0.5, sy)
      return {
        ...original,
        positionX: nextX,
        positionY: nextY,
        width: nextWidth,
        height: nextHeight,
        fontSize: Math.max(
          deps.textMinFontSize,
          Math.min(deps.textMaxFontSize, Math.round((original.fontSize ?? 16) * fontScale)),
        ),
      }
    }
    if (original.objectType === 'path') {
      const base = original.pathPoints ?? []
      const nextPathPoints = base.map((p) => ({
        x: targetBounds.x + (p.x - sourceBounds.x) * sx,
        y: targetBounds.y + (p.y - sourceBounds.y) * sy,
      }))
      return {
        ...original,
        positionX: nextX,
        positionY: nextY,
        width: nextWidth,
        height: nextHeight,
        pathPoints: nextPathPoints,
      }
    }
    if (original.objectType === 'line') {
      const start = { x: original.positionX, y: original.positionY }
      const end = { x: original.positionX + (original.width ?? 0), y: original.positionY + (original.height ?? 0) }
      const nextStart = {
        x: targetBounds.x + (start.x - sourceBounds.x) * sx,
        y: targetBounds.y + (start.y - sourceBounds.y) * sy,
      }
      const nextEnd = {
        x: targetBounds.x + (end.x - sourceBounds.x) * sx,
        y: targetBounds.y + (end.y - sourceBounds.y) * sy,
      }
      return {
        ...original,
        positionX: nextStart.x,
        positionY: nextStart.y,
        width: nextEnd.x - nextStart.x,
        height: nextEnd.y - nextStart.y,
      }
    }
    return {
      ...original,
      positionX: nextX,
      positionY: nextY,
      width: nextWidth,
      height: nextHeight,
      ...(original.objectType !== 'rect' && original.objectType !== 'image'
        ? {
            rotation: original.rotation,
            positionX: targetBounds.x + (originalCenter.x - sourceBounds.x) * sx,
            positionY: targetBounds.y + (originalCenter.y - sourceBounds.y) * sy,
          }
        : {}),
    }
  }

  // 围绕中心旋转图元，按类型修正 position/width/height/pathPoints。
  const applyRotateToGraphic = (original: GraphicVO, center: CanvasPoint, deltaAngle: number): GraphicVO => {
    const arrowEndpoints = deps.getArrowEndpoints(original)
    if (arrowEndpoints) {
      const nextStart = rotatePointAround(arrowEndpoints.start, center, deltaAngle)
      const nextEnd = rotatePointAround(arrowEndpoints.end, center, deltaAngle)
      const nextRotation = (((original.rotation ?? 0) + (deltaAngle * 180) / Math.PI) % 360 + 360) % 360
      return {
        ...original,
        positionX: nextStart.x,
        positionY: nextStart.y,
        width: nextEnd.x - nextStart.x,
        height: nextEnd.y - nextStart.y,
        rotation: Math.round(nextRotation),
        pathPoints: deps.buildArrowPathPoints(nextStart, nextEnd, original.strokeWidth),
      }
    }
    const originalCenter = deps.getGraphicCenter(original)
    const rotatedCenter = rotatePointAround(originalCenter, center, deltaAngle)
    const nextRotation = (((original.rotation ?? 0) + (deltaAngle * 180) / Math.PI) % 360 + 360) % 360
    if (original.objectType === 'path') {
      const nextPath = (original.pathPoints ?? []).map((p) => rotatePointAround(p, center, deltaAngle))
      return {
        ...original,
        positionX: rotatedCenter.x,
        positionY: rotatedCenter.y,
        rotation: Math.round(nextRotation),
        pathPoints: nextPath,
      }
    }
    if (original.objectType === 'line') {
      const start = rotatePointAround({ x: original.positionX, y: original.positionY }, center, deltaAngle)
      const end = rotatePointAround(
        { x: original.positionX + (original.width ?? 0), y: original.positionY + (original.height ?? 0) },
        center,
        deltaAngle,
      )
      return {
        ...original,
        positionX: start.x,
        positionY: start.y,
        width: end.x - start.x,
        height: end.y - start.y,
        rotation: Math.round(nextRotation),
      }
    }
    if (original.objectType === 'circle') {
      return {
        ...original,
        positionX: rotatedCenter.x,
        positionY: rotatedCenter.y,
        rotation: Math.round(nextRotation),
      }
    }
    if (original.objectType === 'rect' || original.objectType === 'image' || original.objectType === 'text') {
      const baseWidth = Math.max(1, Math.abs(original.width ?? 0))
      const baseHeight = Math.max(1, Math.abs(original.height ?? 0))
      return {
        ...original,
        positionX: rotatedCenter.x - baseWidth / 2,
        positionY: rotatedCenter.y - baseHeight / 2,
        rotation: Math.round(nextRotation),
      }
    }
    return {
      ...original,
      positionX: rotatedCenter.x,
      positionY: rotatedCenter.y,
      rotation: Math.round(nextRotation),
    }
  }

  // 以“目标角度”驱动旋转，内部自动换算为相对角度 delta。
  const rotateGraphicAround = (graphic: GraphicVO, center: CanvasPoint, targetRotationDeg: number): GraphicVO => {
    const originalRotation = graphic.rotation ?? 0
    const deltaAngle = ((targetRotationDeg - originalRotation) * Math.PI) / 180
    if (Math.abs(deltaAngle) < 1e-6) {
      return {
        ...graphic,
        rotation: Math.round(targetRotationDeg),
      }
    }
    return applyRotateToGraphic(graphic, center, deltaAngle)
  }

  // 缩放统一入口：按图元类型分流到对应缩放策略。
  const updateGraphicByResize = (
    graphic: GraphicVO,
    handle: ResizeHandleKey,
    moving: CanvasPoint,
    sourceGraphic?: GraphicVO | null,
  ): GraphicVO => {
    const base = sourceGraphic ?? graphic
    const baseArrowEndpoints = deps.getArrowEndpoints(base)
    if (baseArrowEndpoints) {
      const dragStart = handle === 'nw'
      const nextStart = dragStart ? moving : baseArrowEndpoints.start
      const nextEnd = dragStart ? baseArrowEndpoints.end : moving
      const nextPathPoints = deps.buildArrowPathPoints(nextStart, nextEnd, base.strokeWidth)
      return {
        ...base,
        positionX: nextStart.x,
        positionY: nextStart.y,
        width: nextEnd.x - nextStart.x,
        height: nextEnd.y - nextStart.y,
        pathPoints: nextPathPoints,
      }
    }
    if (base.objectType === 'line') {
      const start = { x: base.positionX, y: base.positionY }
      const end = { x: base.positionX + (base.width ?? 0), y: base.positionY + (base.height ?? 0) }
      const dragStart = handle === 'nw'
      const nextStart = dragStart ? moving : start
      const nextEnd = dragStart ? end : moving
      return {
        ...base,
        positionX: nextStart.x,
        positionY: nextStart.y,
        width: nextEnd.x - nextStart.x,
        height: nextEnd.y - nextStart.y,
      }
    }
    const localBounds = deps.getLocalResizeBounds(base)
    const center = deps.getGraphicCenter(base)
    const rotation = deps.getGraphicSelectionRotationRad(base)
    const toLocal = (p: CanvasPoint) => (rotation ? rotatePointAround(p, center, -rotation) : p)
    const toWorld = (p: CanvasPoint) => (rotation ? rotatePointAround(p, center, rotation) : p)
    const movingLocal = toLocal(moving)
    const bounds = localBounds
    const anchor: CanvasPoint = (() => {
      if (handle === 'nw') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
      if (handle === 'ne') return { x: bounds.x, y: bounds.y + bounds.height }
      if (handle === 'sw') return { x: bounds.x + bounds.width, y: bounds.y }
      if (handle === 'se') return { x: bounds.x, y: bounds.y }
      if (handle === 'n') return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
      if (handle === 's') return { x: bounds.x + bounds.width / 2, y: bounds.y }
      if (handle === 'e') return { x: bounds.x, y: bounds.y + bounds.height / 2 }
      return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
    })()

    if (base.objectType === 'rect' || base.objectType === 'image') {
      const targetBounds = resizeBoundsByHandle(bounds, handle, movingLocal)
      const topLeft = toWorld({ x: targetBounds.x, y: targetBounds.y })
      const nextCenter = toWorld({ x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height / 2 })
      const alignedTopLeft = {
        x: nextCenter.x - targetBounds.width / 2,
        y: nextCenter.y - targetBounds.height / 2,
      }
      return {
        ...base,
        positionX: rotation ? alignedTopLeft.x : topLeft.x,
        positionY: rotation ? alignedTopLeft.y : topLeft.y,
        width: targetBounds.width,
        height: targetBounds.height,
      }
    }

    if (base.objectType === 'path') {
      const basePathPoints = base.pathPoints ?? []
      if (basePathPoints.length === 0) {
        return base
      }
      const outline = deps.getPathSelectionOutlinePoints(base)
      const sourceBounds = (() => {
        if (outline.length === 4) {
          const localOutline = outline.map((point) => toLocal(point))
          const xs = localOutline.map((point) => point.x)
          const ys = localOutline.map((point) => point.y)
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(deps.resizeMinSize, Math.max(...xs) - Math.min(...xs)),
            height: Math.max(deps.resizeMinSize, Math.max(...ys) - Math.min(...ys)),
          }
        }
        return bounds
      })()
      const targetBounds = resizeBoundsByHandle(sourceBounds, handle, movingLocal)
      const sx = sourceBounds.width === 0 ? 1 : targetBounds.width / sourceBounds.width
      const sy = sourceBounds.height === 0 ? 1 : targetBounds.height / sourceBounds.height
      const localPathPoints = basePathPoints.map((point) => toLocal(point))
      const nextLocalPathPoints = localPathPoints.map((point) => ({
        x: targetBounds.x + (point.x - sourceBounds.x) * sx,
        y: targetBounds.y + (point.y - sourceBounds.y) * sy,
      }))
      const nextPathPoints = nextLocalPathPoints.map((point) => toWorld(point))
      const xs = nextPathPoints.map((point) => point.x)
      const ys = nextPathPoints.map((point) => point.y)
      const nextBounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      }
      return {
        ...base,
        positionX: nextBounds.x,
        positionY: nextBounds.y,
        width: nextBounds.width,
        height: nextBounds.height,
        pathPoints: nextPathPoints,
      }
    }

    if (base.objectType === 'text') {
      const rect = normalizeResizeRectFromHandle(anchor, movingLocal)
      const originalBounds = localBounds
      const baseHeight = Math.max(1, originalBounds.height)
      const ratio = rect.height / baseHeight
      const nextFontSize = Math.max(
        deps.textMinFontSize,
        Math.min(deps.textMaxFontSize, Math.round((base.fontSize ?? 16) * ratio)),
      )
      const rectCenterWorld = toWorld({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      return {
        ...base,
        positionX: rectCenterWorld.x - rect.width / 2,
        positionY: rectCenterWorld.y - rect.height / 2,
        width: rect.width,
        height: rect.height,
        fontSize: nextFontSize,
      }
    }

    if (base.objectType === 'circle') {
      const targetBounds = resizeBoundsByHandle(bounds, handle, movingLocal)
      const circleCenter = toWorld({ x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height / 2 })
      return {
        ...base,
        positionX: circleCenter.x,
        positionY: circleCenter.y,
        width: targetBounds.width,
        height: targetBounds.height,
      }
    }

    const rect = normalizeResizeRectFromHandle(anchor, movingLocal)
    const fallbackCenter = toWorld({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
    return {
      ...base,
      positionX: fallbackCenter.x,
      positionY: fallbackCenter.y,
      width: rect.width,
      height: rect.height,
    }
  }

  return {
    rotatePointAround,
    isPointInRect,
    isPointInRotatedRect,
    getRectIntersectionArea,
    getResizeHandlePoints,
    getRotateHandlePoint,
    getBoundsResizeHandles,
    hitResizeHandleByBounds,
    hitRotateHandleByBounds,
    hitResizeHandle,
    hitRotateHandle,
    resizeBoundsByHandle,
    applyTransformToGraphic,
    applyRotateToGraphic,
    rotateGraphicAround,
    updateGraphicByResize,
  }
}
