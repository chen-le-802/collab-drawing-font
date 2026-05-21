<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'

import MemberPanel from '@/components/sidebar/MemberPanel.vue'
import StatusBar from '@/components/statusbar/StatusBar.vue'
import ToolBar, { type CanvasTool, type GraphicLineStyle, type ShapeToolType } from '@/components/toolbar/ToolBar.vue'
import TopBar from '@/components/toolbar/TopBar.vue'
import type { GuideStep } from '@/views/DrawCanvas/components/OnboardingGuide.vue'
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
  SessionInviteItemVO,
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
  PresenceSelectionData,
  ReconnectFailedEventData,
  ReconnectingEventData,
  SessionJoinedData,
  SessionLeftData,
  SessionPausedData,
  WsErrorData,
} from '@/ws/types'
import './styles.css'

const ConflictLogDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/ConflictLogDialog.vue'))
const InviteDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/InviteDialog.vue'))
const MemberManageDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/MemberManageDialog.vue'))
const OnboardingGuide = defineAsyncComponent(() => import('@/views/DrawCanvas/components/OnboardingGuide.vue'))
const OperationTimelineDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/OperationTimelineDialog.vue'))
const ShortcutHelpDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/ShortcutHelpDialog.vue'))
const VersionHistoryDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/VersionHistoryDialog.vue'))

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

interface MultiDragState {
  active: boolean
  objectKeys: string[]
  start: Point
  baseByKey: Record<string, { x: number; y: number; pathPoints: Point[] | null }>
}

type ResizeHandleKey = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

interface ResizeState {
  active: boolean
  objectKey: string
  handle: ResizeHandleKey | null
  originalGraphic: GraphicVO | null
}

interface RotateState {
  active: boolean
  objectKey: string
  center: Point
  startAngle: number
  originalRotation: number
  originalGraphic: GraphicVO | null
}

interface GroupResizeState {
  active: boolean
  handle: ResizeHandleKey | null
  originalBounds: { x: number; y: number; width: number; height: number } | null
  originalGraphics: Record<string, GraphicVO>
}

interface GroupRotateState {
  active: boolean
  center: Point
  startAngle: number
  originalGraphics: Record<string, GraphicVO>
}

interface PanState {
  active: boolean
  start: Point
  originOffset: Point
}

interface SelectionRectState {
  active: boolean
  start: Point
  end: Point
}

interface GroupSelectionFrame {
  bounds: { x: number; y: number; width: number; height: number }
  center: Point
  rotationRad: number
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

interface RemoteCursorState {
  userId: number
  username: string
  x: number
  y: number
  updatedAt: number
}

interface RemoteSelectionState {
  userId: number
  username: string
  objectKey: string | null
  objectKeys: string[]
  updatedAt: number
}

type GraphicPatch = NonNullable<import('@/ws/types').UpdateGraphicData['patch']>
type DeferredObjectOperation = { type: 'patch'; patch: GraphicPatch } | { type: 'delete' }

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const canvasStore = useCanvasStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasContainerRef = ref<HTMLDivElement | null>(null)
const drawPageRef = ref<HTMLDivElement | null>(null)
const focusActionsRef = ref<HTMLDivElement | null>(null)

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
const shapeType = ref<ShapeToolType>('diamond')
const strokeColor = ref('#1f2937')
const fillColor = ref('transparent')
const strokeWidth = ref(2)
const lineStyle = ref<GraphicLineStyle>('solid')
const zoomPercent = ref(100)
const viewportOffset = ref<Point>({ x: 0, y: 0 })
const panMode = ref(false)
const zoomOptions = [25, 50, 75, 100, 125, 150, 200]
const selectedObjectKey = ref<string | null>(null)
const selectedObjectKeys = ref<string[]>([])
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
const operationTimelineFilterOperationType = ref<SessionOperationType | 'all' | 'restore'>('all')
const operationTimelineFilterConflictType = ref<CollaborationConflictType | 'all'>('all')
const operationTimelineFilterFromVersion = ref<number | null>(null)
const operationTimelineFilterToVersion = ref<number | null>(null)
const operationTimelinePage = ref(1)
const operationTimelinePageSize = ref(20)
const operationTimelineTechnicalExpandedIds = ref<number[]>([])
const inviteDialogVisible = ref(false)
const inviteDialogLoading = ref(false)
const inviteListLoading = ref(false)
const inviteList = ref<SessionInviteItemVO[]>([])
const memberManageDialogVisible = ref(false)
const shareQrcodePendingLink = ref('')
const shareQrcodeVisible = ref(false)
const exportDialogVisible = ref(false)
const exportFormat = ref<'png' | 'svg' | 'pdf'>('png')
const exportIncludeGrid = ref(true)
const showGrid = ref(true)
const backgroundDialogVisible = ref(false)
const canvasBackgroundColor = ref('#ffffff')
const focusMode = ref(false)
const focusActionsPos = ref<Point>({ x: 16, y: 68 })
const focusActionsCollapsed = ref(false)
const focusActionsDragging = ref(false)
const focusActionsDragOffset = ref<Point>({ x: 0, y: 0 })
const technicalMode = ref(false)
const onboardingVisible = ref(false)
const baseOnboardingSteps: GuideStep[] = [
  {
    selector: '[data-guide="toolbar"]',
    title: '工具区',
    content: '先在这里选择选择器、形状、文本、画笔等工具。',
    placement: 'right',
  },
  {
    selector: '[data-guide="style-section"]',
    title: '样式区',
    content: '可调整填充、描边、线宽和线型，统一图形风格。',
    placement: 'right',
  },
  {
    selector: '.canvas-container',
    title: '画布区',
    content: '在这里拖拽、拉伸、旋转对象；多人编辑会自动实时同步。',
    placement: 'corner',
    highlight: false,
  },
  {
    selector: '[data-guide="topbar-members"]',
    title: '在线成员',
    content: '这里可以快速确认谁在线，方便开始语音或分工协作。',
    placement: 'bottom',
  },
  {
    selector: '[data-guide="member-panel"]',
    title: '成员与权限',
    content: '右侧面板可看成员状态与角色（owner/manager/editor/viewer）。',
    placement: 'left',
  },
  {
    selector: '[data-guide="topbar-more"]',
    title: '管理与恢复入口',
    content: '“更多操作”里有成员管理、冲突日志、版本快照和恢复。',
    placement: 'bottom',
  },
]
const onboardingSteps = ref<GuideStep[]>(baseOnboardingSteps)
const importingImage = ref(false)
const imageFileInputRef = ref<HTMLInputElement | null>(null)
const conflictLogs = ref<SessionConflictLogItemVO[]>([])
const snapshots = ref<SessionSnapshotItemVO[]>([])
const currentSnapshotVersion = ref<number | null>(null)
const conflictTechnicalExpandedIds = ref<number[]>([])
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
const clipboardGraphics = ref<GraphicVO[]>([])
const pasteCount = ref(0)
const patchBatchState = ref<{ active: boolean; count: number }>({ active: false, count: 0 })
const wsBatchMeta = ref<{
  id: string
  size: number
  cursor: number
  label?: string
} | null>(null)
const styleCommitTimer = ref<number | null>(null)
const styleCommitPatch = ref<Partial<Pick<GraphicVO, 'strokeColor' | 'fillColor' | 'strokeWidth' | 'lineStyle'>>>({})
const undoStepCounts = ref<number[]>([])
const redoStepCounts = ref<number[]>([])
const pendingCreateObjectKeys = ref<Set<string>>(new Set())
const deferredObjectOperations = ref<Record<string, DeferredObjectOperation[]>>({})
const recoveringMissingGraphic = ref(false)
const remoteCursors = ref<Record<number, RemoteCursorState>>({})
const remoteSelections = ref<Record<number, RemoteSelectionState>>({})
const lastCursorSentAt = ref(0)
const lastCursorPoint = ref<Point | null>(null)
const lastSelectionBroadcastSignature = ref('')
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
const pointerPressed = ref(false)

const dragMove = ref<DragMove>({
  active: false,
  objectKey: '',
  start: { x: 0, y: 0 },
  baseX: 0,
  baseY: 0,
  basePathPoints: null,
  originalGraphic: null,
})
const multiDrag = ref<MultiDragState>({
  active: false,
  objectKeys: [],
  start: { x: 0, y: 0 },
  baseByKey: {},
})

const resizeState = ref<ResizeState>({
  active: false,
  objectKey: '',
  handle: null,
  originalGraphic: null,
})
const rotateState = ref<RotateState>({
  active: false,
  objectKey: '',
  center: { x: 0, y: 0 },
  startAngle: 0,
  originalRotation: 0,
  originalGraphic: null,
})
const groupResizeState = ref<GroupResizeState>({
  active: false,
  handle: null,
  originalBounds: null,
  originalGraphics: {},
})
const groupRotateState = ref<GroupRotateState>({
  active: false,
  center: { x: 0, y: 0 },
  startAngle: 0,
  originalGraphics: {},
})
const panState = ref<PanState>({
  active: false,
  start: { x: 0, y: 0 },
  originOffset: { x: 0, y: 0 },
})
const selectionRect = ref<SelectionRectState>({
  active: false,
  start: { x: 0, y: 0 },
  end: { x: 0, y: 0 },
})

const syncingSelectedStyle = ref(false)
let selectedStyleSyncReleaseTask = 0

const sessionKey = computed(() => String(route.params.sessionKey || ''))
const zoomScale = computed(() => zoomPercent.value / 100)
const currentVersion = computed(() => sessionDetail.value?.currentVersion ?? sessionInfo.value?.currentVersion ?? 0)
const currentSessionName = computed(() => sessionDetail.value?.name ?? sessionInfo.value?.name ?? '未命名会话')
const sortedGraphics = computed(() => [...canvasStore.graphics].sort((a, b) => a.zIndex - b.zIndex))
const selectedGraphics = computed(() => {
  const keySet = new Set(selectedObjectKeys.value)
  if (keySet.size === 0 && selectedObjectKey.value) {
    keySet.add(selectedObjectKey.value)
  }
  if (keySet.size === 0) {
    return [] as GraphicVO[]
  }
  return canvasStore.graphics.filter((item) => keySet.has(item.objectKey))
})
const selectedGraphic = computed(() =>
  selectedObjectKey.value ? canvasStore.graphics.find((item) => item.objectKey === selectedObjectKey.value) ?? null : null,
)
const canDeleteSelected = computed(() => selectedGraphics.value.length > 0)
const selectedLockState = computed<'none' | 'all' | 'mixed'>(() => {
  const list = selectedGraphics.value
  if (list.length === 0) {
    return 'none'
  }
  const lockedCount = list.filter((item) => item.isLocked).length
  if (lockedCount === 0) {
    return 'none'
  }
  if (lockedCount === list.length) {
    return 'all'
  }
  return 'mixed'
})
const selectedLocked = computed(() => {
  return selectedLockState.value === 'all'
})
const canToggleLock = computed(() => selectedGraphics.value.length > 0)
const selectedGraphicsBounds = computed(() => {
  if (selectedGraphics.value.length === 0) {
    return null as { x: number; y: number; width: number; height: number } | null
  }
  const boundsList = selectedGraphics.value.map((item) => getGraphicBounds(item))
  const left = Math.min(...boundsList.map((item) => item.x))
  const top = Math.min(...boundsList.map((item) => item.y))
  const right = Math.max(...boundsList.map((item) => item.x + item.width))
  const bottom = Math.max(...boundsList.map((item) => item.y + item.height))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
})
const multiSelectionRotationDeg = computed(() => {
  if (selectedGraphics.value.length < 2) {
    return 0
  }
  const angles = selectedGraphics.value
    .map((item) => Number.isFinite(item.rotation) ? (item.rotation ?? 0) : 0)
  if (angles.length === 0) {
    return 0
  }
  const sumSin = angles.reduce((acc, item) => acc + Math.sin((item * Math.PI) / 180), 0)
  const sumCos = angles.reduce((acc, item) => acc + Math.cos((item * Math.PI) / 180), 0)
  if (Math.abs(sumSin) < 1e-6 && Math.abs(sumCos) < 1e-6) {
    return 0
  }
  return (Math.atan2(sumSin, sumCos) * 180) / Math.PI
})
const multiSelectionFrame = computed<GroupSelectionFrame | null>(() => {
  if (selectedGraphics.value.length < 2) {
    return null
  }
  const rotationRad = (multiSelectionRotationDeg.value * Math.PI) / 180
  const selectionPoints = selectedGraphics.value.flatMap((graphic) => getSelectionOutlinePoints(graphic))
  if (selectionPoints.length === 0) {
    const fallback = selectedGraphicsBounds.value
    if (!fallback) {
      return null
    }
    return {
      bounds: { ...fallback },
      center: { x: fallback.x + fallback.width / 2, y: fallback.y + fallback.height / 2 },
      rotationRad,
    }
  }

  const coarseCenter = selectionPoints.reduce(
    (acc, item) => ({ x: acc.x + item.x, y: acc.y + item.y }),
    { x: 0, y: 0 },
  )
  coarseCenter.x /= selectionPoints.length
  coarseCenter.y /= selectionPoints.length

  const localPoints = selectionPoints.map((item) => rotatePointAround(item, coarseCenter, -rotationRad))
  const xs = localPoints.map((item) => item.x)
  const ys = localPoints.map((item) => item.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(RESIZE_MIN_SIZE, maxX - minX)
  const height = Math.max(RESIZE_MIN_SIZE, maxY - minY)
  const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const center = rotatePointAround(localCenter, coarseCenter, rotationRad)
  return {
    bounds: {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    },
    center,
    rotationRad,
  }
})
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
  if (selectedGraphics.value.length !== 1) {
    return false
  }
  const selected = selectedGraphic.value
  if (!selected) {
    return false
  }
  return canvasStore.graphics.some((item) => item.zIndex > selected.zIndex)
})
const canSendBackward = computed(() => {
  if (selectedGraphics.value.length !== 1) {
    return false
  }
  const selected = selectedGraphic.value
  if (!selected) {
    return false
  }
  return canvasStore.graphics.some((item) => item.zIndex < selected.zIndex)
})
const canEditFillColor = computed(() => {
  const canFillGraphic = (item: GraphicVO) => {
    if (item.objectType === 'rect' || item.objectType === 'circle') {
      return true
    }
    if (item.objectType !== 'path') {
      return false
    }
    const points = item.pathPoints ?? []
    return points.length >= 3 && isClosedPath(points)
  }
  if (selectedGraphics.value.length > 1) {
    return selectedGraphics.value.some(canFillGraphic)
  }
  const selected = selectedGraphic.value
  if (!selected) {
    return true
  }
  return canFillGraphic(selected)
})
const canEditLineStyle = computed(() => {
  if (selectedGraphics.value.length > 1) {
    return selectedGraphics.value.some((item) => item.objectType !== 'text' && item.objectType !== 'image')
  }
  const selected = selectedGraphic.value
  if (!selected) {
    return true
  }
  return selected.objectType !== 'text' && selected.objectType !== 'image'
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
    selectedObjectKeys.value = value ? [value] : []
    scheduleRender()
  },
)
const showReconnectHint = computed(() => reconnecting.value || reconnectFailed.value)
const myMember = computed(() => {
  if (!sessionDetail.value || !currentUserId.value) {
    return null
  }
  return (
    sessionDetail.value.members.find(
      (item) => item.userId === currentUserId.value && (item.membershipStatus ?? 'active') === 'active',
    ) ?? null
  )
})
const myRole = computed(() => myMember.value?.role ?? (isCreator.value ? 3 : 0))
const canManageMembers = computed(() => myRole.value >= 2)
const canPauseCanvas = computed(() => myRole.value >= 2)
const isPaused = computed(() => sessionDetail.value?.isPaused === true)
const isReadOnly = computed(() => isPaused.value || myRole.value <= 0)
const canManageRoles = computed(() => myRole.value >= 2)
const canRemoveMembers = computed(() => myRole.value >= 2)
const canCreateSnapshot = computed(() => myRole.value >= 1)
const canRestoreSnapshot = computed(() => myRole.value >= 2)
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
const ROTATE_HANDLE_HIT_SIZE = 8
const ROTATE_HANDLE_OFFSET = 28
const PATH_CLOSE_DISTANCE = 12
const TEXT_MIN_FONT_SIZE = 10
const TEXT_MAX_FONT_SIZE = 120
const ARROW_HEAD_BASE = 10
const ARROW_HEAD_MAX = 24
const IMAGE_INSERT_BOX_WIDTH = 240
const IMAGE_INSERT_BOX_HEIGHT = 180
const VIEWPORT_CULL_MARGIN = 160
const CURSOR_SEND_INTERVAL_MS = 80
const CURSOR_SEND_MIN_DISTANCE = 3
const CURSOR_IDLE_KEEPALIVE_MS = 10_000
const REMOTE_CURSOR_STALE_MS = 12_000
const REMOTE_SELECTION_STALE_MS = 45_000
const CANVAS_BACKGROUND_KEY = 'collab_canvas_background_v1'
const canvasBackgroundPresets = ['#ffffff', '#f8fafc', '#f6f7fb', '#fefce8', '#f0fdf4', '#eef2ff', '#fff1f2', '#f5f3ff']
const imageElementCache = new Map<string, HTMLImageElement>()
const imageFallbackLoading = new Set<string>()
const imageObjectUrlBySource = new Map<string, string>()

