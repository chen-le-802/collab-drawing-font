import type { GraphicVO } from '@/types/graphic'

// 画布几何计算核心模块：
// 负责图元包围盒、旋转换算、选中框轮廓、缩放基准区域等纯数学逻辑。
// 该文件不依赖 Vue 状态，便于在渲染/命中检测/变换流程中复用与单测。
export type CanvasPoint = { x: number; y: number }
export type RectBounds = { x: number; y: number; width: number; height: number }

// 统一矩形方向：无论 width/height 正负，最终都返回左上角 + 正宽高。
export const normalizeRect = (x: number, y: number, width: number, height: number): RectBounds => {
  const left = Math.min(x, x + width)
  const top = Math.min(y, y + height)
  const right = Math.max(x, x + width)
  const bottom = Math.max(y, y + height)
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

// 将点 point 围绕 center 旋转 angleRad（弧度）。
export const rotatePoint = (point: CanvasPoint, center: CanvasPoint, angleRad: number): CanvasPoint => {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

// 将点绕原点(0,0)旋转 angle（弧度），常用于“先转到局部坐标再计算”。
export const rotatePointByAngle = (point: CanvasPoint, angle: number): CanvasPoint => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

const almostSamePoint = (a: CanvasPoint, b: CanvasPoint, epsilon = 1): boolean => {
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsilon
}

// 识别“箭头 path”的约定形态：
// [起点, 终点, 左翼点, 重复终点, 右翼点]，用于后续使用线段式的选中与缩放逻辑。
export const isArrowPathGraphic = (graphic: GraphicVO): boolean => {
  if (graphic.objectType !== 'path') {
    return false
  }
  const points = graphic.pathPoints ?? []
  if (points.length !== 5) {
    return false
  }
  const start = points[0]
  const end = points[1]
  const left = points[2]
  const endRepeat = points[3]
  const right = points[4]
  if (!start || !end || !left || !endRepeat || !right) {
    return false
  }
  if (!almostSamePoint(end, endRepeat)) {
    return false
  }
  if (almostSamePoint(start, end)) {
    return false
  }
  if (almostSamePoint(left, end) || almostSamePoint(right, end)) {
    return false
  }
  return true
}

// 提取箭头主干线起止点（用于包围盒、旋转、命中判定）。
export const getArrowEndpoints = (graphic: GraphicVO): { start: CanvasPoint; end: CanvasPoint } | null => {
  if (!isArrowPathGraphic(graphic)) {
    return null
  }
  const points = graphic.pathPoints ?? []
  const start = points[0]
  const end = points[1]
  if (!start || !end) {
    return null
  }
  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
  }
}

// “类线图元”：直线 + 箭头 path。二者在交互上按线段处理。
export const isLineLikeGraphic = (graphic: GraphicVO): boolean => {
  return graphic.objectType === 'line' || isArrowPathGraphic(graphic)
}

// 计算旋转矩形在世界坐标中的轴对齐外接包围盒（AABB）。
export const getRotatedRectBounds = (x: number, y: number, width: number, height: number, rotationDeg: number): RectBounds => {
  const rect = normalizeRect(x, y, width, height)
  if (!rotationDeg) {
    return rect
  }
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const angle = (rotationDeg * Math.PI) / 180
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((p) => rotatePoint(p, center, angle))
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

// 判断路径是否闭合（首尾距离在阈值内）。
export const isClosedPath = (points: CanvasPoint[], pathCloseDistance: number): boolean => {
  if (points.length < 3) {
    return false
  }
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return false
  }
  return Math.hypot(first.x - last.x, first.y - last.y) <= pathCloseDistance
}

// 把角度规约到 [-PI/2, PI/2]，避免同方向角度表示不一致（如 0° 与 180°）。
const normalizeAngleRad = (value: number) => {
  let angle = value % Math.PI
  if (angle > Math.PI / 2) {
    angle -= Math.PI
  }
  if (angle <= -Math.PI / 2) {
    angle += Math.PI
  }
  return angle
}

// 为闭合 path 估计“更贴合形状主方向”的旋转角：
// 遍历每条边方向，寻找使外接矩形面积最小的角度（面积相同再比周长）。
const estimatePathRotationRad = (points: CanvasPoint[], pathCloseDistance: number): number => {
  if (points.length < 2) {
    return 0
  }
  const normalized = [...points]
  if (normalized.length >= 3) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= pathCloseDistance) {
      normalized.pop()
    }
  }
  if (normalized.length < 2) {
    return 0
  }

  let bestAngle = 0
  let minArea = Number.POSITIVE_INFINITY
  let bestPerimeter = Number.POSITIVE_INFINITY

  for (let i = 0; i < normalized.length; i += 1) {
    const a = normalized[i]
    const b = normalized[(i + 1) % normalized.length]
    if (!a || !b) {
      continue
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.hypot(dx, dy) < 1e-3) {
      continue
    }
    const angle = normalizeAngleRad(Math.atan2(dy, dx))
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    normalized.forEach((point) => {
      const x = point.x * cos - point.y * sin
      const y = point.x * sin + point.y * cos
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    })
    const width = Math.max(1e-3, maxX - minX)
    const height = Math.max(1e-3, maxY - minY)
    const area = width * height
    const perimeter = width + height
    if (area < minArea - 1e-3 || (Math.abs(area - minArea) <= 1e-3 && perimeter < bestPerimeter)) {
      minArea = area
      bestPerimeter = perimeter
      bestAngle = angle
    }
  }

  return normalizeAngleRad(bestAngle)
}

