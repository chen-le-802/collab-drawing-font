<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppHeader from '@/components/layout/AppHeader.vue'
import SessionCard from '@/components/session/SessionCard.vue'
import SessionCreate from '@/views/SessionCreate.vue'
import { sessionApi } from '@/api/session'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import type { SessionVO } from '@/types/session'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const createVisible = ref(false)
const sessions = ref<SessionVO[]>([])
const currentUserId = ref<number>()

const isMyCreatedTab = computed(() => route.path.startsWith('/my-sessions'))
const listTitle = computed(() => (isMyCreatedTab.value ? '我创建的会话' : '我加入的会话'))
const emptyDescription = computed(() =>
  isMyCreatedTab.value ? '暂无你创建的会话，点击左侧创建新会话' : '暂无会话，点击左侧创建新会话',
)

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
      return
    }

    if (!userId) {
      sessions.value = []
      ElMessage.error('获取用户信息失败，无法加载我创建的会话')
      return
    }

    const res = await sessionApi.listMyCreated(1, 30, userId)
    sessions.value = res.list
  } catch (error: any) {
    ElMessage.error(error.message || '获取会话列表失败')
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
    ElMessage.success('会话链接已复制')
  } catch {
    ElMessage.error('复制失败，请检查浏览器权限')
  }
}

const handleDeleteSession = (_session: SessionVO) => {
  ElMessageBox.confirm('确认删除该会话吗？删除后会从你的会话列表中移除。', '删除确认', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      await sessionApi.deleteSession(_session.sessionKey)
      sessions.value = sessions.value.filter((item) => item.sessionKey !== _session.sessionKey)
      ElMessage.success('会话已删除')
    })
    .catch((error: unknown) => {
      if (error === 'cancel' || error === 'close') {
        return
      }
      ElMessage.error((error as Error)?.message || '删除会话失败')
    })
}

const handleLeaveSession = async (session: SessionVO) => {
  try {
    await sessionApi.leave(session.sessionKey)
    sessions.value = sessions.value.filter((item) => item.sessionKey !== session.sessionKey)
    ElMessage.success('已退出会话')
  } catch (error: any) {
    ElMessage.error(error.message || '退出会话失败')
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
  } catch (error: any) {
    ElMessage.error(error.message || '加入会话失败')
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
            <el-empty v-if="sessions.length === 0" :description="emptyDescription" />
            <div v-else class="session-grid">
              <session-card
                v-for="session in sessions"
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
}

.session-title {
  margin: 0;
  font-size: 20px;
  color: #1f2d3d;
  font-weight: 600;
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
}
</style>
