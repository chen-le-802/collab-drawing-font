<script setup lang="ts">
// DrawCanvas 主页面控制器：
// 统一编排会话加入、WebSocket 协同、画布交互、历史/冲突/快照等子模块。
//
// 文件职责总览：
// 1) 页面框架层：组装 TopBar / ToolBar / StatusBar / MemberPanel 与各类业务弹窗。
// 2) 交互状态层：处理选中、框选、拖拽、缩放、旋转、绘制、文本编辑、复制粘贴。
// 3) 渲染管线层：renderCanvas 统一执行背景/网格/图元/草稿/选择态/协作标记绘制。
// 4) 协作同步层：管理 WS 连接、重连、心跳、版本推进、Lamport 时钟、批量操作元数据。
// 5) 会话业务层：加入离开、成员管理、权限控制、快照恢复、操作历史和冲突日志。
// 6) 一致性补偿层：pendingCreate + deferredQueue，保证 create 与后续 patch/delete 因果顺序。
//
// 主流程（从用户操作到全员同步）：
// 鼠标事件 -> 本地草稿/变换 -> sendCreate|sendUpdate|sendDelete ->
// 后端裁决与落库 -> WS 广播 -> handleGraphic* 回写本地 -> scheduleRender 重绘。
//
// 重点函数：
// onMounted -> bindWs -> handleMouseDown -> handleMouseMove -> handleMouseUp ->
// sendCreateGraphic/sendUpdateGraphicPatch/sendDeleteGraphicByObjectKey ->
// handleGraphicCreated/Updated/Deleted -> renderCanvas。
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

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
  MemberVO,
  SessionConflictLogItemVO,
  SessionDetailVO,
  SessionInviteItemVO,
  SessionJoinVO,
  SessionOperationItemVO,
  SessionSnapshotItemVO,
} from '@/types/session'
import { storage } from '@/utils/storage'
import { confirmDanger, feedback } from '@/utils/feedback'
import WebSocketClient from '@/ws/client'
import { useCanvasViewControls } from '@/views/DrawCanvas/js/useCanvasViewControls'
import { useCanvasKeyboard } from '@/views/DrawCanvas/js/useCanvasKeyboard'
import {
  getArrowEndpoints,
  getGraphicBounds as getGraphicBoundsCore,
  getGraphicCenter as getGraphicCenterCore,
  getGraphicSelectionRotationRad as getGraphicSelectionRotationRadCore,
  getLocalResizeBounds as getLocalResizeBoundsCore,
  getPathSelectionOutlinePoints as getPathSelectionOutlinePointsCore,
  getRotatedRectBounds,
  isArrowPathGraphic,
  isClosedPath as isClosedPathCore,
  isLineLikeGraphic,
  normalizeRect,
  rotatePoint,
  rotatePointByAngle,
} from '@/views/DrawCanvas/js/canvasGeometry'
import { createCanvasTransformHelpers, type ResizeHandleKey as TransformResizeHandleKey } from '@/views/DrawCanvas/js/useCanvasTransformHelpers'
import { createCanvasHitTestHelpers } from '@/views/DrawCanvas/js/useCanvasHitTest'
import { createCanvasDraftHelpers } from '@/views/DrawCanvas/js/useCanvasDraftHelpers'
import { useCanvasDrawPrimitives } from '@/views/DrawCanvas/js/useCanvasDrawPrimitives'
import { useInviteMemberManagement } from '@/views/DrawCanvas/js/useInviteMemberManagement'
import { useOperationHistory, type OperationHistorySource } from '@/views/DrawCanvas/js/useOperationHistory'
import { useOperationConflictLogs } from '@/views/DrawCanvas/js/useOperationConflictLogs'
import { useSessionJoinLeave } from '@/views/DrawCanvas/js/useSessionJoinLeave'
import { useSessionLifecycle } from '@/views/DrawCanvas/js/useSessionLifecycle'
import { useVersionSnapshots } from '@/views/DrawCanvas/js/useVersionSnapshots'
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
  SessionRestoredData,
  SessionPausedData,
  WsErrorData,
} from '@/ws/types'
import './styles.css'

