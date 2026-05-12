<script setup lang="ts">
import {
  ArrowLeft,
  Clock,
  Delete,
  Download,
  Files,
  MoreFilled,
  Share,
  SwitchButton,
  Warning,
} from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import type { MemberVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    sessionName: string
    members: MemberVO[]
    userAvatar?: string
    isCreator?: boolean
  }>(),
  {
    userAvatar: '',
    isCreator: false,
  },
)

const emit = defineEmits<{
  'update:sessionName': [name: string]
  back: []
  share: []
  exportImage: []
  showHistory: []
  showConflicts: []
  showVersions: []
  showShortcuts: []
  leave: []
  deleteSession: []
}>()

const router = useRouter()
const editing = ref(false)
const localName = ref(props.sessionName)

watch(
  () => props.sessionName,
  (value) => {
    localName.value = value
  },
)

const visibleMembers = computed(() => props.members.slice(0, 5))
const hiddenCount = computed(() => Math.max(props.members.length - visibleMembers.value.length, 0))

const onSubmitName = () => {
  const next = localName.value.trim()
  if (next) {
    emit('update:sessionName', next)
  }
  editing.value = false
}

const goHome = () => router.push('/')

const handleMoreCommand = (command: string) => {
  const map: Record<string, () => void> = {
    history: () => emit('showHistory'),
    conflicts: () => emit('showConflicts'),
    versions: () => emit('showVersions'),
    shortcuts: () => emit('showShortcuts'),
    leave: () => emit('leave'),
    deleteSession: () => emit('deleteSession'),
  }
  map[command]?.()
}
</script>

<template>
  <header class="top-bar">
    <div class="left">
      <button class="brand-link" @click="goHome" title="返回首页" aria-label="返回首页">
        <span class="logo" aria-hidden="true"></span>
        <span class="brand-name">画协</span>
      </button>
      <div class="divider"></div>
      <div class="session-name" @dblclick="editing = true">
        <el-input
          v-if="editing"
          v-model="localName"
          size="small"
          @blur="onSubmitName"
          @keyup.enter="onSubmitName"
        />
        <span v-else class="name-text">{{ sessionName || '未命名会话' }}</span>
      </div>
    </div>

    <div class="center">
      <el-popover trigger="hover" placement="bottom" :width="240">
        <template #reference>
          <div class="avatars">
            <el-avatar v-for="member in visibleMembers" :key="member.userId" :size="28" :src="member.avatar">
              {{ member.username.slice(0, 1).toUpperCase() }}
            </el-avatar>
            <span v-if="hiddenCount > 0" class="more">+{{ hiddenCount }}</span>
          </div>
        </template>
        <div class="member-pop">
          <div v-for="member in members" :key="member.userId" class="member-row">
            <el-avatar :size="22" :src="member.avatar">{{ member.username.slice(0, 1).toUpperCase() }}</el-avatar>
            <span>{{ member.username }}</span>
            <span class="dot" :class="{ online: member.onlineStatus === 1 }"></span>
          </div>
        </div>
      </el-popover>
    </div>

    <div class="right">
      <button class="back-btn" @click="$emit('back')">
        <el-icon><ArrowLeft /></el-icon>
        返回列表
      </button>

      <div class="divider"></div>

      <button class="icon-btn" title="分享" @click="$emit('share')">
        <el-icon><Share /></el-icon>
      </button>
      <button class="icon-btn" title="导出图片" @click="$emit('exportImage')">
        <el-icon><Download /></el-icon>
      </button>

      <div class="divider"></div>

      <el-dropdown trigger="click" @command="handleMoreCommand">
        <button class="icon-btn more-btn" title="更多操作">
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="history">
              <el-icon class="menu-icon"><Clock /></el-icon> 操作历史
            </el-dropdown-item>
            <el-dropdown-item command="conflicts">
              <el-icon class="menu-icon"><Warning /></el-icon> 冲突日志
            </el-dropdown-item>
            <el-dropdown-item command="versions">
              <el-icon class="menu-icon"><Files /></el-icon> 版本快照
            </el-dropdown-item>
            <el-dropdown-item command="shortcuts" divided>
              <span class="menu-icon keyboard-icon">K</span> 快捷键
            </el-dropdown-item>
            <el-dropdown-item v-if="isCreator" command="deleteSession" divided>
              <el-icon class="menu-icon danger"><Delete /></el-icon>
              <span class="danger">删除会话</span>
            </el-dropdown-item>
            <el-dropdown-item v-else command="leave" divided>
              <el-icon class="menu-icon danger"><SwitchButton /></el-icon>
              <span class="danger">退出会话</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-avatar :size="30" :src="userAvatar" class="user-avatar" @click="router.push('/profile')" title="个人中心">U</el-avatar>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  height: 52px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--cd-bg-card);
  border-bottom: 1px solid var(--cd-border);
  position: relative;
  z-index: 5;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.right {
  justify-content: flex-end;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--cd-border);
  margin: 0 4px;
}

.brand-link {
  height: 38px;
  border: none;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: var(--cd-text-primary);
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
}

.logo {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: block;
  background-image: url('/logo.png');
  background-repeat: no-repeat;
  background-size: contain;
  background-position: center;
  transition: transform var(--cd-transition);
}

.brand-link:hover .logo {
  transform: scale(1.05);
}

.brand-name {
  line-height: 1;
}

.session-name {
  min-width: 120px;
  max-width: 280px;
}

.name-text {
  font-weight: 600;
  color: var(--cd-text-primary);
  font-size: 14px;
}

.avatars {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--cd-border);
  border-radius: 999px;
  background: #f8f9fc;
}

.avatars .el-avatar {
  margin-left: -6px;
  border: 2px solid var(--cd-bg-card);
}

.avatars .el-avatar:first-child {
  margin-left: 0;
}

.more {
  font-size: 12px;
  color: var(--cd-text-muted);
  margin-left: 6px;
}

.member-pop {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
}

.dot.online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: #f8f9fc;
  color: var(--cd-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: background var(--cd-transition), color var(--cd-transition);
}

.icon-btn:hover {
  border-color: rgba(37, 99, 235, 0.24);
  background: var(--cd-primary-light);
  color: var(--cd-primary);
}

.menu-icon {
  margin-right: 6px;
  font-size: 14px;
}

.keyboard-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: 1px solid currentColor;
  font-size: 10px;
  font-weight: 700;
}

.danger {
  color: #dc2626;
}

.user-avatar {
  cursor: pointer;
  background: var(--cd-primary-light);
  color: var(--cd-primary);
  font-weight: 700;
  margin-left: 4px;
  transition: box-shadow var(--cd-transition);
}

.user-avatar:hover {
  box-shadow: 0 0 0 3px var(--cd-primary-light);
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--cd-border);
  border-radius: 999px;
  background: var(--cd-bg-card);
  padding: 6px 12px 6px 10px;
  font-size: 13px;
  color: var(--cd-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--cd-transition), color var(--cd-transition);
}

.back-btn:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
}
</style>
