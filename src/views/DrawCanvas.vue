<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import type { MemberVO, SessionDetailVO, SessionJoinVO } from '@/types/session'
import { userApi } from '@/api/user'
import WebSocketClient from '@/ws/client'
import type {
  ConnectedEventData,
  DisconnectedEventData,
  MemberJoinedData,
  ReconnectFailedEventData,
  ReconnectingEventData,
  SessionJoinedData,
  SessionLeftData,
  WsErrorData,
} from '@/ws/types'
import { sessionApi } from '@/api/session'
import { useAuthStore } from '@/stores/auth'
import { storage } from '@/utils/storage'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const joining = ref(false)
const joined = ref(false)
const wsConnected = ref(false)
const reconnecting = ref(false)
const reconnectFailed = ref(false)
const reconnectAttempt = ref(0)
const reconnectMaxAttempts = ref(0)
const reconnectDelay = ref(0)
const sessionInfo = ref<SessionJoinVO | null>(null)
const sessionDetail = ref<SessionDetailVO | null>(null)
const navigatingAway = ref(false)
const currentUserId = ref<number | null>(authStore.user?.userId ?? null)
const memberViewTab = ref<'active' | 'left' | 'removed'>('active')
const loadingMembers = ref(false)
let membersRefreshTimer: number | null = null
let membersRefreshRequestId = 0
const HEARTBEAT_INTERVAL_MS = 20000
let heartbeatTimer: number | undefined
let wsClient: WebSocketClient | null = null
let onMemberJoined: ((payload: MemberJoinedData) => void) | null = null
let onMemberLeft: ((payload: MemberJoinedData) => void) | null = null

const sessionKey = computed(() => String(route.params.sessionKey || ''))
const memberRoleText = (role: number): string => (role === 2 ? '创建者' : '成员')
const wsUrl = computed(() => {
  const baseApi = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
  const origin = baseApi.replace(/\/api\/?$/, '')
  return `${origin.replace(/^http/i, 'ws')}/ws`
})

const connectionStatusText = computed(() => {
  if (reconnectFailed.value) {
    return '重连失败'
  }
  if (reconnecting.value) {
    return '重连中'
  }
  if (wsConnected.value) {
    return 'WebSocket 已连接'
  }
  return 'WebSocket 未连接'
})

const connectionStatusClass = computed(() => {
  if (reconnectFailed.value) {
    return 'status-failed'
  }
  if (reconnecting.value) {
    return 'status-reconnecting'
  }
  if (wsConnected.value) {
    return 'status-connected'
  }
  return 'status-disconnected'
})

const includeHistoryMembers = computed(() => memberViewTab.value !== 'active')

const filteredMembers = computed(() => {
  const members = sessionDetail.value?.members ?? []
  if (memberViewTab.value === 'active') {
    return members.filter((member) => (member.membershipStatus ?? 'active') === 'active')
  }
  if (memberViewTab.value === 'left') {
    return members.filter((member) => member.membershipStatus === 'left')
  }
  return members.filter((member) => member.membershipStatus === 'removed')
})

const handleBack = () => {
  navigatingAway.value = true
  router.push('/')
}

const handleBackToListFromReconnectFailed = async () => {
  navigatingAway.value = true
  if (wsClient) {
    wsClient.disconnect()
  }
  clearHeartbeat()
  await router.push('/')
}

const isCreator = computed(() => {
  if (!sessionDetail.value || !currentUserId.value) {
    return false
  }
  return sessionDetail.value.creatorId === currentUserId.value
})

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

const handleLeaveSession = () => {
  if (isCreator.value) {
    ElMessage.warning('创建者不能退出会话，请直接删除会话')
    return
  }
  if (!sessionKey.value) return
  ElMessageBox.confirm(
    '退出后将从“我加入的会话”中移除，但你仍可通过邀请链接再次加入。是否继续？',
    '退出会话确认',
    {
      type: 'warning',
      confirmButtonText: '确认退出',
      cancelButtonText: '取消',
    },
  )
    .then(async () => {
      navigatingAway.value = true
      await sessionApi.leave(sessionKey.value)
      ElMessage.success('已退出会话，可通过邀请链接再次加入')
      await router.push('/')
    })
    .catch((error: unknown) => {
      if (error === 'cancel' || error === 'close') {
        return
      }
      ElMessage.error((error as Error)?.message || '退出会话失败')
    })
}