// 对话框按需异步加载，降低首屏体积与初次渲染压力。
const ConflictLogDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/ConflictLogDialog.vue'))
const InviteDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/InviteDialog.vue'))
const MemberManageDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/MemberManageDialog.vue'))
const OnboardingGuide = defineAsyncComponent(() => import('@/views/DrawCanvas/components/OnboardingGuide.vue'))
const OperationTimelineDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/OperationTimelineDialog.vue'))
const ShortcutHelpDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/ShortcutHelpDialog.vue'))
const VersionHistoryDialog = defineAsyncComponent(() => import('@/views/DrawCanvas/components/VersionHistoryDialog.vue'))

// 画布基础坐标点（世界坐标）。
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

type ResizeHandleKey = TransformResizeHandleKey

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

// 路由与全局状态入口。
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const canvasStore = useCanvasStore()

// DOM 引用：画布本体、容器、专注模式浮窗。
const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasContainerRef = ref<HTMLDivElement | null>(null)
const drawPageRef = ref<HTMLDivElement | null>(null)
const focusActionsRef = ref<HTMLDivElement | null>(null)

// 会话连接状态（加入、重连、同步提示）。
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

// 会话与成员数据。
const sessionInfo = ref<SessionJoinVO | null>(null)
const sessionDetail = ref<SessionDetailVO | null>(null)
const loadingMembers = ref(false)
const memberPanelCollapsed = ref(false)
const includeHistoryMembers = ref(false)
const navigatingAway = ref(false)
const currentUserId = ref<number | null>(authStore.user?.userId ?? null)

// 工具栏与画布视图状态（工具、样式、缩放、平移）。
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
// 面板/弹窗可见性。
const shortcutDialogVisible = ref(false)
const operationHistoryVisible = ref(false)
const conflictHistoryVisible = ref(false)
const versionHistoryVisible = ref(false)
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
// 快照与会话运行附加状态。
const importingImage = ref(false)
const imageFileInputRef = ref<HTMLInputElement | null>(null)
const snapshots = ref<SessionSnapshotItemVO[]>([])
const currentSnapshotVersion = ref<number | null>(null)
const pausedByOperator = ref('')
const loadingSnapshots = ref(false)
const replayLoading = ref(false)
const replayTargetVersion = ref<number | null>(null)
// 协作元数据：Lamport 时钟、版本、批量操作上下文、待确认操作队列。
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
// 他人协作可视化状态（当前以选中态为主，光标追踪预留）。
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

// 交互瞬态：草稿绘制、拖拽、缩放、旋转、框选等。
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

// 防抖同步标记：避免“选择变化 -> UI回填 -> watch再次提交”形成循环提交。
const syncingSelectedStyle = ref(false)
let selectedStyleSyncReleaseTask = 0

// 常用派生状态。
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
const readOnlyHintText = computed(() => {
  if (!isReadOnly.value) {
    return ''
  }
  if (isPaused.value) {
    const operator = pausedByOperator.value.trim()
    return operator
      ? `画布已被 ${operator} 暂停，你当前仅可查看与平移。`
      : '画布已暂停，你当前仅可查看与平移。'
  }
  if (myRole.value <= 0) {
    return '你当前权限为只读，暂无编辑权限。'
  }
  return '当前为只读模式。'
})
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
const ONBOARDING_SEEN_KEY_PREFIX = 'collab_canvas_onboarding_seen_v1'

// ------------------------------
// 页面初始化与配置读取
// ------------------------------
const getOnboardingSeenKey = () => {
  const userId = currentUserId.value ?? authStore.user?.userId ?? 0
  return `${ONBOARDING_SEEN_KEY_PREFIX}:${userId}`
}

const hasSeenOnboarding = (): boolean => {
  try {
    return localStorage.getItem(getOnboardingSeenKey()) === '1'
  } catch {
    return false
  }
}

const markOnboardingSeen = () => {
  try {
    localStorage.setItem(getOnboardingSeenKey(), '1')
  } catch {
    // 忽略 localStorage 异常
  }
}

