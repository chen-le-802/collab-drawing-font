<script setup lang="ts">
import { computed } from 'vue'
import type { SessionVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    session: SessionVO
    isCreator?: boolean
  }>(),
  {
    isCreator: false,
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
  <el-card class="session-card" shadow="hover" @click="handleOpen">
    <div class="thumbnail">
      <div class="thumbnail-placeholder">
        <span>画布缩略图</span>
      </div>
    </div>

    <div class="content">
      <div class="top-row">
        <h3 class="name" :title="session.name">{{ session.name }}</h3>
        <el-tag size="small" :type="statusType">{{ statusText }}</el-tag>
      </div>

      <div class="creator" :title="session.creatorName || '未知创建者'">
        创建者：{{ session.creatorName || '未知' }}
      </div>

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

      <div class="time">{{ formattedTime }}</div>
    </div>

    <div class="actions" @click.stop>
      <el-button size="small" text type="primary" @click="handleCopy">复制链接</el-button>
      <el-button v-if="props.isCreator" size="small" text type="danger" @click="handleDelete">
        删除
      </el-button>
      <el-button v-else size="small" text type="warning" @click="handleLeave">退出会话</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.session-card {
  width: 280px;
  height: 200px;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

:deep(.session-card .el-card__body) {
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.thumbnail {
  height: 92px;
  border-radius: 6px;
  overflow: hidden;
  background: #eef3ff;
}

.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7f8ea3;
  background: linear-gradient(120deg, #dfe8ff 0%, #edf2ff 100%);
  font-size: 13px;
}

.content {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  color: #1f2d3d;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.creator {
  color: #7f8ea3;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.extra-members {
  color: #7f8ea3;
  font-size: 12px;
}

.member-count {
  color: #7f8ea3;
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
  color: #909399;
  font-size: 12px;
}

.online-count {
  color: #5f6f85;
  font-size: 12px;
}

.actions {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.session-card:hover .actions {
  opacity: 1;
}
</style>