// 仅对“顶点数量较少且闭合”的 path 使用自动角度估计，避免自由手绘抖动导致旋转不稳定。
const shouldUseEstimatedPathRotation = (graphic: GraphicVO, pathCloseDistance: number): boolean => {
  const points = graphic.pathPoints ?? []
  if (points.length < 4) {
    return false
  }
  if (!isClosedPath(points, pathCloseDistance)) {
    return false
  }
  const normalized = [...points]
  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= pathCloseDistance) {
    normalized.pop()
  }
  return normalized.length >= 3 && normalized.length <= 8
}

// 计算图元用于“选中框/控制柄”的旋转角（弧度）：
// - 线类图元返回 0（由专用线段交互处理）
// - 非 path 优先用显式 rotation
// - 闭合 path 在未显式旋转时可回退到自动估计角
export const getGraphicSelectionRotationRad = (graphic: GraphicVO, pathCloseDistance: number): number => {
  if (isLineLikeGraphic(graphic)) {
    return 0
  }
  const explicit = ((graphic.rotation ?? 0) * Math.PI) / 180
  if (graphic.objectType !== 'path') {
    return explicit
  }
  if (Math.abs(explicit) > 1e-6) {
    return explicit
  }
  if (!shouldUseEstimatedPathRotation(graphic, pathCloseDistance)) {
    return 0
  }
  return estimatePathRotationRad(graphic.pathPoints ?? [], pathCloseDistance)
}

// 生成 path 图元的旋转选中轮廓四角点（含描边 padding），供绘制虚框与控制柄。
export const getPathSelectionOutlinePoints = (
  graphic: GraphicVO,
  pathCloseDistance: number,
): CanvasPoint[] => {
  const points = graphic.pathPoints ?? []
  if (points.length < 2) {
    return []
  }
  const normalized = [...points]
  if (normalized.length >= 3) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= pathCloseDistance) {
      normalized.pop()
    }
  }
  if (normalized.length < 2) {
    return []
  }

  const rotation = getGraphicSelectionRotationRad(graphic, pathCloseDistance)
  const localPoints = normalized.map((point) => rotatePointByAngle(point, -rotation))
  const xs = localPoints.map((p) => p.x)
  const ys = localPoints.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padding = Math.max(3, graphic.strokeWidth / 2 + 1)
  const localCorners: CanvasPoint[] = [
    { x: minX - padding, y: minY - padding },
    { x: maxX + padding, y: minY - padding },
    { x: maxX + padding, y: maxY + padding },
    { x: minX - padding, y: maxY + padding },
  ]
  return localCorners.map((corner) => rotatePointByAngle(corner, rotation))
}