// 统一拼接 WebSocket 地址（随当前页面协议自动切换 ws/wss）。
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

// 计算插图初始尺寸：保持宽高比，并限制在画布可视范围内。
const resolveImageInsertSize = (naturalWidth: number, naturalHeight: number): { width: number; height: number } => {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: IMAGE_INSERT_BOX_WIDTH, height: IMAGE_INSERT_BOX_HEIGHT }
  }
  const scale = Math.min(IMAGE_INSERT_BOX_WIDTH / naturalWidth, IMAGE_INSERT_BOX_HEIGHT / naturalHeight)
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  return { width, height }
}

// 为当前浏览器实例分配稳定 clientId，用于协作端识别与日志追踪。
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

// ------------------------------
// 通用解析与格式化工具
// ------------------------------
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

const formatOperationActorLabel = (userId: number) => {
  return findMemberNameByUserId(userId) || `用户 ${userId}`
}

const {
  operationTimelineLoading,
  operationTimelineFilterUserId,
  operationTimelineFilterOperationType,
  operationTimelineFilterConflictType,
  operationTimelineFilterFromVersion,
  operationTimelineFilterToVersion,
  operationTimelinePage,
  operationTimelinePageSize,
  operationTimelineForDisplay,
  operationTimelineTotal,
  operationTimelineUserOptions,
  conflictLogs,
  loadingConflictLogs,
  isOperationTimelineTechnicalExpanded,
  toggleOperationTimelineTechnical,
  isConflictTechnicalExpanded,
  toggleConflictTechnical,
  openOperationTimeline,
  resetOperationTimelineFilters,
  searchOperationTimeline,
  changeOperationTimelinePage,
  refreshConflictLogs,
  formatSessionOperationTypeLabel,
  formatFieldNamesText,
  formatConflictTypeLabel,
  formatFieldNameLabel,
  formatTimelineActivityText,
  formatTimelineConflictHint,
  getResolvedFieldList,
  formatResolveReasonLabel,
  formatConflictResolveStrategyLabel,
  formatConflictValue,
  formatConflictLogSummary,
  operationTimelineTechnicalExpandedIds,
  conflictTechnicalExpandedIds,
} = useOperationConflictLogs({
  getSessionKey: () => sessionKey.value,
  getSessionMembers: () => sessionDetail.value?.members ?? [],
  getOperationActorLabel: formatOperationActorLabel,
  isRecord,
  parseNumber,
})

// 生成本地 Lamport 时间：保证同端消息全序且与系统时间单调对齐。
const nextLamportTime = () => {
  lamportClock.value = Math.max(lamportClock.value + 1, Date.now())
  return lamportClock.value
}

// 生成客户端 operationId，并可按 objectKey 跟踪“待服务端确认”的操作。
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

// 初始化一次批量操作的 WS 分组元数据（用于后端日志聚合、撤销分组）。
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

// 消费当前批次中的一条索引信息，附带到每次 WS 发送。
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

// 图元尚未服务端确认创建前，先缓存 patch/delete，待创建回执后回放。
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

// 回放某图元的延迟操作队列，保证 create 与后续 update/delete 的因果顺序。
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

// ------------------------------
// 本地历史分组：把多图元一次操作记为一个撤销步
// ------------------------------
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

// 把样式面板短时间内的多次改动合并后提交，减少 WS 消息量。
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

// 兜底获取当前用户 id，防止 store 丢失时后续协作消息缺操作者字段。
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

// ------------------------------
// 在线保活与协作存在感广播
// ------------------------------
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
    // 忽略心跳发送异常
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

// 渲染调度：一帧内合并多次状态变更，避免重复重绘。
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

// 广播“我当前选中了哪些图元”，供其他成员看到实时占用状态。
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

// ------------------------------
// 坐标系与几何适配
// ------------------------------
const getCtx = (): CanvasRenderingContext2D | null => {
  const canvas = canvasRef.value
  if (!canvas) {
    return null
  }
  return canvas.getContext('2d')
}

