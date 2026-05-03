<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import type { SessionDetailVO, SessionJoinVO } from '@/types/session'
import { wsClient } from '@/utils/wsClient'
import { sessionApi } from '@/api/session'

const route = useRoute()
const router = useRouter()

const joining = ref(false)
const joined = ref(false)
const sessionInfo = ref<SessionJoinVO | null>(null)
const sessionDetail = ref<SessionDetailVO | null>(null)
const HEARTBEAT_INTERVAL_MS = 20000
const MEMBER_REFRESH_INTERVAL_MS = 25000
let heartbeatTimer: number | undefined
let memberRefreshTimer: number | undefined

const sessionKey = computed(() => String(route.params.sessionKey || ''))
const memberRoleText = (role: number): string => (role === 2 ? '创建者' : '成员')

const handleBack = () => {
  router.push('/')
}

const clearHeartbeat = () => {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
}

const clearMemberRefresh = () => {
  if (memberRefreshTimer) {
    window.clearInterval(memberRefreshTimer)
    memberRefreshTimer = undefined
  }
}

const sendHeartbeat = async () => {
  if (!joined.value || !sessionKey.value) return
  try {
    await sessionApi.heartbeat(sessionKey.value)
  } catch {
    // 心跳失败不打断页面主流程，交由下次心跳重试。
  }
}

const refreshMembers = async () => {
  if (!joined.value || !sessionKey.value) return
  try {
    const detail = await sessionApi.getDetail(sessionKey.value)
    if (sessionDetail.value) {
      sessionDetail.value = {
        ...sessionDetail.value,
        members: detail.members,
        currentVersion: detail.currentVersion,
        onlineMemberCount: detail.onlineMemberCount,
      }
    } else {
      sessionDetail.value = detail
    }
  } catch {
    // 成员状态刷新失败不打断主流程，交由下次轮询重试。
  }
}

const startHeartbeat = () => {
  clearHeartbeat()
  void sendHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendHeartbeat()
    }
  }, HEARTBEAT_INTERVAL_MS)
}

const startMemberRefresh = () => {
  clearMemberRefresh()
  void refreshMembers()
  memberRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void refreshMembers()
    }
  }, MEMBER_REFRESH_INTERVAL_MS)
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    startHeartbeat()
    startMemberRefresh()
    return
  }
  clearHeartbeat()
  clearMemberRefresh()
}

const joinSessionIfNeeded = async () => {
  if (!sessionKey.value || joined.value || joining.value) return

  joining.value = true
  try {
    // 邀请链接直接访问时，自动调用 join。
    // 后端已约定 join 幂等：已在成员表时也会成功返回当前会话数据。
    const res = await wsClient.joinSession(sessionKey.value)
    sessionInfo.value = res
    // members 不在 join 返回中，这里补一次详情查询。
    sessionDetail.value = await sessionApi.getDetail(sessionKey.value)
    joined.value = true
    startHeartbeat()
    startMemberRefresh()

    // 规范化 URL，避免重复历史记录。
    await router.replace(`/session/${sessionKey.value}`)
  } catch (error: any) {
    ElMessage.error(error.message || '加入会话失败')
    await router.replace('/')
  } finally {
    joining.value = false
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  joinSessionIfNeeded()
})

onBeforeUnmount(() => {
  clearHeartbeat()
  clearMemberRefresh()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="draw-page">
    <app-header />

    <main class="draw-main">
      <el-card class="draw-card">
        <template v-if="joining">
          <el-skeleton animated>
            <template #template>
              <el-skeleton-item variant="h3" style="width: 180px" />
              <el-skeleton-item variant="text" style="margin-top: 12px; width: 70%" />
              <el-skeleton-item variant="text" style="margin-top: 8px; width: 55%" />
            </template>
          </el-skeleton>
        </template>

        <template v-else>
          <h2 class="title">绘图会话</h2>
          <p class="line">会话 Key：{{ sessionKey }}</p>
          <p class="line">会话名称：{{ sessionInfo?.name ?? sessionDetail?.name ?? '-' }}</p>
          <p class="line">当前版本：{{ sessionDetail?.currentVersion ?? sessionInfo?.currentVersion ?? 0 }}</p>
          <p class="line">成员数：{{ sessionDetail?.members?.length ?? 0 }}</p>
          <p class="line">画布全量数据：{{ sessionInfo?.graphics ? '已加载' : '暂无' }}</p>
          <div v-if="sessionDetail?.members?.length" class="members">
            <div class="members-title">成员列表</div>
            <div class="member-list">
              <div v-for="member in sessionDetail.members" :key="member.userId" class="member-item">
                <el-avatar
                  :size="26"
                  :src="member.avatar"
                  class="member-avatar"
                  :class="{ 'avatar-online': member.onlineStatus === 1 }"
                  :title="member.onlineStatus === 1 ? '在线' : '离线'"
                >
                  {{ member.username.slice(0, 1).toUpperCase() }}
                </el-avatar>
                <span class="member-name">{{ member.username }}</span>
                <span class="member-role">{{ memberRoleText(member.role) }}</span>
              </div>
            </div>
          </div>
          <p class="hint">Canvas 与 WebSocket 实时协作区域待接入。</p>
          <el-button type="primary" @click="handleBack">返回会话列表</el-button>
        </template>
      </el-card>
    </main>
  </div>
</template>

<style scoped>
.draw-page {
  min-height: 100vh;
  background: #f5f7fb;
}

.draw-main {
  padding: 24px;
}

.draw-card {
  border-radius: 8px;
}

.title {
  margin: 0 0 12px;
  color: #1f2d3d;
}

.line {
  margin: 0 0 10px;
  color: #606266;
}

.hint {
  margin: 16px 0;
  color: #909399;
}

.members {
  margin: 12px 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f9fd;
}

.members-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #2f3c4d;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #3d4b5d;
}

.member-name {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-role {
  font-size: 12px;
  color: #7f8ea3;
}

.member-avatar {
  box-sizing: border-box;
  border: 2px solid transparent;
}

.member-avatar.avatar-online {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
}
</style>