const handleDeleteSession = () => {
  if (!sessionKey.value || !isCreator.value) {
    return
  }
  ElMessageBox.confirm('确认删除该会话吗？删除后会话及成员关系将被清理。', '删除会话确认', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      navigatingAway.value = true
      await sessionApi.deleteSession(sessionKey.value)
      ElMessage.success('会话已删除')
      await router.push('/my-sessions')
    })
    .catch((error: unknown) => {
      if (error === 'cancel' || error === 'close') {
        return
      }
      ElMessage.error((error as Error)?.message || '删除会话失败')
    })
}

const clearHeartbeat = () => {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
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

const startHeartbeat = () => {
  clearHeartbeat()
  void sendHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendHeartbeat()
    }
  }, HEARTBEAT_INTERVAL_MS)
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    startHeartbeat()
    return
  }
  clearHeartbeat()
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

const patchMemberOnlineStatus = (payload: MemberJoinedData, onlineStatus: number) => {
  if (!sessionDetail.value || payload.sessionKey !== sessionKey.value) {
    return
  }

  const currentMembers = sessionDetail.value.members ?? []
  const hasTargetMember = currentMembers.some((item) => item.userId === payload.userId)
  const serverHasFullMembers = payload.members.length > 0

  if (serverHasFullMembers) {
    sessionDetail.value = {
      ...sessionDetail.value,
      members: payload.members,
      onlineMemberCount: payload.members.filter((item) => item.onlineStatus === 1).length,
    }
    return
  }

  if (hasTargetMember) {
    const nextMembers = currentMembers.map((item) => {
      if (item.userId !== payload.userId) {
        return item
      }
      return {
        ...item,
        onlineStatus,
      }
    })

    sessionDetail.value = {
      ...sessionDetail.value,
      members: nextMembers,
      onlineMemberCount: nextMembers.filter((item) => item.onlineStatus === 1).length,
    }
    return
  }

  // 后端推送不含完整 members 且本地无该成员时，不猜字段，改为触发一次轻量刷新。
  scheduleMembersRefresh()
}

const handleWsConnected = (_payload: ConnectedEventData) => {
  wsConnected.value = true
  reconnecting.value = false
  reconnectFailed.value = false
  reconnectAttempt.value = 0
  reconnectMaxAttempts.value = 0
  reconnectDelay.value = 0
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
    ElMessage.error(payload.message || 'WebSocket 出错')
  }
}

const handleSessionLeft = async (payload: SessionLeftData) => {
  if (payload.sessionKey !== sessionKey.value || navigatingAway.value) {
    return
  }
  navigatingAway.value = true
  ElMessage.info('你已离开当前会话')
  if (wsClient) {
    wsClient.disconnect()
  }
  clearHeartbeat()
  await router.push('/')
}

const handleSessionJoined = (payload: SessionJoinedData) => {
  if (payload.sessionKey !== sessionKey.value) {
    return
  }
  joined.value = true
  sessionInfo.value = {
    sessionId: payload.sessionId,
    sessionKey: payload.sessionKey,
    name: payload.name,
    currentVersion: payload.currentVersion,
    graphics: payload.graphics,
  }
  sessionDetail.value = {
    sessionId: payload.sessionId,
    sessionKey: payload.sessionKey,
    name: payload.name,
    status: 1,
    creatorId: sessionDetail.value?.creatorId ?? 0,
    creatorName: sessionDetail.value?.creatorName,
    memberCount: payload.members.length,
    onlineMemberCount: payload.members.filter((item) => item.onlineStatus === 1).length,
    currentVersion: payload.currentVersion,
    createdAt: sessionDetail.value?.createdAt ?? new Date().toISOString(),
    members: payload.members,
  }
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
    ElMessage.error(error.message || '刷新成员列表失败')
  } finally {
    loadingMembers.value = false
  }
}

const handleChangeMemberViewTab = async (tab: 'active' | 'left' | 'removed') => {
  if (memberViewTab.value === tab) {
    return
  }
  memberViewTab.value = tab
  await refreshSessionMembers()
}

