<script setup lang="ts">
import { ArrowDown, Back, Delete, Download, Share, SwitchButton } from '@element-plus/icons-vue'
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
</script>

<template>
  <header class="top-bar">
    <div class="left">
      <button class="logo" @click="goHome">CD</button>
      <div class="session-name" @dblclick="editing = true">
        <el-input
          v-if="editing"
          v-model="localName"
          size="small"
          @blur="onSubmitName"
          @keyup.enter="onSubmitName"
        />
        <span v-else>{{ sessionName || '未命名会话' }}</span>
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
      <el-button size="small" @click="$emit('back')">
        <el-icon><Back /></el-icon>
        返回列表
      </el-button>
      <el-button size="small" @click="$emit('share')">
        <el-icon><Share /></el-icon>
        分享
      </el-button>
      <el-button size="small" @click="$emit('exportImage')">
        <el-icon><Download /></el-icon>
        导出
      </el-button>
      <el-button size="small" @click="$emit('showHistory')">历史</el-button>
      <el-button size="small" @click="$emit('showShortcuts')">快捷键</el-button>
      <el-dropdown trigger="click">
        <div class="user">
          <el-avatar :size="30" :src="userAvatar">U</el-avatar>
          <el-icon><ArrowDown /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-if="isCreator" @click="$emit('deleteSession')">
              <el-icon><Delete /></el-icon>
              删除当前会话
            </el-dropdown-item>
            <el-dropdown-item v-else @click="$emit('leave')">
              <el-icon><SwitchButton /></el-icon>
              退出当前会话
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  height: 56px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.right {
  justify-content: flex-end;
}

.logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  background: #111827;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.session-name {
  min-width: 140px;
  max-width: 320px;
  font-weight: 600;
}

.avatars {
  display: flex;
  align-items: center;
  gap: 4px;
}

.more {
  font-size: 12px;
  color: #6b7280;
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
}

.user {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
</style>