// 把屏幕坐标转为画布世界坐标（反向应用缩放与平移）。
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

const getGraphicBounds = (graphic: GraphicVO) => getGraphicBoundsCore(graphic)
const getGraphicCenter = (graphic: GraphicVO): Point => getGraphicCenterCore(graphic, PATH_CLOSE_DISTANCE)
const getLocalResizeBounds = (graphic: GraphicVO) => getLocalResizeBoundsCore(graphic)
const getGraphicSelectionRotationRad = (graphic: GraphicVO): number =>
  getGraphicSelectionRotationRadCore(graphic, PATH_CLOSE_DISTANCE)
const getPathSelectionOutlinePoints = (graphic: GraphicVO): Point[] =>
  getPathSelectionOutlinePointsCore(graphic, PATH_CLOSE_DISTANCE)
// 统一返回图元选中轮廓点：path 使用旋转轮廓，普通图元使用包围盒四角。
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

const {
  pickGraphic,
} = createCanvasHitTestHelpers({
  getGraphicBounds,
  getArrowEndpoints,
  isClosedPath,
})

const {
  normalizePathPointsOnFinish,
  buildArrowPathPoints,
  getShapeVertexCount,
  buildRegularPolygonPathPoints,
  normalizeCircleDraftRect,
} = createCanvasDraftHelpers({
  pathCloseDistance: PATH_CLOSE_DISTANCE,
  arrowHeadBase: ARROW_HEAD_BASE,
  arrowHeadMax: ARROW_HEAD_MAX,
})

const {
  rotatePointAround,
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
} = createCanvasTransformHelpers({
  getGraphicBounds,
  getGraphicCenter,
  getLocalResizeBounds,
  getGraphicSelectionRotationRad,
  getPathSelectionOutlinePoints,
  isArrowPathGraphic,
  getArrowEndpoints,
  buildArrowPathPoints,
  resizeHandleHitSize: RESIZE_HANDLE_HIT_SIZE,
  rotateHandleHitSize: ROTATE_HANDLE_HIT_SIZE,
  rotateHandleOffset: ROTATE_HANDLE_OFFSET,
  resizeMinSize: RESIZE_MIN_SIZE,
  textMinFontSize: TEXT_MIN_FONT_SIZE,
  textMaxFontSize: TEXT_MAX_FONT_SIZE,
})

// 命中测试入口：按 zIndex 顺序挑选点击命中的顶层图元。
const pickGraphicAtPoint = (point: Point): GraphicVO | null => pickGraphic(point, sortedGraphics.value)

const {
  drawLine,
  drawRect,
  drawCircle,
  drawText,
  drawPath,
  drawImageGraphic,
  drawGraphic,
  disposeImageResources,
} = useCanvasDrawPrimitives({
  isArrowPathGraphic,
  isClosedPath,
  scheduleRender,
  getToken: () => storage.getToken(),
})

// ------------------------------
// 绘制层：网格、选中框、多人标签
// ------------------------------
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

const {
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
} = useCanvasViewControls({
  canvasRef,
  focusActionsRef,
  getZoomScale: () => zoomScale.value,
  getViewportOffset: () => viewportOffset.value,
  getSortedGraphics: () => sortedGraphics.value,
  getCurrentSessionName: () => currentSessionName.value,
  drawGrid,
  drawGraphic,
  scheduleRender,
  onError: (message) => feedback.error(message),
  onErrorFrom: (error, fallback) => feedback.errorFrom(error, fallback),
  onSuccess: (message) => feedback.success(message),
})

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

// 单选完整控制框：虚线框 + 八个锚点 + 旋转手柄 + 锁定标识。
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

// 轻量选中框：交互进行中只画轮廓，减轻重绘压力。
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

// 多选整体框：把多个图元抽象成一个可旋转/缩放/拖拽的群组控制框。
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

// 对当前选中图元批量应用样式（支持多选统一改色/线宽/线型）。
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

// 根据当前工具与鼠标拖拽草稿，实时构建预览图元（未提交到服务端）。
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

