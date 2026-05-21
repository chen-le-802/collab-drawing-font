<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CirclePlus,
  Clock,
  Collection,
  DocumentDelete,
  Grid,
  Search,
  SwitchButton,
  UserFilled,
  Tickets,
} from '@element-plus/icons-vue'
import SessionCard from '@/components/session/SessionCard.vue'
import SessionCreate from '@/views/SessionCreate.vue'
import { graphicApi } from '@/api/graphic'
import { sessionApi } from '@/api/session'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import type { GraphicVO } from '@/types/graphic'
import type { SessionVO } from '@/types/session'
import type { GuideStep } from '@/views/DrawCanvas/components/OnboardingGuide.vue'
import { confirmDanger, feedback } from '@/utils/feedback'
import { resolveSessionErrorMessage } from '@/utils/sessionError'

const OnboardingGuide = defineAsyncComponent(() => import('@/views/DrawCanvas/components/OnboardingGuide.vue'))

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const createVisible = ref(false)
const sessions = ref<SessionVO[]>([])
const archivedJoinedSessions = ref<SessionVO[]>([])
const archivedCreatedSessions = ref<SessionVO[]>([])
const currentUserId = ref<number>()
const searchKeyword = ref('')
const sortBy = ref<'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'version_desc'>('created_desc')
const compactCards = ref(false)
const sessionFilter = ref<'all' | 'active' | 'paused'>('all')
const archivedScope = ref<'joined' | 'created'>('joined')
const homeGuideVisible = ref(false)
const homeManualVisible = ref(false)
const HOME_GUIDE_SEEN_KEY = 'home_onboarding_seen_v1'
const homeGuideSteps: GuideStep[] = [
  {
    selector: '[data-guide="home-nav"]',
    title: '导航区：先选工作视角',
    content: '这里可以切换“我加入的会话 / 我创建的会话 / 已结束会话”，快速定位目标画布。',
    placement: 'right',
  },
  {
    selector: '[data-guide="home-create"]',
    title: '创建会话：从这里开始协作',
    content: '点击“创建新会话”即可新建画布并邀请成员一起编辑。',
    placement: 'right',
  },
  {
    selector: '[data-guide="home-summary"]',
    title: '概览区：快速查看状态',
    content: '这里展示进行中、暂停中和最近参与会话，方便你快速回到工作上下文。',
    placement: 'bottom',
    highlight: false,
  },
  {
    selector: '[data-guide="home-list-tools"]',
    title: '列表工具：筛选与检索',
    content: '在这里可以切换视图、搜索会话、排序结果，快速找到你要打开的画布。',
    placement: 'bottom',
  },
  {
    selector: '[data-guide="home-help"]',
    title: '完整使用手册：需要时随时查看',
    content: '点击“帮助中心”可进入新手引导或查看完整手册。建议先看“成员管理、邀请分享、版本快照与恢复”。',
    placement: 'right',
  },
]

