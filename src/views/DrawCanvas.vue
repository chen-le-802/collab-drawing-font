<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import MemberPanel from '@/components/sidebar/MemberPanel.vue'
import StatusBar from '@/components/statusbar/StatusBar.vue'
import ToolBar, { type CanvasTool } from '@/components/toolbar/ToolBar.vue'
import TopBar from '@/components/toolbar/TopBar.vue'
import { graphicApi } from '@/api/graphic'
import { sessionApi } from '@/api/session'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import { useCanvasStore } from '@/stores/canvas'
import { generateGraphicObjectKey, type GraphicVO } from '@/types/graphic'
import type {
  CollaborationConflictType,
  MemberVO,
  SessionConflictLogItemVO,
  SessionDetailVO,
  SessionJoinVO,
  SessionOperationItemVO,
  SessionOperationType,
  SessionOperationTimelineVO,
  SessionSnapshotItemVO,
} from '@/types/session'
import { storage } from '@/utils/storage'
import { confirmDanger, feedback } from '@/utils/feedback'
import WebSocketClient from '@/ws/client'
import type {
  ConnectedEventData,
  DisconnectedEventData,
  GraphicCreatedData,
  GraphicDeletedData,
  GraphicUpdatedData,
  MemberJoinedData,
  MemberStatusChangedData,
  OperationResolvedData,
  OperationVO,
  ReconnectFailedEventData,
  ReconnectingEventData,
  SessionJoinedData,
  SessionLeftData,
  WsErrorData,
} from '@/ws/types'

type Point = { x: number; y: number }

interface DraftGraphic {
  active: boolean
  start: Point
  end: Point
  points: Point[]
}

interface DragMove {
  active: boolean
  objectKey: string
  start: Point
  baseX: number
  baseY: number
  basePathPoints: Point[] | null
  originalGraphic: GraphicVO | null
}

type ResizeHandleKey = 'nw' | 'ne' | 'sw' | 'se'

interface ResizeState {
  active: boolean
  objectKey: string
  handle: ResizeHandleKey | null
  originalGraphic: GraphicVO | null
}

interface PanState {
  active: boolean
  start: Point
  originOffset: Point
}

type OperationHistorySource = 'local' | 'remote' | 'system'

interface OperationHistoryItem {
  id: string
  operationType: OperationVO['operationType'] | 'undo' | 'redo'
  objectKey: string
  userId: number | null
  userLabel: string
  source: OperationHistorySource
  detail?: string
  timestamp: number
  timeText: string
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const canvasStore = useCanvasStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasContainerRef = ref<HTMLDivElement | null>(null)

const joining = ref(false)
const joined = ref(false)
const wsConnected = ref(false)
const reconnecting = ref(false)
const reconnectFailed = ref(false)
const reconnectAttempt = ref(0)
const reconnectMaxAttempts = ref(0)
const reconnectDelay = ref(0)
const reconnectTotalCount = ref(0)
const lastSyncText = ref('-')

const sessionInfo = ref<SessionJoinVO | null>(null)
const sessionDetail = ref<SessionDetailVO | null>(null)
const loadingMembers = ref(false)
const memberPanelCollapsed = ref(false)
const includeHistoryMembers = ref(false)
const navigatingAway = ref(false)
const currentUserId = ref<number | null>(authStore.user?.userId ?? null)

const activeTool = ref<CanvasTool>('select')
const strokeColor = ref('#1f2937')
const fillColor = ref('transparent')
const strokeWidth = ref(2)
const zoomPercent = ref(100)
const viewportOffset = ref<Point>({ x: 0, y: 0 })
const panMode = ref(false)
const zoomOptions = [50, 75, 100, 125, 150, 200]
const selectedObjectKey = ref<string | null>(null)
const textEditing = ref(false)
const textEditorValue = ref('')
const textEditorPoint = ref<Point>({ x: 0, y: 0 })
const textEditorInputRef = ref<HTMLInputElement | null>(null)
const textEditingTargetObjectKey = ref<string | null>(null)
const shortcutDialogVisible = ref(false)
const operationHistoryVisible = ref(false)
const conflictHistoryVisible = ref(false)
const versionHistoryVisible = ref(false)
const operationHistory = ref<OperationHistoryItem[]>([])
const operationTimelineLoading = ref(false)
const operationTimeline = ref<SessionOperationTimelineVO | null>(null)
const operationTimelineFilterUserId = ref<number | null>(null)
const operationTimelineFilterOperationType = ref<SessionOperationType | 'all'>('all')
const operationTimelineFilterConflictType = ref<CollaborationConflictType | 'all'>('all')
const operationTimelineFilterFromVersion = ref<number | null>(null)
const operationTimelineFilterToVersion = ref<number | null>(null)
const operationTimelinePage = ref(1)
const operationTimelinePageSize = ref(20)
const conflictLogs = ref<SessionConflictLogItemVO[]>([])
const snapshots = ref<SessionSnapshotItemVO[]>([])
const loadingConflictLogs = ref(false)
const loadingSnapshots = ref(false)
const replayLoading = ref(false)
const replayTargetVersion = ref<number | null>(null)
const conflictSinceId = ref(0)
const operationMetaByObjectKey = ref<Record<string, { operationId: string; startedAt: number }>>({})
const collabClientId = ref('')
const lamportClock = ref(0)
const serverVersionRef = ref(0)
const clientVersionRef = ref(0)
const recentConflictTimestamps = ref<number[]>([])
const conflictFocusMap = ref<Record<string, { fields: string[]; updatedAt: number }>>({})
const focusedObjectKey = ref<string | null>(null)
const textEditorWidth = computed(() => {
  const content = textEditorValue.value || '输入文本，回车确认'
  const estimated = content.length * 14 + 28
  return Math.max(180, Math.min(360, estimated))
})

const draft = ref<DraftGraphic>({
  active: false,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 0 },
  points: [],
})

const dragMove = ref<DragMove>({
  active: false,
  objectKey: '',
  start: { x: 0, y: 0 },
  baseX: 0,
  baseY: 0,
  basePathPoints: null,
  originalGraphic: null,
})

const resizeState = ref<ResizeState>({
  active: false,
  objectKey: '',
  handle: null,
  originalGraphic: null,
})
const panState = ref<PanState>({
  active: false,
  start: { x: 0, y: 0 },
  originOffset: { x: 0, y: 0 },
})

const syncingSelectedStyle = ref(false)

const sessionKey = computed(() => String(route.params.sessionKey || ''))
const zoomScale = computed(() => zoomPercent.value / 100)
const currentVersion = computed(() => sessionDetail.value?.currentVersion ?? sessionInfo.value?.currentVersion ?? 0)
const currentSessionName = computed(() => sessionDetail.value?.name ?? sessionInfo.value?.name ?? '未命名会话')
const sortedGraphics = computed(() => [...canvasStore.graphics].sort((a, b) => a.zIndex - b.zIndex))
const selectedGraphic = computed(() =>
  selectedObjectKey.value ? canvasStore.graphics.find((item) => item.objectKey === selectedObjectKey.value) ?? null : null,
)
const canDeleteSelected = computed(() => !!selectedGraphic.value)
const canvasCursor = computed(() => {
  if (panState.value.active) {
    return 'grabbing'
  }
  if (panMode.value) {
    return 'grab'
  }
  return activeTool.value === 'select' ? 'default' : 'crosshair'
})
const canBringForward = computed(() => {
  const selected = selectedGraphic.value
  if (!selected) {
    return false
  }
  return canvasStore.graphics.some((item) => item.zIndex > selected.zIndex)
})
const canSendBackward = computed(() => {
  const selected = selectedGraphic.value
  if (!selected) {
    return false
  }
  return canvasStore.graphics.some((item) => item.zIndex < selected.zIndex)
})
const canEditFillColor = computed(() => {
  const selected = selectedGraphic.value
  if (!selected) {
    return false
  }
  if (selected.objectType === 'rect' || selected.objectType === 'circle') {
    return true
  }
  if (selected.objectType !== 'path') {
    return false
  }
  return isClosedPath(selected.pathPoints ?? [])
})
const operationHistoryForDisplay = computed(() => {
  return [...operationHistory.value].sort((a, b) => b.timestamp - a.timestamp)
})
const operationTimelineForDisplay = computed(() => operationTimeline.value?.list ?? [])
const operationTimelineTotal = computed(() => operationTimeline.value?.total ?? 0)
const operationTimelineUserOptions = computed(() => {
  const members = sessionDetail.value?.members ?? []
  return members.map((item) => ({
    label: item.username,
    value: item.userId,
  }))
})
const pendingOperationsCount = computed(() => Object.keys(operationMetaByObjectKey.value).length)
const recentConflictCount = computed(() => {
  const cutoff = Date.now() - 5 * 60 * 1000
  return recentConflictTimestamps.value.filter((item) => item >= cutoff).length
})
const activeConflictFocusObjectKey = computed(() => {
  const entries = Object.entries(conflictFocusMap.value)
  if (entries.length === 0) {
    return null
  }
  const sorted = [...entries].sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0))
  const latest = sorted[0]
  return latest?.[0] ?? null
})

watch(
  () => activeConflictFocusObjectKey.value,
  (value) => {
    if (!value) {
      return
    }
    selectedObjectKey.value = value
    scheduleRender()
  },
)
const showReconnectHint = computed(() => reconnecting.value || reconnectFailed.value)
const isCreator = computed(() => {
  if (!sessionDetail.value || !currentUserId.value) {
    return false
  }
  return sessionDetail.value.creatorId === currentUserId.value
})

let wsClient: WebSocketClient | null = null
let heartbeatTimer: number | null = null
let resizeObserver: ResizeObserver | null = null
let renderFrame: number | null = null
let membersRefreshTimer: number | null = null
let membersRefreshRequestId = 0
let focusHighlightTimer: number | null = null

const HEARTBEAT_MS = 20_000
const RESIZE_HANDLE_HIT_SIZE = 8
const RESIZE_MIN_SIZE = 12
const PATH_CLOSE_DISTANCE = 12
const TEXT_MIN_FONT_SIZE = 10
const TEXT_MAX_FONT_SIZE = 120
const ARROW_HEAD_BASE = 10
const ARROW_HEAD_MAX = 24

const getWsUrl = (): string => {
  const baseApi = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
  const origin = baseApi.replace(/\/api\/?$/, '')
  return `${origin.replace(/^http/i, 'ws')}/ws`
}

const loadOrCreateClientId = () => {
  const cacheKey = 'collab_drawing_client_id'
  const existing = localStorage.getItem(cacheKey)
  if (existing && existing.trim().length > 0) {
    collabClientId.value = existing
    return
  }
  const next = `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  localStorage.setItem(cacheKey, next)
  collabClientId.value = next
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const parseString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

const parseNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const nextLamportTime = () => {
  lamportClock.value = Math.max(lamportClock.value + 1, Date.now())
  return lamportClock.value
}

const nextOperationId = (operationType: string, objectKey: string, trackByObject = true) => {
  const opId = `${operationType}_${objectKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  if (trackByObject) {
    operationMetaByObjectKey.value[objectKey] = { operationId: opId, startedAt: Date.now() }
  }
  return opId
}

const ensureCurrentUserId = async (): Promise<number | null> => {
  if (currentUserId.value) {
    return currentUserId.value
  }
  if (authStore.user?.userId) {
    currentUserId.value = authStore.user.userId
    return currentUserId.value
  }
  try {
    const me = await userApi.getMe()
    authStore.setUser(me)
    currentUserId.value = me.userId
    return currentUserId.value
  } catch {
    return null
  }
}

const clearHeartbeat = () => {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

const sendHeartbeat = async () => {
  if (!joined.value || !sessionKey.value) {
    return
  }
  try {
    await sessionApi.heartbeat(sessionKey.value)
  } catch {
    // ignore heartbeat error
  }
}

const startHeartbeat = () => {
  clearHeartbeat()
  void sendHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendHeartbeat()
    }
  }, HEARTBEAT_MS)
}

const scheduleRender = () => {
  if (renderFrame !== null) {
    return
  }
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null
    renderCanvas()
  })
}

const clearRenderFrame = () => {
  if (renderFrame !== null) {
    window.cancelAnimationFrame(renderFrame)
    renderFrame = null
  }
}

const getCtx = (): CanvasRenderingContext2D | null => {
  const canvas = canvasRef.value
  if (!canvas) {
    return null
  }
  return canvas.getContext('2d')
}

const toCanvasPoint = (event: MouseEvent): Point | null => {
  const canvas = canvasRef.value
  if (!canvas) {
    return null
  }
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) / zoomScale.value - viewportOffset.value.x,
    y: (event.clientY - rect.top) / zoomScale.value - viewportOffset.value.y,
  }
}

