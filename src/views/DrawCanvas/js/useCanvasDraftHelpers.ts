import type { ShapeToolType } from '@/components/toolbar/ToolBar.vue'
import { normalizeRect } from '@/views/DrawCanvas/js/canvasGeometry'

export type CanvasPoint = { x: number; y: number }

interface CanvasDraftHelperOptions {
  pathCloseDistance: number
  arrowHeadBase: number
  arrowHeadMax: number
}

// 草稿图形辅助器：
// 负责“鼠标拖拽阶段”的几何点生成与归一化，确保落库前图元结构稳定可复现。
export const createCanvasDraftHelpers = (options: CanvasDraftHelperOptions) => {
  // 手绘/多边形结束时做闭合吸附：
  // 当首尾足够接近，直接把末点吸附到首点，避免后续填充判定出现“看似闭合但数据未闭合”。
  const normalizePathPointsOnFinish = (points: CanvasPoint[]): CanvasPoint[] => {
    if (points.length < 2) {
      return points
    }
    const first = points[0]
    const last = points[points.length - 1]
    if (!first || !last) {
      return points
    }
    if (Math.hypot(first.x - last.x, first.y - last.y) > options.pathCloseDistance) {
      return points
    }
    const next = points.slice()
    next[next.length - 1] = { x: first.x, y: first.y }
    return next
  }

  // 根据起终点生成箭头 path 点列：
  // 主干为 start->end，箭头翼点由“反向单位向量”按固定夹角旋转得到。
  // 返回 5 点结构，与 isArrowPathGraphic 的识别规则保持一致。
  const buildArrowPathPoints = (start: CanvasPoint, end: CanvasPoint, strokeWidthValue: number): CanvasPoint[] => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length < 2) {
      return [start, end]
    }

    const ux = dx / length
    const uy = dy / length
    const headLength = Math.min(options.arrowHeadMax, Math.max(options.arrowHeadBase, strokeWidthValue * 3))
    const headAngle = Math.PI / 7
    const cos = Math.cos(headAngle)
    const sin = Math.sin(headAngle)

    // 围绕反向方向向量旋转，计算箭头左右两侧翼点。
    const lx = -ux * cos - -uy * sin
    const ly = -ux * sin + -uy * cos
    const rx = -ux * cos + -uy * sin
    const ry = ux * sin + -uy * cos

    const left: CanvasPoint = {
      x: end.x + lx * headLength,
      y: end.y + ly * headLength,
    }
    const right: CanvasPoint = {
      x: end.x + rx * headLength,
      y: end.y + ry * headLength,
    }

    return [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
      { x: left.x, y: left.y },
      { x: end.x, y: end.y },
      { x: right.x, y: right.y },
    ]
  }

  // 形状工具到顶点数的映射：三角/菱形/五边形/六边形。
  const getShapeVertexCount = (type: ShapeToolType): number => {
    if (type === 'triangle') {
      return 3
    }
    if (type === 'diamond') {
      return 4
    }
    if (type === 'pentagon') {
      return 5
    }
    return 6
  }

  // 生成规则多边形路径（首点最后再追加一次，形成闭合 path）。
  // radiusX/radiusY 分离，允许在拖拽时形成“横纵半径不同”的多边形外接椭圆。
  const buildRegularPolygonPathPoints = (
    center: CanvasPoint,
    radiusX: number,
    radiusY: number,
    vertexCount: number,
  ): CanvasPoint[] => {
    if (vertexCount < 3) {
      return []
    }
    const points: CanvasPoint[] = []
    const step = (Math.PI * 2) / vertexCount
    const startAngle = -Math.PI / 2
    for (let i = 0; i < vertexCount; i += 1) {
      const angle = startAngle + step * i
      points.push({
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
      })
    }
    if (points.length > 0) {
      const firstPoint = points[0]
      if (firstPoint) {
        points.push({ x: firstPoint.x, y: firstPoint.y })
      }
    }
    return points
  }

  // 圆形草稿归一化：取 dx/dy 绝对值最大者作为边长，强制宽高一致。
  // 这样拖任意方向都能得到“正圆”而不是椭圆。
  const normalizeCircleDraftRect = (start: CanvasPoint, end: CanvasPoint) => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    const width = dx >= 0 ? size : -size
    const height = dy >= 0 ? size : -size
    return normalizeRect(start.x, start.y, width, height)
  }

  return {
    normalizePathPointsOnFinish,
    buildArrowPathPoints,
    getShapeVertexCount,
    buildRegularPolygonPathPoints,
    normalizeCircleDraftRect,
  }
}