const getWsUrl = (): string => {
  const baseApi = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
  const origin = baseApi.replace(/\/api\/?$/, '')
  return `${origin.replace(/^http/i, 'ws')}/ws`
}

const getApiOrigin = (): string => {
  const baseApi = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
  return baseApi.replace(/\/api\/?$/, '')
}

const loadImageNaturalSize = async (file: File): Promise<{ width: number; height: number } | null> => {
  const objectUrl = URL.createObjectURL(file)
  try {
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image()
      image.onload = () => {
        const width = Number.isFinite(image.naturalWidth) ? image.naturalWidth : 0
        const height = Number.isFinite(image.naturalHeight) ? image.naturalHeight : 0
        if (width > 0 && height > 0) {
          resolve({ width, height })
          return
        }
        resolve(null)
      }
      image.onerror = () => resolve(null)
      image.src = objectUrl
    })
    return size
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const resolveImageInsertSize = (naturalWidth: number, naturalHeight: number): { width: number; height: number } => {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: IMAGE_INSERT_BOX_WIDTH, height: IMAGE_INSERT_BOX_HEIGHT }
  }
  const scale = Math.min(IMAGE_INSERT_BOX_WIDTH / naturalWidth, IMAGE_INSERT_BOX_HEIGHT / naturalHeight)
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  return { width, height }
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

const nextBatchId = (label = 'batch') => {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const beginWsBatch = (size: number, label?: string) => {
  const safeSize = Math.max(1, Math.floor(size))
  wsBatchMeta.value = {
    id: nextBatchId(label ?? 'batch'),
    size: safeSize,
    cursor: 0,
    ...(label ? { label } : {}),
  }
}

const endWsBatch = () => {
  wsBatchMeta.value = null
}

const consumeWsBatchMeta = () => {
  const batch = wsBatchMeta.value
  if (!batch) {
    return {}
  }
  const index = batch.cursor
  batch.cursor += 1
  return {
    batchId: batch.id,
    batchIndex: index,
    batchSize: batch.size,
    ...(batch.label ? { batchLabel: batch.label } : {}),
  }
}

const markGraphicCreatePending = (objectKey: string) => {
  if (!objectKey) {
    return
  }
  pendingCreateObjectKeys.value.add(objectKey)
}

const clearGraphicCreatePending = (objectKey: string) => {
  if (!objectKey) {
    return
  }
  pendingCreateObjectKeys.value.delete(objectKey)
}

const isGraphicCreatePending = (objectKey: string) => {
  return pendingCreateObjectKeys.value.has(objectKey)
}

const enqueueDeferredObjectOperation = (objectKey: string, operation: DeferredObjectOperation) => {
  if (!objectKey) {
    return
  }
  const queue = deferredObjectOperations.value[objectKey] ?? []
  queue.push(operation)
  deferredObjectOperations.value[objectKey] = queue
}

const popDeferredObjectOperations = (objectKey: string): DeferredObjectOperation[] => {
  const queue = deferredObjectOperations.value[objectKey] ?? []
  if (queue.length === 0) {
    return []
  }
  delete deferredObjectOperations.value[objectKey]
  return queue
}

const clearDeferredObjectOperations = (objectKey: string) => {
  if (!objectKey) {
    return
  }
  delete deferredObjectOperations.value[objectKey]
}

const flushDeferredObjectOperations = (objectKey: string) => {
  if (!objectKey) {
    return
  }
  const queue = popDeferredObjectOperations(objectKey)
  if (queue.length === 0) {
    return
  }
  queue.forEach((operation) => {
    if (operation.type === 'patch') {
      sendUpdateGraphicPatch(objectKey, operation.patch)
      return
    }
    sendDeleteGraphicByObjectKey(objectKey)
  })
}

const recordUndoStep = (count = 1) => {
  const safe = Math.max(1, Math.floor(count))
  undoStepCounts.value = [...undoStepCounts.value, safe]
  redoStepCounts.value = []
}

const beginPatchBatch = () => {
  patchBatchState.value.active = true
  patchBatchState.value.count = 0
}

const endPatchBatch = () => {
  if (!patchBatchState.value.active) {
    return
  }
  const count = patchBatchState.value.count
  patchBatchState.value.active = false
  patchBatchState.value.count = 0
  if (count > 0) {
    recordUndoStep(count)
  }
}

const recordPatchOperation = () => {
  if (patchBatchState.value.active) {
    patchBatchState.value.count += 1
    return
  }
  recordUndoStep(1)
}

const flushStyleCommitPatch = () => {
  const patch = styleCommitPatch.value
  styleCommitPatch.value = {}
  if (Object.keys(patch).length === 0) {
    return
  }
  updateSelectedGraphicStyle(patch)
}

const queueStyleCommitPatch = (
  patch: Partial<Pick<GraphicVO, 'strokeColor' | 'fillColor' | 'strokeWidth' | 'lineStyle'>>,
) => {
  styleCommitPatch.value = {
    ...styleCommitPatch.value,
    ...patch,
  }
  if (styleCommitTimer.value !== null) {
    window.clearTimeout(styleCommitTimer.value)
  }
  styleCommitTimer.value = window.setTimeout(() => {
    styleCommitTimer.value = null
    flushStyleCommitPatch()
  }, 120)
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
  broadcastSelectionPresence(true)
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendHeartbeat()
      broadcastSelectionPresence(true)
      if (lastCursorPoint.value) {
        const nowAt = Date.now()
        if (nowAt - lastCursorSentAt.value >= CURSOR_IDLE_KEEPALIVE_MS) {
          broadcastCursorPresence(lastCursorPoint.value, true)
        }
      }
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

const clearRemoteCursorByUserId = (userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return
  }
  if (!remoteCursors.value[userId]) {
    return
  }
  delete remoteCursors.value[userId]
}

const clearRemoteSelectionByUserId = (userId: number) => {
  if (!Number.isFinite(userId) || userId <= 0) {
    return
  }
  if (!remoteSelections.value[userId]) {
    return
  }
  delete remoteSelections.value[userId]
}

const broadcastCursorPresence = (point: Point, force = false) => {
  // 产品要求：关闭实时鼠标光标追踪，仅保留选中态等协作感知。
  // 这里不再发送 presence_cursor。
  void point
  void force
}

const PRESENCE_COLOR_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#9333ea',
  '#0891b2',
  '#dc2626',
  '#0f766e',
  '#b45309',
  '#be123c',
  '#1d4ed8',
  '#15803d',
  '#c2410c',
]

const presenceColorByUserId = computed(() => {
  const map = new Map<number, string>()
  const members = [...(sessionDetail.value?.members ?? [])]
  const onlineMembers = members
    .filter((item) => item.onlineStatus === 1)
    .sort((a, b) => a.userId - b.userId)
  const offlineMembers = members
    .filter((item) => item.onlineStatus !== 1)
    .sort((a, b) => a.userId - b.userId)
  const ordered = [...onlineMembers, ...offlineMembers]
  ordered.forEach((member, index) => {
    const color = PRESENCE_COLOR_PALETTE[index % PRESENCE_COLOR_PALETTE.length] ?? '#2563eb'
    map.set(member.userId, color)
  })
  return map
})

const getPresenceColorByUserId = (userId: number) => {
  const mapped = presenceColorByUserId.value.get(userId)
  if (mapped) {
    return mapped
  }
  const index = Math.abs(Math.floor(userId)) % PRESENCE_COLOR_PALETTE.length
  return PRESENCE_COLOR_PALETTE[index] ?? '#2563eb'
}

const normalizeSelectionKeys = (value: string[]) => {
  return Array.from(new Set(value.map((item) => item.trim()).filter((item) => item.length > 0)))
}

