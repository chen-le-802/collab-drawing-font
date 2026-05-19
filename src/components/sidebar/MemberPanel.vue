<script setup lang="ts">
import { computed } from 'vue'
import { Fold, MoreFilled } from '@element-plus/icons-vue'

import type { MemberVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    members: MemberVO[]
    collapsed: boolean
    loading?: boolean
  }>(),
  {
    loading: false,
  },
)

const emit = defineEmits<{
  toggleCollapse: []
}>()

const visibleMembers = computed(() => {
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

const roleText = (role: number) => {
  if (role === 3) {
    return 'owner'
  }
  if (role === 2) {
    return 'manager'
  }
  if (role === 1) {
    return 'editor'
  }
  return 'viewer'
}

const roleTagClass = (role: number) => {
  if (role === 3) {
    return 'role-tag-owner'
  }
  if (role === 2) {
    return 'role-tag-manager'
  }
  if (role === 1) {
    return 'role-tag-editor'
  }
  return ''
}

const displayName = (member: MemberVO) => {
  const normalized = member.username?.trim()
  if (normalized) {
    return normalized
  }
  return `用户${member.userId}`
}
</script>

<template>
  <aside class="member-panel" :class="{ collapsed: collapsed }">
    <div class="panel-header">
      <div class="title-wrap" v-if="!collapsed">
        <h3 class="title">在线成员</h3>
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
            {{ displayName(member).slice(0, 1).toUpperCase() }}
          </el-avatar>
          <div class="meta">
            <div class="name-row">
              <div class="name" :title="displayName(member)">{{ displayName(member) }}</div>
              <div class="role-tag" :class="roleTagClass(member.role)">{{ roleText(member.role) }}</div>
            </div>
            <div class="status">
              <span class="dot" :class="statusClass(member)"></span>
              <span>{{ statusText(member) }}</span>
            </div>
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
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(226, 230, 239, 0.92);
  border-radius: var(--cd-radius-lg);
  box-shadow: var(--cd-shadow-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.member-panel.collapsed {
  width: 44px;
  border-radius: 14px;
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
  width: 100%;
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--cd-text-primary);
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
  padding: 8px 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  transition: background var(--cd-transition), border-color var(--cd-transition);
}

.member-item :deep(.el-avatar) {
  flex-shrink: 0;
}

.member-item:hover {
  background: #f8f9fc;
  border-color: var(--cd-border);
}

.meta {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.name-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.name {
  font-size: 13px;
  color: var(--cd-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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
  background: var(--cd-accent-mint);
  box-shadow: 0 0 0 3px rgba(49, 211, 189, 0.18);
  animation: pulse-green 2s infinite;
}

.role-tag {
  flex-shrink: 0;
  font-size: 10px;
  color: #4b5563;
  line-height: 16px;
  padding: 0 6px;
  background: #eef2f7;
  border: 1px solid #e1e7f0;
  border-radius: 999px;
  text-transform: lowercase;
}

.role-tag-owner {
  color: #ffffff;
  background: #f6c53c;
  border-color: #f6c53c;
}

.role-tag-manager {
  color: #ffffff;
  background: #4dd6c8;
  border-color: #4dd6c8;
}

.role-tag-editor {
  color: #1f4fbd;
  background: #eef3ff;
  border-color: #dbe6ff;
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

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.2s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
</style>