const isMyCreatedTab = computed(() => route.path.startsWith('/my-sessions'))
const isArchivedTab = computed(() => route.path.startsWith('/archived-sessions'))
const listTitle = computed(() => {
  if (isArchivedTab.value) {
    return archivedScope.value === 'created' ? '我创建的已结束会话' : '我加入的已结束会话'
  }
  return isMyCreatedTab.value ? '我创建的会话' : '我加入的会话'
})
const pageSubtitle = computed(() =>
  isArchivedTab.value
    ? archivedScope.value === 'created'
      ? '仅查看你创建且已结束的会话'
      : '查看你加入的已结束会话（包含你创建的）'
    : isMyCreatedTab.value
      ? '管理你发起的协作画布与邀请链接'
      : '继续最近参与的团队画布',
)
const emptyDescription = computed(() =>
  isArchivedTab.value
    ? archivedScope.value === 'created'
      ? '暂无你创建的已结束会话'
      : '暂无你加入的已结束会话'
    : isMyCreatedTab.value
      ? '暂无你创建的会话，点击左侧创建新会话'
      : '暂无会话，点击左侧创建新会话',
)
const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase())
const getSessionActivityTime = (session: SessionVO): number => {
  const candidate = session.lastOperationAt ?? session.updatedAt ?? session.createdAt
  const time = new Date(candidate).getTime()
  return Number.isNaN(time) ? 0 : time
}
const displayedSessions = computed(() => {
  let list = [...sessions.value]
  if (!isArchivedTab.value && sessionFilter.value === 'active') {
    list = list.filter((item) => item.status === 1 && !item.isPaused)
  }
  if (!isArchivedTab.value && sessionFilter.value === 'paused') {
    list = list.filter((item) => item.isPaused)
  }
  if (normalizedKeyword.value) {
    list = list.filter((item) => {
      const fields = [item.name, item.creatorName ?? '', item.sessionKey]
      return fields.some((field) => field.toLowerCase().includes(normalizedKeyword.value))
    })
  }

  list.sort((a, b) => {
    const aCreated = new Date(a.createdAt).getTime()
    const bCreated = new Date(b.createdAt).getTime()
    switch (sortBy.value) {
      case 'created_asc':
        return aCreated - bCreated
      case 'name_asc':
        return a.name.localeCompare(b.name)
      case 'name_desc':
        return b.name.localeCompare(a.name)
      case 'version_desc':
        return (b.currentVersion ?? 0) - (a.currentVersion ?? 0)
      case 'created_desc':
      default:
        return bCreated - aCreated
    }
  })
  return list
})
const emptyDisplayText = computed(() => {
  if (isArchivedTab.value) {
    if (!normalizedKeyword.value) {
      return emptyDescription.value
    }
    return '没有匹配的会话，试试其他关键词'
  }
  if (sessionFilter.value === 'active') {
    return '当前没有进行中的会话'
  }
  if (sessionFilter.value === 'paused') {
    return '当前没有暂停中的会话'
  }
  if (!normalizedKeyword.value) {
    return emptyDescription.value
  }
  return '没有匹配的会话，试试其他关键词'
})
const visibleMemberIds = computed(() => {
  const ids = new Set<number>()
  sessions.value.forEach((session) => {
    if (session.creatorId) {
      ids.add(session.creatorId)
    }
    ;(session.memberPreviews ?? []).forEach((member) => ids.add(member.userId))
  })
  return ids
})
const visibleOnlineMemberIds = computed(() => {
  const ids = new Set<number>()
  sessions.value.forEach((session) => {
    ;(session.memberPreviews ?? []).forEach((member) => {
      if (member.isOnline) {
        ids.add(member.userId)
      }
    })
  })
  return ids
})
const visibleMemberCount = computed(() => visibleMemberIds.value.size)
const visibleOnlineMemberCount = computed(() => visibleOnlineMemberIds.value.size)
const activeSessions = computed(() => sessions.value.filter((item) => item.status === 1 && !item.isPaused).length)
const pausedSessions = computed(() => sessions.value.filter((item) => item.isPaused))
const latestSession = computed(() => {
  if (sessions.value.length === 0) {
    return null
  }
  return [...sessions.value].sort(
    (a, b) => getSessionActivityTime(b) - getSessionActivityTime(a),
  )[0] ?? null
})
const latestSessionStatusText = computed(() => {
  if (!latestSession.value) {
    return ''
  }
  if (latestSession.value.status !== 1) {
    return '已结束'
  }
  if (latestSession.value.isPaused) {
    return '暂停中'
  }
  return '进行中'
})
const latestSessionStatusClass = computed(() => {
  if (!latestSession.value) {
    return ''
  }
  if (latestSession.value.status !== 1) {
    return 'is-info'
  }
  if (latestSession.value.isPaused) {
    return 'is-warning'
  }
  return 'is-success'
})
const summaryCards = computed(() => [
  {
    label: '全部会话',
    value: sessions.value.length,
    hint: isMyCreatedTab.value ? '由你创建' : '已加入',
    tone: 'coral',
    key: 'all',
  },
  {
    label: '进行中画布',
    value: activeSessions.value,
    hint: '点击筛选进行中的会话',
    tone: 'mint',
    key: 'active',
  },
  {
    label: '暂停中画布',
    value: pausedSessions.value.length,
    hint: '点击筛选暂停中的会话',
    tone: 'sky',
    key: 'paused',
  },
])
const showSummaryCards = computed(() => !isArchivedTab.value)
const archivedJoinedTotal = computed(() => archivedJoinedSessions.value.length)
const archivedCreatedTotal = computed(() => archivedCreatedSessions.value.length)
const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 180
const THUMBNAIL_PADDING = 18

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
  if (graphic.objectType === 'image') {
    return normalizeRect(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0)
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
    const pad = Math.max(2, graphic.strokeWidth)
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
    const pad = Math.max(2, graphic.strokeWidth)
    return {
      x: Math.min(graphic.positionX, endX) - pad,
      y: Math.min(graphic.positionY, endY) - pad,
      width: Math.abs(endX - graphic.positionX) + pad * 2,
      height: Math.abs(endY - graphic.positionY) + pad * 2,
    }
  }

  if (graphic.objectType === 'circle') {
    const diameter = Math.max(Math.abs(graphic.width ?? 0), Math.abs(graphic.height ?? 0))
    const radius = diameter / 2
    return {
      x: graphic.positionX - radius,
      y: graphic.positionY - radius,
      width: diameter,
      height: diameter,
    }
  }

  if (graphic.objectType === 'text') {
    const width = graphic.width ?? Math.max((graphic.textContent?.length ?? 1) * 10, 40)
    const height = graphic.height ?? Math.max((graphic.fontSize ?? 16) + 8, 24)
    return normalizeRect(graphic.positionX, graphic.positionY, width, height)
  }

  return normalizeRect(graphic.positionX, graphic.positionY, graphic.width ?? 0, graphic.height ?? 0)
}

const isClosedPath = (points: Array<{ x: number; y: number }>) => {
  if (points.length < 3) {
    return false
  }
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return false
  }
  return Math.hypot(first.x - last.x, first.y - last.y) <= 12
}