// 绘制他人选中态标签：显示“谁正在操作哪个图元”。
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

// 统一渲染主链路：背景/网格 -> 图元 -> 草稿 -> 选择态 -> 远端协作标记。
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

// ------------------------------
// 本地图元仓库写入
// ------------------------------
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

// 全量/增量同步后的合并策略：按 objectKey 去重覆盖，保持本地引用稳定。
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

// 将后端/历史格式的未知数据归一化为前端 GraphicVO。
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

// 版本推进：维护会话当前版本、客户端版本、服务端版本三者一致。
const updateSessionVersion = (version: number) => {
  serverVersionRef.value = version
  if (sessionInfo.value) {
    sessionInfo.value.currentVersion = version
  }
  if (sessionDetail.value) {
    sessionDetail.value.currentVersion = version
  }
}

// ------------------------------
// 与后端同步：优先增量回放，必要时全量拉取
// ------------------------------
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

// ------------------------------
// WS 事件处理
// ------------------------------
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

// 服务端确认创建后：落本地、清 pending、回放该图元延迟队列。
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

// 服务端更新回执：合并 patch，并对缺失图元做恢复补偿。
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
  pausedByOperator.value = payload.isPaused ? operator : ''
  feedback.info(`${operator}${payload.isPaused ? '暂停了画布' : '恢复了画布'}`)
  scheduleRender()
}

// 他人恢复快照后：当前端主动做一次全量补偿同步，保证画布实时与服务端一致。
const handleSessionRestored = (payload: SessionRestoredData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  const operator = payload.operatorUsername || `用户#${payload.operatorUserId}`
  feedback.info(
    `${operator}恢复到版本 V${payload.targetVersion}（当前 V${payload.restoredVersion}）`,
  )
  void syncGraphicsFromServer(true)
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

// 冲突解决事件：记录冲突焦点、提示策略结果，并刷新渲染。
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

// 将单条历史操作重放到当前画布（用于断线重连后的增量追平）。
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

// WS 事件总线绑定：把网络事件接入当前页面状态机。
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
  client.on('session_restored', handleSessionRestored)
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
  client.off('session_restored', handleSessionRestored)
  client.off('session_paused', handleSessionPaused)
  client.off('graphic_created', handleGraphicCreated)
  client.off('graphic_updated', handleGraphicUpdated)
  client.off('graphic_deleted', handleGraphicDeleted)
  client.off('operation_resolved', handleWsOperationResolved)
  client.off('undo_result', handleWsUndoResult)
  client.off('redo_result', handleWsRedoResult)
}

const {
  onVisibilityChange: lifecycleOnVisibilityChange,
  refreshSessionMembers,
  scheduleMembersRefresh,
  clearMembersRefreshTimer,
} = useSessionLifecycle({
  getSessionKey: () => sessionKey.value,
  getJoined: () => joined.value,
  isWsConnected: () => wsConnected.value,
  reconnectWs: () => {
    if (!wsClient) {
      return
    }
    wsClient.connect()
  },
  getIncludeHistoryMembers: () => includeHistoryMembers.value,
  getSessionDetail: () => sessionDetail.value,
  setSessionDetail: (detail) => {
    sessionDetail.value = detail
  },
  setLoadingMembers: (loading) => {
    loadingMembers.value = loading
  },
  onMemberRefreshError: (error) => {
    feedback.errorFrom(error, '刷新成员列表失败')
  },
})

const {
  inviteDialogVisible,
  inviteDialogLoading,
  inviteListLoading,
  inviteList,
  memberManageDialogVisible,
  shareQrcodePendingLink,
  shareQrcodeVisible,
  loadInviteList,
  openInviteDialog,
  handleCreateInvite,
  handleCopyInvite,
  handleShowInviteQr,
  handleRevokeInvite,
  handleShowMembersManage,
  handleUpdateMemberRole,
  handleRemoveMember,
} = useInviteMemberManagement({
  getSessionKey: () => sessionKey.value,
  canRemoveMember: () => isCreator.value,
  refreshSessionMembers,
  confirmDanger,
  onSuccess: (message) => feedback.success(message),
  onError: (error, fallback) => feedback.errorFrom(error, fallback),
  onWarning: (message) => feedback.warning(message),
})

