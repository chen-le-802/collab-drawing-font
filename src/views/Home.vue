<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CirclePlus,
  Clock,
  Collection,
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
import { confirmDanger, feedback } from '@/utils/feedback'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const createVisible = ref(false)
const sessions = ref<SessionVO[]>([])
const currentUserId = ref<number>()
const searchKeyword = ref('')
const sortBy = ref<'created_desc' | 'created_asc' | 'name_asc' | 'name_desc' | 'version_desc'>('created_desc')
const compactCards = ref(false)

const isMyCreatedTab = computed(() => route.path.startsWith('/my-sessions'))
const listTitle = computed(() => (isMyCreatedTab.value ? '我创建的会话' : '我加入的会话'))
const pageSubtitle = computed(() =>
  isMyCreatedTab.value ? '管理你发起的协作画布与邀请链接' : '继续最近参与的团队画布',
)
const emptyDescription = computed(() =>
  isMyCreatedTab.value ? '暂无你创建的会话，点击左侧创建新会话' : '暂无会话，点击左侧创建新会话',
)
const normalizedKeyword = computed(() => searchKeyword.value.trim().toLowerCase())
const displayedSessions = computed(() => {
  let list = [...sessions.value]
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
const activeSessions = computed(() => sessions.value.filter((item) => item.status === 1).length)
const latestSession = computed(() => {
  if (sessions.value.length === 0) {
    return null
  }
  return [...sessions.value].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] ?? null
})
const summaryCards = computed(() => [
  {
    label: '全部会话',
    value: sessions.value.length,
    hint: isMyCreatedTab.value ? '由你创建' : '已加入',
    tone: 'coral',
  },
  {
    label: '活跃画布',
    value: activeSessions.value,
    hint: '可继续协作',
    tone: 'mint',
  },
  {
    label: '在线成员',
    value: visibleOnlineMemberCount.value,
    hint: `已识别成员 ${visibleMemberCount.value}`,
    tone: 'sky',
  },
])
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
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(graphic.positionX, graphic.positionY)
      ctx.lineTo(graphic.positionX + (graphic.width ?? 0), graphic.positionY + (graphic.height ?? 0))
      ctx.strokeStyle = graphic.strokeColor
      ctx.lineWidth = graphic.strokeWidth
      ctx.stroke()
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
      ctx.strokeRect(graphic.positionX, graphic.positionY, width, height)
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
      ctx.stroke()
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
      ctx.stroke()
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

const toggleCompactCards = () => {
  compactCards.value = !compactCards.value
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
    feedback.success('已退出会话，可通过邀请链接再次加入')
  } catch (error) {
    feedback.errorFrom(error, '退出会话失败')
  }
}

const handleLogout = async () => {
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
    await sessionApi.join(sessionKey)
    await router.replace(`/session/${sessionKey}`)
    return true
  } catch (error) {
    feedback.errorFrom(error, '加入会话失败')
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
})

watch(
  () => route.path,
  async () => {
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

        <nav class="sidebar-nav">
          <router-link to="/" class="nav-item" :class="{ active: !isMyCreatedTab }">
            <el-icon class="nav-icon"><Collection /></el-icon>
            <span>我加入的会话</span>
          </router-link>
          <router-link to="/my-sessions" class="nav-item" :class="{ active: isMyCreatedTab }">
            <el-icon class="nav-icon"><UserFilled /></el-icon>
            <span>我创建的会话</span>
          </router-link>
        </nav>

        <button class="create-btn" @click="openCreateDialog">
          <el-icon><CirclePlus /></el-icon>
          创建新会话
        </button>
      </div>

      <div class="sidebar-bottom">
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
    </aside>

    <main class="main-content">
      <section class="overview-panel">
        <div class="overview-copy">
          <div class="eyebrow">Workspace</div>
          <h1 class="main-title">{{ listTitle }}</h1>
          <p class="main-subtitle">{{ pageSubtitle }}</p>
          <div v-if="latestSession" class="latest-session">
            <el-icon><Clock /></el-icon>
            <span>最近创建：{{ latestSession.name }}</span>
          </div>
        </div>
        <div class="summary-grid">
          <div
            v-for="card in summaryCards"
            :key="card.label"
            class="summary-card"
            :class="`summary-${card.tone}`"
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
          <div class="main-tools">
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

.sidebar-bottom {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 8px;
  border-top: 1px solid var(--cd-border);
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

.summary-card {
  min-height: 180px;
  padding: 20px;
  border-radius: var(--cd-radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 36px rgba(20, 30, 55, 0.06);
  color: #202331;
  overflow: hidden;
  position: relative;
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