// 统一获取图元世界包围盒（AABB）。
// 不同图元类型按各自语义计算：如 circle 以中心点+半径、line/arrow 带交互 padding。
export const getGraphicBounds = (graphic: GraphicVO): RectBounds => {
  if (graphic.objectType === 'image') {
    return getRotatedRectBounds(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0, graphic.rotation ?? 0)
  }

  const arrowEndpoints = getArrowEndpoints(graphic)
  if (arrowEndpoints) {
    const { start, end } = arrowEndpoints
    const pad = Math.max(6, graphic.strokeWidth + 4)
    return {
      x: Math.min(start.x, end.x) - pad,
      y: Math.min(start.y, end.y) - pad,
      width: Math.abs(end.x - start.x) + pad * 2,
      height: Math.abs(end.y - start.y) + pad * 2,
    }
  }

  if (graphic.objectType === 'path') {
    const points = graphic.pathPoints ?? []
    if (points.length === 0) {
      return normalizeRect(graphic.positionX, graphic.positionY, 0, 0)
    }
    const xs = points.map((item) => item.x)
    const ys = points.map((item) => item.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  }

  if (graphic.objectType === 'line') {
    const endX = graphic.positionX + (graphic.width ?? 0)
    const endY = graphic.positionY + (graphic.height ?? 0)
    const pad = Math.max(6, graphic.strokeWidth + 4)
    return {
      x: Math.min(graphic.positionX, endX) - pad,
      y: Math.min(graphic.positionY, endY) - pad,
      width: Math.abs(endX - graphic.positionX) + pad * 2,
      height: Math.abs(endY - graphic.positionY) + pad * 2,
    }
  }

  if (graphic.objectType === 'circle') {
    const diameterX = Math.abs(graphic.width ?? 0)
    const diameterY = Math.abs(graphic.height ?? 0)
    const radiusX = diameterX / 2
    const radiusY = diameterY / 2
    return {
      x: graphic.positionX - radiusX,
      y: graphic.positionY - radiusY,
      width: diameterX,
      height: diameterY,
    }
  }

  if (graphic.objectType === 'text') {
    const width = graphic.width ?? 140
    const height = graphic.height ?? Math.max((graphic.fontSize ?? 16) + 8, 24)
    return getRotatedRectBounds(graphic.positionX, graphic.positionY, width, height, graphic.rotation ?? 0)
  }

  if (graphic.objectType === 'rect') {
    return getRotatedRectBounds(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0, graphic.rotation ?? 0)
  }

  return normalizeRect(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0)
}

// 获取图元中心点（用于旋转、组变换等）：
// path 优先使用其选中轮廓中心，避免仅按 positionX/Y 带来的偏移。
export const getGraphicCenter = (graphic: GraphicVO, pathCloseDistance: number): CanvasPoint => {
  if (graphic.objectType === 'circle') {
    return { x: graphic.positionX, y: graphic.positionY }
  }
  if (graphic.objectType === 'path' && !isArrowPathGraphic(graphic)) {
    const outline = getPathSelectionOutlinePoints(graphic, pathCloseDistance)
    const a = outline[0]
    const c = outline[2]
    if (a && c) {
      return {
        x: (a.x + c.x) / 2,
        y: (a.y + c.y) / 2,
      }
    }
  }
  const bounds = getGraphicBounds(graphic)
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

// 获取“缩放计算基准”的本地包围盒：
// 与展示包围盒不同，这里更偏向变换数学需要，保证缩放过程稳定。
export const getLocalResizeBounds = (graphic: GraphicVO): RectBounds => {
  if (graphic.objectType === 'circle') {
    const width = Math.max(1, Math.abs(graphic.width ?? 0))
    const height = Math.max(1, Math.abs(graphic.height ?? 0))
    return {
      x: graphic.positionX - width / 2,
      y: graphic.positionY - height / 2,
      width,
      height,
    }
  }
  if (graphic.objectType === 'path') {
    const points = graphic.pathPoints ?? []
    if (points.length === 0) {
      return normalizeRect(graphic.positionX, graphic.positionY, 1, 1)
    }
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    }
  }
  return normalizeRect(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0)
}