const memberStatusTagType = (status?: MemberVO['membershipStatus']) => {
  if (status === 'left') {
    return 'warning'
  }
  if (status === 'removed') {
    return 'danger'
  }
  return 'success'
}

const memberStatusText = (status?: MemberVO['membershipStatus']) => {
  if (status === 'left') {
    return '已退出'
  }
  if (status === 'removed') {
    return '已移除'
  }
  return '成员'
}

const handleRemoveMember = (member: MemberVO) => {
  if (!sessionKey.value || !sessionDetail.value || !isCreator.value) {
    return
  }
  if (member.role === 2) {
    ElMessage.warning('不能移除创建者')
    return
  }
  ElMessageBox.confirm(`确认移除成员“${member.username}”吗？`, '移除成员确认', {
    type: 'warning',
    confirmButtonText: '确认移除',
    cancelButtonText: '取消',
  })
    .then(async () => {
      await sessionApi.removeMember(sessionKey.value, member.userId)
      ElMessage.success('成员已移除')
      await refreshSessionMembers()
    })
    .catch((error: unknown) => {
      if (error === 'cancel' || error === 'close') {
        return
      }
      ElMessage.error((error as Error)?.message || '移除成员失败')
    })
}

const handleTransferCreator = (member: MemberVO) => {
  if (!sessionKey.value || !sessionDetail.value || !isCreator.value) {
    return
  }
  if (member.role === 2) {
    ElMessage.warning('该成员已经是创建者')
    return
  }
  if ((member.membershipStatus ?? 'active') !== 'active') {
    ElMessage.warning('只能转让给当前成员')
    return
  }

  ElMessageBox.confirm(
    `确认将会话创建者身份转让给“${member.username}”吗？转让后你将变为普通成员。`,
    '转让创建者确认',
    {
      type: 'warning',
      confirmButtonText: '确认转让',
      cancelButtonText: '取消',
    },
  )
    .then(async () => {
      await sessionApi.transferCreator(sessionKey.value, member.userId)
      ElMessage.success('创建者已转让')
      await refreshSessionMembers()
    })
    .catch((error: unknown) => {
      if (error === 'cancel' || error === 'close') {
        return
      }
      ElMessage.error((error as Error)?.message || '转让创建者失败')
    })
}

const handleRetryWsConnect = () => {
  if (!wsClient) {
    return
  }
  reconnectFailed.value = false
  reconnecting.value = false
  reconnectAttempt.value = 0
  reconnectMaxAttempts.value = 0
  reconnectDelay.value = 0
  wsClient.connect()
}

const bindWsHandlers = (client: WebSocketClient) => {
  onMemberJoined = (payload) => patchMemberOnlineStatus(payload, 1)
  onMemberLeft = (payload) => patchMemberOnlineStatus(payload, 0)
  client.on('connected', handleWsConnected)
  client.on('disconnected', handleWsDisconnected)
  client.on('reconnecting', handleWsReconnecting)
  client.on('reconnect_failed', handleWsReconnectFailed)
  client.on('error', handleWsError)
  client.on('session_joined', handleSessionJoined)
  client.on('session_left', handleSessionLeft)
  client.on('member_joined', onMemberJoined)
  client.on('member_left', onMemberLeft)
}

const unbindWsHandlers = (client: WebSocketClient) => {
  client.off('connected', handleWsConnected)
  client.off('disconnected', handleWsDisconnected)
  client.off('reconnecting', handleWsReconnecting)
  client.off('reconnect_failed', handleWsReconnectFailed)
  client.off('error', handleWsError)
  client.off('session_joined', handleSessionJoined)
  client.off('session_left', handleSessionLeft)
  if (onMemberJoined) {
    client.off('member_joined', onMemberJoined)
    onMemberJoined = null
  }
  if (onMemberLeft) {
    client.off('member_left', onMemberLeft)
    onMemberLeft = null
  }
}

