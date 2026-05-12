<script setup lang="ts">
import { computed } from 'vue'
import { CopyDocument, Delete, Right, SwitchButton } from '@element-plus/icons-vue'
import type { SessionVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    session: SessionVO
    isCreator?: boolean
    compact?: boolean
  }>(),
  {
    isCreator: false,
    compact: false,
  },
)

const emit = defineEmits<{
  open: [session: SessionVO]
  copy: [session: SessionVO]
  delete: [session: SessionVO]
  leave: [session: SessionVO]
}>()

// 将后端状态值映射为界面标签，避免模板里出现重复判断。
const statusType = computed(() => (props.session.status === 1 ? 'success' : 'info'))
const statusText = computed(() => (props.session.status === 1 ? '进行中' : '已结束'))

// 列表接口优先返回成员头像预览；缺失时回退占位头像。
const memberCount = computed(() => props.session.memberCount ?? 0)
const displayMembers = computed(() => {
  const previews = props.session.memberPreviews ?? []
  if (previews.length > 0) {
    return previews.slice(0, 4).map((member) => ({
      userId: member.userId,
      avatar: member.avatar,
      isOnline: member.isOnline,
      fallbackText: (member.username || '?').slice(0, 1).toUpperCase(),
    }))
  }

  return Array.from({ length: Math.min(memberCount.value, 4) }, (_, index) => ({
    userId: index + 1,
    avatar: '',
    isOnline: false,
    fallbackText: String(index + 1),
  }))
})
const extraMembers = computed(() => Math.max(memberCount.value - 4, 0))
const onlineMemberCount = computed(() => props.session.onlineMemberCount ?? 0)

const formattedTime = computed(() => {
  const time = new Date(props.session.createdAt)
  if (Number.isNaN(time.getTime())) {
    return props.session.createdAt
  }
  return time.toLocaleString()
})

// 组件只负责事件分发，具体业务逻辑交由父组件处理。
const handleOpen = () => emit('open', props.session)
const handleCopy = () => emit('copy', props.session)
const handleDelete = () => emit('delete', props.session)
const handleLeave = () => emit('leave', props.session)
</script>

<template>
  <el-card class="session-card" :class="{ compact: props.compact }" shadow="never" @click="handleOpen">
    <div class="thumbnail">
      <img v-if="session.thumbnail" :src="session.thumbnail" :alt="`${session.name} 缩略图`" />
      <div v-else class="thumbnail-placeholder">
        <span class="placeholder-line placeholder-line-1"></span>
        <span class="placeholder-line placeholder-line-2"></span>
        <span class="placeholder-dot"></span>
      </div>
    </div>

    <div class="content">
      <div class="top-row">
        <h3 class="name" :title="session.name">{{ session.name }}</h3>
        <span class="status-pill" :class="`status-${statusType}`">{{ statusText }}</span>
      </div>

      <div class="creator" :title="session.creatorName || '未知创建者'">
        <span>创建者：{{ session.creatorName || '未知' }}</span>
        <span class="compact-online">在线 {{ onlineMemberCount }} / 成员 {{ memberCount }}</span>
      </div>

      <div class="session-meta">
        <div class="meta-row">
          <template v-if="displayMembers.length > 0">
            <el-avatar-group :max="4">
              <el-avatar
                v-for="member in displayMembers"
                :key="member.userId"
                :size="26"
                :src="member.avatar"
                class="member-avatar"
                :class="{ 'avatar-online': member.isOnline }"
                :title="member.isOnline ? '在线' : '离线'"
              >
                {{ member.fallbackText }}
              </el-avatar>
            </el-avatar-group>
            <span v-if="extraMembers > 0" class="extra-members">+{{ extraMembers }}</span>
          </template>
          <span v-else class="member-count">成员 {{ memberCount }}</span>
        </div>

        <div class="online-count">在线 {{ onlineMemberCount }} / 成员 {{ memberCount }}</div>
      </div>

      <div class="time">{{ formattedTime }}</div>
    </div>

    <div class="actions" @click.stop>
      <button class="icon-action" title="复制链接" @click="handleCopy">
        <el-icon><CopyDocument /></el-icon>
      </button>
      <button v-if="props.isCreator" class="icon-action danger" title="删除" @click="handleDelete">
        <el-icon><Delete /></el-icon>
      </button>
      <button v-else class="icon-action warning" title="退出会话" @click="handleLeave">
        <el-icon><SwitchButton /></el-icon>
      </button>
      <button class="open-action" title="打开会话" @click="handleOpen">
        <el-icon><Right /></el-icon>
      </button>
    </div>
  </el-card>