const {
  joinSession,
  handleLeaveSession,
  handleDeleteSession,
} = useSessionJoinLeave({
  getSessionKey: () => sessionKey.value,
  getInviteToken: () => (typeof route.query.inviteToken === 'string' ? route.query.inviteToken.trim() : undefined),
  getJoining: () => joining.value,
  getJoined: () => joined.value,
  getIncludeHistoryMembers: () => includeHistoryMembers.value,
  getIsCreator: () => isCreator.value,
  getWsUrl,
  getToken: () => storage.getToken(),
  ensureCurrentUserId,
  setJoining: (value) => {
    joining.value = value
  },
  setJoined: (value) => {
    joined.value = value
  },
  setNavigatingAway: (value) => {
    navigatingAway.value = value
  },
  setSessionInfo: (value) => {
    sessionInfo.value = value
  },
  setSessionDetail: (value) => {
    sessionDetail.value = value
  },
  setWsClient: (value) => {
    wsClient = value
  },
  bindWs,
  bindCanvasSession: (joinedData, client) => {
    canvasStore.bindSession(joinedData, client)
  },
  startHeartbeat,
  confirmAction: (message, title, confirmButtonText) =>
    confirmDanger(message, title, {
      confirmButtonText,
    }),
  onError: (error, fallback) => feedback.errorFrom(error, fallback),
  onSuccess: (message) => feedback.success(message),
  navigate: async (path) => {
    if (path === '/') {
      await router.replace('/')
      return
    }
    if (path.startsWith('/session/')) {
      await router.replace({
        path,
        query: {},
      })
      return
    }
    await router.push(path)
  },
})

// ------------------------------
// 顶栏/面板动作处理
// ------------------------------
const handleTransferCreator = (member: MemberVO) => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  feedback.info(`当前版本暂不支持转交创建者（目标：${member.username}）`)
}

const handleShare = async () => {
  await openInviteDialog()
}

const handleShowShortcuts = () => {
  shortcutDialogVisible.value = true
}

const handleShowOperationHistory = async () => {
  operationHistoryVisible.value = true
  await openOperationTimeline()
}

const handleResetOperationTimelineFilters = async () => {
  await resetOperationTimelineFilters()
}

const handleOperationTimelineSearch = async () => {
  await searchOperationTimeline()
}

const handleOperationTimelinePageChange = async (page: number) => {
  await changeOperationTimelinePage(page)
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

const handleShowGuide = () => {
  const availableSteps = baseOnboardingSteps.filter((step) => {
    const element = document.querySelector(step.selector)
    return Boolean(element)
  })
  onboardingSteps.value = availableSteps.length > 0 ? availableSteps : baseOnboardingSteps
  onboardingVisible.value = true
}

const tryOpenOnboardingOnFirstVisit = () => {
  if (hasSeenOnboarding()) {
    return
  }
  nextTick(() => {
    handleShowGuide()
    markOnboardingSeen()
  })
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
  lifecycleOnVisibilityChange()
  if (document.visibilityState === 'visible') {
    lastSelectionBroadcastSignature.value = ''
    broadcastSelectionPresence(true)
    void refreshSessionMembers()
    return
  }
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
    pausedByOperator.value = result.isPaused ? (authStore.user?.username || '管理员') : ''
    feedback.success(result.isPaused ? '画布已暂停' : '画布已恢复')
  } catch (error) {
    feedback.errorFrom(error, '更新画布状态失败')
  }
}

// 图片默认插入点：优先当前视口中心，保证用户一眼可见。
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

