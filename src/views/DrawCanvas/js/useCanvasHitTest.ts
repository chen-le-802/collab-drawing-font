import type { GraphicVO } from '@/types/graphic'

// 命中测试模块：
// 负责“鼠标点到了什么”的判定，包括图元本体、路径边线、闭合区域等。
// index.vue 通过该模块把点击点映射为“选中对象”。
export type CanvasPoint = { x: number; y: number }
export type RectBounds = { x: number; y: number; width: number; height: number }

interface CanvasHitTestDeps {
  getGraphicBounds: (graphic: GraphicVO) => RectBounds
  getArrowEndpoints: (graphic: GraphicVO) => { start: CanvasPoint; end: CanvasPoint } | null
  isClosedPath: (points: CanvasPoint[]) => boolean
}

export const createCanvasHitTestHelpers = (deps: CanvasHitTestDeps) => {
  // 点到线段的最短距离，用于线条/path 边线命中判定。
  const pointToSegmentDistance = (p: CanvasPoint, start: CanvasPoint, end: CanvasPoint): number => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    if (dx === 0 && dy === 0) {
      return Math.hypot(p.x - start.x, p.y - start.y)
    }
    const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy)))
    const projX = start.x + t * dx
    const projY = start.y + t * dy
    return Math.hypot(p.x - projX, p.y - projY)
  }

  // 射线法判断点是否在多边形内部（闭合 path 填充命中）。
  const pointInPolygon = (point: CanvasPoint, polygon: CanvasPoint[]): boolean => {
    if (polygon.length < 3) {
      return false
    }
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const pi = polygon[i]
      const pj = polygon[j]
      if (!pi || !pj) {
        continue
      }
      const intersect =
        (pi.y > point.y) !== (pj.y > point.y) &&
        point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || Number.EPSILON) + pi.x
      if (intersect) {
        inside = !inside
      }
    }
    return inside
  }

  // 单图元命中判定：按图元类型选择最合适的几何规则。
  const pointInGraphic = (point: CanvasPoint, graphic: GraphicVO): boolean => {
    if (graphic.objectType === 'image') {
      const bounds = deps.getGraphicBounds(graphic)
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      )
    }

    if (graphic.objectType === 'path') {
      const arrowEndpoints = deps.getArrowEndpoints(graphic)
      if (arrowEndpoints) {
        const hitDistance = Math.max(6, graphic.strokeWidth + 4)
        return pointToSegmentDistance(point, arrowEndpoints.start, arrowEndpoints.end) <= hitDistance
      }
      const points = graphic.pathPoints ?? []
      if (points.length < 2) {
        return false
      }
      if (deps.isClosedPath(points) && pointInPolygon(point, points)) {
        return true
      }
      const hitDistance = Math.max(6, graphic.strokeWidth + 4)
      for (let i = 1; i < points.length; i += 1) {
        const start = points[i - 1]
        const end = points[i]
        if (!start || !end) {
          continue
        }
        if (pointToSegmentDistance(point, start, end) <= hitDistance) {
          return true
        }
      }
      return false
    }

    if (graphic.objectType === 'line') {
      const start = { x: graphic.positionX, y: graphic.positionY }
      const end = { x: graphic.positionX + (graphic.width ?? 0), y: graphic.positionY + (graphic.height ?? 0) }
      return pointToSegmentDistance(point, start, end) <= Math.max(6, graphic.strokeWidth + 4)
    }

    if (graphic.objectType === 'circle') {
      const radiusX = Math.max(1, Math.abs(graphic.width ?? 0) / 2)
      const radiusY = Math.max(1, Math.abs(graphic.height ?? 0) / 2)
      const normalizedX = (point.x - graphic.positionX) / (radiusX + 4)
      const normalizedY = (point.y - graphic.positionY) / (radiusY + 4)
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1
    }

    const bounds = deps.getGraphicBounds(graphic)
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    )
  }

  // 命中入口：按 zIndex 从上到下遍历，先粗过滤再精判，返回顶层命中图元。
  const pickGraphic = (point: CanvasPoint, sortedGraphics: GraphicVO[]): GraphicVO | null => {
    const reverse = [...sortedGraphics].reverse()
    for (const graphic of reverse) {
      // 先做一次粗粒度包围盒过滤，减少复杂命中计算次数。
      const bounds = deps.getGraphicBounds(graphic)
      const pad = Math.max(8, graphic.strokeWidth + 4)
      if (
        point.x < bounds.x - pad ||
        point.x > bounds.x + bounds.width + pad ||
        point.y < bounds.y - pad ||
        point.y > bounds.y + bounds.height + pad
      ) {
        continue
      }
      if (pointInGraphic(point, graphic)) {
        return graphic
      }
    }
    return null
  }

  return {
    pointToSegmentDistance,
    pointInPolygon,
    pointInGraphic,
    pickGraphic,
  }
}