const broadcastSelectionPresence = (force = false) => {
  if (!wsClient || !joined.value || !sessionKey.value || !wsConnected.value) {
    return
  }
  const objectKeys = normalizeSelectionKeys(selectedObjectKeys.value)
  const objectKey = selectedObjectKey.value && selectedObjectKey.value.trim().length > 0
    ? selectedObjectKey.value
    : (objectKeys[0] ?? null)
  const signature = `${objectKey ?? ''}|${[...objectKeys].sort().join('|')}`
  if (!force && signature === lastSelectionBroadcastSignature.value) {
    return
  }
  wsClient.sendSelectionChange({
    sessionKey: sessionKey.value,
    objectKey,
    objectKeys,
  })
  lastSelectionBroadcastSignature.value = signature
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

const rotatePoint = (point: Point, center: Point, angleRad: number): Point => {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

const almostSamePoint = (a: Point, b: Point, epsilon = 1): boolean => {
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsilon
}

const isArrowPathGraphic = (graphic: GraphicVO): boolean => {
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

const getArrowEndpoints = (graphic: GraphicVO): { start: Point; end: Point } | null => {
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

const isLineLikeGraphic = (graphic: GraphicVO): boolean => {
  return graphic.objectType === 'line' || isArrowPathGraphic(graphic)
}

const getRotatedRectBounds = (x: number, y: number, width: number, height: number, rotationDeg: number) => {
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

const getGraphicBounds = (graphic: GraphicVO) => {
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

const getGraphicCenter = (graphic: GraphicVO): Point => {
  if (graphic.objectType === 'circle') {
    return { x: graphic.positionX, y: graphic.positionY }
  }
  if (graphic.objectType === 'path' && !isArrowPathGraphic(graphic)) {
    const outline = getPathSelectionOutlinePoints(graphic)
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

const getLocalResizeBounds = (graphic: GraphicVO) => {
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

const getSelectionOutlinePoints = (graphic: GraphicVO): Point[] => {
  if (graphic.objectType === 'path' && !isArrowPathGraphic(graphic)) {
    return getPathSelectionOutlinePoints(graphic)
  }
  const local = getLocalResizeBounds(graphic)
  const center = getGraphicCenter(graphic)
  const rotation = getGraphicSelectionRotationRad(graphic)
  const corners: Point[] = [
    { x: local.x, y: local.y },
    { x: local.x + local.width, y: local.y },
    { x: local.x + local.width, y: local.y + local.height },
    { x: local.x, y: local.y + local.height },
  ]
  if (!rotation) {
    return corners
  }
  return corners.map((p) => rotatePointAround(p, center, rotation))
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

const pointInPolygon = (point: Point, polygon: Point[]): boolean => {
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

const buildRegularPolygonPathPoints = (
  center: Point,
  radiusX: number,
  radiusY: number,
  vertexCount: number,
): Point[] => {
  if (vertexCount < 3) {
    return []
  }
  const points: Point[] = []
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

const normalizeCircleDraftRect = (start: Point, end: Point) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  const width = dx >= 0 ? size : -size
  const height = dy >= 0 ? size : -size
  return normalizeRect(start.x, start.y, width, height)
}

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

const estimatePathRotationRad = (points: Point[]): number => {
  if (points.length < 2) {
    return 0
  }
  const normalized = [...points]
  if (normalized.length >= 3) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= PATH_CLOSE_DISTANCE) {
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

const shouldUseEstimatedPathRotation = (graphic: GraphicVO): boolean => {
  const points = graphic.pathPoints ?? []
  if (points.length < 4) {
    return false
  }
  if (!isClosedPath(points)) {
    return false
  }
  const normalized = [...points]
  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= PATH_CLOSE_DISTANCE) {
    normalized.pop()
  }
  // 仅对规则多边形这类顶点较少的闭合 path 使用估算角度；
  // 自由画笔等复杂路径默认按轴向框选与拉伸，方向更符合预期。
  return normalized.length >= 3 && normalized.length <= 8
}

const getGraphicSelectionRotationRad = (graphic: GraphicVO): number => {
  if (isLineLikeGraphic(graphic)) {
    return 0
  }
  const explicit = ((graphic.rotation ?? 0) * Math.PI) / 180
  if (graphic.objectType !== 'path') {
    return explicit
  }
  // path 在用户发生旋转后会同步写入 rotation，优先使用显式角度可避免
  // 拉伸过程中对 pathPoints 重新估算角度导致手柄跳变。
  if (Math.abs(explicit) > 1e-6) {
    return explicit
  }
  if (!shouldUseEstimatedPathRotation(graphic)) {
    return 0
  }
  return estimatePathRotationRad(graphic.pathPoints ?? [])
}

const rotatePointByAngle = (point: Point, angle: number): Point => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

const getPathSelectionOutlinePoints = (graphic: GraphicVO): Point[] => {
  const points = graphic.pathPoints ?? []
  if (points.length < 2) {
    return []
  }
  const normalized = [...points]
  if (normalized.length >= 3) {
    const first = normalized[0]
    const last = normalized[normalized.length - 1]
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= PATH_CLOSE_DISTANCE) {
      normalized.pop()
    }
  }
  if (normalized.length < 2) {
    return []
  }

  const rotation = getGraphicSelectionRotationRad(graphic)
  const localPoints = normalized.map((point) => rotatePointByAngle(point, -rotation))
  const xs = localPoints.map((p) => p.x)
  const ys = localPoints.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  // 给 path 选框增加留白，保证多边形顶点落在框内而非贴边/越界。
  const padding = Math.max(3, graphic.strokeWidth / 2 + 1)
  const localCorners: Point[] = [
    { x: minX - padding, y: minY - padding },
    { x: maxX + padding, y: minY - padding },
    { x: maxX + padding, y: maxY + padding },
    { x: minX - padding, y: maxY + padding },
  ]
  return localCorners.map((corner) => rotatePointByAngle(corner, rotation))
}

const pointInGraphic = (point: Point, graphic: GraphicVO): boolean => {
  if (graphic.objectType === 'image') {
    const bounds = getGraphicBounds(graphic)
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    )
  }

  if (graphic.objectType === 'path') {
    const arrowEndpoints = getArrowEndpoints(graphic)
    if (arrowEndpoints) {
      const hitDistance = Math.max(6, graphic.strokeWidth + 4)
      return pointToSegmentDistance(point, arrowEndpoints.start, arrowEndpoints.end) <= hitDistance
    }
    const points = graphic.pathPoints ?? []
    if (points.length < 2) {
      return false
    }
    if (isClosedPath(points) && pointInPolygon(point, points)) {
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
    // 先做一次粗粒度包围盒过滤，减少复杂命中计算次数。
    const bounds = getGraphicBounds(graphic)
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
  if (isArrowPathGraphic(graphic)) {
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

    // Arrow shaft follows selected line style (solid/dashed).
    ctx.setLineDash(graphic.lineStyle === 'dashed' ? [8, 6] : [])
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // Arrow head should stay solid for clear direction indication.
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
  if (isClosedPath(points)) {
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
      scheduleRender()
    }
    image.onerror = () => {
      imageElementCache.delete(src)
      if (!imageFallbackLoading.has(src)) {
        imageFallbackLoading.add(src)
        fetch(src, {
          credentials: 'include',
          headers: (() => {
            const token = storage.getToken()
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
              scheduleRender()
            }
            fallbackImage.onerror = () => {
              scheduleRender()
            }
            fallbackImage.src = objectUrl
          })
          .catch(() => {
            scheduleRender()
          })
          .finally(() => {
            imageFallbackLoading.delete(src)
          })
      } else {
        scheduleRender()
      }
    }
    image.src = src
    imageElementCache.set(src, image)
  }

  withRotation(() => {
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

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  viewLeft: number,
  viewTop: number,
  viewRight: number,
  viewBottom: number,
  backgroundHex: string,
) => {
  const gap = 24
  ctx.save()
  ctx.strokeStyle = getGridColorForBackground(backgroundHex)
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

const SELECTION_TAG_HEIGHT = 18
const SELECTION_TAG_GAP = 4
const SELECTION_TAG_STACK_GAP = 4

const resolveTagTopY = (boundsY: number, index = 0) => {
  const stackedTop = boundsY - SELECTION_TAG_GAP - SELECTION_TAG_HEIGHT - index * (SELECTION_TAG_HEIGHT + SELECTION_TAG_STACK_GAP)
  if (stackedTop >= 4) {
    return stackedTop
  }
  return boundsY + 6 + index * (SELECTION_TAG_HEIGHT + 2)
}

const getTopEdgeLabelAnchors = (outline: Point[], fallback: { x: number; y: number; width: number; height: number }) => {
  if (outline.length < 2) {
    return {
      topY: fallback.y,
      leftX: fallback.x,
      rightX: fallback.x + fallback.width,
    }
  }
  const sorted = [...outline].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    return a.x - b.x
  })
  const p1 = sorted[0]
  const p2 = sorted[1]
  if (!p1 || !p2) {
    return {
      topY: fallback.y,
      leftX: fallback.x,
      rightX: fallback.x + fallback.width,
    }
  }
  return {
    topY: Math.min(p1.y, p2.y),
    leftX: Math.min(p1.x, p2.x),
    rightX: Math.max(p1.x, p2.x),
  }
}

const getCircleTagAnchors = (graphic: GraphicVO, fallback: { x: number; y: number; width: number; height: number }) => {
  const radiusX = Math.max(1, Math.abs(graphic.width ?? 0) / 2)
  const radiusY = Math.max(1, Math.abs(graphic.height ?? 0) / 2)
  const centerX = graphic.positionX
  const centerY = graphic.positionY
  const rotation = ((graphic.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const samples: Point[] = []
  const total = 96
  for (let i = 0; i < total; i += 1) {
    const t = (i / total) * Math.PI * 2
    const localX = radiusX * Math.cos(t)
    const localY = radiusY * Math.sin(t)
    samples.push({
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    })
  }
  if (samples.length === 0) {
    return { topY: fallback.y, leftX: fallback.x, rightX: fallback.x + fallback.width }
  }
  const topY = Math.min(...samples.map((p) => p.y))
  const band = samples.filter((p) => p.y <= topY + 2.5)
  if (band.length === 0) {
    return { topY, leftX: centerX - radiusX, rightX: centerX + radiusX }
  }
  return {
    topY,
    leftX: Math.min(...band.map((p) => p.x)),
    rightX: Math.max(...band.map((p) => p.x)),
  }
}

const getGraphicTagAnchors = (graphic: GraphicVO, bounds: { x: number; y: number; width: number; height: number }, outline: Point[]) => {
  if (graphic.objectType === 'circle') {
    return getCircleTagAnchors(graphic, bounds)
  }
  return getTopEdgeLabelAnchors(outline, bounds)
}

const drawSelection = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const bounds = getGraphicBounds(graphic)
  const outline = getSelectionOutlinePoints(graphic)
  const tagAnchor = getGraphicTagAnchors(graphic, bounds, outline)
  const isFocused = focusedObjectKey.value === graphic.objectKey
  const conflictFocus = conflictFocusMap.value[graphic.objectKey]
  const isConflictFocused = !!conflictFocus
  ctx.save()
  ctx.strokeStyle = isConflictFocused ? '#ef4444' : isFocused ? '#f59e0b' : '#1890ff'
  ctx.lineWidth = isConflictFocused ? 3 : isFocused ? 2 : 1
  ctx.setLineDash(isFocused || isConflictFocused ? [] : [4, 4])
  if (outline.length >= 4) {
    const first = outline[0]
    if (!first) {
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
      ctx.setLineDash([])
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < outline.length; i += 1) {
      const p = outline[i]
      if (!p) continue
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.stroke()
  } else {
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  }
  ctx.setLineDash([])
  const resizeHandles = getResizeHandlePoints(graphic)
  if (!graphic.isLocked) {
    const arrowEndpoints = getArrowEndpoints(graphic)
    const handles: Point[] =
      graphic.objectType === 'line' || !!arrowEndpoints
        ? [
            arrowEndpoints ? arrowEndpoints.start : { x: graphic.positionX, y: graphic.positionY },
            arrowEndpoints ? arrowEndpoints.end : { x: graphic.positionX + (graphic.width ?? 0), y: graphic.positionY + (graphic.height ?? 0) },
          ]
        : graphic.objectType === 'text'
        ? [resizeHandles.se]
        : [
            resizeHandles.nw,
            resizeHandles.n,
            resizeHandles.ne,
            resizeHandles.w,
            resizeHandles.e,
            resizeHandles.sw,
            resizeHandles.s,
            resizeHandles.se,
          ]
    ctx.fillStyle = isConflictFocused ? '#ef4444' : isFocused ? '#f59e0b' : '#1890ff'
    handles.forEach((point) => {
      ctx.fillRect(point.x - 3, point.y - 3, 6, 6)
    })
    if (
      graphic.objectType === 'line' ||
      graphic.objectType === 'rect' ||
      graphic.objectType === 'circle' ||
      graphic.objectType === 'text' ||
      graphic.objectType === 'image' ||
      graphic.objectType === 'path'
    ) {
      const rotateHandle = getRotateHandlePoint(graphic)
      const rotateAnchor = resizeHandles.n
      ctx.beginPath()
      ctx.moveTo(rotateAnchor.x, rotateAnchor.y)
      ctx.lineTo(rotateHandle.x, rotateHandle.y)
      ctx.strokeStyle = ctx.fillStyle as string
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(rotateHandle.x, rotateHandle.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (graphic.isLocked) {
    const text = '已锁定'
    ctx.font = '12px sans-serif'
    const textWidth = ctx.measureText(text).width
    const labelX = tagAnchor.rightX - textWidth - 12
    const labelY = resolveTagTopY(tagAnchor.topY)
    ctx.fillStyle = '#111827'
    ctx.globalAlpha = 0.8
    ctx.fillRect(labelX - 6, labelY, textWidth + 10, SELECTION_TAG_HEIGHT)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.fillText(text, labelX, labelY + 13)
  }

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

const drawSelectionOutlineOnly = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  const bounds = getGraphicBounds(graphic)
  const outline = getSelectionOutlinePoints(graphic)
  ctx.save()
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  if (outline.length >= 4) {
    const first = outline[0]
    if (!first) {
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < outline.length; i += 1) {
      const p = outline[i]
      if (!p) continue
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.stroke()
  } else {
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  }
  ctx.restore()
}

const drawMultiSelectionBounds = (ctx: CanvasRenderingContext2D, lightweight = false) => {
  const frame = multiSelectionFrame.value
  if (!frame || selectedGraphics.value.length < 2) {
    return
  }
  const { bounds, center, rotationRad: rotation } = frame
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => rotatePointAround(point, center, rotation))
  const handles = getBoundsResizeHandles(bounds, rotation)
  const topMid = handles.n
  const rotate = {
    x: topMid.x + ((topMid.x - center.x) / (Math.hypot(topMid.x - center.x, topMid.y - center.y) || 1)) * ROTATE_HANDLE_OFFSET,
    y: topMid.y + ((topMid.y - center.y) / (Math.hypot(topMid.x - center.x, topMid.y - center.y) || 1)) * ROTATE_HANDLE_OFFSET,
  }
  ctx.save()
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  const first = corners[0]
  if (!first) {
    ctx.restore()
    return
  }
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < corners.length; i += 1) {
    const next = corners[i]
    if (next) {
      ctx.lineTo(next.x, next.y)
    }
  }
  ctx.closePath()
  ctx.stroke()
  if (lightweight) {
    ctx.restore()
    return
  }
  ctx.setLineDash([])
  ctx.fillStyle = '#2563eb'
  ;(
    [
      handles.nw,
      handles.n,
      handles.ne,
      handles.w,
      handles.e,
      handles.sw,
      handles.s,
      handles.se,
    ] as Point[]
  ).forEach((p) => ctx.fillRect(p.x - 3, p.y - 3, 6, 6))
  ctx.beginPath()
  ctx.moveTo(topMid.x, topMid.y)
  ctx.lineTo(rotate.x, rotate.y)
  ctx.strokeStyle = '#2563eb'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(rotate.x, rotate.y, 4, 0, Math.PI * 2)
  ctx.fill()

  const lockText = selectedLockState.value === 'all' ? '已锁定' : selectedLockState.value === 'mixed' ? '部分锁定' : ''
  if (lockText) {
    const tagAnchor = getTopEdgeLabelAnchors(corners, bounds)
    ctx.font = '12px sans-serif'
    const textWidth = ctx.measureText(lockText).width
    const labelX = tagAnchor.rightX - textWidth - 12
    const labelY = resolveTagTopY(tagAnchor.topY)
    ctx.fillStyle = '#111827'
    ctx.globalAlpha = 0.8
    ctx.fillRect(labelX - 6, labelY, textWidth + 10, SELECTION_TAG_HEIGHT)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.fillText(lockText, labelX, labelY + 13)
  }
  ctx.restore()
}

const drawSelectionRectOverlay = (ctx: CanvasRenderingContext2D) => {
  if (!selectionRect.value.active) {
    return
  }
  const rect = normalizeRect(
    selectionRect.value.start.x,
    selectionRect.value.start.y,
    selectionRect.value.end.x - selectionRect.value.start.x,
    selectionRect.value.end.y - selectionRect.value.start.y,
  )
  if (rect.width < 1 || rect.height < 1) {
    return
  }
  ctx.save()
  ctx.fillStyle = 'rgba(24, 144, 255, 0.08)'
  ctx.strokeStyle = '#1890ff'
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

const isPointInRect = (point: Point, rect: { x: number; y: number; width: number; height: number }) => {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

const isPointInRotatedRect = (
  point: Point,
  rect: { x: number; y: number; width: number; height: number },
  rotationRad: number,
) => {
  if (!rotationRad) {
    return isPointInRect(point, rect)
  }
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const local = rotatePointAround(point, center, -rotationRad)
  return isPointInRect(local, rect)
}

const getRectIntersectionArea = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => {
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

const getResizeHandlePoints = (graphic: GraphicVO): Record<ResizeHandleKey, Point> => {
  if (graphic.objectType === 'path' && !isArrowPathGraphic(graphic)) {
    const outline = getPathSelectionOutlinePoints(graphic)
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
  const local = getLocalResizeBounds(graphic)
  const rotation = getGraphicSelectionRotationRad(graphic)
  const center = getGraphicCenter(graphic)
  const localHandles: Record<ResizeHandleKey, Point> = {
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

const getRotateHandlePoint = (graphic: GraphicVO): Point => {
  const handles = getResizeHandlePoints(graphic)
  const center = getGraphicCenter(graphic)
  const north = handles.n
  const vx = north.x - center.x
  const vy = north.y - center.y
  const len = Math.hypot(vx, vy) || 1
  return {
    x: north.x + (vx / len) * ROTATE_HANDLE_OFFSET,
    y: north.y + (vy / len) * ROTATE_HANDLE_OFFSET,
  }
}

const hitRotateHandle = (point: Point, graphic: GraphicVO): boolean => {
  const rotatePoint = getRotateHandlePoint(graphic)
  return (
    Math.abs(point.x - rotatePoint.x) <= ROTATE_HANDLE_HIT_SIZE &&
    Math.abs(point.y - rotatePoint.y) <= ROTATE_HANDLE_HIT_SIZE
  )
}

const getBoundsResizeHandles = (
  bounds: { x: number; y: number; width: number; height: number },
  rotationRad = 0,
): Record<ResizeHandleKey, Point> => {
  const local: Record<ResizeHandleKey, Point> = {
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
  point: Point,
  bounds: { x: number; y: number; width: number; height: number },
  rotationRad = 0,
): ResizeHandleKey | null => {
  const handles = getBoundsResizeHandles(bounds, rotationRad)
  for (const key of Object.keys(handles) as ResizeHandleKey[]) {
    const handle = handles[key]
    if (Math.abs(point.x - handle.x) <= RESIZE_HANDLE_HIT_SIZE && Math.abs(point.y - handle.y) <= RESIZE_HANDLE_HIT_SIZE) {
      return key
    }
  }
  return null
}

const hitRotateHandleByBounds = (
  point: Point,
  bounds: { x: number; y: number; width: number; height: number },
  rotationRad = 0,
) => {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const handles = getBoundsResizeHandles(bounds, rotationRad)
  const topMid = handles.n
  const vx = topMid.x - center.x
  const vy = topMid.y - center.y
  const len = Math.hypot(vx, vy) || 1
  const rotate = {
    x: topMid.x + (vx / len) * ROTATE_HANDLE_OFFSET,
    y: topMid.y + (vy / len) * ROTATE_HANDLE_OFFSET,
  }
  return Math.abs(point.x - rotate.x) <= ROTATE_HANDLE_HIT_SIZE && Math.abs(point.y - rotate.y) <= ROTATE_HANDLE_HIT_SIZE
}

const hitResizeHandle = (point: Point, graphic: GraphicVO): ResizeHandleKey | null => {
  const arrowEndpoints = getArrowEndpoints(graphic)
  if (arrowEndpoints) {
    const startHit =
      Math.abs(point.x - arrowEndpoints.start.x) <= RESIZE_HANDLE_HIT_SIZE &&
      Math.abs(point.y - arrowEndpoints.start.y) <= RESIZE_HANDLE_HIT_SIZE
    const endHit =
      Math.abs(point.x - arrowEndpoints.end.x) <= RESIZE_HANDLE_HIT_SIZE &&
      Math.abs(point.y - arrowEndpoints.end.y) <= RESIZE_HANDLE_HIT_SIZE
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
      Math.abs(point.x - start.x) <= RESIZE_HANDLE_HIT_SIZE && Math.abs(point.y - start.y) <= RESIZE_HANDLE_HIT_SIZE
    const endHit =
      Math.abs(point.x - end.x) <= RESIZE_HANDLE_HIT_SIZE && Math.abs(point.y - end.y) <= RESIZE_HANDLE_HIT_SIZE
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

const resizeBoundsByHandle = (
  bounds: { x: number; y: number; width: number; height: number },
  handle: ResizeHandleKey,
  moving: Point,
) => {
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
    width: Math.max(RESIZE_MIN_SIZE, normalized.width),
    height: Math.max(RESIZE_MIN_SIZE, normalized.height),
  }
}

const applyTransformToGraphic = (
  original: GraphicVO,
  sourceBounds: { x: number; y: number; width: number; height: number },
  targetBounds: { x: number; y: number; width: number; height: number },
): GraphicVO => {
  const sx = sourceBounds.width === 0 ? 1 : targetBounds.width / sourceBounds.width
  const sy = sourceBounds.height === 0 ? 1 : targetBounds.height / sourceBounds.height
  const graphicBounds = getGraphicBounds(original)
  const originalCenter = getGraphicCenter(original)
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
      fontSize: Math.max(TEXT_MIN_FONT_SIZE, Math.min(TEXT_MAX_FONT_SIZE, Math.round((original.fontSize ?? 16) * fontScale))),
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

const rotatePointAround = (point: Point, center: Point, angle: number): Point => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

const applyRotateToGraphic = (original: GraphicVO, center: Point, deltaAngle: number): GraphicVO => {
  const arrowEndpoints = getArrowEndpoints(original)
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
      pathPoints: buildArrowPathPoints(nextStart, nextEnd, original.strokeWidth),
    }
  }
  const originalCenter = getGraphicCenter(original)
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

const rotateGraphicAround = (graphic: GraphicVO, center: Point, targetRotationDeg: number): GraphicVO => {
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

const updateGraphicByResize = (
  graphic: GraphicVO,
  handle: ResizeHandleKey,
  moving: Point,
  sourceGraphic?: GraphicVO | null,
): GraphicVO => {
  const base = sourceGraphic ?? graphic
  const baseArrowEndpoints = getArrowEndpoints(base)
  if (baseArrowEndpoints) {
    const dragStart = handle === 'nw'
    const nextStart = dragStart ? moving : baseArrowEndpoints.start
    const nextEnd = dragStart ? baseArrowEndpoints.end : moving
    const nextPathPoints = buildArrowPathPoints(nextStart, nextEnd, base.strokeWidth)
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
  const localBounds = getLocalResizeBounds(base)
  const center = getGraphicCenter(base)
  const rotation = getGraphicSelectionRotationRad(base)
  const toLocal = (p: Point) => (rotation ? rotatePointAround(p, center, -rotation) : p)
  const toWorld = (p: Point) => (rotation ? rotatePointAround(p, center, rotation) : p)
  const movingLocal = toLocal(moving)
  const bounds = localBounds
  const anchor: Point = (() => {
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
    const targetBounds = resizeBoundsByHandle(bounds, handle, movingLocal)
    if (!rotation) {
      return applyTransformToGraphic(base, bounds, targetBounds)
    }
    const sx = bounds.width === 0 ? 1 : targetBounds.width / bounds.width
    const sy = bounds.height === 0 ? 1 : targetBounds.height / bounds.height
    const basePathPoints = base.pathPoints ?? []
    const localPathPoints = basePathPoints.map((point) => rotatePointAround(point, center, -rotation))
    const nextLocalPathPoints = localPathPoints.map((point) => ({
      x: targetBounds.x + (point.x - bounds.x) * sx,
      y: targetBounds.y + (point.y - bounds.y) * sy,
    }))
    const nextPathPoints = nextLocalPathPoints.map((point) => rotatePointAround(point, center, rotation))
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
      TEXT_MIN_FONT_SIZE,
      Math.min(TEXT_MAX_FONT_SIZE, Math.round((base.fontSize ?? 16) * ratio)),
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

const updateSelectedGraphicStyle = (
  patch: Partial<Pick<GraphicVO, 'strokeColor' | 'fillColor' | 'strokeWidth' | 'lineStyle'>>,
) => {
  if (isReadOnly.value) {
    return
  }
  if (selectedGraphics.value.length === 0) {
    return
  }
  beginPatchBatch()
  beginWsBatch(selectedGraphics.value.length, 'multi_style')
  try {
    selectedGraphics.value.forEach((selected) => {
      const index = canvasStore.graphics.findIndex((item) => item.objectKey === selected.objectKey)
      if (index === -1) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current || current.isLocked) {
        return
      }
      const nextGraphic: GraphicVO = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      if (nextGraphic.objectType === 'image') {
        nextGraphic.strokeColor = current.strokeColor
        nextGraphic.fillColor = current.fillColor
        nextGraphic.strokeWidth = current.strokeWidth
        nextGraphic.lineStyle = current.lineStyle
      }
      canvasStore.graphics[index] = nextGraphic
      sendUpdateGraphicPatch(nextGraphic.objectKey, {
        ...(typeof patch.strokeColor === 'string' ? { strokeColor: patch.strokeColor } : {}),
        ...(typeof patch.fillColor !== 'undefined' ? { fillColor: patch.fillColor } : {}),
        ...(typeof patch.strokeWidth === 'number' ? { strokeWidth: patch.strokeWidth } : {}),
        ...(patch.lineStyle === 'solid' || patch.lineStyle === 'dashed' ? { lineStyle: patch.lineStyle } : {}),
      })
    })
  } finally {
    endWsBatch()
    endPatchBatch()
  }
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
      lineStyle: lineStyle.value,
      fillColor: null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: null,
      isLocked: false,
      rotation: 0,
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
      lineStyle: lineStyle.value,
      fillColor: null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: points,
      isLocked: false,
      rotation: 0,
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
      lineStyle: lineStyle.value,
      fillColor: fillColor.value === 'transparent' ? null : fillColor.value,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: null,
      isLocked: false,
      rotation: 0,
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
      lineStyle: lineStyle.value,
      fillColor: isClosedPath(points) ? fillColor.value === 'transparent' ? null : fillColor.value : null,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints: points.map((item) => ({ x: item.x, y: item.y })),
      isLocked: false,
      rotation: 0,
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  if (activeTool.value === 'shape') {
    const normalized = normalizeRect(start.x, start.y, width, height)
    const radiusX = Math.max(1, normalized.width / 2)
    const radiusY = Math.max(1, normalized.height / 2)
    const center = {
      x: normalized.x + radiusX,
      y: normalized.y + radiusY,
    }
    const pathPoints = buildRegularPolygonPathPoints(center, radiusX, radiusY, getShapeVertexCount(shapeType.value))
    if (pathPoints.length < 4) {
      return null
    }
    return {
      id: -1,
      sessionId: sessionInfo.value?.sessionId ?? 0,
      objectKey: '__preview__',
      objectType: 'path',
      positionX: normalized.x,
      positionY: normalized.y,
      width: normalized.width,
      height: normalized.height,
      strokeColor: strokeColor.value,
      lineStyle: lineStyle.value,
      fillColor: fillColor.value === 'transparent' ? null : fillColor.value,
      strokeWidth: strokeWidth.value,
      textContent: null,
      fontSize: null,
      pathPoints,
      isLocked: false,
      rotation: 0,
      zIndex: 0,
      version: 0,
      creatorId: currentUserId.value ?? 0,
      createdAt: '',
      updatedAt: '',
    }
  }

  const normalized = activeTool.value === 'circle'
    ? normalizeCircleDraftRect(start, end)
    : normalizeRect(start.x, start.y, width, height)
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
    lineStyle: lineStyle.value,
    fillColor: fillColor.value === 'transparent' ? null : fillColor.value,
    strokeWidth: strokeWidth.value,
    textContent: null,
    fontSize: null,
    pathPoints: null,
    isLocked: false,
    rotation: 0,
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

const drawRemoteCursors = (ctx: CanvasRenderingContext2D) => {
  const now = Date.now()
  const list = Object.values(remoteCursors.value).filter((item) => {
    return now - item.updatedAt <= REMOTE_CURSOR_STALE_MS
  })
  if (list.length === 0) {
    return
  }
  ctx.save()
  list.forEach((cursor) => {
    ctx.save()
    const x = cursor.x
    const y = cursor.y
    ctx.fillStyle = '#2563eb'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 10, y + 4)
    ctx.lineTo(x + 4, y + 10)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const label = cursor.username || `用户#${cursor.userId}`
    ctx.font = '12px sans-serif'
    const textWidth = ctx.measureText(label).width
    const padX = 6
    const padY = 4
    const labelX = x + 12
    const labelY = y - 18
    ctx.fillStyle = 'rgba(17, 24, 39, 0.9)'
    ctx.fillRect(labelX, labelY, textWidth + padX * 2, 18)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, labelX + padX, labelY + 13)
    ctx.restore()
  })
  ctx.restore()
}

const drawRemoteSelections = (ctx: CanvasRenderingContext2D) => {
  const now = Date.now()
  const validStates = Object.values(remoteSelections.value).filter((item) => now - item.updatedAt <= REMOTE_SELECTION_STALE_MS)
  if (validStates.length === 0) {
    return
  }

  const ownersByObjectKey = new Map<string, RemoteSelectionState[]>()
  const ownersBySelectionGroup = new Map<string, { objectKeys: string[]; owners: RemoteSelectionState[] }>()
  validStates.forEach((state) => {
    const keys = normalizeSelectionKeys(state.objectKeys)
    if (keys.length > 1) {
      const signature = [...keys].sort().join('|')
      const entry = ownersBySelectionGroup.get(signature)
      if (entry) {
        entry.owners.push(state)
      } else {
        ownersBySelectionGroup.set(signature, { objectKeys: keys, owners: [state] })
      }
      return
    }
    keys.forEach((key) => {
      const queue = ownersByObjectKey.get(key) ?? []
      queue.push(state)
      ownersByObjectKey.set(key, queue)
    })
  })

  ctx.save()
  ownersBySelectionGroup.forEach((group) => {
    const groupGraphics = group.objectKeys
      .map((key) => canvasStore.graphics.find((item) => item.objectKey === key))
      .filter((item): item is GraphicVO => !!item)
    if (groupGraphics.length === 0) {
      return
    }
    const boundsList = groupGraphics.map((graphic) => getGraphicBounds(graphic))
    const left = Math.min(...boundsList.map((item) => item.x))
    const top = Math.min(...boundsList.map((item) => item.y))
    const right = Math.max(...boundsList.map((item) => item.x + item.width))
    const bottom = Math.max(...boundsList.map((item) => item.y + item.height))
    const groupBounds = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }

    const firstOwner = group.owners[0]
    const strokeColor = firstOwner ? getPresenceColorByUserId(firstOwner.userId) : '#2563eb'
    const labelText = firstOwner ? (firstOwner.username || `用户#${firstOwner.userId}`) : '协作中'

    ctx.save()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 3])
    ctx.strokeRect(groupBounds.x, groupBounds.y, groupBounds.width, groupBounds.height)
    ctx.setLineDash([])

    ctx.font = '12px sans-serif'
    const textWidth = ctx.measureText(labelText).width
    const padX = 6
    const centerX = groupBounds.x + groupBounds.width / 2
    const labelX = centerX - (textWidth + padX * 2) / 2
    const labelY = resolveTagTopY(groupBounds.y, 0)
    ctx.fillStyle = strokeColor
    ctx.fillRect(labelX, labelY, textWidth + padX * 2, SELECTION_TAG_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(labelText, labelX + padX, labelY + 13)
    ctx.restore()
  })

  ownersByObjectKey.forEach((owners, objectKey) => {
    const graphic = canvasStore.graphics.find((item) => item.objectKey === objectKey)
    if (!graphic) {
      return
    }
    const bounds = getGraphicBounds(graphic)
    const outline = getSelectionOutlinePoints(graphic)
    const tagAnchor = getGraphicTagAnchors(graphic, bounds, outline)

    const firstOwner = owners[0]
    const strokeColor = firstOwner ? getPresenceColorByUserId(firstOwner.userId) : '#2563eb'
    ctx.save()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 3])
    if (outline.length >= 4) {
      const first = outline[0]
      if (first) {
        ctx.beginPath()
        ctx.moveTo(first.x, first.y)
        for (let i = 1; i < outline.length; i += 1) {
          const p = outline[i]
          if (!p) continue
          ctx.lineTo(p.x, p.y)
        }
        ctx.closePath()
        ctx.stroke()
      }
    } else {
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
    }
    ctx.setLineDash([])

    owners.forEach((owner, index) => {
      const label = owner.username || `用户#${owner.userId}`
      ctx.font = '12px sans-serif'
      const textWidth = ctx.measureText(label).width
      const padX = 6
      const labelX = (tagAnchor.leftX + tagAnchor.rightX) / 2 - (textWidth + padX * 2) / 2
      const labelY = resolveTagTopY(tagAnchor.topY, index)
      const bg = getPresenceColorByUserId(owner.userId)
      ctx.fillStyle = bg
      ctx.fillRect(labelX, labelY, textWidth + padX * 2, SELECTION_TAG_HEIGHT)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, labelX + padX, labelY + 13)
    })
    ctx.restore()
  })
  ctx.restore()
}

const hasActiveCanvasInteraction = (): boolean => {
  return (
    panState.value.active ||
    groupRotateState.value.active ||
    groupResizeState.value.active ||
    rotateState.value.active ||
    resizeState.value.active ||
    dragMove.value.active ||
    multiDrag.value.active ||
    selectionRect.value.active ||
    draft.value.active
  )
}

const intersectsViewport = (
  bounds: { x: number; y: number; width: number; height: number },
  view: { left: number; top: number; right: number; bottom: number },
  margin = VIEWPORT_CULL_MARGIN,
): boolean => {
  const left = bounds.x - margin
  const top = bounds.y - margin
  const right = bounds.x + bounds.width + margin
  const bottom = bounds.y + bounds.height + margin
  if (right < view.left || left > view.right) {
    return false
  }
  if (bottom < view.top || top > view.bottom) {
    return false
  }
  return true
}

const renderCanvas = () => {
  const canvas = canvasRef.value
  const ctx = getCtx()
  if (!canvas || !ctx) {
    return
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = canvasBackgroundColor.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(zoomScale.value, zoomScale.value)
  ctx.translate(viewportOffset.value.x, viewportOffset.value.y)

  const worldWidth = canvas.width / zoomScale.value
  const worldHeight = canvas.height / zoomScale.value
  const viewLeft = -viewportOffset.value.x
  const viewTop = -viewportOffset.value.y
  const viewRight = viewLeft + worldWidth
  const viewBottom = viewTop + worldHeight
  const viewport = {
    left: viewLeft,
    top: viewTop,
    right: viewRight,
    bottom: viewBottom,
  }

  if (showGrid.value) {
    drawGrid(ctx, viewLeft, viewTop, viewRight, viewBottom, canvasBackgroundColor.value)
  }
  const interacting = pointerPressed.value && hasActiveCanvasInteraction()
  const visibleGraphics = sortedGraphics.value.filter((graphic) => {
    return intersectsViewport(getGraphicBounds(graphic), viewport)
  })
  visibleGraphics.forEach((graphic) => drawGraphic(ctx, graphic))
  drawPreview(ctx)
  drawSelectionRectOverlay(ctx)
  if (selectedGraphics.value.length > 1) {
    selectedGraphics.value.forEach((graphic) => drawSelectionOutlineOnly(ctx, graphic))
  }
  drawMultiSelectionBounds(ctx, interacting)
  if (selectedGraphic.value && selectedGraphics.value.length <= 1) {
    if (interacting) {
      drawSelectionOutlineOnly(ctx, selectedGraphic.value)
    } else {
      drawSelection(ctx, selectedGraphic.value)
    }
  }
  if (!interacting) {
    drawRemoteSelections(ctx)
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
  selectedObjectKeys.value = selectedObjectKeys.value.filter((item) => item !== objectKey)
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
    lineStyle: value.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillColor: typeof value.fillColor === 'string' ? value.fillColor : null,
    strokeWidth: parseNumber(value.strokeWidth, 1),
    textContent: typeof value.textContent === 'string' ? value.textContent : null,
    fontSize: typeof value.fontSize === 'number' ? value.fontSize : null,
    pathPoints: toOperationPathPoints(value.pathPoints),
    isLocked: value.isLocked === true || value.isLocked === 1,
    rotation: parseNumber(value.rotation),
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
    const serverResultKeys = new Set(result.graphics.map((item) => item.objectKey))
    if (forceFull || typeof sinceVersion !== 'number' || sinceVersion <= 0) {
      canvasStore.graphics = [...result.graphics]
    } else {
      mergeGraphicsByObjectKey(result.graphics)
    }
    if (forceFull || typeof sinceVersion !== 'number' || sinceVersion <= 0) {
      const pendingKeys = Array.from(pendingCreateObjectKeys.value)
      pendingKeys.forEach((key) => {
        if (serverResultKeys.has(key)) {
          clearGraphicCreatePending(key)
          flushDeferredObjectOperations(key)
        }
      })
      const existingKeys = new Set(canvasStore.graphics.map((item) => item.objectKey))
      const deferredKeys = Object.keys(deferredObjectOperations.value)
      deferredKeys.forEach((key) => {
        if (!existingKeys.has(key) && !isGraphicCreatePending(key)) {
          clearDeferredObjectOperations(key)
        }
      })
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
  remoteCursors.value = {}
  remoteSelections.value = {}
  lastSelectionBroadcastSignature.value = ''
  clientVersionRef.value = payload.currentVersion
  window.setTimeout(() => {
    broadcastSelectionPresence(true)
  }, 0)
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
  const deferredOps = popDeferredObjectOperations(payload.graphic.objectKey)
  clearGraphicCreatePending(payload.graphic.objectKey)
  upsertGraphic(payload.graphic)
  deferredOps.forEach((operation) => {
    if (operation.type === 'patch') {
      sendUpdateGraphicPatch(payload.graphic.objectKey, operation.patch)
      return
    }
    sendDeleteGraphicByObjectKey(payload.graphic.objectKey)
  })
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
  clearGraphicCreatePending(payload.objectKey)
  clearDeferredObjectOperations(payload.objectKey)
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
  lastSelectionBroadcastSignature.value = ''
  window.setTimeout(() => {
    broadcastSelectionPresence(true)
  }, 0)
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
  if (
    payload.code === 3001 &&
    (payload.originalType === 'update_graphic' || payload.originalType === 'delete_graphic') &&
    !recoveringMissingGraphic.value
  ) {
    recoveringMissingGraphic.value = true
    void syncGraphicsFromServer(true).finally(() => {
      recoveringMissingGraphic.value = false
    })
  }
  if (payload.code >= 3000 || payload.code === 2001 || payload.code === 2002) {
    feedback.error(payload.message || 'WebSocket 出错')
  }
}

const handleWsMemberJoined = (payload: MemberJoinedData) => {
  patchMemberOnlineStatus(payload, 1)
}

const handleWsMemberLeft = (payload: MemberJoinedData) => {
  patchMemberOnlineStatus(payload, 0)
  clearRemoteCursorByUserId(payload.userId)
  clearRemoteSelectionByUserId(payload.userId)
  scheduleRender()
}

const handlePresenceSelection = (payload: PresenceSelectionData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  if (payload.userId === currentUserId.value) {
    return
  }
  const objectKeys = normalizeSelectionKeys(Array.isArray(payload.objectKeys) ? payload.objectKeys : [])
  const objectKey = (typeof payload.objectKey === 'string' && payload.objectKey.trim().length > 0)
    ? payload.objectKey.trim()
    : (objectKeys[0] ?? null)
  if (!objectKey && objectKeys.length === 0) {
    clearRemoteSelectionByUserId(payload.userId)
    scheduleRender()
    return
  }
  remoteSelections.value[payload.userId] = {
    userId: payload.userId,
    username: payload.username || `用户#${payload.userId}`,
    objectKey,
    objectKeys,
    updatedAt: Date.now(),
  }
  scheduleRender()
}

const handleSessionPaused = (payload: SessionPausedData) => {
  if (!sessionDetail.value || payload.sessionKey !== sessionKey.value) {
    return
  }
  sessionDetail.value = {
    ...sessionDetail.value,
    isPaused: payload.isPaused,
  }
  const operator = payload.operatorUsername || (typeof payload.operatorUserId === 'number' ? `用户#${payload.operatorUserId}` : '系统')
  feedback.info(`${operator}${payload.isPaused ? '暂停了画布' : '恢复了画布'}`)
  scheduleRender()
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
  if (data.objectKey && data.operationType === 'create_graphic') {
    clearGraphicCreatePending(data.objectKey)
    flushDeferredObjectOperations(data.objectKey)
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
    fillColor: typeof patchSource.fillColor === 'string' || patchSource.fillColor === null ? patchSource.fillColor : undefined,
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
  client.on('presence_selection', handlePresenceSelection)
  client.on('session_paused', handleSessionPaused)
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
  client.off('presence_selection', handlePresenceSelection)
  client.off('session_paused', handleSessionPaused)
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
    const inviteToken = typeof route.query.inviteToken === 'string' ? route.query.inviteToken.trim() : undefined
    const joinedData = await sessionApi.join(sessionKey.value, inviteToken || undefined)
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
    await router.replace({
      path: `/session/${sessionKey.value}`,
      query: {},
    })
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
  feedback.info(`当前版本暂不支持转交创建者（目标：${member.username}）`)
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
  inviteDialogVisible.value = true
  await loadInviteList()
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

const createExportCanvas = () => {
  const canvas = canvasRef.value
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
  exportCtx.scale(zoomScale.value, zoomScale.value)
  exportCtx.translate(viewportOffset.value.x, viewportOffset.value.y)
  const worldWidth = exportCanvas.width / zoomScale.value
  const worldHeight = exportCanvas.height / zoomScale.value
  const viewLeft = -viewportOffset.value.x
  const viewTop = -viewportOffset.value.y
  const viewRight = viewLeft + worldWidth
  const viewBottom = viewTop + worldHeight

  if (exportIncludeGrid.value) {
    drawGrid(exportCtx, viewLeft, viewTop, viewRight, viewBottom, canvasBackgroundColor.value)
  }
  sortedGraphics.value.forEach((graphic) => drawGraphic(exportCtx, graphic))
  exportCtx.restore()
  return exportCanvas
}

const blobFromCanvas = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 1) => {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((file) => resolve(file), type, quality)
  })
}

const buildSimplePdfFromJpegBytes = (jpegBytes: Uint8Array, widthPx: number, heightPx: number): Blob => {
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
    feedback.error('画布尚未就绪，暂时无法导出')
    return
  }
  try {
    const sessionName = sanitizeFilename(currentSessionName.value)
    const stamp = formatNowForFilename()
    if (exportFormat.value === 'png') {
      const pngBlob = await blobFromCanvas(canvas, 'image/png', 1)
      if (!pngBlob) {
        feedback.error('导出失败：PNG 编码失败')
        return
      }
      downloadBlob(pngBlob, `${sessionName}_${stamp}.png`)
      feedback.success('已导出 PNG')
      exportDialogVisible.value = false
      return
    }

    if (exportFormat.value === 'svg') {
      const pngDataUrl = canvas.toDataURL('image/png')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><rect width="100%" height="100%" fill="${canvasBackgroundColor.value}"/><image href="${pngDataUrl}" width="${canvas.width}" height="${canvas.height}" /></svg>`
      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      downloadBlob(svgBlob, `${sessionName}_${stamp}.svg`)
      feedback.success('已导出 SVG')
      exportDialogVisible.value = false
      return
    }

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    const jpegBytes = parseDataUrlBase64(jpegDataUrl)
    if (!jpegBytes) {
      feedback.error('导出失败：PDF 编码失败')
      return
    }
    const pdfBlob = buildSimplePdfFromJpegBytes(jpegBytes, canvas.width, canvas.height)
    downloadBlob(pdfBlob, `${sessionName}_${stamp}.pdf`)
    feedback.success('已导出 PDF')
    exportDialogVisible.value = false
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

const isOperationTimelineTechnicalExpanded = (id: number) => {
  return operationTimelineTechnicalExpandedIds.value.includes(id)
}

const toggleOperationTimelineTechnical = (id: number) => {
  if (isOperationTimelineTechnicalExpanded(id)) {
    operationTimelineTechnicalExpandedIds.value = operationTimelineTechnicalExpandedIds.value.filter((item) => item !== id)
    return
  }
  operationTimelineTechnicalExpandedIds.value = [...operationTimelineTechnicalExpandedIds.value, id]
}

const isConflictTechnicalExpanded = (id: number) => {
  return conflictTechnicalExpandedIds.value.includes(id)
}

const toggleConflictTechnical = (id: number) => {
  if (isConflictTechnicalExpanded(id)) {
    conflictTechnicalExpandedIds.value = conflictTechnicalExpandedIds.value.filter((item) => item !== id)
    return
  }
  conflictTechnicalExpandedIds.value = [...conflictTechnicalExpandedIds.value, id]
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
  operationTimelineTechnicalExpandedIds.value = []
  await loadOperationTimeline()
}

const handleResetOperationTimelineFilters = async () => {
  operationTimelineFilterUserId.value = null
  operationTimelineFilterOperationType.value = 'all'
  operationTimelineFilterConflictType.value = 'all'
  operationTimelineFilterFromVersion.value = null
  operationTimelineFilterToVersion.value = null
  operationTimelinePage.value = 1
  operationTimelineTechnicalExpandedIds.value = []
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
  conflictTechnicalExpandedIds.value = []
  await refreshConflictLogs(true)
}

const handleShowVersionHistory = async () => {
  versionHistoryVisible.value = true
  await refreshSnapshots()
}

const handleShowMembersManage = async () => {
  memberManageDialogVisible.value = true
  await refreshSessionMembers()
}

const handleUpdateMemberRole = async (payload: { member: MemberVO; role: 0 | 1 | 2 }) => {
  if (!sessionKey.value) {
    return
  }
  try {
    await sessionApi.updateMemberRole(sessionKey.value, payload.member.userId, payload.role)
    feedback.success(`已将 ${payload.member.username} 设为 ${payload.role === 2 ? 'manager' : payload.role === 1 ? 'editor' : 'viewer'}`)
    await refreshSessionMembers()
  } catch (error) {
    feedback.errorFrom(error, '更新成员角色失败')
  }
}

const handleCloseSession = async () => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  try {
    const confirmed = await confirmDanger('确认结束当前会话吗？结束后不可继续协作。', '结束会话', {
      confirmButtonText: '确认结束',
    })
    if (!confirmed) {
      return
    }
    await sessionApi.closeSession(sessionKey.value)
    feedback.success('会话已结束')
    await router.push('/my-sessions')
  } catch (error) {
    feedback.errorFrom(error, '结束会话失败')
  }
}

const handleToggleFocusMode = () => {
  focusMode.value = !focusMode.value
}

const handleShowGuide = () => {
  const availableSteps = baseOnboardingSteps.filter((step) => {
    const element = document.querySelector(step.selector)
    return Boolean(element)
  })
  onboardingSteps.value = availableSteps.length > 0 ? availableSteps : baseOnboardingSteps
  onboardingVisible.value = true
}

const handleShowBackground = () => {
  backgroundDialogVisible.value = true
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
    lastSelectionBroadcastSignature.value = ''
    broadcastSelectionPresence(true)
    void refreshSessionMembers()
    return
  }
  clearHeartbeat()
}

const loadInviteList = async () => {
  if (!sessionKey.value) {
    return
  }
  inviteListLoading.value = true
  try {
    const result = await sessionApi.getInviteList(sessionKey.value)
    inviteList.value = result.list
  } catch (error) {
    feedback.errorFrom(error, '加载邀请码失败')
  } finally {
    inviteListLoading.value = false
  }
}

const handleCreateInvite = async (payload: { role: 0 | 1 | 2 }) => {
  if (!sessionKey.value) {
    return
  }
  inviteDialogLoading.value = true
  try {
    await sessionApi.createInvite(sessionKey.value, payload.role)
    feedback.success('邀请码创建成功')
    await loadInviteList()
  } catch (error) {
    feedback.errorFrom(error, '创建邀请码失败')
  } finally {
    inviteDialogLoading.value = false
  }
}

const copyInviteLinkText = async (invitePath?: string) => {
  if (!invitePath) {
    feedback.warning('邀请码链接缺失')
    return
  }
  const isAbsolute = /^https?:\/\//i.test(invitePath)
  const link = isAbsolute ? invitePath : `${window.location.origin}${invitePath}`
  await navigator.clipboard.writeText(link)
}

const handleCopyInvite = async (invite: SessionInviteItemVO) => {
  try {
    await copyInviteLinkText(invite.invitePath)
    feedback.success('邀请码链接已复制')
  } catch {
    feedback.error('复制失败，请稍后重试')
  }
}

const handleShowInviteQr = async (invite: SessionInviteItemVO) => {
  if (!invite.invitePath) {
    feedback.warning('邀请码链接缺失')
    return
  }
  const isAbsolute = /^https?:\/\//i.test(invite.invitePath)
  shareQrcodePendingLink.value = isAbsolute ? invite.invitePath : `${window.location.origin}${invite.invitePath}`
  shareQrcodeVisible.value = true
}

const handleRevokeInvite = async (invite: SessionInviteItemVO) => {
  if (!sessionKey.value) {
    return
  }
  try {
    const confirmed = await confirmDanger('确认作废该邀请码吗？', '邀请码作废', { confirmButtonText: '确认作废' })
    if (!confirmed) {
      return
    }
    await sessionApi.revokeInvite(sessionKey.value, invite.id)
    feedback.success('邀请码已作废')
    await loadInviteList()
  } catch (error) {
    feedback.errorFrom(error, '作废邀请码失败')
  }
}

const handleToggleGrid = () => {
  showGrid.value = !showGrid.value
  scheduleRender()
}

const applyCanvasBackgroundColor = (value: string) => {
  const normalized = normalizeHexColor(value)
  if (!normalized) {
    return
  }
  canvasBackgroundColor.value = normalized
  saveCanvasBackgroundColor(normalized)
  scheduleRender()
}

const handleTogglePaused = async () => {
  if (!sessionKey.value || !canPauseCanvas.value) {
    return
  }
  try {
    const nextPaused = !isPaused.value
    const result = await sessionApi.updatePausedStatus(sessionKey.value, nextPaused)
    if (sessionDetail.value) {
      sessionDetail.value = {
        ...sessionDetail.value,
        isPaused: result.isPaused,
      }
    }
    feedback.success(result.isPaused ? '画布已暂停' : '画布已恢复')
  } catch (error) {
    feedback.errorFrom(error, '更新画布状态失败')
  }
}

const pickImageInsertPoint = () => {
  const canvas = canvasRef.value
  if (!canvas) {
    return { x: 80, y: 80 }
  }
  const worldCenterX = canvas.width / (2 * zoomScale.value) - viewportOffset.value.x
  const worldCenterY = canvas.height / (2 * zoomScale.value) - viewportOffset.value.y
  return {
    x: Math.max(0, Math.round(worldCenterX - 120)),
    y: Math.max(0, Math.round(worldCenterY - 90)),
  }
}

const handleImportImage = () => {
  if (isReadOnly.value || importingImage.value) {
    return
  }
  imageFileInputRef.value?.click()
}

const handleImageFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file || !sessionKey.value || !canvasStore.currentSession) {
    if (target) {
      target.value = ''
    }
    return
  }
  importingImage.value = true
  try {
    const naturalSize = await loadImageNaturalSize(file)
    const uploaded = await sessionApi.uploadSessionImage(sessionKey.value, file)
    const imageUrl = (() => {
      const raw = (uploaded.url || '').trim()
      if (!raw) {
        return ''
      }
      if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw
      }
      const apiOrigin = getApiOrigin()
      if (raw.startsWith('/')) {
        return `${apiOrigin}${raw}`
      }
      return `${apiOrigin}/${raw}`
    })()
    if (!imageUrl) {
      throw new Error('上传成功但图片地址为空')
    }
    const initialSize = naturalSize
      ? resolveImageInsertSize(naturalSize.width, naturalSize.height)
      : { width: IMAGE_INSERT_BOX_WIDTH, height: IMAGE_INSERT_BOX_HEIGHT }
    const point = pickImageInsertPoint()
    const graphic: GraphicVO = {
      id: 0,
      sessionId: canvasStore.currentSession.sessionId,
      objectKey: generateGraphicObjectKey(),
      objectType: 'image',
      positionX: point.x,
      positionY: point.y,
      width: initialSize.width,
      height: initialSize.height,
      strokeColor: '#94a3b8',
      lineStyle: 'solid',
      fillColor: null,
      strokeWidth: 1,
      textContent: imageUrl,
      fontSize: null,
      pathPoints: null,
      isLocked: false,
      rotation: 0,
      zIndex: canvasStore.graphics.length + 1,
      version: currentVersion.value,
      creatorId: currentUserId.value ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    upsertGraphic(graphic)
    selectedObjectKey.value = graphic.objectKey
    sendCreateGraphic(graphic)
    feedback.success('图片已插入')
  } catch (error) {
    feedback.errorFrom(error, '图片导入失败')
  } finally {
    importingImage.value = false
    if (target) {
      target.value = ''
    }
  }
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

const locateConflictObject = (item: SessionConflictLogItemVO) => {
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

const formatOperationActorLabel = (userId: number) => {
  return findMemberNameByUserId(userId) || `用户 ${userId}`
}

const formatFieldNamesText = (fields: string[]) => {
  return fields.length > 0 ? fields.join(', ') : '-'
}

const formatObjectTypeLabel = (value: unknown) => {
  const type = typeof value === 'string' ? value : ''
  const map: Record<string, string> = {
    rect: '矩形',
    circle: '圆形',
    ellipse: '椭圆',
    line: '直线',
    path: '路径',
    text: '文本',
    image: '图片',
  }
  return map[type] ?? (type || '图元')
}

const timelineUpdateFieldOrder: string[] = [
  'positionX',
  'positionY',
  'width',
  'height',
  'rotation',
  'pathPoints',
  'strokeColor',
  'fillColor',
  'strokeWidth',
  'lineStyle',
  'textContent',
  'fontSize',
  'zIndex',
  'isLocked',
]

const extractTimelineUpdateFieldKeys = (item: SessionOperationItemVO): string[] => {
  const payload = isRecord(item.operationData) ? item.operationData : {}
  const fromPayload = timelineUpdateFieldOrder.filter((key) => typeof payload[key] !== 'undefined')
  if (fromPayload.length > 0) {
    return fromPayload
  }
  const applied = getResolvedFieldList(item, 'appliedFields')
  return timelineUpdateFieldOrder.filter((key) => applied.includes(key))
}

const getResolvedFieldList = (item: SessionOperationItemVO, key: 'appliedFields' | 'rejectedFields') => {
  if (!item.resolvedResult || typeof item.resolvedResult !== 'object') {
    return [] as string[]
  }
  const resolved = item.resolvedResult as Record<string, unknown>
  const value = resolved[key]
  if (!Array.isArray(value)) {
    return [] as string[]
  }
  return value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
}

const isRestoreTimelineEvent = (item: SessionOperationItemVO): boolean => {
  const payload = isRecord(item.operationData) ? item.operationData : {}
  return payload.__systemEvent === 'restore_version'
}

const getRestoreTimelineMeta = (item: SessionOperationItemVO) => {
  const payload = isRecord(item.operationData) ? item.operationData : {}
  const resolved = isRecord(item.resolvedResult) ? item.resolvedResult : {}
  const targetVersion = parseNumber(payload.targetVersion ?? resolved.targetVersion, 0)
  const previousVersion = parseNumber(payload.previousVersion ?? resolved.previousVersion ?? item.baseVersion, item.baseVersion)
  const restoredVersion = parseNumber(payload.restoredVersion ?? resolved.restoredVersion ?? item.serverVersion, item.serverVersion)
  const createdCount = parseNumber(payload.createdCount ?? resolved.createdCount, 0)
  const updatedCount = parseNumber(payload.updatedCount ?? resolved.updatedCount, 0)
  const deletedCount = parseNumber(payload.deletedCount ?? resolved.deletedCount, 0)
  return {
    targetVersion,
    previousVersion,
    restoredVersion,
    createdCount,
    updatedCount,
    deletedCount,
  }
}

const formatTimelineActivityText = (item: SessionOperationItemVO) => {
  const actor = formatOperationActorLabel(item.userId)
  const payload = isRecord(item.operationData) ? item.operationData : {}
  const resolved = isRecord(item.resolvedResult) ? item.resolvedResult : {}
  const resolvedGraphic = isRecord(resolved.graphic) ? resolved.graphic : {}
  const objectType = formatObjectTypeLabel(payload.objectType ?? resolvedGraphic.objectType)

  if (isRestoreTimelineEvent(item)) {
    const meta = getRestoreTimelineMeta(item)
    return `${actor} 恢复到历史版本 V${meta.targetVersion}（V${meta.previousVersion} → V${meta.restoredVersion}）`
  }

  if (item.operationType === 'create') {
    return `${actor} 创建了${objectType}（${item.objectKey || '对象'}）`
  }
  if (item.operationType === 'delete') {
    return `${actor} 删除了${objectType}（${item.objectKey || '对象'}）`
  }

  const updateFields = extractTimelineUpdateFieldKeys(item)
    .map((field) => formatFieldNameLabel(field))
    .filter((field, index, arr) => field && arr.indexOf(field) === index)

  if (updateFields.length === 0) {
    return `${actor} 更新了${objectType}（${item.objectKey || '对象'}）`
  }
  return `${actor} 更新了${objectType}（${item.objectKey || '对象'}），更新字段：${updateFields.join('、')}`
}

const formatTimelineConflictHint = (item: SessionOperationItemVO) => {
  if (isRestoreTimelineEvent(item)) {
    const meta = getRestoreTimelineMeta(item)
    return `恢复结果：新增 ${meta.createdCount}，更新 ${meta.updatedCount}，删除 ${meta.deletedCount}。`
  }
  if (item.conflictType === 'none') {
    return '该操作未触发冲突。'
  }
  const applied = formatFieldNamesText(getResolvedFieldList(item, 'appliedFields'))
  const rejected = formatFieldNamesText(getResolvedFieldList(item, 'rejectedFields'))
  return `冲突类型：${formatConflictTypeLabel(item.conflictType)}；采用字段：${applied}；拒绝字段：${rejected}`
}

const formatResolveReasonLabel = (value: unknown) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  return '-'
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

const formatFieldNameLabel = (field: string) => {
  const map: Record<string, string> = {
    positionX: 'X坐标',
    positionY: 'Y坐标',
    width: '宽度',
    height: '高度',
    strokeColor: '描边颜色',
    fillColor: '填充颜色',
    strokeWidth: '线宽',
    lineStyle: '线型',
    textContent: '文本内容',
    fontSize: '字体大小',
    pathPoints: '路径点',
    zIndex: '图层',
    rotation: '旋转角度',
    isLocked: '锁定状态',
  }
  return map[field] ?? field
}

const formatConflictResolveStrategyLabel = (strategy: string) => {
  if (!strategy) {
    return '-'
  }
  return strategy
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

const formatConflictLogSummary = (item: SessionConflictLogItemVO) => {
  const field = formatFieldNameLabel(item.fieldName || '-')
  const strategy = formatConflictResolveStrategyLabel(item.resolveStrategy)
  if (item.conflictType === 'field_merge') {
    return `字段 ${field} 与并发修改可合并，已采用传入值。`
  }
  if (item.conflictType === 'field_conflict') {
    return `字段 ${field} 发生并发冲突，系统已按 ${strategy} 选择最终值。`
  }
  if (item.conflictType === 'delete_wins') {
    return `目标图元已被删除，本次字段 ${field} 的修改未生效（删除优先）。`
  }
  if (item.conflictType === 'duplicate_operation') {
    return `检测到重复操作提交，系统已按幂等策略忽略重复执行。`
  }
  return `字段 ${field} 无冲突，按策略 ${strategy} 正常处理。`
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
  currentSnapshotVersion.value = snapshots.value.length > 0 ? (snapshots.value[0]?.version ?? null) : null
}

const createSnapshotNow = async () => {
  if (!sessionKey.value || loadingSnapshots.value) {
    return
  }
  try {
    const defaultName = `${currentSessionName.value || '未命名会话'}_V${currentVersion.value}_${formatNowForFilename()}`
    const promptResult = await ElMessageBox.prompt('请输入快照名称（可留空）', '创建快照', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValue: defaultName,
      inputPlaceholder: '例如：联调前快照 / 答辩演示快照',
      closeOnClickModal: false,
    }).catch((error) => {
      if (error === 'cancel' || error === 'close') {
        return null
      }
      throw error
    })
    if (!promptResult) {
      return
    }

    const snapshotNameRaw = promptResult.value
    const snapshotName = typeof snapshotNameRaw === 'string' ? snapshotNameRaw.trim() : ''

    loadingSnapshots.value = true
    await sessionApi.createSnapshot(sessionKey.value, snapshotName || undefined)
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
  const confirmed = await confirmDanger(
    `确认恢复到版本 V${targetVersion} 吗？该操作会按目标版本内容覆盖当前画布状态，并生成新的恢复记录。`,
    '恢复快照确认',
    {
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消',
    },
  )
  if (!confirmed) {
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
    objectTypeRaw === 'line' ||
    objectTypeRaw === 'rect' ||
    objectTypeRaw === 'circle' ||
    objectTypeRaw === 'text' ||
    objectTypeRaw === 'path' ||
    objectTypeRaw === 'image'
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
    lineStyle: source.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillColor: typeof source.fillColor === 'string' ? source.fillColor : null,
    strokeWidth: parseNumber(source.strokeWidth, 1),
    textContent: typeof source.textContent === 'string' ? source.textContent : null,
    fontSize: typeof source.fontSize === 'number' ? source.fontSize : null,
    pathPoints,
    isLocked: source.isLocked === true || source.isLocked === 1,
    rotation: parseNumber(source.rotation),
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
        lineStyle: patch.lineStyle === 'dashed' ? 'dashed' : (patch.lineStyle === 'solid' ? 'solid' : current.lineStyle),
        fillColor: typeof patch.fillColor === 'string' || patch.fillColor === null ? patch.fillColor : current.fillColor,
        strokeWidth: typeof patch.strokeWidth === 'number' ? patch.strokeWidth : current.strokeWidth,
        textContent: typeof patch.textContent === 'string' ? patch.textContent : current.textContent,
        fontSize: typeof patch.fontSize === 'number' ? patch.fontSize : current.fontSize,
        pathPoints: toOperationPathPoints(patch.pathPoints) ?? current.pathPoints,
        isLocked: typeof patch.isLocked === 'boolean' ? patch.isLocked : current.isLocked,
        rotation: typeof patch.rotation === 'number' ? patch.rotation : current.rotation,
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
  markGraphicCreatePending(graphic.objectKey)
  const operationId = nextOperationId('create_graphic', graphic.objectKey)
  const lamportTime = nextLamportTime()
  wsClient.sendCreateGraphic({
    sessionKey: canvasStore.currentSession.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    ...consumeWsBatchMeta(),
    objectKey: graphic.objectKey,
    objectType: graphic.objectType,
    positionX: graphic.positionX,
    positionY: graphic.positionY,
    width: graphic.width ?? undefined,
    height: graphic.height ?? undefined,
    strokeColor: graphic.strokeColor,
    lineStyle: graphic.lineStyle,
    fillColor: graphic.fillColor ?? undefined,
    strokeWidth: graphic.strokeWidth,
    zIndex: graphic.zIndex,
    textContent: graphic.textContent ?? undefined,
    fontSize: graphic.fontSize ?? undefined,
    pathPoints: graphic.pathPoints ?? undefined,
    isLocked: graphic.isLocked,
    rotation: graphic.rotation,
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
  recordUndoStep(1)
}

const sendUpdateGraphicPatch = (objectKey: string, patch: NonNullable<import('@/ws/types').UpdateGraphicData['patch']>) => {
  if (!wsClient || !canvasStore.currentSession) {
    return
  }
  const patchKeys = Object.keys(patch).filter((item) => typeof (patch as Record<string, unknown>)[item] !== 'undefined')
  if (patchKeys.length === 0) {
    return
  }
  if (isGraphicCreatePending(objectKey)) {
    enqueueDeferredObjectOperation(objectKey, {
      type: 'patch',
      patch: { ...patch },
    })
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
    ...consumeWsBatchMeta(),
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
  recordPatchOperation()
}

const sendDeleteGraphicByObjectKey = (objectKey: string) => {
  const session = canvasStore.currentSession
  const client = wsClient
  if (!session || !client) {
    return false
  }
  const graphic = canvasStore.graphics.find((item) => item.objectKey === objectKey)
  if (!graphic || graphic.isLocked) {
    return false
  }
  if (isGraphicCreatePending(objectKey)) {
    enqueueDeferredObjectOperation(objectKey, { type: 'delete' })
    removeGraphic(objectKey)
    return true
  }
  const operationId = nextOperationId('delete_graphic', objectKey)
  const lamportTime = nextLamportTime()
  client.sendDeleteGraphicWithMeta({
    sessionKey: session.sessionKey,
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    ...consumeWsBatchMeta(),
    objectKey,
  })
  removeGraphic(objectKey)
  canvasStore.pushLocalOperation(
    buildLocalOperation('delete_graphic', objectKey, {
      ...graphic,
    }),
  )
  pushOperationHistory({
    operationType: 'delete_graphic',
    objectKey,
    userId: currentUserId.value,
    source: 'local',
  })
  return true
}

const deleteSelectedGraphic = () => {
  const selectedList = selectedGraphics.value
  if (selectedList.length === 0 || !wsClient || !canvasStore.currentSession) {
    return
  }
  if (isReadOnly.value) {
    return
  }
  let deletedCount = 0
  beginWsBatch(selectedList.length, 'multi_delete')
  try {
    selectedList.forEach((selected) => {
      if (sendDeleteGraphicByObjectKey(selected.objectKey)) {
        deletedCount += 1
      }
    })
  } finally {
    endWsBatch()
  }
  if (deletedCount > 0) {
    recordUndoStep(deletedCount)
  }
  selectedObjectKeys.value = []
  selectedObjectKey.value = null
}

const handleToggleLock = () => {
  if (isReadOnly.value || selectedGraphics.value.length === 0) {
    return
  }
  const nextLocked = !selectedLocked.value
  let updatedCount = 0
  beginWsBatch(selectedGraphics.value.length, 'multi_lock')
  try {
    selectedGraphics.value.forEach((graphic) => {
      const index = canvasStore.graphics.findIndex((item) => item.objectKey === graphic.objectKey)
      if (index === -1) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current) {
        return
      }
      if (current.isLocked === nextLocked) {
        return
      }
      const next: GraphicVO = {
        ...current,
        isLocked: nextLocked,
        updatedAt: new Date().toISOString(),
      }
      canvasStore.graphics[index] = next
      sendUpdateGraphicPatch(next.objectKey, { isLocked: nextLocked })
      updatedCount += 1
    })
  } finally {
    endWsBatch()
  }
  if (updatedCount > 0) {
    recordUndoStep(updatedCount)
  }
  scheduleRender()
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

  beginWsBatch(2, 'pair_zindex_swap')
  try {
    sendUpdateGraphicPatch(firstNext.objectKey, { zIndex: firstNext.zIndex })
    sendUpdateGraphicPatch(secondNext.objectKey, { zIndex: secondNext.zIndex })
  } finally {
    endWsBatch()
  }
  scheduleRender()
}

const handleBringForward = () => {
  if (isReadOnly.value) {
    return
  }
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
  if (isReadOnly.value) {
    return
  }
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
  if (isReadOnly.value) {
    cancelTextEditing()
    return
  }
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
    lineStyle: lineStyle.value,
    fillColor: null,
    strokeWidth: strokeWidth.value,
    textContent: content,
    fontSize: 16,
    pathPoints: null,
    isLocked: false,
    rotation: 0,
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
  pointerPressed.value = true

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
  if (activeTool.value === 'select') {
    broadcastSelectionPresence(true)
  }

  if (activeTool.value === 'text') {
    selectedObjectKey.value = null
    selectedObjectKeys.value = []
    scheduleRender()
    return
  }

  if (activeTool.value === 'select') {
    if (selectedObjectKeys.value.length > 1 && multiSelectionFrame.value && !isReadOnly.value) {
      const bounds = multiSelectionFrame.value.bounds
      const groupRotation = multiSelectionFrame.value.rotationRad
      const groupCenter = multiSelectionFrame.value.center
      if (hitRotateHandleByBounds(point, bounds, groupRotation)) {
        const originals: Record<string, GraphicVO> = {}
        selectedGraphics.value.forEach((item) => {
          originals[item.objectKey] = { ...item, pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null }
        })
        groupRotateState.value = {
          active: true,
          center: { ...groupCenter },
          startAngle: Math.atan2(point.y - groupCenter.y, point.x - groupCenter.x),
          originalGraphics: originals,
        }
        scheduleRender()
        return
      }
      const groupHandle = hitResizeHandleByBounds(point, bounds, groupRotation)
      if (groupHandle) {
        const originals: Record<string, GraphicVO> = {}
        selectedGraphics.value.forEach((item) => {
          originals[item.objectKey] = { ...item, pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null }
        })
        groupResizeState.value = {
          active: true,
          handle: groupHandle,
          originalBounds: { ...bounds },
          originalGraphics: originals,
        }
        scheduleRender()
        return
      }

      if (isPointInRotatedRect(point, bounds, groupRotation)) {
        const baseByKey: Record<string, { x: number; y: number; pathPoints: Point[] | null }> = {}
        selectedGraphics.value.forEach((item) => {
          if (item.isLocked) {
            return
          }
          baseByKey[item.objectKey] = {
            x: item.positionX,
            y: item.positionY,
            pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null,
          }
        })
        const movableKeys = Object.keys(baseByKey)
        if (movableKeys.length > 0) {
          multiDrag.value = {
            active: true,
            objectKeys: movableKeys,
            start: point,
            baseByKey,
          }
          scheduleRender()
          return
        }
      }
    }

    const selected = selectedGraphic.value
  if (selected && selectedGraphics.value.length === 1) {
      if (!isReadOnly.value && !selected.isLocked && hitRotateHandle(point, selected)) {
        const center = getGraphicCenter(selected)
        rotateState.value = {
          active: true,
          objectKey: selected.objectKey,
          center,
          startAngle: Math.atan2(point.y - center.y, point.x - center.x),
          originalRotation: selected.rotation || 0,
          originalGraphic: { ...selected, pathPoints: selected.pathPoints ? selected.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null },
        }
        scheduleRender()
        return
      }
      const handle = selected.isLocked ? null : hitResizeHandle(point, selected)
      if (handle) {
        resizeState.value = {
          active: true,
          objectKey: selected.objectKey,
          handle,
          originalGraphic: { ...selected, pathPoints: selected.pathPoints ? selected.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null },
        }
        scheduleRender()
        return
      }
    }

    const target = pickGraphic(point)
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    if (target) {
      if (additive) {
        const next = new Set(selectedObjectKeys.value)
        if (next.has(target.objectKey)) {
          next.delete(target.objectKey)
        } else {
          next.add(target.objectKey)
        }
        selectedObjectKeys.value = [...next]
        selectedObjectKey.value = selectedObjectKeys.value[selectedObjectKeys.value.length - 1] ?? null
      } else {
        selectedObjectKeys.value = [target.objectKey]
        selectedObjectKey.value = target.objectKey
      }
    } else if (!additive) {
      selectedObjectKey.value = null
      selectedObjectKeys.value = []
    }
    if (target && !isReadOnly.value && target.isLocked) {
      scheduleRender()
      return
    }
    if (target && !isReadOnly.value) {
      if (selectedObjectKeys.value.length > 1 && selectedObjectKeys.value.includes(target.objectKey)) {
        const baseByKey: Record<string, { x: number; y: number; pathPoints: Point[] | null }> = {}
        selectedGraphics.value.forEach((item) => {
          baseByKey[item.objectKey] = {
            x: item.positionX,
            y: item.positionY,
            pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null,
          }
        })
        multiDrag.value = {
          active: true,
          objectKeys: [...selectedObjectKeys.value],
          start: point,
          baseByKey,
        }
        scheduleRender()
        return
      }
      if (!selectedObjectKeys.value.includes(target.objectKey)) {
        selectedObjectKeys.value = [target.objectKey]
        selectedObjectKey.value = target.objectKey
      }
      dragMove.value = {
        active: true,
        objectKey: target.objectKey,
        start: point,
        baseX: target.positionX,
        baseY: target.positionY,
        basePathPoints: target.pathPoints ? target.pathPoints.map((item) => ({ x: item.x, y: item.y })) : null,
        originalGraphic: { ...target },
      }
    } else if (!target) {
      selectionRect.value = {
        active: true,
        start: point,
        end: point,
      }
    }
    scheduleRender()
    return
  }

  if (activeTool.value === 'brush') {
    if (isReadOnly.value) {
      return
    }
    selectedObjectKey.value = null
    selectedObjectKeys.value = []
    draft.value = {
      active: true,
      start: point,
      end: point,
      points: [point],
    }
    scheduleRender()
    return
  }

  if (isReadOnly.value) {
    return
  }
  selectedObjectKey.value = null
  selectedObjectKeys.value = []
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
    selectedObjectKeys.value = [target.objectKey]
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
    selectedObjectKeys.value = [target.objectKey]
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

  if (isReadOnly.value) {
    return
  }

  if (!hasActiveCanvasInteraction()) {
    return
  }

  const point = toCanvasPoint(event)
  if (!point) {
    return
  }
  broadcastCursorPresence(point)

  if (groupRotateState.value.active && selectedObjectKeys.value.length > 1) {
    const angle = Math.atan2(point.y - groupRotateState.value.center.y, point.x - groupRotateState.value.center.x)
    const delta = angle - groupRotateState.value.startAngle
    const indexByObjectKey = new Map(canvasStore.graphics.map((item, index) => [item.objectKey, index]))
    selectedObjectKeys.value.forEach((objectKey) => {
      const original = groupRotateState.value.originalGraphics[objectKey]
      if (!original || original.isLocked) {
        return
      }
      const index = indexByObjectKey.get(objectKey) ?? -1
      if (index === -1) {
        return
      }
      canvasStore.graphics[index] = applyRotateToGraphic(original, groupRotateState.value.center, delta)
    })
    scheduleRender()
    return
  }

  if (groupResizeState.value.active && selectedObjectKeys.value.length > 1) {
    const sourceBounds = groupResizeState.value.originalBounds
    const handle = groupResizeState.value.handle
    if (!sourceBounds || !handle) {
      return
    }
    const targetBounds = resizeBoundsByHandle(sourceBounds, handle, point)
    const indexByObjectKey = new Map(canvasStore.graphics.map((item, index) => [item.objectKey, index]))
    selectedObjectKeys.value.forEach((objectKey) => {
      const original = groupResizeState.value.originalGraphics[objectKey]
      if (!original || original.isLocked) {
        return
      }
      const index = indexByObjectKey.get(objectKey) ?? -1
      if (index === -1) {
        return
      }
      const transformed = applyTransformToGraphic(original, sourceBounds, targetBounds)
      if (
        original.objectType === 'rect' ||
        original.objectType === 'image' ||
        original.objectType === 'text' ||
        original.objectType === 'circle' ||
        original.objectType === 'path'
      ) {
        const sourceCenter = {
          x: sourceBounds.x + sourceBounds.width / 2,
          y: sourceBounds.y + sourceBounds.height / 2,
        }
        canvasStore.graphics[index] = rotateGraphicAround(transformed, sourceCenter, original.rotation ?? 0)
      } else {
        canvasStore.graphics[index] = transformed
      }
    })
    scheduleRender()
    return
  }

  if (rotateState.value.active && activeTool.value === 'select') {
    const index = canvasStore.graphics.findIndex((item) => item.objectKey === rotateState.value.objectKey)
    if (index !== -1) {
      const original = rotateState.value.originalGraphic
      if (original) {
        const angle = Math.atan2(point.y - rotateState.value.center.y, point.x - rotateState.value.center.x)
        const delta = angle - rotateState.value.startAngle
        const nextDeg = (rotateState.value.originalRotation + (delta * 180) / Math.PI + 360) % 360
        canvasStore.graphics[index] = rotateGraphicAround(original, rotateState.value.center, Math.round(nextDeg))
        scheduleRender()
      }
    }
    return
  }

  if (selectionRect.value.active && activeTool.value === 'select') {
    selectionRect.value.end = point
    scheduleRender()
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
    if (
      current.objectType !== 'rect' &&
      current.objectType !== 'circle' &&
      current.objectType !== 'text' &&
      current.objectType !== 'image' &&
      current.objectType !== 'path' &&
      current.objectType !== 'line'
    ) {
      return
    }
    const source = resizeState.value.originalGraphic
    const resized = updateGraphicByResize(current, handle, point, source)
    canvasStore.graphics[index] = resized
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

  if (multiDrag.value.active && activeTool.value === 'select') {
    const dx = point.x - multiDrag.value.start.x
    const dy = point.y - multiDrag.value.start.y
    const indexByObjectKey = new Map(canvasStore.graphics.map((item, index) => [item.objectKey, index]))
    multiDrag.value.objectKeys.forEach((objectKey) => {
      const index = indexByObjectKey.get(objectKey) ?? -1
      const base = multiDrag.value.baseByKey[objectKey]
      if (index === -1 || !base) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current || current.isLocked) {
        return
      }
      if (current.objectType === 'path') {
        const movedPoints = (base.pathPoints ?? current.pathPoints ?? []).map((item) => ({
          x: item.x + dx,
          y: item.y + dy,
        }))
        canvasStore.graphics[index] = {
          ...current,
          positionX: base.x + dx,
          positionY: base.y + dy,
          pathPoints: movedPoints,
        }
      } else {
        canvasStore.graphics[index] = {
          ...current,
          positionX: base.x + dx,
          positionY: base.y + dy,
        }
      }
    })
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
  pointerPressed.value = false
  window.setTimeout(() => {
    broadcastSelectionPresence(true)
  }, 0)
  if (isReadOnly.value) {
    if (selectionRect.value.active) {
      selectionRect.value.active = false
      scheduleRender()
    }
    return
  }
  if (panState.value.active) {
    panState.value.active = false
    return
  }

  if (selectionRect.value.active && activeTool.value === 'select') {
    const rect = normalizeRect(
      selectionRect.value.start.x,
      selectionRect.value.start.y,
      selectionRect.value.end.x - selectionRect.value.start.x,
      selectionRect.value.end.y - selectionRect.value.start.y,
    )
    selectionRect.value.active = false
    if (rect.width >= 4 && rect.height >= 4) {
      const picked = [...sortedGraphics.value].filter((item) => {
          const bounds = getGraphicBounds(item)
          const overlapArea = getRectIntersectionArea(bounds, rect)
          const graphicArea = Math.max(1, bounds.width * bounds.height)
          return overlapArea / graphicArea >= 0.5
        })
      if (picked.length > 0) {
        selectedObjectKeys.value = picked.map((item) => item.objectKey)
        const topMost = [...picked].sort((a, b) => b.zIndex - a.zIndex)[0]
        selectedObjectKey.value = topMost?.objectKey ?? null
      } else {
        selectedObjectKey.value = null
        selectedObjectKeys.value = []
      }
    }
    scheduleRender()
    return
  }

  if (groupRotateState.value.active) {
    beginPatchBatch()
    beginWsBatch(selectedObjectKeys.value.length, 'multi_rotate')
    selectedObjectKeys.value.forEach((objectKey) => {
      const index = canvasStore.graphics.findIndex((item) => item.objectKey === objectKey)
      const original = groupRotateState.value.originalGraphics[objectKey]
      if (index === -1 || !original) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current) {
        return
      }
      if (
        current.positionX !== original.positionX ||
        current.positionY !== original.positionY ||
        current.rotation !== original.rotation ||
        JSON.stringify(current.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null)
      ) {
        sendUpdateGraphicPatch(current.objectKey, {
          positionX: current.positionX,
          positionY: current.positionY,
          rotation: current.rotation,
          ...(Array.isArray(current.pathPoints) ? { pathPoints: current.pathPoints } : {}),
        })
      }
    })
    endWsBatch()
    endPatchBatch()
    groupRotateState.value.active = false
    groupRotateState.value.originalGraphics = {}
    scheduleRender()
    return
  }

  if (groupResizeState.value.active) {
    beginPatchBatch()
    beginWsBatch(selectedObjectKeys.value.length, 'multi_resize')
    selectedObjectKeys.value.forEach((objectKey) => {
      const index = canvasStore.graphics.findIndex((item) => item.objectKey === objectKey)
      const original = groupResizeState.value.originalGraphics[objectKey]
      if (index === -1 || !original) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current) {
        return
      }
      if (
        current.positionX !== original.positionX ||
        current.positionY !== original.positionY ||
        current.width !== original.width ||
        current.height !== original.height ||
        current.fontSize !== original.fontSize ||
        JSON.stringify(current.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null)
      ) {
        sendUpdateGraphicPatch(current.objectKey, {
          positionX: current.positionX,
          positionY: current.positionY,
          ...(typeof current.width === 'number' ? { width: current.width } : {}),
          ...(typeof current.height === 'number' ? { height: current.height } : {}),
          ...(typeof current.fontSize === 'number' ? { fontSize: current.fontSize } : {}),
          ...(Array.isArray(current.pathPoints) ? { pathPoints: current.pathPoints } : {}),
        })
      }
    })
    endWsBatch()
    endPatchBatch()
    groupResizeState.value.active = false
    groupResizeState.value.handle = null
    groupResizeState.value.originalBounds = null
    groupResizeState.value.originalGraphics = {}
    scheduleRender()
    return
  }

  if (rotateState.value.active) {
    const index = canvasStore.graphics.findIndex((item) => item.objectKey === rotateState.value.objectKey)
    if (index !== -1) {
      const current = canvasStore.graphics[index]
      const original = rotateState.value.originalGraphic
      if (current && original) {
        const pathChanged =
          JSON.stringify(current.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null)
        if (
          current.rotation !== original.rotation ||
          current.positionX !== original.positionX ||
          current.positionY !== original.positionY ||
          pathChanged
        ) {
          sendUpdateGraphicPatch(current.objectKey, {
            rotation: current.rotation,
            ...(current.objectType === 'path'
              ? {
                  positionX: current.positionX,
                  positionY: current.positionY,
                  ...(Array.isArray(current.pathPoints) ? { pathPoints: current.pathPoints } : {}),
                }
              : {}),
          })
        }
      } else if (current && current.rotation !== rotateState.value.originalRotation) {
        sendUpdateGraphicPatch(current.objectKey, { rotation: current.rotation })
      }
    }
    rotateState.value.active = false
    rotateState.value.objectKey = ''
    rotateState.value.originalGraphic = null
    scheduleRender()
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
        resized.height !== original.height ||
        resized.rotation !== original.rotation ||
        JSON.stringify(resized.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null))
    ) {
      sendUpdateGraphicPatch(resized.objectKey, {
        positionX: resized.positionX,
        positionY: resized.positionY,
        ...(typeof resized.width === 'number' ? { width: resized.width } : {}),
        ...(typeof resized.height === 'number' ? { height: resized.height } : {}),
        ...(typeof resized.fontSize === 'number' ? { fontSize: resized.fontSize } : {}),
        ...(typeof resized.rotation === 'number' ? { rotation: resized.rotation } : {}),
        ...(Array.isArray(resized.pathPoints) ? { pathPoints: resized.pathPoints } : {}),
      })
    }
    resizeState.value.originalGraphic = null
    scheduleRender()
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
    scheduleRender()
    return
  }

  if (multiDrag.value.active) {
    beginPatchBatch()
    const movedKeys = [...multiDrag.value.objectKeys]
    beginWsBatch(movedKeys.length, 'multi_move')
    movedKeys.forEach((objectKey) => {
      const index = canvasStore.graphics.findIndex((item) => item.objectKey === objectKey)
      const base = multiDrag.value.baseByKey[objectKey]
      if (index === -1 || !base) {
        return
      }
      const current = canvasStore.graphics[index]
      if (!current) {
        return
      }
      const moved =
        current.positionX !== base.x ||
        current.positionY !== base.y ||
        JSON.stringify(current.pathPoints ?? null) !== JSON.stringify(base.pathPoints ?? null)
      if (!moved) {
        return
      }
      sendUpdateGraphicPatch(current.objectKey, {
        positionX: current.positionX,
        positionY: current.positionY,
        ...(Array.isArray(current.pathPoints) ? { pathPoints: current.pathPoints } : {}),
      })
    })
    endWsBatch()
    endPatchBatch()
    multiDrag.value.active = false
    multiDrag.value.objectKeys = []
    multiDrag.value.baseByKey = {}
    scheduleRender()
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
  selectedObjectKeys.value = [graphic.objectKey]
  sendCreateGraphic(graphic)
}

const handleMouseLeave = () => {
  pointerPressed.value = false
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
  if (multiDrag.value.active) {
    multiDrag.value.active = false
    multiDrag.value.objectKeys = []
    multiDrag.value.baseByKey = {}
  }
  if (rotateState.value.active) {
    rotateState.value.active = false
    rotateState.value.objectKey = ''
    rotateState.value.originalGraphic = null
  }
  if (selectionRect.value.active) {
    selectionRect.value.active = false
  }
  lastCursorPoint.value = null
  groupRotateState.value.active = false
  groupRotateState.value.originalGraphics = {}
  groupResizeState.value.active = false
  groupResizeState.value.handle = null
  groupResizeState.value.originalBounds = null
  groupResizeState.value.originalGraphics = {}
  scheduleRender()
}


const handleUndo = async () => {
  if (isReadOnly.value) {
    return
  }
  const times = Math.max(1, undoStepCounts.value[undoStepCounts.value.length - 1] ?? 1)
  const operationId = nextOperationId('undo', 'global', false)
  const lamportTime = nextLamportTime()
  await canvasStore.undo({
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    times,
  })
  const undoNext = [...undoStepCounts.value]
  const popped = undoNext.pop() ?? 1
  undoStepCounts.value = undoNext
  redoStepCounts.value = [...redoStepCounts.value, Math.max(1, popped)]
}

const handleRedo = async () => {
  if (isReadOnly.value) {
    return
  }
  const times = Math.max(1, redoStepCounts.value[redoStepCounts.value.length - 1] ?? 1)
  const operationId = nextOperationId('redo', 'global', false)
  const lamportTime = nextLamportTime()
  await canvasStore.redo({
    operationId,
    clientId: collabClientId.value,
    baseVersion: currentVersion.value,
    lamportTime,
    times,
  })
  const redoNext = [...redoStepCounts.value]
  const popped = redoNext.pop() ?? 1
  redoStepCounts.value = redoNext
  undoStepCounts.value = [...undoStepCounts.value, Math.max(1, popped)]
}

const clampZoomPercent = (value: number) => {
  return Math.max(25, Math.min(200, value))
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
    if (event.key === 'Escape' && focusMode.value) {
      event.preventDefault()
      handleToggleFocusMode()
      return
    }
    return
  }

  const key = event.key.toLowerCase()
  if (key === 'c') {
    if (selectedGraphics.value.length > 0) {
      event.preventDefault()
      clipboardGraphics.value = selectedGraphics.value.map((item) => ({
        ...item,
        pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null,
      }))
      pasteCount.value = 0
      feedback.success(`已复制 ${clipboardGraphics.value.length} 个图元`)
    }
    return
  }
  if (key === 'v') {
    if (!isReadOnly.value && clipboardGraphics.value.length > 0 && canvasStore.currentSession) {
      event.preventDefault()
      pasteCount.value += 1
      const offset = 24 * pasteCount.value
      const created: GraphicVO[] = clipboardGraphics.value.map((item, idx) => {
        const key = generateGraphicObjectKey()
        const next: GraphicVO = {
          ...item,
          id: 0,
          objectKey: key,
          sessionId: canvasStore.currentSession?.sessionId ?? item.sessionId,
          positionX: item.positionX + offset,
          positionY: item.positionY + offset,
          pathPoints: item.pathPoints
            ? item.pathPoints.map((p) => ({ x: p.x + offset, y: p.y + offset }))
            : null,
          zIndex: canvasStore.graphics.length + idx + 1,
          creatorId: currentUserId.value ?? 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        return next
      })
      beginWsBatch(created.length, 'multi_paste')
      try {
        created.forEach((item) => {
          upsertGraphic(item)
          sendCreateGraphic(item)
        })
      } finally {
        endWsBatch()
      }
      if (created.length > 1) {
        const stack = [...undoStepCounts.value]
        stack.splice(Math.max(0, stack.length - created.length), created.length, created.length)
        undoStepCounts.value = stack
      }
      selectedObjectKeys.value = created.map((item) => item.objectKey)
      selectedObjectKey.value = selectedObjectKeys.value[selectedObjectKeys.value.length - 1] ?? null
      feedback.success(`已粘贴 ${created.length} 个图元`)
    }
    return
  }
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
    return
  }
  if (key === 'l') {
    event.preventDefault()
    handleToggleLock()
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

const clampFocusActionsPosition = (x: number, y: number) => {
  const panelWidth = Math.max(
    120,
    Math.ceil(focusActionsRef.value?.getBoundingClientRect().width ?? (focusActionsCollapsed.value ? 130 : 360)),
  )
  const panelHeight = Math.max(40, Math.ceil(focusActionsRef.value?.getBoundingClientRect().height ?? 48))
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
  const panelWidth = Math.max(
    120,
    Math.ceil(focusActionsRef.value?.getBoundingClientRect().width ?? (focusActionsCollapsed.value ? 130 : 360)),
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

watch(
  () => selectedGraphic.value,
  (graphic) => {
    selectedStyleSyncReleaseTask += 1
    const taskId = selectedStyleSyncReleaseTask
    syncingSelectedStyle.value = true
    if (!graphic) {
      strokeColor.value = '#1f2937'
      fillColor.value = 'transparent'
      strokeWidth.value = 2
      lineStyle.value = 'solid'
      queueMicrotask(() => {
        if (taskId === selectedStyleSyncReleaseTask) {
          syncingSelectedStyle.value = false
        }
      })
      return
    }
    strokeColor.value = graphic.strokeColor || '#1f2937'
    fillColor.value = graphic.fillColor || 'transparent'
    strokeWidth.value = graphic.strokeWidth || 2
    lineStyle.value = graphic.lineStyle || 'solid'
    queueMicrotask(() => {
      if (taskId === selectedStyleSyncReleaseTask) {
        syncingSelectedStyle.value = false
      }
    })
  },
  { immediate: true },
)

watch(
  () => [selectedObjectKey.value, [...selectedObjectKeys.value].sort().join('|'), wsConnected.value, joined.value, sessionKey.value],
  () => {
    broadcastSelectionPresence()
  },
)

watch(
  () => strokeColor.value,
  (value) => {
    if (syncingSelectedStyle.value || selectedGraphics.value.length === 0) {
      return
    }
    const selected = selectedGraphic.value
    if (selectedGraphics.value.length <= 1 && selected && selected.strokeColor === value) {
      return
    }
    queueStyleCommitPatch({ strokeColor: value })
  },
)

watch(
  () => strokeWidth.value,
  (value) => {
    if (syncingSelectedStyle.value || selectedGraphics.value.length === 0) {
      return
    }
    const selected = selectedGraphic.value
    if (selectedGraphics.value.length <= 1 && selected && selected.strokeWidth === value) {
      return
    }
    queueStyleCommitPatch({ strokeWidth: value })
  },
)

watch(
  () => lineStyle.value,
  (value) => {
    if (syncingSelectedStyle.value || selectedGraphics.value.length === 0 || !canEditLineStyle.value) {
      return
    }
    const selected = selectedGraphic.value
    if (selectedGraphics.value.length <= 1 && selected && selected.lineStyle === value) {
      return
    }
    queueStyleCommitPatch({ lineStyle: value })
  },
)

watch(
  () => fillColor.value,
  (value) => {
    if (syncingSelectedStyle.value || selectedGraphics.value.length === 0 || !canEditFillColor.value) {
      return
    }
    const modelFill = value === 'transparent' ? null : value
    const selected = selectedGraphic.value
    if (selectedGraphics.value.length <= 1 && selected && selected.fillColor === modelFill) {
      return
    }
    queueStyleCommitPatch({ fillColor: modelFill })
  },
)

watch(
  () => isReadOnly.value,
  (readonly) => {
    if (!readonly) {
      return
    }
    draft.value.active = false
    draft.value.points = []
    dragMove.value.active = false
    dragMove.value.basePathPoints = null
    dragMove.value.originalGraphic = null
    resizeState.value.active = false
    resizeState.value.handle = null
    resizeState.value.originalGraphic = null
    rotateState.value.active = false
    rotateState.value.objectKey = ''
    rotateState.value.originalGraphic = null
    multiDrag.value.active = false
    multiDrag.value.objectKeys = []
    multiDrag.value.baseByKey = {}
    groupRotateState.value.active = false
    groupRotateState.value.originalGraphics = {}
    groupResizeState.value.active = false
    groupResizeState.value.handle = null
    groupResizeState.value.originalBounds = null
    groupResizeState.value.originalGraphics = {}
    patchBatchState.value.active = false
    patchBatchState.value.count = 0
    wsBatchMeta.value = null
    selectionRect.value.active = false
    if (!readonly) {
      return
    }
    remoteCursors.value = {}
    remoteSelections.value = {}
    scheduleRender()
  },
)

watch(
  () => zoomPercent.value,
  () => {
    scheduleRender()
  },
)

watch(
  () => focusMode.value,
  (value) => {
    if (value) {
      placeFocusActionsToRight()
    }
    nextTick(() => {
      resizeCanvas()
      scheduleRender()
    })
  },
)

watch(
  () => focusActionsCollapsed.value,
  (collapsed) => {
    nextTick(() => {
      if (collapsed) {
        placeFocusActionsToRight()
        return
      }
      const clamped = clampFocusActionsPosition(focusActionsPos.value.x, focusActionsPos.value.y)
      focusActionsPos.value = clamped
    })
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
  loadCanvasBackgroundColor()
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
  if (styleCommitTimer.value !== null) {
    window.clearTimeout(styleCommitTimer.value)
    styleCommitTimer.value = null
  }
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearHeartbeat()
  clearRenderFrame()
  teardownResizeObserver()
  stopFocusActionsDrag()

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
  imageObjectUrlBySource.forEach((url) => URL.revokeObjectURL(url))
  imageObjectUrlBySource.clear()
  imageFallbackLoading.clear()
  canvasStore.clearSession()
})
</script>

<template>
  <div ref="drawPageRef" class="draw-page" :class="{ 'focus-mode': focusMode }">
    <TopBar
      v-if="!focusMode"
      :session-name="currentSessionName"
      :members="sessionDetail?.members ?? []"
      :is-creator="isCreator"
      :can-manage-members="canManageMembers"
      :can-pause-canvas="canPauseCanvas"
      :is-paused="isPaused"
      :show-grid="showGrid"
      :background-color="canvasBackgroundColor"
      :focus-mode="focusMode"
      :user-avatar="authStore.user?.avatar"
      @update:session-name="handleUpdateSessionName"
      @back="handleBackToList"
      @share="handleShare"
      @export-image="handleExportImage"
      @toggle-grid="handleToggleGrid"
      @show-members-manage="handleShowMembersManage"
      @toggle-paused="handleTogglePaused"
      @show-history="handleShowOperationHistory"
      @show-conflicts="handleShowConflictHistory"
      @show-versions="handleShowVersionHistory"
      @show-shortcuts="handleShowShortcuts"
      @toggle-focus-mode="handleToggleFocusMode"
      @show-guide="handleShowGuide"
      @show-background="handleShowBackground"
      @close-session="handleCloseSession"
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

    <div class="draw-main" :class="{ 'focus-mode': focusMode }" v-loading="joining">
      <ToolBar
        v-model:active-tool="activeTool"
        v-model:shape-type="shapeType"
        v-model:stroke-color="strokeColor"
        v-model:fill-color="fillColor"
        v-model:stroke-width="strokeWidth"
        v-model:line-style="lineStyle"
        v-model:pan-mode="panMode"
        :can-undo="canvasStore.canUndo"
        :can-redo="canvasStore.canRedo"
        :zoom-percent="zoomPercent"
        :can-edit-line-style="canEditLineStyle"
        :can-delete="canDeleteSelected"
        :can-bring-forward="canBringForward"
        :can-send-backward="canSendBackward"
        :can-toggle-lock="canToggleLock"
        :selected-locked="selectedLocked"
        :selected-lock-state="selectedLockState"
        :read-only="isReadOnly"
        :importing-image="importingImage"
        :layout="focusMode ? 'horizontal' : 'vertical'"
        @undo="handleUndo"
        @redo="handleRedo"
        @delete="deleteSelectedGraphic"
        @import-image="handleImportImage"
        @bring-forward="handleBringForward"
        @send-backward="handleSendBackward"
        @toggle-lock="handleToggleLock"
      />
      <div
        v-if="focusMode"
        ref="focusActionsRef"
        class="focus-top-actions"
        :class="{ collapsed: focusActionsCollapsed, dragging: focusActionsDragging }"
        :style="{ left: `${focusActionsPos.x}px`, top: `${focusActionsPos.y}px` }"
      >
        <button class="focus-drag-handle" type="button" title="拖动浮窗" @mousedown.stop.prevent="startFocusActionsDrag">
          ⋮⋮
        </button>
        <button class="focus-collapse-btn" type="button" @click="focusActionsCollapsed = !focusActionsCollapsed">
          {{ focusActionsCollapsed ? '展开' : '收起' }}
        </button>
        <template v-if="!focusActionsCollapsed">
          <button class="focus-action-btn" type="button" @click="handleExportImage">
            导出
          </button>
          <button class="focus-action-btn" type="button" @click="handleToggleGrid">
            {{ showGrid ? '隐藏网格' : '显示网格' }}
          </button>
          <button class="focus-action-btn" type="button" @click="handleShowShortcuts">
            快捷键
          </button>
          <button class="focus-action-btn focus-action-btn-primary" type="button" @click="handleToggleFocusMode">
            退出专注 (Esc)
          </button>
        </template>
      </div>

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
          <input
            ref="imageFileInputRef"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            style="display: none"
            @change="handleImageFileChange"
          />
        </div>
      </section>

      <MemberPanel
        v-if="!focusMode"
        :members="sessionDetail?.members ?? []"
        :collapsed="memberPanelCollapsed"
        :loading="loadingMembers"
        @toggle-collapse="toggleMemberPanel"
      />
    </div>

    <StatusBar
      :zoom-percent="zoomPercent"
      :zoom-options="zoomOptions"
      :graphic-count="canvasStore.graphics.length"
      :snapshot-count="snapshots.length"
      :current-version="currentVersion"
      :server-version="serverVersionRef"
      :client-version="clientVersionRef"
      :pending-operations="pendingOperationsCount"
      :recent-conflicts="recentConflictCount"
      :connected="wsConnected"
      :reconnecting="reconnecting"
      :reconnect-failed="reconnectFailed"
      :client-id="collabClientId"
      :lamport-time="lamportClock"
      :last-sync-at="lastSyncText"
      :reconnect-count="reconnectTotalCount"
      :technical-mode="technicalMode"
      @update:technical-mode="technicalMode = $event"
      @update:zoom-percent="zoomPercent = Number($event)"
    />

    <MemberManageDialog
      v-model:visible="memberManageDialogVisible"
      :members="sessionDetail?.members ?? []"
      :include-history="includeHistoryMembers"
      :loading="loadingMembers"
      :current-user-id="currentUserId"
      :current-user-role="myRole"
      :can-manage-roles="canManageRoles"
      :can-remove-members="canRemoveMembers"
      @update:include-history="updateHistoryToggle"
      @update-role="handleUpdateMemberRole"
      @remove-member="handleRemoveMember"
    />

    <OnboardingGuide
      v-model:visible="onboardingVisible"
      :steps="onboardingSteps"
    />

    <ShortcutHelpDialog v-model:visible="shortcutDialogVisible" />

    <InviteDialog
      v-model:visible="inviteDialogVisible"
      :loading="inviteDialogLoading"
      :list-loading="inviteListLoading"
      :can-invite="canManageMembers"
      :can-invite-manager="isCreator"
      :invites="inviteList"
      @create="handleCreateInvite"
      @refresh="loadInviteList"
      @copy="handleCopyInvite"
      @revoke="handleRevokeInvite"
      @show-qr="handleShowInviteQr"
    />

    <el-dialog v-model="shareQrcodeVisible" title="邀请码二维码" width="360px">
      <div style="display: flex; justify-content: center; padding: 12px 0">
        <el-image
          v-if="shareQrcodePendingLink"
          :src="`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(shareQrcodePendingLink)}`"
          fit="contain"
          style="width: 240px; height: 240px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff"
        />
      </div>
      <div style="font-size: 12px; color: #64748b; word-break: break-all; text-align: center">
        {{ shareQrcodePendingLink }}
      </div>
      <template #footer>
        <el-button @click="shareQrcodeVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="exportDialogVisible" title="导出画布" width="420px">
      <el-radio-group v-model="exportFormat">
        <el-radio label="png">PNG（位图）</el-radio>
        <el-radio label="svg">SVG（矢量容器）</el-radio>
        <el-radio label="pdf">PDF</el-radio>
      </el-radio-group>
      <div style="margin-top: 12px;">
        <el-switch
          v-model="exportIncludeGrid"
          inline-prompt
          active-text="带网格"
          inactive-text="无网格"
        />
      </div>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmExportImage">导出</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="backgroundDialogVisible" title="画布背景" width="420px">
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px;">
        <button
          v-for="color in canvasBackgroundPresets"
          :key="color"
          type="button"
          :title="color"
          :style="{
            width: '100%',
            height: '34px',
            borderRadius: '8px',
            border: canvasBackgroundColor === color ? '2px solid #2563eb' : '1px solid #d1d5db',
            background: color,
            cursor: 'pointer',
          }"
          @click="applyCanvasBackgroundColor(color)"
        ></button>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 13px; color: #475569;">自定义颜色</span>
        <el-color-picker
          :model-value="canvasBackgroundColor"
          color-format="hex"
          @change="(value: string | null) => value && applyCanvasBackgroundColor(String(value))"
        />
        <span style="font-size: 12px; color: #64748b;">当前：{{ canvasBackgroundColor }}</span>
      </div>
      <template #footer>
        <el-button @click="backgroundDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <OperationTimelineDialog
      v-model:visible="operationHistoryVisible"
      :loading="operationTimelineLoading"
      :list="operationTimelineForDisplay"
      :page="operationTimelinePage"
      :page-size="operationTimelinePageSize"
      :total="operationTimelineTotal"
      :user-options="operationTimelineUserOptions"
      :filter-user-id="operationTimelineFilterUserId"
      :filter-operation-type="operationTimelineFilterOperationType"
      :filter-conflict-type="operationTimelineFilterConflictType"
      :filter-from-version="operationTimelineFilterFromVersion"
      :filter-to-version="operationTimelineFilterToVersion"
      :is-technical-expanded="isOperationTimelineTechnicalExpanded"
      :can-locate-object="canLocateHistoryObject"
      :format-session-operation-type-label="formatSessionOperationTypeLabel"
      :format-operation-actor-label="formatOperationActorLabel"
      :format-conflict-type-label="formatConflictTypeLabel"
      :format-timeline-activity-text="formatTimelineActivityText"
      :format-timeline-conflict-hint="formatTimelineConflictHint"
      :format-field-names-text="formatFieldNamesText"
      :format-field-name-label="formatFieldNameLabel"
      :get-resolved-field-list="getResolvedFieldList"
      :format-resolve-reason-label="formatResolveReasonLabel"
      @update:filter-user-id="operationTimelineFilterUserId = $event"
      @update:filter-operation-type="operationTimelineFilterOperationType = $event"
      @update:filter-conflict-type="operationTimelineFilterConflictType = $event"
      @update:filter-from-version="operationTimelineFilterFromVersion = $event"
      @update:filter-to-version="operationTimelineFilterToVersion = $event"
      @search="handleOperationTimelineSearch"
      @reset="handleResetOperationTimelineFilters"
      @page-change="handleOperationTimelinePageChange"
      @toggle-technical="toggleOperationTimelineTechnical"
      @locate-object="locateTimelineObject"
    />

    <ConflictLogDialog
      v-model:visible="conflictHistoryVisible"
      :loading="loadingConflictLogs"
      :list="conflictLogs"
      :is-technical-expanded="isConflictTechnicalExpanded"
      :format-conflict-type-label="formatConflictTypeLabel"
      :format-field-name-label="formatFieldNameLabel"
      :format-conflict-log-summary="formatConflictLogSummary"
      :format-conflict-resolve-strategy-label="formatConflictResolveStrategyLabel"
      :format-conflict-value="formatConflictValue"
      :can-locate-object="canLocateHistoryObject"
      @refresh="refreshConflictLogs(true)"
      @toggle-technical="toggleConflictTechnical"
      @locate-object="locateConflictObject"
    />

    <VersionHistoryDialog
      v-model:visible="versionHistoryVisible"
      :loading="loadingSnapshots"
      :replay-loading="replayLoading"
      :replay-target-version="replayTargetVersion"
      :current-version="currentVersion"
      :current-snapshot-version="currentSnapshotVersion"
      :list="snapshots"
      :can-create-snapshot="canCreateSnapshot"
      :can-restore-snapshot="canRestoreSnapshot"
      @refresh="refreshSnapshots"
      @create-snapshot="createSnapshotNow"
      @replay="applyReplayToCanvas"
      @restore="restoreToVersion"
    />
  </div>
</template>
