import { ref, type Ref } from 'vue'

import type { GraphicVO } from '@/types/graphic'

type Point = { x: number; y: number }

type UseCanvasViewControlsOptions = {
  canvasRef: Ref<HTMLCanvasElement | null>
  focusActionsRef: Ref<HTMLDivElement | null>
  getZoomScale: () => number
  getViewportOffset: () => Point
  getSortedGraphics: () => GraphicVO[]
  getCurrentSessionName: () => string
  drawGrid: (ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number, backgroundHex: string) => void
  drawGraphic: (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => void
  scheduleRender: () => void
  onError: (message: string) => void
  onErrorFrom: (error: unknown, fallback: string) => void
  onSuccess: (message: string) => void
}

const CANVAS_BACKGROUND_KEY = 'collab_canvas_background_v1'

/**
 * 管理导出、背景与专注模式浮窗等视图能力，
 * 让 DrawCanvas/index.vue 只保留页面编排逻辑。
 */
export const useCanvasViewControls = (options: UseCanvasViewControlsOptions) => {
  const exportDialogVisible = ref(false)
  const exportFormat = ref<'png' | 'svg' | 'pdf'>('png')
  const exportIncludeGrid = ref(true)

  const showGrid = ref(true)
  const backgroundDialogVisible = ref(false)
  const canvasBackgroundColor = ref('#ffffff')
  const canvasBackgroundPresets = ['#ffffff', '#f8fafc', '#f6f7fb', '#fefce8', '#f0fdf4', '#eef2ff', '#fff1f2', '#f5f3ff']

  const focusMode = ref(false)
  const focusActionsPos = ref<Point>({ x: 16, y: 68 })
  const focusActionsCollapsed = ref(false)
  const focusActionsDragging = ref(false)
  const focusActionsDragOffset = ref<Point>({ x: 0, y: 0 })

  const sanitizeFilename = (name: string) => {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名会话'
  }

  const formatNowForFilename = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    return `${y}${m}${d}_${hh}${mm}${ss}`
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }

  const normalizeHexColor = (value: string): string | null => {
    const text = value.trim()
    if (!text) {
      return null
    }
    const withPrefix = text.startsWith('#') ? text : `#${text}`
    if (!/^#([0-9a-fA-F]{6})$/.test(withPrefix)) {
      return null
    }
    return withPrefix.toLowerCase()
  }

  const loadCanvasBackgroundColor = () => {
    const cached = localStorage.getItem(CANVAS_BACKGROUND_KEY)
    const normalized = cached ? normalizeHexColor(cached) : null
    canvasBackgroundColor.value = normalized ?? '#ffffff'
  }

  const saveCanvasBackgroundColor = (value: string) => {
    localStorage.setItem(CANVAS_BACKGROUND_KEY, value)
  }

  const hexToRgb = (value: string): { r: number; g: number; b: number } | null => {
    const normalized = normalizeHexColor(value)
    if (!normalized) {
      return null
    }
    const raw = normalized.slice(1)
    const r = Number.parseInt(raw.slice(0, 2), 16)
    const g = Number.parseInt(raw.slice(2, 4), 16)
    const b = Number.parseInt(raw.slice(4, 6), 16)
    if (![r, g, b].every((item) => Number.isFinite(item))) {
      return null
    }
    return { r, g, b }
  }

  const getGridColorForBackground = (backgroundHex: string): string => {
    const rgb = hexToRgb(backgroundHex)
    if (!rgb) {
      return 'rgba(148, 163, 184, 0.22)'
    }
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
    const alpha = luminance > 0.62 ? 0.22 : 0.3
    return luminance > 0.62 ? `rgba(148, 163, 184, ${alpha})` : `rgba(241, 245, 249, ${alpha})`
  }

  const createExportCanvas = () => {
    // 导出使用离屏 canvas，避免干扰主画布实时渲染。
    const canvas = options.canvasRef.value
    if (!canvas) {
      return null
    }
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const exportCtx = exportCanvas.getContext('2d')
    if (!exportCtx) {
      return null
    }
    exportCtx.fillStyle = canvasBackgroundColor.value
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)

    exportCtx.save()
    const zoomScale = options.getZoomScale()
    const viewportOffset = options.getViewportOffset()
    exportCtx.scale(zoomScale, zoomScale)
    exportCtx.translate(viewportOffset.x, viewportOffset.y)
    const worldWidth = exportCanvas.width / zoomScale
    const worldHeight = exportCanvas.height / zoomScale
    const viewLeft = -viewportOffset.x
    const viewTop = -viewportOffset.y
    const viewRight = viewLeft + worldWidth
    const viewBottom = viewTop + worldHeight

    if (exportIncludeGrid.value) {
      options.drawGrid(exportCtx, viewLeft, viewTop, viewRight, viewBottom, canvasBackgroundColor.value)
    }
    options.getSortedGraphics().forEach((graphic) => options.drawGraphic(exportCtx, graphic))
    exportCtx.restore()
    return exportCanvas
  }

  const blobFromCanvas = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 1) => {
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((file) => resolve(file), type, quality)
    })
  }

  const buildSimplePdfFromJpegBytes = (jpegBytes: Uint8Array, widthPx: number, heightPx: number): Blob => {
    // 轻量 PDF 组装：不引入大型依赖，直接拼接最小可用 PDF 结构。
    const widthPt = Math.max(1, (widthPx * 72) / 96)
    const heightPt = Math.max(1, (heightPx * 72) / 96)
    const contentStream = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`

    const encoder = new TextEncoder()
    const chunks: string[] = []
    const offsets: number[] = [0]
    let length = 0

    const pushText = (value: string) => {
      const bytes = encoder.encode(value)
      chunks.push(value)
      length += bytes.length
    }
    const pushBytes = (bytes: Uint8Array) => {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i] ?? 0)
      }
      chunks.push(binary)
      length += bytes.length
    }

    const addObject = (id: number, body: string, binary?: Uint8Array) => {
      offsets[id] = length
      pushText(`${id} 0 obj\n${body}\n`)
      if (binary) {
        pushText('stream\n')
        pushBytes(binary)
        pushText('\nendstream\n')
      }
      pushText('endobj\n')
    }

    pushText('%PDF-1.4\n')
    addObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
    addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    addObject(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>`,
    )
    addObject(4, `<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream`)
    addObject(
      5,
      `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`,
      jpegBytes,
    )

    const xrefStart = length
    pushText(`xref\n0 6\n0000000000 65535 f \n`)
    for (let i = 1; i <= 5; i += 1) {
      const offset = offsets[i] ?? 0
      pushText(`${String(offset).padStart(10, '0')} 00000 n \n`)
    }
    pushText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)
    return new Blob(chunks, { type: 'application/pdf' })
  }

  const parseDataUrlBase64 = (dataUrl: string): Uint8Array | null => {
    const commaIndex = dataUrl.indexOf(',')
    if (commaIndex <= 0) {
      return null
    }
    const b64 = dataUrl.slice(commaIndex + 1)
    try {
      const binary = atob(b64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    } catch {
      return null
    }
  }

  const handleExportImage = async () => {
    exportDialogVisible.value = true
  }

  const confirmExportImage = async () => {
    const canvas = createExportCanvas()
    if (!canvas) {
      options.onError('画布尚未就绪，暂时无法导出')
      return
    }
    try {
      const sessionName = sanitizeFilename(options.getCurrentSessionName())
      const stamp = formatNowForFilename()
      if (exportFormat.value === 'png') {
        const pngBlob = await blobFromCanvas(canvas, 'image/png', 1)
        if (!pngBlob) {
          options.onError('导出失败：PNG 编码失败')
          return
        }
        downloadBlob(pngBlob, `${sessionName}_${stamp}.png`)
        options.onSuccess('已导出 PNG')
        exportDialogVisible.value = false
        return
      }

      if (exportFormat.value === 'svg') {
        // 当前实现以“位图嵌入 SVG”的方式导出，保持视觉一致性。
        const pngDataUrl = canvas.toDataURL('image/png')
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><rect width="100%" height="100%" fill="${canvasBackgroundColor.value}"/><image href="${pngDataUrl}" width="${canvas.width}" height="${canvas.height}" /></svg>`
        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
        downloadBlob(svgBlob, `${sessionName}_${stamp}.svg`)
        options.onSuccess('已导出 SVG')
        exportDialogVisible.value = false
        return
      }

      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
      const jpegBytes = parseDataUrlBase64(jpegDataUrl)
      if (!jpegBytes) {
        options.onError('导出失败：PDF 编码失败')
        return
      }
      const pdfBlob = buildSimplePdfFromJpegBytes(jpegBytes, canvas.width, canvas.height)
      downloadBlob(pdfBlob, `${sessionName}_${stamp}.pdf`)
      options.onSuccess('已导出 PDF')
      exportDialogVisible.value = false
    } catch (error) {
      options.onErrorFrom(error, '导出失败')
    }
  }

  const handleToggleGrid = () => {
    showGrid.value = !showGrid.value
    options.scheduleRender()
  }

  const applyCanvasBackgroundColor = (value: string) => {
    const normalized = normalizeHexColor(value)
    if (!normalized) {
      return
    }
    canvasBackgroundColor.value = normalized
    saveCanvasBackgroundColor(normalized)
    options.scheduleRender()
  }

  const handleShowBackground = () => {
    backgroundDialogVisible.value = true
  }

  const handleToggleFocusMode = () => {
    focusMode.value = !focusMode.value
  }

  const clampFocusActionsPosition = (x: number, y: number) => {
    // 将浮窗位置限制在浏览器可视区内，避免拖拽后丢失。
    const panelWidth = Math.max(
      120,
      Math.ceil(options.focusActionsRef.value?.getBoundingClientRect().width ?? (focusActionsCollapsed.value ? 130 : 360)),
    )
    const panelHeight = Math.max(40, Math.ceil(options.focusActionsRef.value?.getBoundingClientRect().height ?? 48))
    const minX = 8
    const minY = 8
    const maxX = Math.max(minX, window.innerWidth - panelWidth - 8)
    const maxY = Math.max(minY, window.innerHeight - panelHeight - 8)
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    }
  }

  const placeFocusActionsToRight = () => {
    // 展开/收起后把浮窗吸附到右侧，避免挡住左侧工具栏。
    const panelWidth = Math.max(
      120,
      Math.ceil(options.focusActionsRef.value?.getBoundingClientRect().width ?? (focusActionsCollapsed.value ? 130 : 360)),
    )
    const next = clampFocusActionsPosition(window.innerWidth - panelWidth - 16, 68)
    focusActionsPos.value = next
  }

  const handleFocusActionsDragMove = (event: MouseEvent) => {
    if (!focusActionsDragging.value) {
      return
    }
    const next = clampFocusActionsPosition(
      event.clientX - focusActionsDragOffset.value.x,
      event.clientY - focusActionsDragOffset.value.y,
    )
    focusActionsPos.value = next
  }

  const stopFocusActionsDrag = () => {
    if (!focusActionsDragging.value) {
      return
    }
    focusActionsDragging.value = false
    window.removeEventListener('mousemove', handleFocusActionsDragMove)
    window.removeEventListener('mouseup', stopFocusActionsDrag)
  }

  const startFocusActionsDrag = (event: MouseEvent) => {
    focusActionsDragging.value = true
    focusActionsDragOffset.value = {
      x: event.clientX - focusActionsPos.value.x,
      y: event.clientY - focusActionsPos.value.y,
    }
    window.addEventListener('mousemove', handleFocusActionsDragMove)
    window.addEventListener('mouseup', stopFocusActionsDrag)
  }

  return {
    exportDialogVisible,
    exportFormat,
    exportIncludeGrid,
    showGrid,
    backgroundDialogVisible,
    canvasBackgroundColor,
    canvasBackgroundPresets,
    focusMode,
    focusActionsPos,
    focusActionsCollapsed,
    focusActionsDragging,
    formatNowForFilename,
    loadCanvasBackgroundColor,
    getGridColorForBackground,
    handleExportImage,
    confirmExportImage,
    handleToggleGrid,
    applyCanvasBackgroundColor,
    handleShowBackground,
    handleToggleFocusMode,
    clampFocusActionsPosition,
    placeFocusActionsToRight,
    startFocusActionsDrag,
    stopFocusActionsDrag,
  }
}