const {
  operationHistory,
  operationHistoryForDisplay,
  formatOperationTypeLabel,
  formatOperationSourceLabel,
  canLocateHistoryObject,
  locateHistoryObject,
  locateTimelineObject,
  locateConflictObject,
  pushOperationHistory,
} = useOperationHistory({
  graphicsRef: computed(() => canvasStore.graphics),
  selectedObjectKeyRef: selectedObjectKey,
  selectedObjectKeysRef: selectedObjectKeys,
  focusedObjectKeyRef: focusedObjectKey,
  conflictFocusMapRef: conflictFocusMap,
  conflictHistoryVisibleRef: conflictHistoryVisible,
  focusHighlightTimerRef: computed({
    get: () => focusHighlightTimer,
    set: (value) => {
      focusHighlightTimer = value
    },
  }),
  canvasRef,
  zoomScaleRef: zoomScale,
  viewportOffsetRef: viewportOffset,
  findMemberNameByUserId,
  formatFieldNameLabel,
  getGraphicBounds,
  scheduleRender,
  onWarning: (message) => feedback.warning(message),
})

const {
  refreshSnapshots,
  createSnapshotNow,
  restoreToVersion,
  applyReplayToCanvas,
} = useVersionSnapshots({
  getSessionKey: () => sessionKey.value,
  getCurrentSessionName: () => currentSessionName.value,
  getCurrentVersion: () => currentVersion.value,
  formatNowForFilename,
  loadingSnapshotsRef: loadingSnapshots,
  replayLoadingRef: replayLoading,
  replayTargetVersionRef: replayTargetVersion,
  snapshotsRef: snapshots,
  currentSnapshotVersionRef: currentSnapshotVersion,
  isRecord,
  toGraphicFromUnknown,
  toOperationPathPoints,
  setGraphics: (graphics) => {
    canvasStore.graphics = graphics
  },
  syncGraphicsFromServer,
  updateSessionVersion,
  scheduleRender,
})

// ------------------------------
// 客户端操作构建与发送
// ------------------------------
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

// 发送创建操作：携带 Lamport、operationId、batch 元数据。
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

// 发送更新操作：若图元仍在 pending create，则先入延迟队列等待创建确认。
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

// 发送删除操作：支持批量分组，保证撤销/日志可按一次动作聚合。
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

// 删除当前选中（单选/多选），并同步处理本地选择状态。
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

// 锁定切换：多选 mixed 态点击后统一切到“全锁/全解锁”。
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

// 根据草稿状态生成最终图元对象（鼠标抬起时提交）。
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

// 鼠标按下：根据当前工具与命中目标，进入拖拽/缩放/旋转/框选/绘制等分支。
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

    const target = pickGraphicAtPoint(point)
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
  const target = pickGraphicAtPoint(point)
  if (target?.objectType === 'text') {
    selectedObjectKey.value = target.objectKey
    selectedObjectKeys.value = [target.objectKey]
    startEditTextGraphic(target)
    scheduleRender()
    return
  }
  createTextGraphic(point)
}

// 双击文本图元进入编辑态。
const handleCanvasDblClick = (event: MouseEvent) => {
  if (textEditing.value || activeTool.value !== 'select' || panState.value.active || panMode.value) {
    return
  }
  const point = toCanvasPoint(event)
  if (!point) {
    return
  }
  const target = pickGraphicAtPoint(point)
  if (target?.objectType === 'text') {
    selectedObjectKey.value = target.objectKey
    selectedObjectKeys.value = [target.objectKey]
    startEditTextGraphic(target)
    scheduleRender()
  }
}

// 鼠标移动：推进当前交互状态（拖拽/缩放/旋转/草稿），并触发局部同步。
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