</template>

<style scoped>
.session-card {
  border-radius: var(--cd-radius-lg);
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid rgba(226, 230, 239, 0.9);
  box-shadow: none;
  transition: border-color var(--cd-transition), box-shadow var(--cd-transition);
}

.session-card:hover {
  border-color: rgba(37, 99, 235, 0.34);
  box-shadow: 0 16px 34px rgba(20, 30, 55, 0.08);
}

:deep(.session-card .el-card__body) {
  height: 100%;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

:deep(.session-card.compact .el-card__body) {
  min-height: 0;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.thumbnail {
  height: 108px;
  border-radius: var(--cd-radius-md);
  overflow: hidden;
  background: #f6f7fb;
  border: 1px solid #edf0f6;
}

.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.session-card.compact .thumbnail {
  display: none;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  position: relative;
  background:
    linear-gradient(#eef1f7 1px, transparent 1px),
    linear-gradient(90deg, #eef1f7 1px, transparent 1px),
    #fbfcff;
  background-size: 18px 18px;
}

.placeholder-line,
.placeholder-dot {
  position: absolute;
  display: block;
}

.placeholder-line {
  height: 3px;
  border-radius: 999px;
}

.placeholder-line-1 {
  width: 46%;
  left: 18%;
  top: 58%;
  background: var(--cd-accent-coral);
  transform: rotate(-12deg);
}

.placeholder-line-2 {
  width: 34%;
  right: 14%;
  top: 38%;
  background: var(--cd-accent-sky);
  transform: rotate(16deg);
}

.placeholder-dot {
  width: 12px;
  height: 12px;
  right: 26%;
  top: 52%;
  border-radius: 999px;
  background: var(--cd-accent-mint);
}

.content {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-card.compact .content {
  min-width: 0;
  margin-top: 0;
  gap: 7px;
}

.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.name {
  margin: 0;
  font-size: 15px;
  color: var(--cd-text-primary);
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status-pill {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.status-success {
  color: #16806d;
  background: #e7f8f4;
}

.status-info {
  color: #7b8190;
  background: #f0f2f6;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-card.compact .session-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.creator {
  color: var(--cd-text-muted);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compact-online {
  display: none;
}

.session-card.compact .creator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.session-card.compact .creator span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-card.compact .compact-online {
  display: inline;
  flex-shrink: 0;
  color: var(--cd-text-secondary);
}

.extra-members {
  color: var(--cd-text-muted);
  font-size: 12px;
}

.member-count {
  color: var(--cd-text-muted);
  font-size: 12px;
}

.member-avatar {
  box-sizing: border-box;
  border: 2px solid transparent;
}

.member-avatar.avatar-online {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
}

.time {
  color: var(--cd-text-muted);
  font-size: 12px;
}

.session-card.compact .time {
  display: none;
}

.online-count {
  color: var(--cd-text-secondary);
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #edf0f6;
}

.session-card.compact .actions {
  margin-top: 10px;
  padding-top: 10px;
  padding-left: 0;
  border-top: 1px solid #edf0f6;
  border-left: none;
}

.session-card.compact .icon-action,
.session-card.compact .open-action {
  width: 28px;
  height: 28px;
}

.icon-action,
.open-action {
  width: 30px;
  height: 30px;
  border: 1px solid #e5e9f2;
  border-radius: 9px;
  background: #ffffff;
  color: var(--cd-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--cd-transition), border-color var(--cd-transition), color var(--cd-transition);
}

.icon-action:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
  background: var(--cd-primary-lighter);
}

.icon-action.danger:hover {
  border-color: #ffb4b4;
  color: #ef4444;
  background: #fff1f1;
}

.icon-action.warning:hover {
  border-color: #ffd28a;
  color: #d97706;
  background: #fff8e8;
}

.open-action {
  margin-left: auto;
  border-color: #202331;
  background: #202331;
  color: #ffffff;
}

.open-action:hover {
  background: #111827;
}

@media (max-width: 720px) {
  :deep(.session-card.compact .el-card__body) {
    display: flex;
  }

  .session-card.compact .actions {
    justify-content: flex-end;
    padding-left: 0;
    padding-top: 10px;
    border-top: 1px solid #edf0f6;
  }
}
</style>