const normalizeRect = (x: number, y: number, width: number, height: number) => {
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

const getGraphicBounds = (graphic: GraphicVO) => {
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
    const pad = Math.max(6, graphic.strokeWidth + 4)
    return {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
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
    return normalizeRect(graphic.positionX, graphic.positionY, width, height)
  }

  return normalizeRect(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0)
}

const pointToSegmentDistance = (p: Point, start: Point, end: Point): number => {
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

const isClosedPath = (points: Point[]): boolean => {
  if (points.length < 3) {
    return false
  }
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return false
  }
  return Math.hypot(first.x - last.x, first.y - last.y) <= PATH_CLOSE_DISTANCE
}

const normalizePathPointsOnFinish = (points: Point[]): Point[] => {
  if (points.length < 2) {
    return points
  }
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return points
  }
  if (Math.hypot(first.x - last.x, first.y - last.y) > PATH_CLOSE_DISTANCE) {
    return points
  }
  const next = points.slice()
  next[next.length - 1] = { x: first.x, y: first.y }
  return next
}

const buildArrowPathPoints = (start: Point, end: Point, strokeWidthValue: number): Point[] => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 2) {
    return [start, end]
  }

  const ux = dx / length
  const uy = dy / length
  const headLength = Math.min(ARROW_HEAD_MAX, Math.max(ARROW_HEAD_BASE, strokeWidthValue * 3))
  const headAngle = Math.PI / 7
  const cos = Math.cos(headAngle)
  const sin = Math.sin(headAngle)

  // Rotation around reversed direction vector for left/right arrow wing.
  const lx = -ux * cos - -uy * sin
  const ly = -ux * sin + -uy * cos
  const rx = -ux * cos + -uy * sin
  const ry = ux * sin + -uy * cos

  const left: Point = {
    x: end.x + lx * headLength,
    y: end.y + ly * headLength,
  }
  const right: Point = {
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

const pointInGraphic = (point: Point, graphic: GraphicVO): boolean => {
  if (graphic.objectType === 'path') {
    const points = graphic.pathPoints ?? []
    if (points.length < 2) {
      return false
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

  const bounds = getGraphicBounds(graphic)
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

const pickGraphic = (point: Point): GraphicVO | null => {
  const reverse = [...sortedGraphics.value].reverse()
  for (const graphic of reverse) {
    if (pointInGraphic(point, graphic)) {
      return graphic
    }
  }
  return null
}

const drawLine = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
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
  if (graphic.fillColor && graphic.fillColor !== 'transparent') {
    ctx.fillStyle = graphic.fillColor
    ctx.fillRect(graphic.positionX, graphic.positionY, width, height)
  }
  ctx.strokeStyle = graphic.strokeColor
  ctx.lineWidth = graphic.strokeWidth
  ctx.strokeRect(graphic.positionX, graphic.positionY, width, height)
}

const drawCircle = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const radiusX = Math.abs(graphic.width ?? 0) / 2
  const radiusY = Math.abs(graphic.height ?? 0) / 2
  ctx.beginPath()
  ctx.ellipse(graphic.positionX, graphic.positionY, radiusX, radiusY, 0, 0, Math.PI * 2)
  if (graphic.fillColor && graphic.fillColor !== 'transparent') {
    ctx.fillStyle = graphic.fillColor
    ctx.fill()
  }
  ctx.strokeStyle = graphic.strokeColor
  ctx.lineWidth = graphic.strokeWidth
  ctx.stroke()
}

const drawText = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const fontSize = graphic.fontSize ?? 16
  ctx.fillStyle = graphic.strokeColor
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText(graphic.textContent ?? '', graphic.positionX, graphic.positionY)
}

const drawPath = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const points = graphic.pathPoints ?? []
  if (points.length < 2) {
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
  if (isClosedPath(points)) {
    ctx.closePath()
    if (graphic.fillColor && graphic.fillColor !== 'transparent') {
      ctx.fillStyle = graphic.fillColor
      ctx.fill()
    }
  }
  ctx.strokeStyle = graphic.strokeColor
  ctx.lineWidth = graphic.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

const drawGraphic = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  switch (graphic.objectType) {
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

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  viewLeft: number,
  viewTop: number,
  viewRight: number,
  viewBottom: number,
) => {
  const gap = 24
  ctx.save()
  ctx.strokeStyle = '#eef2f7'
  ctx.lineWidth = 1
  const startX = Math.floor(viewLeft / gap) * gap
  const endX = Math.ceil(viewRight / gap) * gap
  const startY = Math.floor(viewTop / gap) * gap
  const endY = Math.ceil(viewBottom / gap) * gap

  for (let x = startX; x <= endX; x += gap) {
    ctx.beginPath()
    ctx.moveTo(x, viewTop)
    ctx.lineTo(x, viewBottom)
    ctx.stroke()
  }
  for (let y = startY; y <= endY; y += gap) {
    ctx.beginPath()
    ctx.moveTo(viewLeft, y)
    ctx.lineTo(viewRight, y)
    ctx.stroke()
  }
  ctx.restore()
}

const drawSelection = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const bounds = getGraphicBounds(graphic)
  const isFocused = focusedObjectKey.value === graphic.objectKey
  const conflictFocus = conflictFocusMap.value[graphic.objectKey]
  const isConflictFocused = !!conflictFocus
  ctx.save()
  ctx.strokeStyle = isConflictFocused ? '#ef4444' : isFocused ? '#f59e0b' : '#1890ff'
  ctx.lineWidth = isConflictFocused ? 3 : isFocused ? 2 : 1
  ctx.setLineDash(isFocused || isConflictFocused ? [] : [4, 4])
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  ctx.setLineDash([])
  const handles: Point[] =
    graphic.objectType === 'text'
      ? [{ x: bounds.x + bounds.width, y: bounds.y + bounds.height }]
      : [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.width / 2, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x, y: bounds.y + bounds.height / 2 },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
          { x: bounds.x, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        ]
  ctx.fillStyle = isConflictFocused ? '#ef4444' : isFocused ? '#f59e0b' : '#1890ff'
  handles.forEach((point) => {
    ctx.fillRect(point.x - 3, point.y - 3, 6, 6)
  })

  if (isConflictFocused && conflictFocus.fields.length > 0) {
    const text = `冲突字段: ${conflictFocus.fields.join(', ')}`
    ctx.font = '12px sans-serif'
    const textWidth = ctx.measureText(text).width
    const padX = 6
    const padY = 4
    const labelX = bounds.x
    const labelY = bounds.y - 20
    ctx.fillStyle = '#fee2e2'
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 1
    ctx.fillRect(labelX, labelY, textWidth + padX * 2, 18)
    ctx.strokeRect(labelX, labelY, textWidth + padX * 2, 18)
    ctx.fillStyle = '#991b1b'
    ctx.fillText(text, labelX + padX, labelY + 13)
  }
  ctx.restore()
}

const getResizeHandlePoints = (graphic: GraphicVO): Record<ResizeHandleKey, Point> => {
  const bounds = getGraphicBounds(graphic)
  return {
    nw: { x: bounds.x, y: bounds.y },
    ne: { x: bounds.x + bounds.width, y: bounds.y },
    sw: { x: bounds.x, y: bounds.y + bounds.height },
    se: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  }
}

const hitResizeHandle = (point: Point, graphic: GraphicVO): ResizeHandleKey | null => {
  if (graphic.objectType !== 'rect' && graphic.objectType !== 'circle' && graphic.objectType !== 'text') {
    return null
  }
  if (graphic.objectType === 'text') {
    const se = getResizeHandlePoints(graphic).se
    if (Math.abs(point.x - se.x) <= RESIZE_HANDLE_HIT_SIZE && Math.abs(point.y - se.y) <= RESIZE_HANDLE_HIT_SIZE) {
      return 'se'
    }
    return null
  }
  const handles = getResizeHandlePoints(graphic)
  for (const key of Object.keys(handles) as ResizeHandleKey[]) {
    const handle = handles[key]
    if (Math.abs(point.x - handle.x) <= RESIZE_HANDLE_HIT_SIZE && Math.abs(point.y - handle.y) <= RESIZE_HANDLE_HIT_SIZE) {
      return key
    }
  }
  return null
}

const normalizeResizeRectFromHandle = (anchor: Point, moving: Point) => {
  const left = Math.min(anchor.x, moving.x)
  const right = Math.max(anchor.x, moving.x)
  const top = Math.min(anchor.y, moving.y)
  const bottom = Math.max(anchor.y, moving.y)
  const width = Math.max(RESIZE_MIN_SIZE, right - left)
  const height = Math.max(RESIZE_MIN_SIZE, bottom - top)
  return {
    x: left,
    y: top,
    width,
    height,
  }
}

const updateGraphicByResize = (graphic: GraphicVO, handle: ResizeHandleKey, moving: Point): GraphicVO => {
  const bounds = getGraphicBounds(graphic)
  const anchor: Point =
    handle === 'nw'
      ? { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
      : handle === 'ne'
        ? { x: bounds.x, y: bounds.y + bounds.height }
        : handle === 'sw'
          ? { x: bounds.x + bounds.width, y: bounds.y }
          : { x: bounds.x, y: bounds.y }

  if (graphic.objectType === 'rect') {
    const rect = normalizeResizeRectFromHandle(anchor, moving)
    return {
      ...graphic,
      positionX: rect.x,
      positionY: rect.y,
      width: rect.width,
      height: rect.height,
    }
  }

  if (graphic.objectType === 'text') {
    const rect = normalizeResizeRectFromHandle(anchor, moving)
    const originalBounds = getGraphicBounds(graphic)
    const baseHeight = Math.max(1, originalBounds.height)
    const ratio = rect.height / baseHeight
    const nextFontSize = Math.max(
      TEXT_MIN_FONT_SIZE,
      Math.min(TEXT_MAX_FONT_SIZE, Math.round((graphic.fontSize ?? 16) * ratio)),
    )
    return {
      ...graphic,
      positionX: rect.x,
      positionY: rect.y,
      width: rect.width,
      height: rect.height,
      fontSize: nextFontSize,
    }
  }

  const rect = normalizeResizeRectFromHandle(anchor, moving)
  return {
    ...graphic,
    positionX: rect.x + rect.width / 2,
    positionY: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height,
  }
}

const updateSelectedGraphicStyle = (patch: Partial<Pick<GraphicVO, 'strokeColor' | 'fillColor' | 'strokeWidth'>>) => {
  const selected = selectedGraphic.value
  if (!selected) {
    return
  }
  const index = canvasStore.graphics.findIndex((item) => item.objectKey === selected.objectKey)
  if (index === -1) {
    return
  }
  const current = canvasStore.graphics[index]
  if (!current) {
    return
  }
  const nextGraphic: GraphicVO = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  canvasStore.graphics[index] = nextGraphic
  sendUpdateGraphicPatch(nextGraphic.objectKey, {
    ...(typeof patch.strokeColor === 'string' ? { strokeColor: patch.strokeColor } : {}),
    ...(typeof patch.fillColor === 'string' ? { fillColor: patch.fillColor } : {}),
    ...(typeof patch.strokeWidth === 'number' ? { strokeWidth: patch.strokeWidth } : {}),
  })
}

const getPreviewGraphic = (): GraphicVO | null => {
  if (!draft.value.active || activeTool.value === 'select' || activeTool.value === 'text') {
    return null
  }

  const start = draft.value.start
  const end = draft.value.end
  const width = end.x - start.x
  const height = end.y - start.y

  if (activeTool.value === 'line') {
    return {
      id: -1,
      sessionId: sessionInfo.value?.sessionId ?? 0,
      objectKey: '__preview__',
      objectType: 'line',
      positionX: start.x,
      positionY: start.y,
      width,
      height,
      strokeColor: strokeColor.value,
      fillColor: null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: null,
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  if (activeTool.value === 'arrow') {
    const points = buildArrowPathPoints(start, end, strokeWidth.value)
    return {
      id: -1,
      sessionId: sessionInfo.value?.sessionId ?? 0,
      objectKey: '__preview__',
      objectType: 'path',
      positionX: start.x,
      positionY: start.y,
      width: null,
      height: null,
      strokeColor: strokeColor.value,
      fillColor: null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: points,
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  if (activeTool.value === 'rect') {
    return {
      id: -1,
      sessionId: sessionInfo.value?.sessionId ?? 0,
      objectKey: '__preview__',
      objectType: 'rect',
      positionX: start.x,
      positionY: start.y,
      width,
      height,
      strokeColor: strokeColor.value,
      fillColor: fillColor.value === 'transparent' ? null : fillColor.value,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: null,
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  if (activeTool.value === 'brush') {
    const points = normalizePathPointsOnFinish(draft.value.points)
    if (points.length < 2) {
      return null
    }
    const first = points[0]
    if (!first) {
      return null
    }
    return {
      id: -1,
      sessionId: sessionInfo.value?.sessionId ?? 0,
      objectKey: '__preview__',
      objectType: 'path',
      positionX: first.x,
      positionY: first.y,
      width: null,
      height: null,
      strokeColor: strokeColor.value,
      fillColor: isClosedPath(points) ? fillColor.value === 'transparent' ? null : fillColor.value : null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: points.map((item) => ({ x: item.x, y: item.y })),
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  const normalized = normalizeRect(start.x, start.y, width, height)
  return {
    id: -1,
    sessionId: sessionInfo.value?.sessionId ?? 0,
    objectKey: '__preview__',
    objectType: 'circle',
    positionX: normalized.x + normalized.width / 2,
    positionY: normalized.y + normalized.height / 2,
    width: normalized.width,
    height: normalized.height,
    strokeColor: strokeColor.value,
    fillColor: fillColor.value === 'transparent' ? null : fillColor.value,
    strokeWidth: strokeWidth.value,
    textContent: null,
    fontSize: null,
    pathPoints: null,
    zIndex: 0,
    version: 0,
    creatorId: currentUserId.value ?? 0,
    createdAt: '',
    updatedAt: '',
  }
}

const drawPreview = (ctx: CanvasRenderingContext2D) => {
  const preview = getPreviewGraphic()
  if (!preview) {
    return
  }
  ctx.save()
  ctx.setLineDash([5, 5])
  drawGraphic(ctx, preview)
  ctx.restore()
}

const renderCanvas = () => {
  const canvas = canvasRef.value
  const ctx = getCtx()
  if (!canvas || !ctx) {
    return
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(zoomScale.value, zoomScale.value)
  ctx.translate(viewportOffset.value.x, viewportOffset.value.y)

  const worldWidth = canvas.width / zoomScale.value
  const worldHeight = canvas.height / zoomScale.value
  const viewLeft = -viewportOffset.value.x
  const viewTop = -viewportOffset.value.y
  const viewRight = viewLeft + worldWidth
  const viewBottom = viewTop + worldHeight

  drawGrid(ctx, viewLeft, viewTop, viewRight, viewBottom)
  sortedGraphics.value.forEach((graphic) => drawGraphic(ctx, graphic))
  drawPreview(ctx)

  if (selectedGraphic.value) {
    drawSelection(ctx, selectedGraphic.value)
  }

  ctx.restore()
}

const resizeCanvas = () => {
  const canvas = canvasRef.value
  const container = canvasContainerRef.value
  if (!canvas || !container) {
    return
  }
  const width = Math.max(1, Math.floor(container.clientWidth))
  const height = Math.max(1, Math.floor(container.clientHeight))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  scheduleRender()
}

const setupResizeObserver = () => {
  if (!canvasContainerRef.value) {
    return
  }
  resizeObserver = new ResizeObserver(() => {
    resizeCanvas()
  })
  resizeObserver.observe(canvasContainerRef.value)
}

const teardownResizeObserver = () => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
}

const upsertGraphic = (graphic: GraphicVO) => {
  const index = canvasStore.graphics.findIndex((item) => item.objectKey === graphic.objectKey)
  if (index === -1) {
    canvasStore.graphics.push(graphic)
  } else {
    canvasStore.graphics[index] = graphic
  }
  scheduleRender()
}

const patchGraphic = (patch: { objectKey: string } & Partial<GraphicVO>) => {
  const index = canvasStore.graphics.findIndex((item) => item.objectKey === patch.objectKey)
  if (index === -1) {
    return
  }
  const current = canvasStore.graphics[index]
  if (!current) {
    return
  }
  canvasStore.graphics[index] = {
    ...current,
    ...patch,
    objectKey: current.objectKey,
  }
  scheduleRender()
}

const removeGraphic = (objectKey: string) => {
  const index = canvasStore.graphics.findIndex((item) => item.objectKey === objectKey)
  if (index === -1) {
    return
  }
  canvasStore.graphics.splice(index, 1)
  if (selectedObjectKey.value === objectKey) {
    selectedObjectKey.value = null
  }
  scheduleRender()
}

const mergeGraphicsByObjectKey = (incoming: GraphicVO[]) => {
  if (incoming.length === 0) {
    return
  }
  const map = new Map(canvasStore.graphics.map((item) => [item.objectKey, item]))
  incoming.forEach((item) => {
    map.set(item.objectKey, item)
  })
  canvasStore.graphics = Array.from(map.values())
}

const toOperationGraphicType = (value: unknown): GraphicVO['objectType'] => {
  const normalized = parseString(value, 'line')
  if (normalized === 'line' || normalized === 'rect' || normalized === 'circle' || normalized === 'text' || normalized === 'path') {
    return normalized
  }
  return 'line'
}

const toOperationPathPoints = (value: unknown): Array<{ x: number; y: number }> | null => {
  if (!Array.isArray(value)) {
    return null
  }
  const points = value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({ x: parseNumber(item.x), y: parseNumber(item.y) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
  return points.length > 0 ? points : null
}

const toGraphicFromUnknown = (value: unknown, fallbackObjectKey?: string): GraphicVO | null => {
  if (!isRecord(value)) {
    return null
  }
  const objectKey = parseString(value.objectKey, fallbackObjectKey ?? '')
  if (!objectKey) {
    return null
  }
  return {
    id: parseNumber(value.id),
    sessionId: parseNumber(value.sessionId, sessionInfo.value?.sessionId ?? 0),
    objectKey,
    objectType: toOperationGraphicType(value.objectType),
    positionX: parseNumber(value.positionX),
    positionY: parseNumber(value.positionY),
    width: typeof value.width === 'number' ? value.width : null,
    height: typeof value.height === 'number' ? value.height : null,
    strokeColor: parseString(value.strokeColor, '#000000'),
    fillColor: typeof value.fillColor === 'string' ? value.fillColor : null,
    strokeWidth: parseNumber(value.strokeWidth, 1),
    textContent: typeof value.textContent === 'string' ? value.textContent : null,
    fontSize: typeof value.fontSize === 'number' ? value.fontSize : null,
    pathPoints: toOperationPathPoints(value.pathPoints),
    zIndex: parseNumber(value.zIndex),
    version: parseNumber(value.version),
    creatorId: parseNumber(value.creatorId),
    createdAt: parseString(value.createdAt, new Date().toISOString()),
    updatedAt: parseString(value.updatedAt, new Date().toISOString()),
  }
}

const updateSessionVersion = (version: number) => {
  serverVersionRef.value = version
  if (sessionInfo.value) {
    sessionInfo.value.currentVersion = version
  }
  if (sessionDetail.value) {
    sessionDetail.value.currentVersion = version
  }
}

const syncGraphicsFromServer = async (forceFull = false) => {
  if (!sessionKey.value) {
    return
  }
  try {
    const sinceVersion = forceFull ? undefined : currentVersion.value
    const result = await graphicApi.getGraphics(sessionKey.value, sinceVersion)
    if (forceFull || typeof sinceVersion !== 'number' || sinceVersion <= 0) {
      canvasStore.graphics = [...result.graphics]
    } else {
      mergeGraphicsByObjectKey(result.graphics)
    }
    updateSessionVersion(result.currentVersion)
    clientVersionRef.value = result.currentVersion
    scheduleRender()
  } catch (error: any) {
    feedback.errorFrom(error, '同步画布失败')
  }
}

const applyMemberList = (members: MemberVO[]) => {
  if (!sessionDetail.value) {
    return
  }
  sessionDetail.value.members = members
  sessionDetail.value.memberCount = members.length
  sessionDetail.value.onlineMemberCount = members.filter((item) => item.onlineStatus === 1).length
}

const patchMemberOnlineStatus = (payload: MemberJoinedData, onlineStatus: number) => {
  if (!sessionDetail.value || payload.sessionKey !== sessionKey.value) {
    return
  }
  if (payload.members.length > 0) {
    applyMemberList(payload.members)
    return
  }
  const members = [...(sessionDetail.value.members ?? [])]
  const index = members.findIndex((item) => item.userId === payload.userId)
  if (index === -1) {
    scheduleMembersRefresh(200)
    return
  }
  const prev = members[index]
  if (!prev) {
    return
  }
  members[index] = {
    ...prev,
    username: payload.username || prev.username,
    onlineStatus,
  }
  applyMemberList(members)
}

const handleSessionJoined = (payload: SessionJoinedData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  sessionInfo.value = {
    sessionId: payload.sessionId,
    sessionKey: payload.sessionKey,
    name: payload.name,
    currentVersion: payload.currentVersion,
    graphics: payload.graphics,
  }
  if (sessionDetail.value) {
    sessionDetail.value = {
      ...sessionDetail.value,
      sessionId: payload.sessionId,
      sessionKey: payload.sessionKey,
      name: payload.name,
      currentVersion: payload.currentVersion,
      members: payload.members,
      memberCount: payload.members.length,
      onlineMemberCount: payload.members.filter((item) => item.onlineStatus === 1).length,
    }
  }
  canvasStore.graphics = [...payload.graphics]
  clientVersionRef.value = payload.currentVersion
  scheduleRender()
}

const handleSessionLeft = async (payload: SessionLeftData) => {
  if (payload.sessionKey !== sessionKey.value || navigatingAway.value) {
    return
  }
  navigatingAway.value = true
  feedback.info('你已离开当前会话')
  if (wsClient) {
    wsClient.disconnect()
  }
  clearHeartbeat()
  await router.push('/')
}

const handleGraphicCreated = (payload: GraphicCreatedData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  upsertGraphic(payload.graphic)
  pushOperationHistory({
    operationType: 'create_graphic',
    objectKey: payload.graphic.objectKey,
    userId: payload.userId,
    source: payload.userId === currentUserId.value ? 'local' : 'remote',
  })
  updateSessionVersion(payload.currentVersion)
  clientVersionRef.value = Math.max(clientVersionRef.value, payload.currentVersion)
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

const handleGraphicUpdated = (payload: GraphicUpdatedData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  patchGraphic(payload.graphic)
  pushOperationHistory({
    operationType: 'update_graphic',
    objectKey: payload.graphic.objectKey,
    userId: payload.userId,
    source: payload.userId === currentUserId.value ? 'local' : 'remote',
  })
  updateSessionVersion(payload.currentVersion)
  clientVersionRef.value = Math.max(clientVersionRef.value, payload.currentVersion)
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

const handleGraphicDeleted = (payload: GraphicDeletedData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  removeGraphic(payload.objectKey)
  pushOperationHistory({
    operationType: 'delete_graphic',
    objectKey: payload.objectKey,
    userId: payload.userId,
    source: payload.userId === currentUserId.value ? 'local' : 'remote',
  })
  updateSessionVersion(payload.currentVersion)
  clientVersionRef.value = Math.max(clientVersionRef.value, payload.currentVersion)
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

const handleMemberStatusChanged = (payload: MemberStatusChangedData) => {
  if (!sessionDetail.value || payload.sessionKey !== sessionKey.value) {
    return
  }
  if (payload.members.length > 0) {
    applyMemberList(payload.members)
    return
  }
  const members = [...(sessionDetail.value.members ?? [])]
  const index = members.findIndex((item) => item.userId === payload.userId)
  if (index === -1) {
    return
  }
  const prev = members[index]
  if (!prev) {
    return
  }
  members[index] = {
    ...prev,
    username: payload.username || prev.username,
    onlineStatus: payload.onlineStatus,
  }
  applyMemberList(members)
}

const handleWsConnected = (payload: ConnectedEventData) => {
  wsConnected.value = true
  reconnecting.value = false
  reconnectFailed.value = false
  reconnectAttempt.value = 0
  reconnectMaxAttempts.value = 0
  reconnectDelay.value = 0
  if (payload.reconnectAttempt > 0) {
    reconnectTotalCount.value += 1
    void (async () => {
      const replayed = await syncOperationsFromServer()
      if (!replayed) {
        await syncGraphicsFromServer(true)
      }
    })()
  }
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

const handleWsDisconnected = (_payload: DisconnectedEventData) => {
  wsConnected.value = false
}

const handleWsReconnecting = (payload: ReconnectingEventData) => {
  reconnecting.value = true
  reconnectFailed.value = false
  reconnectAttempt.value = payload.attempt
  reconnectMaxAttempts.value = payload.maxAttempts
  reconnectDelay.value = payload.delay
}

const handleWsReconnectFailed = (payload: ReconnectFailedEventData) => {
  reconnecting.value = false
  reconnectFailed.value = true
  reconnectAttempt.value = payload.attempts
  reconnectMaxAttempts.value = payload.maxAttempts
}

const handleWsError = (payload: WsErrorData) => {
  if (payload.code >= 3000 || payload.code === 2001 || payload.code === 2002) {
    feedback.error(payload.message || 'WebSocket 出错')
  }
}

const handleWsMemberJoined = (payload: MemberJoinedData) => {
  patchMemberOnlineStatus(payload, 1)
}

const handleWsMemberLeft = (payload: MemberJoinedData) => {
  patchMemberOnlineStatus(payload, 0)
}

const handleWsUndoResult = (data: import('@/ws/types').UndoResultData) => {
  canvasStore.handleUndoResult(data)
  if (data.success !== false) {
    pushOperationHistory({
      operationType: 'undo',
      objectKey: data.operation?.objectKey ?? '',
      userId: data.operation?.userId ?? null,
      source: 'remote',
    })
  }
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  scheduleRender()
}

const handleWsRedoResult = (data: import('@/ws/types').RedoResultData) => {
  canvasStore.handleRedoResult(data)
  if (data.success !== false) {
    pushOperationHistory({
      operationType: 'redo',
      objectKey: data.operation?.objectKey ?? '',
      userId: data.operation?.userId ?? null,
      source: 'remote',
    })
  }
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  scheduleRender()
}

const handleWsOperationResolved = (data: OperationResolvedData) => {
  if (!data.operationId) {
    return
  }
  updateSessionVersion(data.serverVersion)
  clientVersionRef.value = Math.max(clientVersionRef.value, data.serverVersion)
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  const localOperation = data.objectKey ? operationMetaByObjectKey.value[data.objectKey] : undefined
  if (data.objectKey && localOperation && localOperation.operationId === data.operationId) {
    delete operationMetaByObjectKey.value[data.objectKey]
  }

  if (data.conflictType === 'none' && data.rejectedFields.length === 0) {
    return
  }

  recentConflictTimestamps.value = [...recentConflictTimestamps.value, Date.now()].slice(-200)
  if (data.objectKey) {
    conflictFocusMap.value[data.objectKey] = {
      fields: [...data.rejectedFields, ...data.appliedFields].filter((value, index, source) => source.indexOf(value) === index),
      updatedAt: Date.now(),
    }
    selectedObjectKey.value = data.objectKey
    focusedObjectKey.value = data.objectKey
    if (focusHighlightTimer !== null) {
      window.clearTimeout(focusHighlightTimer)
    }
    focusHighlightTimer = window.setTimeout(() => {
      if (data.objectKey) {
        delete conflictFocusMap.value[data.objectKey]
      }
      focusedObjectKey.value = null
      focusHighlightTimer = null
      scheduleRender()
    }, 2800)
  }

  const rejected = data.rejectedFields.length > 0 ? `，拒绝字段: ${data.rejectedFields.join(', ')}` : ''
  const applied = data.appliedFields.length > 0 ? `，采用字段: ${data.appliedFields.join(', ')}` : ''
  const resolveReason = data.resolveReason ? `，策略: ${data.resolveReason}` : ''
  const detail = `冲突类型: ${data.conflictType}${applied}${rejected}${resolveReason}`
  pushOperationHistory({
    operationType: data.operationType,
    objectKey: data.objectKey,
    userId: currentUserId.value,
    source: 'system',
    detail,
  })
  feedback.info(
    `协同冲突已自动解决：${data.conflictType}${rejected ? `（拒绝: ${data.rejectedFields.join(', ')}）` : ''}`,
  )
  scheduleRender()
}

const applyOperationReplayItem = (operation: SessionOperationItemVO) => {
  if (operation.operationType === 'delete') {
    removeGraphic(operation.objectKey)
    return
  }

  const resolved = isRecord(operation.resolvedResult) ? operation.resolvedResult : null
  const resolvedGraphic = toGraphicFromUnknown(resolved?.graphic, operation.objectKey)
  if (resolvedGraphic) {
    upsertGraphic(resolvedGraphic)
    return
  }

  const patchSource = isRecord(operation.operationData) ? operation.operationData : {}
  if (operation.operationType === 'create') {
    const createdGraphic = toGraphicFromUnknown(patchSource, operation.objectKey)
    if (createdGraphic) {
      upsertGraphic(createdGraphic)
    }
    return
  }

  patchGraphic({
    objectKey: operation.objectKey,
    positionX: typeof patchSource.positionX === 'number' ? patchSource.positionX : undefined,
    positionY: typeof patchSource.positionY === 'number' ? patchSource.positionY : undefined,
    width: typeof patchSource.width === 'number' ? patchSource.width : undefined,
    height: typeof patchSource.height === 'number' ? patchSource.height : undefined,
    strokeColor: typeof patchSource.strokeColor === 'string' ? patchSource.strokeColor : undefined,
    fillColor: typeof patchSource.fillColor === 'string' ? patchSource.fillColor : undefined,
    strokeWidth: typeof patchSource.strokeWidth === 'number' ? patchSource.strokeWidth : undefined,
    textContent: typeof patchSource.textContent === 'string' ? patchSource.textContent : undefined,
    fontSize: typeof patchSource.fontSize === 'number' ? patchSource.fontSize : undefined,
    pathPoints: toOperationPathPoints(patchSource.pathPoints) ?? undefined,
    zIndex: typeof patchSource.zIndex === 'number' ? patchSource.zIndex : undefined,
    version: operation.serverVersion,
  })
}

const syncOperationsFromServer = async (): Promise<boolean> => {
  if (!sessionKey.value) {
    return false
  }
  try {
    const result = await sessionApi.getOperations(sessionKey.value, currentVersion.value)
    if (result.operations.length > 0) {
      result.operations.forEach((operation) => {
        applyOperationReplayItem(operation)
      })
      const conflictCount = result.operations.filter((operation) => operation.conflictType !== 'none').length
      pushOperationHistory({
        operationType: 'update_graphic',
        objectKey: '',
        userId: null,
        source: 'system',
        detail: `增量回放 ${result.operations.length} 条操作${conflictCount > 0 ? `，冲突 ${conflictCount} 条` : ''}`,
      })
    }
    updateSessionVersion(result.currentVersion)
    clientVersionRef.value = result.currentVersion
    scheduleRender()
    return true
  } catch {
    return false
  }
}

const bindWs = (client: WebSocketClient) => {
  client.on('connected', handleWsConnected)
  client.on('disconnected', handleWsDisconnected)
  client.on('reconnecting', handleWsReconnecting)
  client.on('reconnect_failed', handleWsReconnectFailed)
  client.on('error', handleWsError)
  client.on('session_joined', handleSessionJoined)
  client.on('session_left', handleSessionLeft)
  client.on('member_joined', handleWsMemberJoined)
  client.on('member_left', handleWsMemberLeft)
  client.on('member_status_changed', handleMemberStatusChanged)
  client.on('graphic_created', handleGraphicCreated)
  client.on('graphic_updated', handleGraphicUpdated)
  client.on('graphic_deleted', handleGraphicDeleted)
  client.on('operation_resolved', handleWsOperationResolved)
  client.on('undo_result', handleWsUndoResult)
  client.on('redo_result', handleWsRedoResult)
}

const unbindWs = (client: WebSocketClient) => {
  client.off('connected', handleWsConnected)
  client.off('disconnected', handleWsDisconnected)
  client.off('reconnecting', handleWsReconnecting)
  client.off('reconnect_failed', handleWsReconnectFailed)
  client.off('error', handleWsError)
  client.off('session_joined', handleSessionJoined)
  client.off('session_left', handleSessionLeft)
  client.off('member_joined', handleWsMemberJoined)
  client.off('member_left', handleWsMemberLeft)
  client.off('member_status_changed', handleMemberStatusChanged)
  client.off('graphic_created', handleGraphicCreated)
  client.off('graphic_updated', handleGraphicUpdated)
  client.off('graphic_deleted', handleGraphicDeleted)
  client.off('operation_resolved', handleWsOperationResolved)
  client.off('undo_result', handleWsUndoResult)
  client.off('redo_result', handleWsRedoResult)
}

const refreshSessionMembers = async () => {
  if (!sessionKey.value || !sessionDetail.value) {
    return
  }
  const requestId = ++membersRefreshRequestId
  loadingMembers.value = true
  try {
    const detail = await sessionApi.getDetail(sessionKey.value, includeHistoryMembers.value)
    if (requestId !== membersRefreshRequestId) {
      return
    }
    sessionDetail.value = {
      ...sessionDetail.value,
      ...detail,
      members: detail.members,
      memberCount: detail.members.length,
      onlineMemberCount: detail.members.filter((item) => item.onlineStatus === 1).length,
    }
  } catch (error: any) {
    feedback.errorFrom(error, '刷新成员列表失败')
  } finally {
    loadingMembers.value = false
  }
}

const scheduleMembersRefresh = (delay = 250) => {
  if (membersRefreshTimer !== null) {
    window.clearTimeout(membersRefreshTimer)
  }
  membersRefreshTimer = window.setTimeout(() => {
    membersRefreshTimer = null
    void refreshSessionMembers()
  }, delay)
}

const joinSession = async () => {
  if (!sessionKey.value || joining.value || joined.value) {
    return
  }
  joining.value = true
  try {
    await ensureCurrentUserId()
    const joinedData = await sessionApi.join(sessionKey.value)
    sessionInfo.value = joinedData
    sessionDetail.value = await sessionApi.getDetail(sessionKey.value, includeHistoryMembers.value)
    joined.value = true

    const token = storage.getToken()
    if (!token) {
      throw new Error('未登录')
    }
    const client = new WebSocketClient(getWsUrl(), token, sessionKey.value)
    bindWs(client)
    wsClient = client
    canvasStore.bindSession(joinedData, client)
    client.connect()

    startHeartbeat()
    await router.replace(`/session/${sessionKey.value}`)
  } catch (error) {
    feedback.errorFrom(error, '加入会话失败')
    await router.replace('/')
  } finally {
    joining.value = false
  }
}

const handleLeaveSession = async () => {
  if (!sessionKey.value) {
    return
  }
  try {
    const confirmed = await confirmDanger('确认退出当前会话吗？', '退出会话', { confirmButtonText: '确认退出' })
    if (!confirmed) {
      return
    }
    navigatingAway.value = true
    await sessionApi.leave(sessionKey.value)
    feedback.success('已退出会话')
    await router.push('/')
  } catch (error) {
    feedback.errorFrom(error, '退出会话失败')
  }
}

const handleDeleteSession = async () => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  try {
    const confirmed = await confirmDanger('确认删除当前会话吗？删除后不可恢复。', '删除会话', {
      confirmButtonText: '确认删除',
    })
    if (!confirmed) {
      return
    }
    navigatingAway.value = true
    await sessionApi.deleteSession(sessionKey.value)
    feedback.success('会话已删除')
    await router.push('/my-sessions')
  } catch (error) {
    feedback.errorFrom(error, '删除会话失败')
  }
}

const handleTransferCreator = (member: MemberVO) => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  const status = member.membershipStatus ?? 'active'
  if (status !== 'active') {
    feedback.warning('只能转交给当前成员')
    return
  }
  confirmDanger(`确认将创建者身份转交给“${member.username}”吗？转交后你将变为普通成员。`, '转交创建者确认', {
    confirmButtonText: '确认转交',
  })
    .then(async (confirmed) => {
      if (!confirmed) {
        return
      }
      await sessionApi.transferCreator(sessionKey.value, member.userId)
      feedback.success('创建者身份已转交')
      await refreshSessionMembers()
    })
    .catch((error) => {
      feedback.errorFrom(error, '转交创建者失败')
    })
}

const handleRemoveMember = (member: MemberVO) => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  confirmDanger(`确认移除成员“${member.username}”吗？`, '移除成员', { confirmButtonText: '确认移除' })
    .then(async (confirmed) => {
      if (!confirmed) {
        return
      }
      await sessionApi.removeMember(sessionKey.value, member.userId)
      feedback.success('成员已移除')
      await refreshSessionMembers()
    })
    .catch((error) => {
      feedback.errorFrom(error, '移除成员失败')
    })
}

const handleShare = async () => {
  const link = `${window.location.origin}/session/${sessionKey.value}`
  try {
    await navigator.clipboard.writeText(link)
    feedback.success('会话链接已复制')
  } catch {
    feedback.error('复制失败，请手动复制地址栏链接')
  }
}

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

const handleExportImage = async () => {
  const canvas = canvasRef.value
  if (!canvas) {
    feedback.error('画布尚未就绪，暂时无法导出')
    return
  }

  try {
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const exportCtx = exportCanvas.getContext('2d')
    if (!exportCtx) {
      feedback.error('导出失败：无法初始化导出画布')
      return
    }

    exportCtx.fillStyle = '#ffffff'
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    exportCtx.drawImage(canvas, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      exportCanvas.toBlob((file) => resolve(file), 'image/png', 1)
    })
    if (!blob) {
      feedback.error('导出失败：图片编码失败')
      return
    }

    const sessionName = sanitizeFilename(currentSessionName.value)
    const filename = `${sessionName}_${formatNowForFilename()}.png`
    downloadBlob(blob, filename)
    feedback.success('已导出 PNG 图片')
  } catch (error) {
    feedback.errorFrom(error, '导出失败')
  }
}

const handleShowShortcuts = () => {
  shortcutDialogVisible.value = true
}

const handleShowOperationHistory = () => {
  void handleOpenOperationTimeline()
}

const loadOperationTimeline = async () => {
  if (!sessionKey.value || operationTimelineLoading.value) {
    return
  }
  operationTimelineLoading.value = true
  try {
    operationTimeline.value = await sessionApi.getOperationTimeline(sessionKey.value, {
      ...(typeof operationTimelineFilterFromVersion.value === 'number'
        ? { fromVersion: operationTimelineFilterFromVersion.value }
        : {}),
      ...(typeof operationTimelineFilterToVersion.value === 'number'
        ? { toVersion: operationTimelineFilterToVersion.value }
        : {}),
      ...(typeof operationTimelineFilterUserId.value === 'number' ? { userId: operationTimelineFilterUserId.value } : {}),
      ...(operationTimelineFilterOperationType.value !== 'all'
        ? { operationType: operationTimelineFilterOperationType.value }
        : {}),
      ...(operationTimelineFilterConflictType.value !== 'all'
        ? { conflictType: operationTimelineFilterConflictType.value }
        : {}),
      page: operationTimelinePage.value,
      pageSize: operationTimelinePageSize.value,
    })
  } catch (error) {
    feedback.errorFrom(error, '加载操作时间线失败')
  } finally {
    operationTimelineLoading.value = false
  }
}

const handleOpenOperationTimeline = async () => {
  operationHistoryVisible.value = true
  operationTimelinePage.value = 1
  await loadOperationTimeline()
}

const handleResetOperationTimelineFilters = async () => {
  operationTimelineFilterUserId.value = null
  operationTimelineFilterOperationType.value = 'all'
  operationTimelineFilterConflictType.value = 'all'
  operationTimelineFilterFromVersion.value = null
  operationTimelineFilterToVersion.value = null
  operationTimelinePage.value = 1
  await loadOperationTimeline()
}

const handleOperationTimelineSearch = async () => {
  operationTimelinePage.value = 1
  await loadOperationTimeline()
}

const handleOperationTimelinePageChange = async (page: number) => {
  operationTimelinePage.value = page
  await loadOperationTimeline()
}

const handleShowConflictHistory = async () => {
  conflictHistoryVisible.value = true
  await refreshConflictLogs(true)
}

const handleShowVersionHistory = async () => {
  versionHistoryVisible.value = true
  await refreshSnapshots()
}

const handleBackToList = async () => {
  navigatingAway.value = true
  await router.push('/')
}

const handleUpdateSessionName = (name: string) => {
  if (sessionInfo.value) {
    sessionInfo.value.name = name
  }
  if (sessionDetail.value) {
    sessionDetail.value.name = name
  }
}

const toggleMemberPanel = () => {
  memberPanelCollapsed.value = !memberPanelCollapsed.value
}

const updateHistoryToggle = async (value: boolean) => {
  includeHistoryMembers.value = value
  await refreshSessionMembers()
}

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    startHeartbeat()
    return
  }
  clearHeartbeat()
}

const isInputTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }
  const tag = element.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || element.isContentEditable
}

const findMemberNameByUserId = (userId: number | null): string | null => {
  if (!userId) {
    return null
  }
  const member = sessionDetail.value?.members?.find((item) => item.userId === userId)
  if (member?.username) {
    return member.username
  }
  if (currentUserId.value === userId) {
    return authStore.user?.username ?? '我'
  }
  return null
}

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
  return canvasStore.graphics.some((item) => item.objectKey === objectKey)
}

const locateHistoryObject = (item: OperationHistoryItem) => {
  if (!item.objectKey) {
    feedback.warning('该记录没有关联图元对象')
    return
  }
  const target = canvasStore.graphics.find((graphic) => graphic.objectKey === item.objectKey)
  if (!target) {
    feedback.warning('该图元已不存在，无法定位')
    return
  }

  const canvas = canvasRef.value
  if (canvas) {
    const bounds = getGraphicBounds(target)
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    viewportOffset.value = {
      x: canvas.width / (2 * zoomScale.value) - centerX,
      y: canvas.height / (2 * zoomScale.value) - centerY,
    }
  }

  selectedObjectKey.value = target.objectKey
  focusedObjectKey.value = target.objectKey
  if (focusHighlightTimer !== null) {
    window.clearTimeout(focusHighlightTimer)
  }
  focusHighlightTimer = window.setTimeout(() => {
    focusedObjectKey.value = null
    focusHighlightTimer = null
    scheduleRender()
  }, 1200)
  scheduleRender()
}

const pushOperationHistory = (payload: {
  operationType: OperationHistoryItem['operationType']
  objectKey: string
  userId: number | null
  source: OperationHistorySource
  detail?: string
}) => {
  const now = Date.now()
  const userName = findMemberNameByUserId(payload.userId)
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

const formatSessionOperationTypeLabel = (operationType: SessionOperationType) => {
  if (operationType === 'create') {
    return '创建图元'
  }
  if (operationType === 'update') {
    return '更新图元'
  }
  return '删除图元'
}

const formatConflictTypeLabel = (conflictType: CollaborationConflictType) => {
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

const formatConflictValue = (value: unknown): string => {
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

const refreshConflictLogs = async (forceFromStart = false) => {
  if (!sessionKey.value) {
    return
  }
  if (loadingConflictLogs.value) {
    return
  }
  loadingConflictLogs.value = true
  try {
    const sinceId = forceFromStart ? 0 : conflictSinceId.value
    const result = await sessionApi.getConflictLogs(sessionKey.value, sinceId, 100)
    if (forceFromStart) {
      conflictLogs.value = result.conflicts
    } else {
      conflictLogs.value = [...conflictLogs.value, ...result.conflicts]
    }
    const maxId = result.conflicts.reduce((max, item) => Math.max(max, item.id), forceFromStart ? 0 : conflictSinceId.value)
    conflictSinceId.value = maxId
  } catch (error) {
    feedback.errorFrom(error, '加载冲突日志失败')
  } finally {
    loadingConflictLogs.value = false
  }
}

const refreshSnapshots = async () => {
  if (!sessionKey.value || loadingSnapshots.value) {
    return
  }
  loadingSnapshots.value = true
  try {
    const result = await sessionApi.getSnapshots(sessionKey.value, 20)
    snapshots.value = result.snapshots
  } catch (error) {
    feedback.errorFrom(error, '加载版本快照失败')
  } finally {
    loadingSnapshots.value = false
  }
}

const createSnapshotNow = async () => {
  if (!sessionKey.value || loadingSnapshots.value) {
    return
  }
  loadingSnapshots.value = true
  try {
    await sessionApi.createSnapshot(sessionKey.value)
    feedback.success('已创建版本快照')
    await refreshSnapshots()
  } catch (error) {
    feedback.errorFrom(error, '创建快照失败')
  } finally {
    loadingSnapshots.value = false
  }
}

const restoreToVersion = async (targetVersion: number) => {
  if (!sessionKey.value || replayLoading.value) {
    return
  }
  replayLoading.value = true
  replayTargetVersion.value = targetVersion
  try {
    const result = await sessionApi.restoreVersion(sessionKey.value, targetVersion)
    await syncGraphicsFromServer(true)
    await refreshSnapshots()
    updateSessionVersion(result.restoredVersion)
    feedback.success(
      `已恢复到版本 ${targetVersion}，当前版本 ${result.restoredVersion}（创建 ${result.createdCount}，更新 ${result.updatedCount}，删除 ${result.deletedCount}）`,
    )
  } catch (error) {
    feedback.errorFrom(error, '版本恢复失败')
  } finally {
    replayLoading.value = false
    replayTargetVersion.value = null
  }
}

const convertUnknownGraphicToGraphicVO = (source: Record<string, unknown>): GraphicVO | null => {
  const objectKey = parseString(source.objectKey)
  if (!objectKey) {
    return null
  }
  const objectTypeRaw = parseString(source.objectType, 'line')
  const objectType =
    objectTypeRaw === 'line' || objectTypeRaw === 'rect' || objectTypeRaw === 'circle' || objectTypeRaw === 'text' || objectTypeRaw === 'path'
      ? objectTypeRaw
      : 'line'
  const pathPoints = toOperationPathPoints(source.pathPoints)
  return {
    id: parseNumber(source.id),
    sessionId: parseNumber(source.sessionId, sessionInfo.value?.sessionId ?? 0),
    objectKey,
    objectType,
    positionX: parseNumber(source.positionX),
    positionY: parseNumber(source.positionY),
    width: typeof source.width === 'number' ? source.width : null,
    height: typeof source.height === 'number' ? source.height : null,
    strokeColor: parseString(source.strokeColor, '#000000'),
    fillColor: typeof source.fillColor === 'string' ? source.fillColor : null,
    strokeWidth: parseNumber(source.strokeWidth, 1),
    textContent: typeof source.textContent === 'string' ? source.textContent : null,
    fontSize: typeof source.fontSize === 'number' ? source.fontSize : null,
    pathPoints,
    zIndex: parseNumber(source.zIndex),
    version: parseNumber(source.version),
    creatorId: parseNumber(source.creatorId),
    createdAt: parseString(source.createdAt, new Date().toISOString()),
    updatedAt: parseString(source.updatedAt, new Date().toISOString()),
  }
}

const applyReplayToCanvas = async (targetVersion: number) => {
  if (!sessionKey.value || replayLoading.value) {
    return
  }
  replayLoading.value = true
  replayTargetVersion.value = targetVersion
  try {
    const replay = await sessionApi.getReplay(sessionKey.value, targetVersion)
    const replayMap = new Map<string, GraphicVO>()
    const baseGraphics = replay.baseSnapshotData?.graphics ?? []
    baseGraphics.forEach((item) => {
      if (isRecord(item)) {
        const next = convertUnknownGraphicToGraphicVO(item)
        if (next) {
          replayMap.set(next.objectKey, next)
        }
      }
    })

    replay.operations.forEach((op) => {
      if (op.operationType === 'delete') {
        replayMap.delete(op.objectKey)
        return
      }
      const resolvedGraphic = isRecord(op.resolvedResult?.graphic) ? convertUnknownGraphicToGraphicVO(op.resolvedResult.graphic) : null
      if (resolvedGraphic) {
        replayMap.set(resolvedGraphic.objectKey, resolvedGraphic)
        return
      }
      const current = replayMap.get(op.objectKey)
      if (!current) {
        return
      }
      const patch = isRecord(op.operationData) ? op.operationData : {}
      const updated: GraphicVO = {
        ...current,
        positionX: typeof patch.positionX === 'number' ? patch.positionX : current.positionX,
        positionY: typeof patch.positionY === 'number' ? patch.positionY : current.positionY,
        width: typeof patch.width === 'number' ? patch.width : current.width,
        height: typeof patch.height === 'number' ? patch.height : current.height,
        strokeColor: typeof patch.strokeColor === 'string' ? patch.strokeColor : current.strokeColor,
        fillColor: typeof patch.fillColor === 'string' ? patch.fillColor : current.fillColor,
        strokeWidth: typeof patch.strokeWidth === 'number' ? patch.strokeWidth : current.strokeWidth,
        textContent: typeof patch.textContent === 'string' ? patch.textContent : current.textContent,
        fontSize: typeof patch.fontSize === 'number' ? patch.fontSize : current.fontSize,
        pathPoints: toOperationPathPoints(patch.pathPoints) ?? current.pathPoints,
        zIndex: typeof patch.zIndex === 'number' ? patch.zIndex : current.zIndex,
        version: op.serverVersion,
      }
      replayMap.set(op.objectKey, updated)
    })

    canvasStore.graphics = Array.from(replayMap.values()).sort((a, b) => a.zIndex - b.zIndex)
    updateSessionVersion(targetVersion)
    scheduleRender()
    feedback.success(`已回放到版本 ${targetVersion}`)
  } catch (error) {
    feedback.errorFrom(error, '版本回放失败')
  } finally {
    replayLoading.value = false
    replayTargetVersion.value = null
  }
}

const buildLocalOperation = (
  operationType: OperationVO['operationType'],
  objectKey: string,
  data: Record<string, unknown>,
): OperationVO => {
  return {
    operationId: Date.now(),
    sessionId: sessionInfo.value?.sessionId ?? 0,
    userId: currentUserId.value ?? 0,
    objectKey,
    operationType,
    version: currentVersion.value,
    timestamp: Date.now(),
    data,
  }
}

const sendCreateGraphic = (graphic: GraphicVO) => {
  if (!wsClient || !canvasStore.currentSession) {
    return
  }
  const operationId = nextOperationId('create_graphic', graphic.objectKey)
  const lamportTime = nextLamportTime()
  wsClient.sendCreateGraphic({
    sessionKey: canvasStore.currentSession.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    objectKey: graphic.objectKey,
    objectType: graphic.objectType,
    positionX: graphic.positionX,
    positionY: graphic.positionY,
    width: graphic.width ?? undefined,
    height: graphic.height ?? undefined,
    strokeColor: graphic.strokeColor,
    fillColor: graphic.fillColor ?? undefined,
    strokeWidth: graphic.strokeWidth,
    zIndex: graphic.zIndex,
    textContent: graphic.textContent ?? undefined,
    fontSize: graphic.fontSize ?? undefined,
    pathPoints: graphic.pathPoints ?? undefined,
  })

  canvasStore.pushLocalOperation(
    buildLocalOperation('create_graphic', graphic.objectKey, {
      ...graphic,
    }),
  )
  pushOperationHistory({
    operationType: 'create_graphic',
    objectKey: graphic.objectKey,
    userId: currentUserId.value,
    source: 'local',
  })
}

const sendUpdateGraphic = (graphic: GraphicVO) => {
  if (!wsClient || !canvasStore.currentSession) {
    return
  }
  const operationId = nextOperationId('update_graphic', graphic.objectKey)
  const lamportTime = nextLamportTime()
  wsClient.sendUpdateGraphic({
    sessionKey: canvasStore.currentSession.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    objectKey: graphic.objectKey,
    positionX: graphic.positionX,
    positionY: graphic.positionY,
    width: graphic.width ?? undefined,
    height: graphic.height ?? undefined,
    strokeColor: graphic.strokeColor,
    fillColor: graphic.fillColor ?? undefined,
    strokeWidth: graphic.strokeWidth,
    zIndex: graphic.zIndex,
    textContent: graphic.textContent ?? undefined,
    fontSize: graphic.fontSize ?? undefined,
    pathPoints: graphic.pathPoints ?? undefined,
  })

  canvasStore.pushLocalOperation(
    buildLocalOperation('update_graphic', graphic.objectKey, {
      ...graphic,
    }),
  )
  pushOperationHistory({
    operationType: 'update_graphic',
    objectKey: graphic.objectKey,
    userId: currentUserId.value,
    source: 'local',
  })
}

const sendUpdateGraphicPatch = (objectKey: string, patch: NonNullable<import('@/ws/types').UpdateGraphicData['patch']>) => {
  if (!wsClient || !canvasStore.currentSession) {
    return
  }
  const patchKeys = Object.keys(patch).filter((item) => typeof (patch as Record<string, unknown>)[item] !== 'undefined')
  if (patchKeys.length === 0) {
    return
  }
  const operationId = nextOperationId('update_graphic', objectKey)
  const lamportTime = nextLamportTime()
  wsClient.sendUpdateGraphic({
    sessionKey: canvasStore.currentSession.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    objectKey,
    patch: {
      ...patch,
    },
  })

  canvasStore.pushLocalOperation(
    buildLocalOperation('update_graphic', objectKey, {
      objectKey,
      ...patch,
    }),
  )
  pushOperationHistory({
    operationType: 'update_graphic',
    objectKey,
    userId: currentUserId.value,
    source: 'local',
  })
}

const deleteSelectedGraphic = () => {
  const selected = selectedGraphic.value
  const session = canvasStore.currentSession
  const client = wsClient
  if (!selected || !client || !session) {
    return
  }
  const operationId = nextOperationId('delete_graphic', selected.objectKey)
  const lamportTime = nextLamportTime()
  client.sendDeleteGraphicWithMeta({
    sessionKey: session.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    objectKey: selected.objectKey,
  })
  removeGraphic(selected.objectKey)
  canvasStore.pushLocalOperation(
    buildLocalOperation('delete_graphic', selected.objectKey, {
      ...selected,
    }),
  )
  pushOperationHistory({
    operationType: 'delete_graphic',
    objectKey: selected.objectKey,
    userId: currentUserId.value,
    source: 'local',
  })
}

const isBoundsOverlapped = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

const findNeighborByZIndex = (selected: GraphicVO, direction: 'forward' | 'backward'): GraphicVO | null => {
  const selectedBounds = getGraphicBounds(selected)
  const sameLayerCandidates = canvasStore.graphics.filter((item) => {
    if (item.objectKey === selected.objectKey) {
      return false
    }
    const itemBounds = getGraphicBounds(item)
    if (!isBoundsOverlapped(selectedBounds, itemBounds)) {
      return false
    }
    if (direction === 'forward') {
      return item.zIndex > selected.zIndex
    }
    return item.zIndex < selected.zIndex
  })

  if (sameLayerCandidates.length > 0) {
    const sorted = [...sameLayerCandidates].sort((a, b) =>
      direction === 'forward' ? a.zIndex - b.zIndex : b.zIndex - a.zIndex,
    )
    return sorted[0] ?? null
  }

  const globalCandidates = canvasStore.graphics.filter((item) => {
    if (item.objectKey === selected.objectKey) {
      return false
    }
    return direction === 'forward' ? item.zIndex > selected.zIndex : item.zIndex < selected.zIndex
  })
  if (globalCandidates.length === 0) {
    return null
  }
  const sorted = [...globalCandidates].sort((a, b) =>
    direction === 'forward' ? a.zIndex - b.zIndex : b.zIndex - a.zIndex,
  )
  return sorted[0] ?? null
}

const swapGraphicZIndex = (first: GraphicVO, second: GraphicVO) => {
  const firstIndex = canvasStore.graphics.findIndex((item) => item.objectKey === first.objectKey)
  const secondIndex = canvasStore.graphics.findIndex((item) => item.objectKey === second.objectKey)
  if (firstIndex === -1 || secondIndex === -1) {
    return
  }
  const firstCurrent = canvasStore.graphics[firstIndex]
  const secondCurrent = canvasStore.graphics[secondIndex]
  if (!firstCurrent || !secondCurrent) {
    return
  }

  const firstNext: GraphicVO = { ...firstCurrent, zIndex: secondCurrent.zIndex, updatedAt: new Date().toISOString() }
  const secondNext: GraphicVO = { ...secondCurrent, zIndex: firstCurrent.zIndex, updatedAt: new Date().toISOString() }
  canvasStore.graphics[firstIndex] = firstNext
  canvasStore.graphics[secondIndex] = secondNext

  sendUpdateGraphicPatch(firstNext.objectKey, { zIndex: firstNext.zIndex })
  sendUpdateGraphicPatch(secondNext.objectKey, { zIndex: secondNext.zIndex })
  scheduleRender()
}

const handleBringForward = () => {
  const selected = selectedGraphic.value
  if (!selected) {
    return
  }
  const higher = findNeighborByZIndex(selected, 'forward')
  if (!higher) {
    return
  }
  swapGraphicZIndex(selected, higher)
}

const handleSendBackward = () => {
  const selected = selectedGraphic.value
  if (!selected) {
    return
  }
  const lower = findNeighborByZIndex(selected, 'backward')
  if (!lower) {
    return
  }
  swapGraphicZIndex(selected, lower)
}

const buildGraphicFromDraft = (): GraphicVO | null => {
  if (!canvasStore.currentSession) {
    return null
  }
  const preview = getPreviewGraphic()
  if (!preview) {
    return null
  }
  return {
    ...preview,
    id: 0,
    sessionId: canvasStore.currentSession.sessionId,
    objectKey: generateGraphicObjectKey(),
    zIndex: canvasStore.graphics.length + 1,
    version: currentVersion.value,
    creatorId: currentUserId.value ?? 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const createTextGraphic = (point: Point) => {
  if (!canvasStore.currentSession) {
    return
  }
  textEditing.value = true
  textEditingTargetObjectKey.value = null
  textEditorValue.value = ''
  textEditorPoint.value = point
  nextTick(() => {
    window.requestAnimationFrame(() => {
      textEditorInputRef.value?.focus()
    })
  })
}

const startEditTextGraphic = (graphic: GraphicVO) => {
  textEditing.value = true
  textEditingTargetObjectKey.value = graphic.objectKey
  textEditorValue.value = graphic.textContent ?? ''
  textEditorPoint.value = { x: graphic.positionX, y: graphic.positionY }
  nextTick(() => {
    textEditorInputRef.value?.focus()
    textEditorInputRef.value?.select()
  })
}

const cancelTextEditing = () => {
  textEditing.value = false
  textEditorValue.value = ''
  textEditingTargetObjectKey.value = null
}

const commitTextEditing = () => {
  if (!canvasStore.currentSession) {
    cancelTextEditing()
    return
  }
  const content = textEditorValue.value.trim()
  if (!content) {
    cancelTextEditing()
    return
  }

  const editingObjectKey = textEditingTargetObjectKey.value
  if (editingObjectKey) {
    const index = canvasStore.graphics.findIndex((item) => item.objectKey === editingObjectKey)
    if (index !== -1) {
      const target = canvasStore.graphics[index]
      if (target) {
        const changed = target.textContent !== content
        if (changed) {
          const nextGraphic: GraphicVO = {
            ...target,
            textContent: content,
            updatedAt: new Date().toISOString(),
          }
          canvasStore.graphics[index] = nextGraphic
          selectedObjectKey.value = nextGraphic.objectKey
          sendUpdateGraphicPatch(nextGraphic.objectKey, { textContent: content })
        }
        cancelTextEditing()
        return
      }
    }
  }

  const graphic: GraphicVO = {
    id: 0,
    sessionId: canvasStore.currentSession.sessionId,
    objectKey: generateGraphicObjectKey(),
    objectType: 'text',
    positionX: textEditorPoint.value.x,
    positionY: textEditorPoint.value.y,
    width: 160,
    height: 28,
    strokeColor: strokeColor.value,
    fillColor: null,
    strokeWidth: strokeWidth.value,
    textContent: content,
    fontSize: 16,
    pathPoints: null,
    zIndex: canvasStore.graphics.length + 1,
    version: currentVersion.value,
    creatorId: currentUserId.value ?? 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  upsertGraphic(graphic)
  selectedObjectKey.value = graphic.objectKey
  sendCreateGraphic(graphic)
  cancelTextEditing()
}

const handleMouseDown = (event: MouseEvent) => {
  if (textEditing.value) {
    return
  }

  if (panMode.value) {
    panState.value = {
      active: true,
      start: { x: event.clientX, y: event.clientY },
      originOffset: { ...viewportOffset.value },
    }
    return
  }

  const point = toCanvasPoint(event)
  if (!point) {
    return
  }

  if (activeTool.value === 'text') {
    selectedObjectKey.value = null
    scheduleRender()
    return
  }

  if (activeTool.value === 'select') {
    const selected = selectedGraphic.value
    if (selected) {
      const handle = hitResizeHandle(point, selected)
      if (handle) {
        resizeState.value = {
          active: true,
          objectKey: selected.objectKey,
          handle,
          originalGraphic: { ...selected },
        }
        scheduleRender()
        return
      }
    }

    const target = pickGraphic(point)
    selectedObjectKey.value = target?.objectKey ?? null
    if (target) {
      dragMove.value = {
        active: true,
        objectKey: target.objectKey,
        start: point,
        baseX: target.positionX,
        baseY: target.positionY,
        basePathPoints: target.pathPoints ? target.pathPoints.map((item) => ({ x: item.x, y: item.y })) : null,
        originalGraphic: { ...target },
      }
    }
    scheduleRender()
    return
  }

  if (activeTool.value === 'brush') {
    selectedObjectKey.value = null
    draft.value = {
      active: true,
      start: point,
      end: point,
      points: [point],
    }
    scheduleRender()
    return
  }

  selectedObjectKey.value = null
  draft.value = {
    active: true,
    start: point,
    end: point,
    points: [],
  }
  scheduleRender()
}

const handleCanvasClick = (event: MouseEvent) => {
  if (textEditing.value || activeTool.value !== 'text' || panState.value.active || panMode.value) {
    return
  }
  const point = toCanvasPoint(event)
  if (!point) {
    return
  }
  const target = pickGraphic(point)
  if (target?.objectType === 'text') {
    selectedObjectKey.value = target.objectKey
    startEditTextGraphic(target)
    scheduleRender()
    return
  }
  createTextGraphic(point)
}

const handleCanvasDblClick = (event: MouseEvent) => {
  if (textEditing.value || activeTool.value !== 'select' || panState.value.active || panMode.value) {
    return
  }
  const point = toCanvasPoint(event)
  if (!point) {
    return
  }
  const target = pickGraphic(point)
  if (target?.objectType === 'text') {
    selectedObjectKey.value = target.objectKey
    startEditTextGraphic(target)
    scheduleRender()
  }
}

const handleMouseMove = (event: MouseEvent) => {
  if (panState.value.active) {
    const dx = (event.clientX - panState.value.start.x) / zoomScale.value
    const dy = (event.clientY - panState.value.start.y) / zoomScale.value
    viewportOffset.value = {
      x: panState.value.originOffset.x + dx,
      y: panState.value.originOffset.y + dy,
    }
    scheduleRender()
    return
  }

  const point = toCanvasPoint(event)
  if (!point) {
    return
  }

  if (resizeState.value.active && activeTool.value === 'select') {
    const handle = resizeState.value.handle
    const index = canvasStore.graphics.findIndex((item) => item.objectKey === resizeState.value.objectKey)
    if (!handle || index === -1) {
      return
    }
    const current = canvasStore.graphics[index]
    if (!current) {
      return
    }
    if (current.objectType !== 'rect' && current.objectType !== 'circle' && current.objectType !== 'text') {
      return
    }
    canvasStore.graphics[index] = updateGraphicByResize(current, handle, point)
    scheduleRender()
    return
  }

  if (dragMove.value.active && activeTool.value === 'select') {
    const index = canvasStore.graphics.findIndex((item) => item.objectKey === dragMove.value.objectKey)
    if (index === -1) {
      return
    }
    const current = canvasStore.graphics[index]
    if (!current) {
      return
    }
    const dx = point.x - dragMove.value.start.x
    const dy = point.y - dragMove.value.start.y
    if (current.objectType === 'path') {
      const movedPoints = (dragMove.value.basePathPoints ?? current.pathPoints ?? []).map((item) => ({
        x: item.x + dx,
        y: item.y + dy,
      }))
      canvasStore.graphics[index] = {
        ...current,
        positionX: dragMove.value.baseX + dx,
        positionY: dragMove.value.baseY + dy,
        pathPoints: movedPoints,
      }
    } else {
      canvasStore.graphics[index] = {
        ...current,
        positionX: dragMove.value.baseX + dx,
        positionY: dragMove.value.baseY + dy,
      }
    }
    scheduleRender()
    return
  }

  if (!draft.value.active) {
    return
  }
  if (activeTool.value === 'brush') {
    const last = draft.value.points[draft.value.points.length - 1]
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2) {
      draft.value.points.push(point)
    }
  }
  draft.value.end = point
  scheduleRender()
}

const handleMouseUp = () => {
  if (panState.value.active) {
    panState.value.active = false
    return
  }

  if (resizeState.value.active) {
    const resized = selectedGraphic.value
    const original = resizeState.value.originalGraphic
    resizeState.value.active = false
    resizeState.value.handle = null
    if (
      resized &&
      original &&
      (resized.positionX !== original.positionX ||
        resized.positionY !== original.positionY ||
        resized.width !== original.width ||
        resized.height !== original.height)
    ) {
      sendUpdateGraphicPatch(resized.objectKey, {
        positionX: resized.positionX,
        positionY: resized.positionY,
        ...(typeof resized.width === 'number' ? { width: resized.width } : {}),
        ...(typeof resized.height === 'number' ? { height: resized.height } : {}),
        ...(typeof resized.fontSize === 'number' ? { fontSize: resized.fontSize } : {}),
      })
    }
    resizeState.value.originalGraphic = null
    return
  }

  if (dragMove.value.active) {
    const moved = selectedGraphic.value
    const original = dragMove.value.originalGraphic
    dragMove.value.active = false
    if (
      moved &&
      original &&
      (moved.positionX !== original.positionX ||
        moved.positionY !== original.positionY ||
        moved.width !== original.width ||
        moved.height !== original.height ||
        JSON.stringify(moved.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null) ||
        moved.strokeColor !== original.strokeColor ||
        moved.fillColor !== original.fillColor ||
        moved.strokeWidth !== original.strokeWidth ||
        moved.zIndex !== original.zIndex ||
        moved.textContent !== original.textContent ||
        moved.fontSize !== original.fontSize)
    ) {
      sendUpdateGraphicPatch(moved.objectKey, {
        positionX: moved.positionX,
        positionY: moved.positionY,
        ...(Array.isArray(moved.pathPoints) ? { pathPoints: moved.pathPoints } : {}),
      })
    }
    dragMove.value.basePathPoints = null
    dragMove.value.originalGraphic = null
    return
  }

  if (!draft.value.active) {
    return
  }
  const graphic = buildGraphicFromDraft()
  draft.value.active = false
  draft.value.points = []
  if (!graphic) {
    scheduleRender()
    return
  }
  if (
    graphic.objectType !== 'text' &&
    graphic.objectType !== 'path' &&
    Math.abs(graphic.width ?? 0) < 2 &&
    Math.abs(graphic.height ?? 0) < 2
  ) {
    scheduleRender()
    return
  }
  if (graphic.objectType === 'path' && (graphic.pathPoints?.length ?? 0) < 2) {
    scheduleRender()
    return
  }
  upsertGraphic(graphic)
  selectedObjectKey.value = graphic.objectKey
  sendCreateGraphic(graphic)
}

const handleMouseLeave = () => {
  if (panState.value.active) {
    panState.value.active = false
  }
  if (draft.value.active) {
    draft.value.active = false
    draft.value.points = []
  }
  if (resizeState.value.active) {
    resizeState.value.active = false
    resizeState.value.handle = null
    resizeState.value.originalGraphic = null
  }
  if (dragMove.value.active) {
    dragMove.value.active = false
    dragMove.value.basePathPoints = null
    dragMove.value.originalGraphic = null
  }
  scheduleRender()
}


const handleUndo = async () => {
  const operationId = nextOperationId('undo', 'global', false)
  const lamportTime = nextLamportTime()
  await canvasStore.undo({
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
  })
}

const handleRedo = async () => {
  const operationId = nextOperationId('redo', 'global', false)
  const lamportTime = nextLamportTime()
  await canvasStore.redo({
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
  })
}

const clampZoomPercent = (value: number) => {
  return Math.max(50, Math.min(200, value))
}

const handleWheel = (event: WheelEvent) => {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }
  const oldZoom = zoomPercent.value
  const delta = event.deltaY < 0 ? 5 : -5
  const nextZoom = clampZoomPercent(oldZoom + delta)
  if (nextZoom === oldZoom) {
    return
  }

  const oldScale = oldZoom / 100
  const newScale = nextZoom / 100
  const rect = canvas.getBoundingClientRect()
  const screenX = event.clientX - rect.left
  const screenY = event.clientY - rect.top
  const worldX = screenX / oldScale - viewportOffset.value.x
  const worldY = screenY / oldScale - viewportOffset.value.y

  zoomPercent.value = nextZoom
  viewportOffset.value = {
    x: screenX / newScale - worldX,
    y: screenY / newScale - worldY,
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (textEditing.value) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitTextEditing()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelTextEditing()
      return
    }
    return
  }

  if (isInputTarget(event.target)) {
    return
  }

  if (event.key === 'Delete') {
    event.preventDefault()
    deleteSelectedGraphic()
    return
  }

  if (!event.ctrlKey && !event.metaKey) {
    return
  }

  const key = event.key.toLowerCase()
  if (key === 'z' && event.shiftKey) {
    event.preventDefault()
    void handleRedo()
    return
  }
  if (key === 'z') {
    event.preventDefault()
    void handleUndo()
    return
  }
  if (key === 'y') {
    event.preventDefault()
    void handleRedo()
  }
}

const handleRetryConnect = () => {
  if (!wsClient) {
    return
  }
  reconnecting.value = false
  reconnectFailed.value = false
  reconnectAttempt.value = 0
  reconnectMaxAttempts.value = 0
  reconnectDelay.value = 0
  wsClient.connect()
}

watch(
  () => selectedGraphic.value,
  (graphic) => {
    syncingSelectedStyle.value = true
    if (!graphic) {
      strokeColor.value = '#1f2937'
      fillColor.value = 'transparent'
      strokeWidth.value = 2
      syncingSelectedStyle.value = false
      return
    }
    strokeColor.value = graphic.strokeColor || '#1f2937'
    fillColor.value = graphic.fillColor || 'transparent'
    strokeWidth.value = graphic.strokeWidth || 2
    syncingSelectedStyle.value = false
  },
  { immediate: true },
)

watch(
  () => strokeColor.value,
  (value) => {
    if (syncingSelectedStyle.value || !selectedGraphic.value) {
      return
    }
    if (selectedGraphic.value.strokeColor === value) {
      return
    }
    updateSelectedGraphicStyle({ strokeColor: value })
  },
)

watch(
  () => strokeWidth.value,
  (value) => {
    if (syncingSelectedStyle.value || !selectedGraphic.value) {
      return
    }
    if (selectedGraphic.value.strokeWidth === value) {
      return
    }
    updateSelectedGraphicStyle({ strokeWidth: value })
  },
)

watch(
  () => fillColor.value,
  (value) => {
    if (syncingSelectedStyle.value || !selectedGraphic.value || !canEditFillColor.value) {
      return
    }
    const modelFill = value === 'transparent' ? null : value
    if (selectedGraphic.value.fillColor === modelFill) {
      return
    }
    updateSelectedGraphicStyle({ fillColor: modelFill })
  },
)

watch(
  () => zoomPercent.value,
  () => {
    scheduleRender()
  },
)

watch(
  () => canvasStore.graphics,
  () => {
    scheduleRender()
  },
  { deep: true },
)

onMounted(async () => {
  loadOrCreateClientId()
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)

  await joinSession()
  await nextTick()
  resizeCanvas()
  setupResizeObserver()
  await syncGraphicsFromServer(true)
  clientVersionRef.value = currentVersion.value
  serverVersionRef.value = currentVersion.value
  lastSyncText.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  scheduleRender()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearHeartbeat()
  clearRenderFrame()
  teardownResizeObserver()

  if (membersRefreshTimer !== null) {
    window.clearTimeout(membersRefreshTimer)
    membersRefreshTimer = null
  }
  if (focusHighlightTimer !== null) {
    window.clearTimeout(focusHighlightTimer)
    focusHighlightTimer = null
  }

  if (wsClient) {
    unbindWs(wsClient)
    wsClient.disconnect()
    wsClient = null
  }
  canvasStore.clearSession()
})
</script>

<template>
  <div class="draw-page">
    <TopBar
      :session-name="currentSessionName"
      :members="sessionDetail?.members ?? []"
      :is-creator="isCreator"
      :user-avatar="authStore.user?.avatar"
      @update:session-name="handleUpdateSessionName"
      @back="handleBackToList"
      @share="handleShare"
      @export-image="handleExportImage"
      @show-history="handleShowOperationHistory"
      @show-conflicts="handleShowConflictHistory"
      @show-versions="handleShowVersionHistory"
      @show-shortcuts="handleShowShortcuts"
      @leave="handleLeaveSession"
      @delete-session="handleDeleteSession"
    />

    <div v-if="showReconnectHint" class="reconnect-bar" :class="{ failed: reconnectFailed }">
      <span v-if="reconnecting">
        正在重连（第 {{ reconnectAttempt }}/{{ reconnectMaxAttempts }} 次，{{ reconnectDelay / 1000 }} 秒后）
      </span>
      <span v-else>重连失败（已尝试 {{ reconnectAttempt }}/{{ reconnectMaxAttempts }} 次）</span>
      <el-button v-if="reconnectFailed" type="warning" size="small" @click="handleRetryConnect">重试连接</el-button>
    </div>

    <div class="draw-main" v-loading="joining">
      <ToolBar
        v-model:active-tool="activeTool"
        v-model:stroke-color="strokeColor"
        v-model:fill-color="fillColor"
        v-model:stroke-width="strokeWidth"
        v-model:pan-mode="panMode"
        :can-undo="canvasStore.canUndo"
        :can-redo="canvasStore.canRedo"
        :zoom-percent="zoomPercent"
        :can-delete="canDeleteSelected"
        :can-bring-forward="canBringForward"
        :can-send-backward="canSendBackward"
        @undo="handleUndo"
        @redo="handleRedo"
        @delete="deleteSelectedGraphic"
        @bring-forward="handleBringForward"
        @send-backward="handleSendBackward"
      />

      <section class="canvas-area">
        <div class="canvas-container" ref="canvasContainerRef">
          <div
            v-if="textEditing"
            class="text-editor-wrap"
            :style="{
              left: `${(textEditorPoint.x + viewportOffset.x) * zoomScale}px`,
              top: `${(textEditorPoint.y + viewportOffset.y) * zoomScale}px`,
            }"
          >
            <input
              ref="textEditorInputRef"
              v-model="textEditorValue"
              class="text-editor-input"
              :style="{ width: `${textEditorWidth}px` }"
              placeholder="输入文本，回车确认"
              @keydown.enter.prevent="commitTextEditing"
              @keydown.esc.prevent="cancelTextEditing"
              @blur="commitTextEditing"
            />
          </div>
          <canvas
            ref="canvasRef"
            class="draw-canvas"
            :style="{ cursor: canvasCursor }"
            @mousedown="handleMouseDown"
            @click="handleCanvasClick"
            @dblclick="handleCanvasDblClick"
            @wheel.prevent="handleWheel"
            @mousemove="handleMouseMove"
            @mouseup="handleMouseUp"
            @mouseleave="handleMouseLeave"
          />
        </div>
      </section>

      <MemberPanel
        :members="sessionDetail?.members ?? []"
        :collapsed="memberPanelCollapsed"
        :include-history="includeHistoryMembers"
        :loading="loadingMembers"
        :is-creator="isCreator"
        :current-user-id="currentUserId"
        @toggle-collapse="toggleMemberPanel"
        @update:include-history="updateHistoryToggle"
        @remove-member="handleRemoveMember"
        @transfer-creator="handleTransferCreator"
      />
    </div>

    <StatusBar
      :zoom-percent="zoomPercent"
      :zoom-options="zoomOptions"
      :graphic-count="canvasStore.graphics.length"
      :current-version="currentVersion"
      :server-version="serverVersionRef"
      :client-version="clientVersionRef"
      :pending-operations="pendingOperationsCount"
      :recent-conflicts="recentConflictCount"
      :connected="wsConnected"
      :last-sync-at="lastSyncText"
      :reconnect-count="reconnectTotalCount"
      @update:zoom-percent="zoomPercent = $event"
    />

    <el-dialog v-model="shortcutDialogVisible" title="快捷键帮助" width="420px">
      <div class="shortcut-list">
        <div class="shortcut-row">
          <span class="shortcut-action">撤销</span>
          <code>Ctrl + Z</code>
        </div>
        <div class="shortcut-row">
          <span class="shortcut-action">重做</span>
          <code>Ctrl + Y / Ctrl + Shift + Z</code>
        </div>
        <div class="shortcut-row">
          <span class="shortcut-action">删除选中图元</span>
          <code>Delete</code>
        </div>
        <div class="shortcut-row">
          <span class="shortcut-action">文本确认</span>
          <code>Enter</code>
        </div>
        <div class="shortcut-row">
          <span class="shortcut-action">文本取消</span>
          <code>Esc</code>
        </div>
      </div>
      <template #footer>
        <el-button @click="shortcutDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="operationHistoryVisible" title="协同操作时间线" width="860px">
      <div class="timeline-filter">
        <el-select v-model="operationTimelineFilterUserId" clearable placeholder="操作者" size="small" style="width: 140px">
          <el-option v-for="item in operationTimelineUserOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-model="operationTimelineFilterOperationType"
          placeholder="操作类型"
          size="small"
          style="width: 130px"
        >
          <el-option label="全部操作" value="all" />
          <el-option label="创建图元" value="create" />
          <el-option label="更新图元" value="update" />
          <el-option label="删除图元" value="delete" />
        </el-select>
        <el-select
          v-model="operationTimelineFilterConflictType"
          placeholder="冲突类型"
          size="small"
          style="width: 130px"
        >
          <el-option label="全部冲突" value="all" />
          <el-option label="无冲突" value="none" />
          <el-option label="字段合并" value="field_merge" />
          <el-option label="字段冲突" value="field_conflict" />
          <el-option label="删除优先" value="delete_wins" />
          <el-option label="重复操作" value="duplicate_operation" />
        </el-select>
        <el-input-number v-model="operationTimelineFilterFromVersion" :min="0" size="small" placeholder="起始版本" />
        <el-input-number v-model="operationTimelineFilterToVersion" :min="0" size="small" placeholder="结束版本" />
        <el-button size="small" type="primary" :loading="operationTimelineLoading" @click="handleOperationTimelineSearch">
          查询
        </el-button>
        <el-button size="small" @click="handleResetOperationTimelineFilters">重置</el-button>
      </div>

      <div v-if="operationTimelineLoading" class="history-empty">加载中...</div>
      <div v-else-if="operationTimelineForDisplay.length === 0" class="history-empty">暂无操作记录</div>
      <div v-else class="history-list">
        <div v-for="item in operationTimelineForDisplay" :key="item.id" class="history-row">
          <div class="history-main">
            <span class="history-type">{{ formatSessionOperationTypeLabel(item.operationType) }}</span>
            <span class="history-user">{{ findMemberNameByUserId(item.userId) || `用户 ${item.userId}` }}</span>
            <span class="history-conflict">{{ formatConflictTypeLabel(item.conflictType) }}</span>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="!canLocateHistoryObject(item.objectKey)"
              @click="
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
              "
            >
              定位到对象
            </el-button>
          </div>
          <div v-if="item.resolvedResult?.appliedFields || item.resolvedResult?.rejectedFields" class="history-detail">
            <span v-if="Array.isArray(item.resolvedResult?.appliedFields) && item.resolvedResult?.appliedFields.length > 0">
              采用字段: {{ item.resolvedResult?.appliedFields.join(', ') }}
            </span>
            <span
              v-if="
                Array.isArray(item.resolvedResult?.rejectedFields) && item.resolvedResult?.rejectedFields.length > 0
              "
            >
              ，拒绝字段: {{ item.resolvedResult?.rejectedFields.join(', ') }}
            </span>
          </div>
          <div class="history-meta">
            <span class="history-object">对象: {{ item.objectKey || '-' }}</span>
            <span>版本: {{ item.serverVersion }}</span>
            <span>基线版本: {{ item.baseVersion }}</span>
            <span>操作ID: {{ item.operationId || '-' }}</span>
            <span class="history-time">{{ new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false }) }}</span>
          </div>
        </div>
      </div>
      <div class="timeline-pagination">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :current-page="operationTimelinePage"
          :page-size="operationTimelinePageSize"
          :total="operationTimelineTotal"
          @current-change="handleOperationTimelinePageChange"
        />
      </div>
      <template #footer>
        <el-button @click="operationHistoryVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="conflictHistoryVisible" title="冲突日志（CRDT）" width="760px">
      <div class="conflict-toolbar">
        <el-button size="small" :loading="loadingConflictLogs" @click="refreshConflictLogs(true)">刷新</el-button>
      </div>
      <div v-if="conflictLogs.length === 0" class="history-empty">暂无冲突记录</div>
      <div v-else class="conflict-list">
        <div v-for="item in conflictLogs" :key="item.id" class="conflict-row">
          <div class="conflict-head">
            <span class="conflict-type">{{ item.conflictType }}</span>
            <span class="conflict-field">{{ item.fieldName || '-' }}</span>
            <span class="conflict-time">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
          </div>
          <div class="conflict-meta">
            <span>对象: {{ item.objectKey }}</span>
            <span>策略: {{ item.resolveStrategy }}</span>
            <span>操作ID: {{ item.operationId || '-' }}</span>
          </div>
          <div class="conflict-values">
            <div>当前值: {{ formatConflictValue(item.currentValue) }}</div>
            <div>传入值: {{ formatConflictValue(item.incomingValue) }}</div>
            <div>采用值: {{ formatConflictValue(item.resolvedValue) }}</div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="conflictHistoryVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="versionHistoryVisible" title="版本快照与回放" width="760px">
      <div class="version-toolbar">
        <el-button size="small" :loading="loadingSnapshots" @click="refreshSnapshots">刷新</el-button>
        <el-button size="small" type="primary" :loading="loadingSnapshots" @click="createSnapshotNow">创建快照</el-button>
      </div>
      <div v-if="snapshots.length === 0" class="history-empty">暂无版本快照</div>
      <div v-else class="version-list">
        <div v-for="item in snapshots" :key="item.id" class="version-row">
          <div class="version-head">
            <span class="version-tag">版本 {{ item.version }}</span>
            <span class="version-time">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
          </div>
          <div class="version-meta">
            <span>图元数量: {{ item.graphicCount }}</span>
            <span>快照ID: {{ item.id }}</span>
          </div>
          <div class="version-actions">
            <el-button
              size="small"
              :loading="replayLoading && replayTargetVersion === item.version"
              @click="applyReplayToCanvas(item.version)"
            >
              回放到此版本
            </el-button>
            <el-button
              size="small"
              type="warning"
              :loading="replayLoading && replayTargetVersion === item.version"
              @click="restoreToVersion(item.version)"
            >
              恢复到此版本
            </el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="versionHistoryVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.draw-page {
  height: 100vh;
  display: grid;
  grid-template-rows: 52px 1fr 30px;
  background:
    radial-gradient(circle at 16% 12%, rgba(255, 107, 107, 0.06), transparent 24%),
    radial-gradient(circle at 84% 10%, rgba(49, 211, 189, 0.08), transparent 28%),
    var(--cd-bg-page);
  overflow: hidden;
}

.draw-main {
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  overflow: hidden;
}

.canvas-area {
  min-width: 0;
  min-height: 0;
  padding: 10px 12px;
}

.canvas-container {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(226, 230, 239, 0.94);
  border-radius: var(--cd-radius-lg);
  background: #ffffff;
  overflow: hidden;
  position: relative;
  box-shadow: var(--cd-shadow-card);
}

.draw-canvas {
  display: block;
  width: 100%;
  height: 100%;
  position: relative;
  z-index: 1;
}

.text-editor-wrap {
  position: absolute;
  z-index: 20;
  transform: translate(-2px, -2px);
  pointer-events: auto;
}

.text-editor-input {
  width: 180px;
  height: 30px;
  border: 1px solid var(--cd-primary);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 14px;
  color: var(--cd-text-primary);
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(20, 30, 55, 0.14);
}

.reconnect-bar {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid #fcd34d;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  box-shadow: var(--cd-shadow-card);
}

.reconnect-bar.failed {
  border-color: #fca5a5;
  background: #fee2e2;
  color: #991b1b;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.shortcut-action {
  color: #111827;
  font-size: 13px;
}

.history-empty {
  color: #6b7280;
  font-size: 13px;
  padding: 8px 2px;
}

.history-list {
  max-height: 420px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timeline-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.history-row {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 8px 10px;
  background: #f8f9fc;
}

.history-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-detail {
  color: #1f2937;
  font-size: 12px;
  margin-bottom: 4px;
}

.history-type {
  color: #111827;
  font-weight: 600;
  font-size: 13px;
}

.history-user {
  color: #374151;
  font-size: 12px;
}

.history-conflict {
  color: #6b7280;
  font-size: 12px;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6b7280;
  font-size: 12px;
  flex-wrap: wrap;
}

.timeline-pagination {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.conflict-toolbar {
  margin-bottom: 8px;
}

.conflict-list {
  max-height: 440px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-row {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 8px 10px;
  background: #f8f9fc;
}

.conflict-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.conflict-type {
  color: #111827;
  font-size: 12px;
  font-weight: 600;
}

.conflict-field {
  color: #1f2937;
  font-size: 12px;
}

.conflict-time {
  color: #6b7280;
  font-size: 12px;
}

.conflict-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.conflict-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #1f2937;
  font-size: 12px;
}

.version-toolbar {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-list {
  max-height: 440px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-row {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 8px 10px;
  background: #f8f9fc;
}

.version-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.version-tag {
  color: #111827;
  font-size: 12px;
  font-weight: 600;
}

.version-time {
  color: #6b7280;
  font-size: 12px;
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}

.version-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 1024px) {
  .draw-main {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