const joinSessionIfNeeded = async () => {
  if (!sessionKey.value || joined.value || joining.value) return

  joining.value = true
  try {
    await ensureCurrentUserId()
    // 邀请链接直接访问时，自动调用 join。
    // 后端已约定 join 幂等：已在成员表时也会成功返回当前会话数据。
    const res = await sessionApi.join(sessionKey.value)
    sessionInfo.value = res
    // members 不在 join 返回中，这里补一次详情查询。
    sessionDetail.value = await sessionApi.getDetail(sessionKey.value, includeHistoryMembers.value)
    joined.value = true
    startHeartbeat()
    const token = storage.getToken()
    if (!token) {
      throw new Error('未登录')
    }
    const client = new WebSocketClient(wsUrl.value, token, sessionKey.value)
    bindWsHandlers(client)
    wsClient = client
    wsClient.connect()

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
  if (membersRefreshTimer !== null) {
    window.clearTimeout(membersRefreshTimer)
    membersRefreshTimer = null
  }
  if (wsClient) {
    unbindWsHandlers(wsClient)
    wsClient.disconnect()
    wsClient = null
  }
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
          <p class="line connection-line">
            连接状态：
            <span class="status-dot" :class="connectionStatusClass"></span>
            <span>{{ connectionStatusText }}</span>
          </p>
          <p v-if="reconnecting" class="line reconnecting-line">
            正在重连（第 {{ reconnectAttempt }}/{{ reconnectMaxAttempts }} 次，{{ reconnectDelay / 1000 }} 秒后）
          </p>
          <p v-if="reconnectFailed" class="line reconnect-failed-line">
            重连失败（已尝试 {{ reconnectAttempt }}/{{ reconnectMaxAttempts }} 次），请刷新页面或返回列表重进会话
          </p>
          <div v-if="reconnectFailed" class="reconnect-actions">
            <el-button size="small" type="warning" plain @click="handleRetryWsConnect">重试连接</el-button>
            <el-button size="small" @click="handleBackToListFromReconnectFailed">返回会话列表</el-button>
          </div>
          <p class="line">画布全量数据：{{ sessionInfo?.graphics ? '已加载' : '暂无' }}</p>
          <div class="member-controls">
            <div class="member-view-tabs">
              <el-button
                size="small"
                :type="memberViewTab === 'active' ? 'primary' : 'default'"
                @click="handleChangeMemberViewTab('active')"
              >
                当前成员
              </el-button>
              <el-button
                size="small"
                :type="memberViewTab === 'left' ? 'primary' : 'default'"
                @click="handleChangeMemberViewTab('left')"
              >
                已退出
              </el-button>
              <el-button
                size="small"
                :type="memberViewTab === 'removed' ? 'primary' : 'default'"
                @click="handleChangeMemberViewTab('removed')"
              >
                已移除
              </el-button>
            </div>
          </div>
          <div v-if="filteredMembers.length" class="members">
            <div class="members-title">成员列表</div>
            <div class="member-list">
              <div v-for="member in filteredMembers" :key="member.userId" class="member-item">
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
                <el-tag size="small" :type="memberStatusTagType(member.membershipStatus)" effect="plain">
                  {{ memberStatusText(member.membershipStatus) }}
                </el-tag>
                <el-button
                  v-if="isCreator && member.role !== 2 && (member.membershipStatus || 'active') !== 'removed'"
                  size="small"
                  text
                  type="danger"
                  @click="handleRemoveMember(member)"
                >
                  移除
                </el-button>
                <el-button
                  v-if="isCreator && member.role !== 2 && (member.membershipStatus ?? 'active') === 'active'"
                  size="small"
                  text
                  type="primary"
                  @click="handleTransferCreator(member)"
                >
                  转让创建者
                </el-button>
              </div>
            </div>
          </div>
          <p class="hint">Canvas 与 WebSocket 实时协作区域待接入。</p>
          <div class="actions">
            <el-button type="primary" @click="handleBack">返回会话列表</el-button>
            <el-button v-if="isCreator" type="danger" plain @click="handleDeleteSession">删除会话</el-button>
            <el-button v-else type="warning" plain @click="handleLeaveSession">退出会话</el-button>
          </div>
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

.connection-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-connected {
  background: #16a34a;
}

.status-reconnecting {
  background: #d97706;
}

.status-failed {
  background: #dc2626;
}

.status-disconnected {
  background: #94a3b8;
}

.reconnecting-line {
  color: #d97706;
}

.reconnect-failed-line {
  color: #dc2626;
}

.reconnect-actions {
  margin: -4px 0 8px;
}

.hint {
  margin: 16px 0;
  color: #909399;
}

.member-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 12px;
}

.member-view-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
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
