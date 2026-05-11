<script setup lang="ts">
import { computed } from 'vue'
import { Delete, Fold, MoreFilled, Promotion } from '@element-plus/icons-vue'

import type { MemberVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    members: MemberVO[]
    collapsed: boolean
    includeHistory?: boolean
    loading?: boolean
    isCreator?: boolean
    currentUserId?: number | null
  }>(),
  {
    includeHistory: false,
    loading: false,
    isCreator: false,
    currentUserId: null,
  },
)

const emit = defineEmits<{
  toggleCollapse: []
  'update:includeHistory': [value: boolean]
  removeMember: [member: MemberVO]
  transferCreator: [member: MemberVO]
}>()

const visibleMembers = computed(() => {
  if (props.includeHistory) {
    return props.members
  }
  return props.members.filter((member) => (member.membershipStatus ?? 'active') === 'active')
})

const statusText = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (status === 'left') {
    return '已退出'
  }
  if (status === 'removed') {
    return '已移除'
  }
  return member.onlineStatus === 1 ? '在线' : '离线'
}

const statusClass = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (status === 'left') {
    return 'dot-left'
  }
  if (status === 'removed') {
    return 'dot-removed'
  }
  return member.onlineStatus === 1 ? 'dot-online' : 'dot-offline'
}

const canRemove = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (!props.isCreator) {
    return false
  }
  if (member.role === 2) {
    return false
  }
  if (props.currentUserId && member.userId === props.currentUserId) {
    return false
  }
  return status === 'active'
}

const canTransferCreator = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (!props.isCreator) {
    return false
  }
  if (status !== 'active') {
    return false
  }
  if (member.role === 2) {
    return false
  }
  if (props.currentUserId && member.userId === props.currentUserId) {
    return false
  }
  return true
}
</script>

<template>
  <aside class="member-panel" :class="{ collapsed: collapsed }">
    <div class="panel-header">
      <div class="title-wrap" v-if="!collapsed">
        <h3 class="title">在线成员</h3>
        <el-switch
          class="history-switch"
          :model-value="includeHistory"
          size="small"
          inline-prompt
          active-text="历史"
          inactive-text="当前"
          @update:model-value="$emit('update:includeHistory', $event)"
        />
      </div>
      <el-button class="collapse-btn" text @click="$emit('toggleCollapse')" :title="collapsed ? '展开成员面板' : '收起成员面板'">
        <el-icon>
          <Fold v-if="!collapsed" />
          <MoreFilled v-else />
        </el-icon>
      </el-button>
    </div>

    <transition name="panel-fade">
      <div v-if="!collapsed" class="member-list" v-loading="loading">
        <div v-if="visibleMembers.length === 0" class="empty">暂无成员</div>
        <div v-for="member in visibleMembers" :key="member.userId" class="member-item">
          <el-avatar :size="30" :src="member.avatar">
            {{ member.username.slice(0, 1).toUpperCase() }}
          </el-avatar>
          <div class="meta">
            <div class="name">{{ member.username }}</div>
            <div class="status">
              <span class="dot" :class="statusClass(member)"></span>
              <span>{{ statusText(member) }}</span>
            </div>
          </div>
          <div class="actions">
            <el-button
              v-if="canTransferCreator(member)"
              type="primary"
              text
              size="small"
              title="转交创建者"
              @click="$emit('transferCreator', member)"
            >
              <el-icon><Promotion /></el-icon>
            </el-button>
            <el-button
              v-if="canRemove(member)"
              type="danger"
              text
              size="small"
              title="移除成员"
              @click="$emit('removeMember', member)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
    </transition>
  </aside>
</template>

<style scoped>
.member-panel {
  width: 210px;
  margin: 10px 10px 10px 0;
  background: var(--cd-bg-card);
  border-radius: var(--cd-radius-lg);
  box-shadow: var(--cd-shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.member-panel.collapsed {
  width: 44px;
  border-radius: var(--cd-radius-md);
}

.panel-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--cd-border);
  padding: 0 10px;
}

.title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--cd-text-primary);
}

.history-switch {
  --el-switch-on-color: var(--cd-primary);
  --el-switch-off-color: #d1d5db;
}

.collapse-btn {
  padding: 4px;
}

.member-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--cd-radius-md);
  transition: background var(--cd-transition);
}

.member-item:hover {
  background: var(--cd-primary-lighter);
}

.meta {
  min-width: 0;
  flex: 1;
}

.name {
  font-size: 13px;
  color: var(--cd-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--cd-text-muted);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.dot-online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
  animation: pulse-green 2s infinite;
}

.dot-offline {
  background: #9ca3af;
}

.dot-left {
  background: #f59e0b;
}

.dot-removed {
  background: #ef4444;
}

@keyframes pulse-green {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.empty {
  font-size: 12px;
  color: var(--cd-text-muted);
  text-align: center;
  padding: 20px 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.2s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
</style>
