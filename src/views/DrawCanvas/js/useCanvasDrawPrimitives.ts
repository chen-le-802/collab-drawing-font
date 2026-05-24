import type { GraphicVO } from '@/types/graphic'

type Point = { x: number; y: number }

type UseCanvasDrawPrimitivesOptions = {
  isArrowPathGraphic: (graphic: GraphicVO) => boolean
  isClosedPath: (points: Point[]) => boolean
  scheduleRender: () => void
  getToken: () => string | null | undefined
}

/**
 * 封装图元基础绘制与图片缓存生命周期。
 * 让 DrawCanvas/index.vue 聚焦在交互编排本身。
 */
export const useCanvasDrawPrimitives = (options: UseCanvasDrawPrimitivesOptions) => {
  // 图片缓存：src -> HTMLImageElement，避免每帧重复创建 Image 对象。
  const imageElementCache = new Map<string, HTMLImageElement>()
  // 回退加载中的 src，避免同一图片错误时并发触发多次 fetch。
  const imageFallbackLoading = new Set<string>()
  // 由 fetch(blob) 生成的 objectUrl，组件销毁时统一释放。
  const imageObjectUrlBySource = new Map<string, string>()

  const drawLine = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
    ctx.beginPath()
    ctx.moveTo(graphic.positionX, graphic.positionY)
    ctx.lineTo(graphic.positionX + (graphic.width ?? 0), graphic.positionY + (graphic.height ?? 0))
    ctx.strokeStyle = graphic.strokeColor
    ctx.lineWidth = graphic.strokeWidth
    ctx.stroke()
  }

  const drawRect = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    const width = graphic.width ?? 0
    const height = graphic.height ?? 0
    const rotation = ((graphic.rotation ?? 0) * Math.PI) / 180
    const center = { x: graphic.positionX + width / 2, y: graphic.positionY + height / 2 }
    ctx.save()
    if (rotation) {
      ctx.translate(center.x, center.y)
      ctx.rotate(rotation)
      ctx.translate(-center.x, -center.y)
    }
    if (graphic.fillColor && graphic.fillColor !== 'transparent') {
      ctx.fillStyle = graphic.fillColor
      ctx.fillRect(graphic.positionX, graphic.positionY, width, height)
    }
    ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
    ctx.strokeStyle = graphic.strokeColor
    ctx.lineWidth = graphic.strokeWidth
    ctx.strokeRect(graphic.positionX, graphic.positionY, width, height)
    ctx.restore()
  }

  const drawCircle = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    const radiusX = Math.abs(graphic.width ?? 0) / 2
    const radiusY = Math.abs(graphic.height ?? 0) / 2
    const rotation = ((graphic.rotation ?? 0) * Math.PI) / 180
    ctx.beginPath()
    ctx.ellipse(graphic.positionX, graphic.positionY, radiusX, radiusY, rotation, 0, Math.PI * 2)
    if (graphic.fillColor && graphic.fillColor !== 'transparent') {
      ctx.fillStyle = graphic.fillColor
      ctx.fill()
    }
    ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
    ctx.strokeStyle = graphic.strokeColor
    ctx.lineWidth = graphic.strokeWidth
    ctx.stroke()
  }

  const drawText = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    const fontSize = graphic.fontSize ?? 16
    const text = graphic.textContent ?? ''
    const rotation = ((graphic.rotation ?? 0) * Math.PI) / 180
    const boxWidth = graphic.width ?? Math.max(160, text.length * fontSize * 0.6)
    const boxHeight = graphic.height ?? Math.max(fontSize + 8, 24)
    const center = { x: graphic.positionX + boxWidth / 2, y: graphic.positionY + boxHeight / 2 }
    ctx.save()
    if (rotation) {
      ctx.translate(center.x, center.y)
      ctx.rotate(rotation)
      ctx.translate(-center.x, -center.y)
    }
    ctx.fillStyle = graphic.strokeColor
    ctx.font = `${fontSize}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(text, graphic.positionX, graphic.positionY)
    ctx.restore()
  }

  const drawPath = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    const points = graphic.pathPoints ?? []
    if (points.length < 2) {
      return
    }
    if (options.isArrowPathGraphic(graphic)) {
      const start = points[0]
      const end = points[1]
      const left = points[2]
      const right = points[4]
      if (!start || !end || !left || !right) {
        return
      }
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      // 箭杆遵循当前线型（实线/虚线）。
      ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()

      // 箭头头部保持实线，保证方向识别清晰。
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(left.x, left.y)
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(right.x, right.y)
      ctx.stroke()
      return
    }
    const first = points[0]
    if (!first) {
      return
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]
      if (!point) {
        continue
      }
      ctx.lineTo(point.x, point.y)
    }
    if (options.isClosedPath(points)) {
      // 闭合路径允许填充；未闭合路径仅描边。
      ctx.closePath()
      if (graphic.fillColor && graphic.fillColor !== 'transparent') {
        ctx.fillStyle = graphic.fillColor
        ctx.fill()
      }
    }
    ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
    ctx.strokeStyle = graphic.strokeColor
    ctx.lineWidth = graphic.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  const drawImageGraphic = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    const width = Math.max(1, Math.abs(graphic.width ?? 0))
    const height = Math.max(1, Math.abs(graphic.height ?? 0))
    const x = graphic.positionX
    const y = graphic.positionY
    const src = graphic.textContent || ''
    const rotation = ((graphic.rotation ?? 0) * Math.PI) / 180
    const center = { x: x + width / 2, y: y + height / 2 }
    const withRotation = (fn: () => void) => {
      ctx.save()
      if (rotation) {
        ctx.translate(center.x, center.y)
        ctx.rotate(rotation)
        ctx.translate(-center.x, -center.y)
      }
      fn()
      ctx.restore()
    }
    if (!src) {
      // 无图片源时绘制占位块，避免空白区域无反馈。
      withRotation(() => {
        ctx.fillStyle = '#f3f4f6'
        ctx.fillRect(x, y, width, height)
      })
      return
    }

    const cached = imageElementCache.get(src)
    if (cached && cached.complete && cached.naturalWidth > 0 && cached.naturalHeight > 0) {
      withRotation(() => {
        ctx.drawImage(cached, x, y, width, height)
      })
      return
    }

    if (!cached) {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        options.scheduleRender()
      }
      image.onerror = () => {
        imageElementCache.delete(src)
        // 首次失败时回退到 fetch + blob 模式（携带 token），兼容受鉴权保护的资源地址。
        if (!imageFallbackLoading.has(src)) {
          imageFallbackLoading.add(src)
          fetch(src, {
            credentials: 'include',
            headers: (() => {
              const token = options.getToken()
              return token ? { Authorization: `Bearer ${token}` } : undefined
            })(),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error(`图片拉取失败: ${response.status}`)
              }
              return response.blob()
            })
            .then((blob) => {
              const objectUrl = URL.createObjectURL(blob)
              imageObjectUrlBySource.set(src, objectUrl)
              const fallbackImage = new Image()
              fallbackImage.onload = () => {
                imageElementCache.set(src, fallbackImage)
                options.scheduleRender()
              }
              fallbackImage.onerror = () => {
                options.scheduleRender()
              }
              fallbackImage.src = objectUrl
            })
            .catch(() => {
              options.scheduleRender()
            })
            .finally(() => {
              imageFallbackLoading.delete(src)
            })
        } else {
          options.scheduleRender()
        }
      }
      image.src = src
      imageElementCache.set(src, image)
    }

    withRotation(() => {
      // 加载中的轻占位底色，避免出现突兀白块。
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(x, y, width, height)
    })
  }

  const drawGraphic = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
    switch (graphic.objectType) {
      case 'image':
        drawImageGraphic(ctx, graphic)
        break
      case 'line':
        drawLine(ctx, graphic)
        break
      case 'rect':
        drawRect(ctx, graphic)
        break
      case 'circle':
        drawCircle(ctx, graphic)
        break
      case 'text':
        drawText(ctx, graphic)
        break
      case 'path':
        drawPath(ctx, graphic)
        break
      default:
        break
    }
  }

  const disposeImageResources = () => {
    // 释放 objectUrl，避免长期编辑后内存持续增长。
    imageObjectUrlBySource.forEach((url) => URL.revokeObjectURL(url))
    imageObjectUrlBySource.clear()
    imageFallbackLoading.clear()
  }

  return {
    drawLine,
    drawRect,
    drawCircle,
    drawText,
    drawPath,
    drawImageGraphic,
    drawGraphic,
    disposeImageResources,
  }
}