const drawGraphic = (ctx: CanvasRenderingContext2D, graphic: GraphicVO) => {
  switch (graphic.objectType) {
    case 'image': {
      const width = Math.max(1, Math.abs(graphic.width ?? 0))
      const height = Math.max(1, Math.abs(graphic.height ?? 0))
      ctx.fillStyle = '#e5e7eb'
      ctx.fillRect(graphic.positionX, graphic.positionY, width, height)
      break
    }
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(graphic.positionX, graphic.positionY)
      ctx.lineTo(graphic.positionX + (graphic.width ?? 0), graphic.positionY + (graphic.height ?? 0))
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.setLineDash(graphic.lineStyle === 'dashed' ? [10, 6] : [])
      ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case 'rect': {
      const width = graphic.width ?? 0
      const height = graphic.height ?? 0
      if (graphic.fillColor) {
        ctx.fillStyle = graphic.fillColor
        ctx.fillRect(graphic.positionX, graphic.positionY, width, height)
      }
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.setLineDash(graphic.lineStyle === 'dashed' ? [10, 6] : [])
      ctx.strokeRect(graphic.positionX, graphic.positionY, width, height)
      ctx.setLineDash([])
      break
    }
    case 'circle': {
      const diameter = Math.max(Math.abs(graphic.width ?? 0), Math.abs(graphic.height ?? 0))
      const radius = diameter / 2
      ctx.beginPath()
      ctx.arc(graphic.positionX, graphic.positionY, radius, 0, Math.PI * 2)
      if (graphic.fillColor) {
        ctx.fillStyle = graphic.fillColor
        ctx.fill()
      }
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.setLineDash(graphic.lineStyle === 'dashed' ? [10, 6] : [])
      ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case 'text': {
      ctx.fillStyle = graphic.strokeColor
      ctx.font = `${graphic.fontSize ?? 16}px sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(graphic.textContent ?? '', graphic.positionX, graphic.positionY)
      break
    }
    case 'path': {
      const points = graphic.pathPoints ?? []
      if (points.length < 2) {
        break
      }
      const first = points[0]
      if (!first) {
        break
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
        if (graphic.fillColor) {
          ctx.fillStyle = graphic.fillColor
          ctx.fill()
        }
      }
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash(graphic.lineStyle === 'dashed' ? [10, 6] : [])
      ctx.stroke()
      ctx.setLineDash([])
      break
    }
    default:
      break
  }
}

const buildThumbnail = (graphics: GraphicVO[]): string | undefined => {
  if (graphics.length === 0) {
    return undefined
  }
  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_WIDTH
  canvas.height = THUMBNAIL_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return undefined
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)

  const sorted = [...graphics].sort((a, b) => a.zIndex - b.zIndex)
  const bounds = sorted.map(getGraphicBounds)
  const minX = Math.min(...bounds.map((item) => item.x))
  const minY = Math.min(...bounds.map((item) => item.y))
  const maxX = Math.max(...bounds.map((item) => item.x + item.width))
  const maxY = Math.max(...bounds.map((item) => item.y + item.height))
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)

  const drawWidth = THUMBNAIL_WIDTH - THUMBNAIL_PADDING * 2
  const drawHeight = THUMBNAIL_HEIGHT - THUMBNAIL_PADDING * 2
  const scale = Math.min(drawWidth / contentWidth, drawHeight / contentHeight)
  const offsetX = THUMBNAIL_PADDING + (drawWidth - contentWidth * scale) / 2 - minX * scale
  const offsetY = THUMBNAIL_PADDING + (drawHeight - contentHeight * scale) / 2 - minY * scale

  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  sorted.forEach((graphic) => drawGraphic(ctx, graphic))
  ctx.restore()

  return canvas.toDataURL('image/png')
}

const loadSessionThumbnails = async (list: SessionVO[]) => {
  const jobs = list.map(async (session) => {
    try {
      const { graphics } = await graphicApi.getGraphics(session.sessionKey)
      const thumbnail = buildThumbnail(graphics)
      return { sessionKey: session.sessionKey, thumbnail }
    } catch {
      return { sessionKey: session.sessionKey, thumbnail: undefined }
    }
  })

  const results = await Promise.all(jobs)
  const thumbnailMap = new Map(results.map((item) => [item.sessionKey, item.thumbnail]))
  sessions.value = sessions.value.map((item) => ({
    ...item,
    thumbnail: thumbnailMap.get(item.sessionKey),
  }))
}

const ensureCurrentUserId = async (): Promise<number | undefined> => {
  if (currentUserId.value) {
    return currentUserId.value
  }

  if (authStore.user?.userId) {
    currentUserId.value = authStore.user.userId
    return authStore.user.userId
  }

  try {
    const me = await userApi.getMe()
    authStore.setUser(me)
    currentUserId.value = me.userId
    return me.userId
  } catch {
    return undefined
  }
}

const fetchSessions = async () => {
  loading.value = true
  try {
    // 先同步用户信息，保证卡片按钮权限（删除/退出）在首屏渲染时就是正确状态。
    const userId = await ensureCurrentUserId()

    if (isArchivedTab.value) {
      if (!userId) {
        sessions.value = []
        archivedJoinedSessions.value = []
        archivedCreatedSessions.value = []
        feedback.error('获取用户信息失败，无法加载已结束会话')
        return
      }
      const [joinedRes, createdRes] = await Promise.all([
        sessionApi.list(1, 30, 0),
        sessionApi.list(1, 30, 0, userId),
      ])
      archivedJoinedSessions.value = joinedRes.list
      archivedCreatedSessions.value = createdRes.list
      sessions.value = archivedScope.value === 'created' ? createdRes.list : joinedRes.list
      void loadSessionThumbnails(sessions.value)
      return
    }

    // 首页：展示我加入的会话；我的会话：展示我创建的会话。
    if (!isMyCreatedTab.value) {
      const res = await sessionApi.list(1, 30)
      sessions.value = res.list
      void loadSessionThumbnails(res.list)
      return
    }

    if (!userId) {
      sessions.value = []
      feedback.error('获取用户信息失败，无法加载我创建的会话')
      return
    }

    const res = await sessionApi.listMyCreated(1, 30, userId)
    sessions.value = res.list
    void loadSessionThumbnails(res.list)
  } catch (error) {
    feedback.errorFrom(error, '获取会话列表失败')
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  createVisible.value = true
}
const openLatestSession = () => {
  if (!latestSession.value) {
    return
  }
  router.push(`/session/${latestSession.value.sessionKey}`)
}
const handleSummaryCardClick = (filter: 'all' | 'active' | 'paused') => {
  if (isArchivedTab.value) {
    return
  }
  sessionFilter.value = filter
}
const handleArchivedScopeChange = async (scope: 'joined' | 'created') => {
  if (archivedScope.value === scope) {
    return
  }
  archivedScope.value = scope
  sessionFilter.value = 'all'
  sessions.value = scope === 'created' ? archivedCreatedSessions.value : archivedJoinedSessions.value
  if (sessions.value.length === 0) {
    await fetchSessions()
    return
  }
  void loadSessionThumbnails(sessions.value)
}
const toggleCompactCards = () => {
  compactCards.value = !compactCards.value
}

const maybeOpenHomeGuide = () => {
  const seen = localStorage.getItem(HOME_GUIDE_SEEN_KEY) === '1'
  if (!seen) {
    homeGuideVisible.value = true
  }
}

const handleOpenHomeGuide = () => {
  homeGuideVisible.value = true
}

const handleOpenHomeManual = () => {
  homeManualVisible.value = true
}

const handleHomeHelpCommand = (command: 'guide' | 'manual') => {
  if (command === 'guide') {
    handleOpenHomeGuide()
    return
  }
  handleOpenHomeManual()
}

const handleHomeGuideFinished = () => {
  localStorage.setItem(HOME_GUIDE_SEEN_KEY, '1')
}

const handleOpenSession = (session: SessionVO) => {
  router.push(`/session/${session.sessionKey}`)
}

const handleSessionCreated = () => {
  // 创建弹窗成功后刷新一次列表，确保首页状态与服务端一致。
  fetchSessions()
}

const handleCopyLink = async (session: SessionVO) => {
  // 复制可分享链接：前端按当前 origin 组装，兼容本地与生产域名。
  const link = `${window.location.origin}/session/${session.sessionKey}`
  try {
    await navigator.clipboard.writeText(link)
    feedback.success('会话链接已复制')
  } catch {
    feedback.error('复制失败，请检查浏览器权限')
  }
}

const handleDeleteSession = async (_session: SessionVO) => {
  try {
    const confirmed = await confirmDanger('确认删除该会话吗？删除后会从你的会话列表中移除。', '删除确认', {
      confirmButtonText: '确认删除',
    })
    if (!confirmed) {
      return
    }
    await sessionApi.deleteSession(_session.sessionKey)
    sessions.value = sessions.value.filter((item) => item.sessionKey !== _session.sessionKey)
    archivedJoinedSessions.value = archivedJoinedSessions.value.filter((item) => item.sessionKey !== _session.sessionKey)
    archivedCreatedSessions.value = archivedCreatedSessions.value.filter((item) => item.sessionKey !== _session.sessionKey)
    feedback.success('会话已删除')
  } catch (error) {
    feedback.errorFrom(error, '删除会话失败')
  }
}

const handleLeaveSession = async (session: SessionVO) => {
  try {
    const confirmed = await confirmDanger(
      '退出后将从”我加入的会话”中移除，但你仍可通过邀请链接再次加入。是否继续？',
      '退出会话确认',
      {
        confirmButtonText: '确认退出',
      },
    )
    if (!confirmed) {
      return
    }
    await sessionApi.leave(session.sessionKey)
    sessions.value = sessions.value.filter((item) => item.sessionKey !== session.sessionKey)
    archivedJoinedSessions.value = archivedJoinedSessions.value.filter((item) => item.sessionKey !== session.sessionKey)
    feedback.success('已退出会话，可通过邀请链接再次加入')
  } catch (error) {
    feedback.errorFrom(error, '退出会话失败')
  }
}

const handleLogout = async () => {
  const confirmed = await confirmDanger('确认退出登录吗？', '退出登录确认', {
    confirmButtonText: '确认退出',
  })
  if (!confirmed) {
    return
  }
  try {
    await userApi.logout()
  } catch {
    // ignore
  }
  authStore.logout()
  router.push('/login')
}

const isSessionCreator = (session: SessionVO): boolean => {
  // 仅会话创建者可见删除按钮；非创建者显示退出按钮。
  if (!currentUserId.value) return false
  return session.creatorId === currentUserId.value
}

const tryAutoJoinFromRoute = async (): Promise<boolean> => {
  const sessionKey = typeof route.params.sessionKey === 'string' ? route.params.sessionKey : ''
  if (!sessionKey) {
    return false
  }

  try {
    // 邀请链接自动加入：后端 join 为幂等，已在成员表时也会直接成功返回。
    const inviteToken = typeof route.query.inviteToken === 'string' ? route.query.inviteToken.trim() : undefined
    await sessionApi.join(sessionKey, inviteToken || undefined)
    await router.replace(`/session/${sessionKey}`)
    return true
  } catch (error) {
    feedback.error(resolveSessionErrorMessage(error, '加入会话失败'))
    return false
  }
}

onMounted(async () => {
  // 优先处理邀请链接自动加入；非邀请场景正常加载会话列表。
  const joinedFromUrl = await tryAutoJoinFromRoute()
  if (joinedFromUrl) {
    return
  }
  await fetchSessions()
  maybeOpenHomeGuide()
})

watch(
  () => route.path,
  async () => {
    sessionFilter.value = 'all'
    archivedScope.value = 'joined'
    await fetchSessions()
  },
)
</script>

<template>
  <div class="home-page">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="sidebar-logo" @click="$router.push('/')">
          <span class="logo-mark" aria-hidden="true"></span>
          <span class="logo-text">画协</span>
        </div>

        <nav class="sidebar-nav" data-guide="home-nav">
          <router-link to="/" class="nav-item" :class="{ active: !isMyCreatedTab && !isArchivedTab }">
            <el-icon class="nav-icon"><Collection /></el-icon>
            <span>我加入的会话</span>
          </router-link>
          <router-link to="/my-sessions" class="nav-item" :class="{ active: isMyCreatedTab && !isArchivedTab }">
            <el-icon class="nav-icon"><UserFilled /></el-icon>
            <span>我创建的会话</span>
          </router-link>
          <router-link to="/archived-sessions" class="nav-item" :class="{ active: isArchivedTab }">
            <el-icon class="nav-icon"><DocumentDelete /></el-icon>
            <span>已结束的会话</span>
          </router-link>
        </nav>

        <button class="create-btn" data-guide="home-create" @click="openCreateDialog">
          <el-icon><CirclePlus /></el-icon>
          创建新会话
        </button>
      </div>

      <div class="sidebar-bottom">
        <div class="help-row help-row-bottom" data-guide="home-help">
          <el-dropdown trigger="click" @command="handleHomeHelpCommand">
            <button class="help-entry" type="button" title="帮助中心">
              <span class="help-dot">?</span>
              <span>帮助中心</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="guide">新手引导</el-dropdown-item>
                <el-dropdown-item command="manual">使用手册</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="account-row">
          <div class="user-info" @click="$router.push('/profile')">
            <el-avatar :size="36" :src="authStore.user?.avatar" class="user-avatar">
              {{ (authStore.user?.username ?? 'U').slice(0, 1).toUpperCase() }}
            </el-avatar>
            <div class="user-meta">
              <div class="user-name">{{ authStore.user?.username ?? '用户' }}</div>
              <div class="user-role">个人中心</div>
            </div>
          </div>
          <button class="logout-btn" @click="handleLogout" title="退出登录">
            <el-icon><SwitchButton /></el-icon>
          </button>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <section class="overview-panel" data-guide="home-summary" :class="{ 'overview-panel-archived': isArchivedTab }">
        <div
          class="overview-copy"
          :class="{
            'overview-copy-clickable': !!latestSession && !isArchivedTab,
          }"
          @click="!isArchivedTab && openLatestSession()"
        >
          <div class="eyebrow">Workspace</div>
          <h1 class="main-title">{{ listTitle }}</h1>
          <p class="main-subtitle">{{ pageSubtitle }}</p>
          <div v-if="latestSession && !isArchivedTab" class="latest-session">
            <el-icon><Clock /></el-icon>
            <span>最近参与：{{ latestSession.name }}</span>
            <span class="latest-status-pill" :class="latestSessionStatusClass">{{ latestSessionStatusText }}</span>
          </div>
        </div>
        <div v-if="isArchivedTab" class="summary-grid">
          <div
            class="summary-card summary-mint"
            role="button"
            tabindex="0"
            @click="handleArchivedScopeChange('joined')"
          >
            <div class="summary-label">我加入的</div>
            <div class="summary-value">{{ archivedJoinedTotal }}</div>
            <div class="summary-hint">已结束会话（包含我创建的）</div>
          </div>
          <div
            class="summary-card summary-coral"
            role="button"
            tabindex="0"
            @click="handleArchivedScopeChange('created')"
          >
            <div class="summary-label">我创建的</div>
            <div class="summary-value">{{ archivedCreatedTotal }}</div>
            <div class="summary-hint">仅我创建且已结束</div>
          </div>
        </div>
        <div v-else class="summary-grid">
          <div
            v-for="card in summaryCards"
            :key="card.label"
            class="summary-card"
            :class="`summary-${card.tone}`"
            role="button"
            tabindex="0"
            @click="handleSummaryCardClick(card.key as 'all' | 'active' | 'paused')"
          >
            <div class="summary-label">{{ card.label }}</div>
            <div class="summary-value">{{ card.value }}</div>
            <div class="summary-hint">{{ card.hint }}</div>
          </div>
        </div>
      </section>

      <div class="list-panel">
        <div class="main-header">
          <div>
            <h2 class="list-title">画布列表</h2>
            <p class="list-subtitle">{{ displayedSessions.length }} 个结果</p>
          </div>
          <div class="main-tools" data-guide="home-list-tools">
            <button
              class="view-toggle"
              type="button"
              @click="toggleCompactCards"
            >
              <el-icon><Tickets /></el-icon>
              {{ compactCards ? '展开卡片' : '紧凑卡片' }}
            </button>
            <div class="search-box">
              <el-icon class="search-icon"><Search /></el-icon>
            <input
              v-model="searchKeyword"
              class="search-input"
              placeholder="搜索会话名 / 创建者 / Key"
            />
          </div>
          <el-select v-model="sortBy" size="small" class="sort-select">
            <el-option label="最近创建" value="created_desc" />
            <el-option label="最早创建" value="created_asc" />
            <el-option label="名称 A-Z" value="name_asc" />
            <el-option label="名称 Z-A" value="name_desc" />
            <el-option label="版本号高到低" value="version_desc" />
          </el-select>
        </div>
      </div>

        <el-skeleton :loading="loading" animated :count="3">
          <template #template>
            <div class="session-grid" :class="{ compact: compactCards }">
              <div v-for="item in 6" :key="item" class="skeleton-card">
                <div class="skeleton-thumb"></div>
                <div class="skeleton-line skeleton-line-short"></div>
                <div class="skeleton-line"></div>
              </div>
            </div>
          </template>
          <template #default>
            <div v-if="displayedSessions.length === 0" class="empty-state">
              <el-icon class="empty-icon"><Grid /></el-icon>
              <p class="empty-text">{{ emptyDisplayText }}</p>
            </div>
            <div v-else class="session-grid" :class="{ compact: compactCards }">
              <session-card
                v-for="session in displayedSessions"
                :key="session.sessionKey"
                :session="session"
                :is-creator="isSessionCreator(session)"
                :compact="compactCards"
                @open="handleOpenSession"
                @copy="handleCopyLink"
                @delete="handleDeleteSession"
                @leave="handleLeaveSession"
              />
            </div>
          </template>
        </el-skeleton>
      </div>
    </main>

    <session-create v-model="createVisible" @created="handleSessionCreated" />
    <OnboardingGuide
      v-model:visible="homeGuideVisible"
      :steps="homeGuideSteps"
      @finished="handleHomeGuideFinished"
    />
    <el-dialog
      v-model="homeManualVisible"
      title="协同白板使用手册"
      width="680px"
      top="5vh"
      class="home-manual-dialog"
      destroy-on-close
      append-to-body
    >
      <div class="manual-block">
        <h4>一、快速开始（新用户建议先看）</h4>
        <p>1）在首页点击“创建新会话”。2）输入会话名称并确认创建。3）进入画板后先使用“矩形 + 文字”完成第一张草图。</p>

        <h4>二、如何邀请成员加入协作</h4>
        <p>点击画板顶部“分享”按钮，可生成邀请链接或二维码。将链接发送给成员后，对方即可进入同一画布实时协作。</p>

        <h4>三、成员管理与权限说明</h4>
        <p>在“更多操作 &gt; 成员管理”中可查看成员列表、在线状态，并执行角色调整与成员移除。建议仅为核心协作者分配较高权限。</p>

        <h4>四、绘图与编辑操作</h4>
        <p>左侧工具栏支持选择、图形、文字、画笔。支持多选后批量修改描边、填充、线宽和线型；支持拖动画布、缩放视图与网格辅助。</p>

        <h4>五、常用协作能力</h4>
        <p>1）操作历史：用于回看编辑记录。2）冲突日志：用于排查多人同时编辑冲突。3）版本快照：用于保存关键里程碑。</p>

        <h4>六、版本快照与恢复（重点）</h4>
        <p>恢复版本会覆盖当前画布状态。建议流程：先“创建快照（可命名）”，再执行恢复；恢复后建议立刻检查关键区域是否符合预期。</p>

        <h4>七、导出与展示建议</h4>
        <p>PNG 适合汇报截图，SVG 适合后续二次编辑，PDF 适合归档与打印。正式提交前建议分别导出 1 份并做打开验证。</p>

        <h4>八、效率功能与快捷键</h4>
        <p>支持撤销/重做、快捷键帮助、专注模式、网格开关。建议在演示时开启专注模式，减少视觉干扰并提升讲解连贯性。</p>

        <h4>九、常见问题排查</h4>
        <p>如果“看不到最新协作内容”，先检查网络与重连提示；如果“恢复后结果不对”，先回看快照版本与操作历史；如需定位问题可先看冲突日志。</p>
      </div>
      <template #footer>
        <el-button @click="homeManualVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.home-page {
  height: 100vh;
  display: flex;
  background: var(--cd-bg-page);
  position: relative;
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  height: 100vh;
  width: 248px;
  flex-shrink: 0;
  background: var(--cd-bg-card);
  border-right: 1px solid var(--cd-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 22px 18px;
  position: relative;
  z-index: 2;
}

.sidebar-top {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;
}

.logo-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: block;
  background-image: url('/logo.png');
  background-repeat: no-repeat;
  background-size: contain;
  background-position: center;
}

.logo-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--cd-text-primary);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: var(--cd-radius-md);
  font-size: 14px;
  color: var(--cd-text-secondary);
  text-decoration: none;
  transition: background var(--cd-transition), color var(--cd-transition);
}

.nav-item:hover {
  background: var(--cd-primary-lighter);
  color: var(--cd-text-primary);
}

.nav-item.active {
  background: #eef3ff;
  color: #1f4fbd;
  font-weight: 600;
}

.nav-icon {
  font-size: 17px;
  width: 20px;
}

.create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border: none;
  border-radius: var(--cd-radius-md);
  background: #202331;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--cd-transition), transform var(--cd-transition);
}

.create-btn:hover {
  background: #111827;
  transform: translateY(-1px);
}

.help-row {
  display: flex;
  justify-content: center;
  margin-top: 2px;
}

.help-entry {
  height: 32px;
  border: none;
  background: transparent;
  color: var(--cd-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 8px;
  transition: color var(--cd-transition), background var(--cd-transition);
}

.help-entry:hover {
  color: var(--cd-primary);
  background: rgba(79, 110, 247, 0.08);
}

.help-dot {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1px solid currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.manual-block h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--cd-text-primary);
}

.manual-block p {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cd-text-secondary);
}

.manual-block p:last-child {
  margin-bottom: 0;
}

:deep(.el-dialog__body) .manual-block {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 6px;
}

/* 手册弹窗在桌面端上移并右偏，减少遮挡左侧导航和标题区域 */
:deep(.home-manual-dialog) {
  margin-left: clamp(320px, 36vw, 520px);
  margin-right: 24px;
}

.sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 12px 8px;
  border-top: 1px solid var(--cd-border);
}

.help-row-bottom {
  justify-content: flex-start;
  padding: 0 4px;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  border-radius: var(--cd-radius-sm);
  padding: 4px;
  transition: background var(--cd-transition);
}

.user-info:hover {
  background: var(--cd-primary-lighter);
}

.user-avatar {
  background: var(--cd-primary-light);
  color: var(--cd-primary);
  font-weight: 700;
}

.user-meta {
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--cd-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  font-size: 11px;
  color: var(--cd-text-muted);
}

.logout-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--cd-radius-sm);
  background: transparent;
  color: var(--cd-text-muted);
  font-size: 15px;
  cursor: pointer;
  transition: background var(--cd-transition), color var(--cd-transition);
}

.logout-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}

/* Main content */
.main-content {
  flex: 1;
  height: 100vh;
  min-width: 0;
  padding: 26px 30px;
  position: relative;
  z-index: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.main-content::-webkit-scrollbar {
  width: 8px;
}

.main-content::-webkit-scrollbar-track {
  background: transparent;
}

.main-content::-webkit-scrollbar-thumb {
  background: rgba(154, 161, 173, 0.32);
  border-radius: 999px;
}

.main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(154, 161, 173, 0.48);
}

.overview-panel {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(360px, 0.95fr);
  gap: 20px;
  align-items: stretch;
  margin-bottom: 22px;
}

.overview-copy {
  min-height: 180px;
  padding: 28px 30px;
  border-radius: var(--cd-radius-xl);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.78)),
    radial-gradient(circle at 82% 18%, rgba(49, 211, 189, 0.22), transparent 34%),
    radial-gradient(circle at 16% 88%, rgba(255, 107, 107, 0.18), transparent 30%);
  border: 1px solid rgba(255, 255, 255, 0.84);
  box-shadow: var(--cd-shadow-card);
}

.overview-copy-clickable {
  cursor: pointer;
  transition: transform var(--cd-transition), box-shadow var(--cd-transition), border-color var(--cd-transition);
}

.overview-copy-clickable:hover {
  transform: translateY(-2px);
  /* border-color: rgba(79, 110, 247, 0.28); */
  box-shadow: 0 18px 30px rgba(20, 30, 55, 0.12);
}

.eyebrow {
  margin-bottom: 12px;
  color: var(--cd-text-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.main-title {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--cd-text-primary);
}

.main-subtitle {
  margin: 8px 0 0;
  color: var(--cd-text-secondary);
  font-size: 14px;
}

.latest-session {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  margin-top: 28px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--cd-text-secondary);
  font-size: 13px;
  box-shadow: 0 8px 18px rgba(20, 30, 55, 0.05);
}

.latest-status-pill {
  margin-left: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f0f2f6;
  color: #7b8190;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.latest-status-pill.is-success {
  background: #e7f8f4;
  color: #16806d;
}

.latest-status-pill.is-info {
  background: #f0f2f6;
  color: #7b8190;
}

.latest-status-pill.is-warning {
  background: #fff4dd;
  color: #b36b00;
}

.latest-session span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.overview-panel-archived .summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}


.summary-card {
  min-height: 180px;
  padding: 20px;
  border-radius: var(--cd-radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 36px rgba(20, 30, 55, 0.06);
  color: #202331;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: transform var(--cd-transition), box-shadow var(--cd-transition);
}

.summary-card::after {
  content: '';
  position: absolute;
  inset: auto -42px -56px auto;
  width: 150px;
  height: 150px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  filter: blur(2px);
}

.summary-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.08));
  pointer-events: none;
}

.summary-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 36px rgba(20, 30, 55, 0.1);
}


.summary-coral {
  background:
    radial-gradient(circle at 88% 82%, rgba(255, 255, 255, 0.48), transparent 34%),
    radial-gradient(circle at 12% 14%, rgba(255, 255, 255, 0.58), transparent 26%),
    linear-gradient(145deg, #fff4f5 0%, #ffc5ce 54%, #ff8f97 100%);
}

.summary-mint {
  background:
    radial-gradient(circle at 88% 82%, rgba(255, 255, 255, 0.42), transparent 34%),
    radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.58), transparent 26%),
    linear-gradient(145deg, #edfffb 0%, #afeee4 54%, #58d7c7 100%);
}

.summary-sky {
  background:
    radial-gradient(circle at 88% 82%, rgba(255, 255, 255, 0.42), transparent 34%),
    radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.58), transparent 26%),
    linear-gradient(145deg, #f2fbff 0%, #bddfff 54%, #67b4f7 100%);
}

.summary-label {
  position: relative;
  z-index: 1;
  color: #323644;
  font-size: 13px;
  font-weight: 700;
}

.summary-value {
  position: relative;
  z-index: 1;
  margin-top: 42px;
  font-size: 42px;
  line-height: 1;
  font-weight: 800;
}

.summary-hint {
  position: relative;
  z-index: 1;
  margin-top: 8px;
  color: rgba(32, 35, 49, 0.72);
  font-size: 12px;
  font-weight: 600;
}

.list-panel {
  padding: 22px;
  border-radius: var(--cd-radius-xl);
  background: rgba(255, 255, 255, 0.64);
  border: 1px solid rgba(255, 255, 255, 0.86);
  box-shadow: var(--cd-shadow-card);
}

.main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.list-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--cd-text-primary);
}

.list-subtitle {
  margin: 4px 0 0;
  color: var(--cd-text-muted);
  font-size: 12px;
}

.main-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.view-toggle {
  height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border: 1px solid var(--cd-border);
  border-radius: 999px;
  background: var(--cd-bg-card);
  color: var(--cd-text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--cd-transition), color var(--cd-transition), box-shadow var(--cd-transition);
}

.view-toggle:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.08);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 38px;
  background: var(--cd-bg-card);
  border-radius: 999px;
  border: 1px solid var(--cd-border);
  transition: border-color var(--cd-transition), box-shadow var(--cd-transition);
}

.search-box:focus-within {
  border-color: var(--cd-primary);
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.08);
}

.search-icon {
  font-size: 15px;
  opacity: 0.5;
}

.search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  width: 200px;
  color: var(--cd-text-primary);
}

.search-input::placeholder {
  color: var(--cd-text-muted);
}

.sort-select {
  width: 152px;
  height: 38px;
}

:deep(.sort-select .el-select__wrapper),
:deep(.sort-select .el-input__wrapper) {
  min-height: 38px;
  padding: 0 12px 0 14px;
  border-radius: 999px;
  background: var(--cd-bg-card);
  border: 1px solid var(--cd-border);
  box-shadow: none !important;
  transition: border-color var(--cd-transition), box-shadow var(--cd-transition);
}

:deep(.sort-select .el-select__wrapper:hover),
:deep(.sort-select .el-input__wrapper:hover) {
  border-color: var(--cd-border);
  box-shadow: none !important;
}

:deep(.sort-select .el-select__wrapper.is-focused),
:deep(.sort-select .el-input__wrapper.is-focus),
:deep(.sort-select .el-input.is-focus .el-input__wrapper) {
  border-color: var(--cd-primary);
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.08) !important;
}

:deep(.sort-select .el-select__selected-item),
:deep(.sort-select .el-input__inner) {
  height: 36px;
  line-height: 36px;
  color: var(--cd-text-primary);
  font-size: 13px;
}

:deep(.sort-select .el-select__caret) {
  color: var(--cd-text-muted);
}

.session-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.session-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.skeleton-card {
  background: var(--cd-bg-card);
  border-radius: var(--cd-radius-lg);
  padding: 14px;
  box-shadow: var(--cd-shadow-sm);
}

.skeleton-thumb {
  height: 110px;
  border-radius: var(--cd-radius-md);
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: #f0f0f0;
  margin-top: 12px;
  width: 90%;
}

.skeleton-line-short {
  width: 60%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 42px;
  margin-bottom: 16px;
  opacity: 0.4;
}

.empty-text {
  font-size: 15px;
  color: var(--cd-text-muted);
  margin: 0;
}

@media (max-width: 900px) {
  :deep(.home-manual-dialog) {
    margin-left: auto;
    margin-right: auto;
  }

  .home-page {
    height: 100vh;
    flex-direction: column;
  }

  .sidebar {
    height: auto;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--cd-border);
    padding: 16px;
    flex-direction: row;
    align-items: center;
  }

  .sidebar-top {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    flex: 1;
  }

  .sidebar-nav {
    flex-direction: row;
  }

  .sidebar-bottom {
    border-top: none;
    padding: 0;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .account-row {
    gap: 6px;
  }

  .user-meta {
    display: none;
  }

  .main-content {
    height: calc(100vh - 77px);
    padding: 20px 16px;
  }

  .overview-panel {
    grid-template-columns: 1fr;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .session-grid {
    grid-template-columns: 1fr;
  }

  .search-input {
    width: 140px;
  }

  .main-tools {
    width: 100%;
    flex-wrap: wrap;
    align-items: stretch;
  }

  .view-toggle,
  .sort-select {
    flex: 1 1 140px;
  }

  .search-box {
    flex: 1 1 100%;
  }
}
</style>