// 鼠标抬起：提交本次交互（含批处理收口、历史步数记录、状态复位）。
const handleMouseUp = () => {
  pointerPressed.value = false
  window.setTimeout(() => {
    broadcastSelectionPresence(true)
  }, 0)
  if (panState.value.active) {
    panState.value.active = false
  }
  if (isReadOnly.value) {
    if (selectionRect.value.active) {
      selectionRect.value.active = false
      scheduleRender()
    }
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
        current.width !== original.width ||
        current.height !== original.height ||
        current.rotation !== original.rotation ||
        JSON.stringify(current.pathPoints ?? null) !== JSON.stringify(original.pathPoints ?? null)
      ) {
        sendUpdateGraphicPatch(current.objectKey, {
          positionX: current.positionX,
          positionY: current.positionY,
          rotation: current.rotation,
          ...(Array.isArray(current.pathPoints) ? { pathPoints: current.pathPoints } : {}),
          ...(current.objectType === 'line'
            ? {
                ...(typeof current.width === 'number' ? { width: current.width } : {}),
                ...(typeof current.height === 'number' ? { height: current.height } : {}),
              }
            : {}),
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
          current.width !== original.width ||
          current.height !== original.height ||
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
            ...(current.objectType === 'line'
              ? {
                  positionX: current.positionX,
                  positionY: current.positionY,
                  ...(typeof current.width === 'number' ? { width: current.width } : {}),
                  ...(typeof current.height === 'number' ? { height: current.height } : {}),
                }
              : {}),
          })
        }
      } else if (current && current.rotation !== rotateState.value.originalRotation) {
        sendUpdateGraphicPatch(current.objectKey, {
          rotation: current.rotation,
          ...(current.objectType === 'line'
            ? {
                positionX: current.positionX,
                positionY: current.positionY,
                ...(typeof current.width === 'number' ? { width: current.width } : {}),
                ...(typeof current.height === 'number' ? { height: current.height } : {}),
              }
            : {}),
        })
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

// 鼠标离开画布时，确保交互状态安全收尾，避免“卡拖拽”。
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


// 撤销：按本地记录的步数分组执行，保证批量操作一次撤销。
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

// 重做：与撤销同样按分组步数回放。
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

// Ctrl/Meta + 滚轮缩放，普通滚轮按浏览器默认滚动容器处理。
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

const { handleKeydown } = useCanvasKeyboard({
  textEditingRef: textEditing,
  focusModeRef: focusMode,
  isReadOnlyRef: isReadOnly,
  clipboardGraphicsRef: clipboardGraphics,
  pasteCountRef: pasteCount,
  selectedGraphicsRef: selectedGraphics,
  selectedObjectKeysRef: selectedObjectKeys,
  selectedObjectKeyRef: selectedObjectKey,
  canvasStoreRef: computed(() => ({
    currentSession: canvasStore.currentSession,
    graphics: canvasStore.graphics,
  })),
  currentUserIdRef: currentUserId,
  undoStepCountsRef: undoStepCounts,
  commitTextEditing,
  cancelTextEditing,
  isInputTarget,
  deleteSelectedGraphic,
  handleToggleFocusMode,
  beginWsBatch,
  endWsBatch,
  upsertGraphic,
  sendCreateGraphic,
  handleUndo,
  handleRedo,
  handleToggleLock,
  onSuccess: (message) => feedback.success(message),
})

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

// 选中态变化时向协作者广播，确保远端标签实时更新。
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

// 切只读后立即终止所有正在进行的编辑交互，防止越权写操作。
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

// 生命周期：挂载后完成入会、画布初始化、同步回放、首次渲染。
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
  tryOpenOnboardingOnFirstVisit()
  scheduleRender()
})

// 生命周期：卸载时清理计时器、监听器、WS 连接与画布资源。
onBeforeUnmount(() => {
  if (styleCommitTimer.value !== null) {
    window.clearTimeout(styleCommitTimer.value)
    styleCommitTimer.value = null
  }
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearHeartbeat()
  clearMembersRefreshTimer()
  clearRenderFrame()
  teardownResizeObserver()
  stopFocusActionsDrag()
  if (focusHighlightTimer !== null) {
    window.clearTimeout(focusHighlightTimer)
    focusHighlightTimer = null
  }

  if (wsClient) {
    unbindWs(wsClient)
    wsClient.disconnect()
    wsClient = null
  }
  disposeImageResources()
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
    <div v-if="readOnlyHintText" class="readonly-bar">
      {{ readOnlyHintText }}
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
        <el-radio label="png">PNG</el-radio>
        <el-radio label="svg">SVG</el-radio>
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
