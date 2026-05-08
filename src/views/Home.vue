<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
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

const isMyCreatedTab = computed(() => route.path.startsWith('/my-sessions'))
const listTitle = computed(() => (isMyCreatedTab.value ? '我创建的会话' : '我加入的会话'))
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
      '退出后将从“我加入的会话”中移除，但你仍可通过邀请链接再次加入。是否继续？',
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
    <app-header />

    <main class="content">
      <aside class="create-side">
        <el-card class="create-card" shadow="hover" @click="openCreateDialog">
          <div class="create-inner">
            <div class="create-icon">+</div>
            <p class="create-title">创建新会话</p>
          </div>
        </el-card>
      </aside>

      <section class="session-side">
        <div class="session-header">
          <h2 class="session-title">{{ listTitle }}</h2>
          <div class="session-tools">
            <el-input
              v-model="searchKeyword"
              size="small"
              clearable
              placeholder="搜索会话名/创建者/Key"
              class="search-input"
            />
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
            <div class="session-grid">
              <el-card v-for="item in 3" :key="item" class="skeleton-card">
                <el-skeleton-item variant="image" style="height: 90px" />
                <el-skeleton-item variant="h3" style="margin-top: 12px; width: 70%" />
                <el-skeleton-item variant="text" style="margin-top: 8px; width: 90%" />
              </el-card>
            </div>
          </template>
          <template #default>
            <el-empty v-if="displayedSessions.length === 0" :description="emptyDisplayText" />
            <div v-else class="session-grid">
              <session-card
                v-for="session in displayedSessions"
                :key="session.sessionKey"
                :session="session"
                :is-creator="isSessionCreator(session)"
                @open="handleOpenSession"
                @copy="handleCopyLink"
                @delete="handleDeleteSession"
                @leave="handleLeaveSession"
              />
            </div>
          </template>
        </el-skeleton>
      </section>
    </main>

    <session-create v-model="createVisible" @created="handleSessionCreated" />
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  background: #f5f7fb;
}

.content {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 24px;
}

.create-side {
  width: 200px;
  flex: 0 0 200px;
}

.create-card {
  width: 200px;
  height: 200px;
  border-radius: 8px;
  cursor: pointer;
}

:deep(.create-card .el-card__body) {
  height: 100%;
}

.create-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.create-icon {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: #2d72ff;
  color: #ffffff;
  font-size: 28px;
  line-height: 48px;
  text-align: center;
}

.create-title {
  color: #1f2d3d;
  font-size: 15px;
  font-weight: 600;
}

.session-side {
  flex: 1;
  min-width: 0;
}

.session-header {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.session-title {
  margin: 0;
  font-size: 20px;
  color: #1f2d3d;
  font-weight: 600;
}

.session-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input {
  width: 220px;
}

.sort-select {
  width: 140px;
}

.session-grid {
  display: grid;
  grid-template-columns: repeat(3, 280px);
  gap: 24px;
}

.skeleton-card {
  width: 280px;
  height: 200px;
  border-radius: 8px;
}

@media (max-width: 1360px) {
  .session-grid {
    grid-template-columns: repeat(2, 280px);
  }
}

@media (max-width: 1000px) {
  .content {
    flex-direction: column;
  }

  .create-side {
    width: 100%;
  }

  .create-card {
    width: 100%;
    max-width: 280px;
  }

  .session-grid {
    grid-template-columns: repeat(1, 280px);
  }

  .search-input,
  .sort-select {
    width: 100%;
  }
}
</style>
