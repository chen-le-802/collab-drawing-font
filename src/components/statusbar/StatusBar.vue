<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  zoomPercent: number
  zoomOptions: number[]
  graphicCount: number
  currentVersion: number
  serverVersion?: number
  clientVersion?: number
  pendingOperations?: number
  recentConflicts?: number
  connected: boolean
  lastSyncAt?: string
  reconnectCount?: number
}>()

const emit = defineEmits<{
  'update:zoomPercent': [value: number]
}>()

const connectionText = computed(() => (props.connected ? '已连接' : '断开'))
const connectionClass = computed(() => (props.connected ? 'connected' : 'disconnected'))
const syncText = computed(() => props.lastSyncAt || '-')
const reconnectText = computed(() => `重连: ${props.reconnectCount ?? 0}`)
const serverVersionText = computed(() => `服务端版本: v${props.serverVersion ?? props.currentVersion}`)
const clientVersionText = computed(() => `客户端版本: v${props.clientVersion ?? props.currentVersion}`)
const pendingOpsText = computed(() => `待确认操作: ${props.pendingOperations ?? 0}`)
const recentConflictsText = computed(() => `最近冲突: ${props.recentConflicts ?? 0}`)
</script>

<template>
  <footer class="status-bar">
    <div class="item zoom">
      <span>缩放:</span>
      <el-select
        :model-value="zoomPercent"
        size="small"
        class="zoom-select"
        @update:model-value="$emit('update:zoomPercent', Number($event))"
      >
        <el-option v-for="option in zoomOptions" :key="option" :label="`${option}%`" :value="option" />
      </el-select>
    </div>
    <div class="item">图元数量: {{ graphicCount }}</div>
    <div class="item">{{ serverVersionText }}</div>
    <div class="item">{{ clientVersionText }}</div>
    <div class="item">{{ pendingOpsText }}</div>
    <div class="item">{{ recentConflictsText }}</div>
    <div class="item">同步: {{ syncText }}</div>
    <div class="item">{{ reconnectText }}</div>
    <div class="item status" :class="connectionClass">● {{ connectionText }}</div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 30px;
  background: rgba(255, 255, 255, 0.92);
  border-top: 1px solid var(--cd-border);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  font-size: 11px;
  color: var(--cd-text-secondary);
  overflow-x: auto;
}

.item {
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f8f9fc;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-select {
  width: 82px;
}

:deep(.zoom-select .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
  box-shadow: none;
  background: transparent;
}

.status.connected {
  color: #16806d;
  background: #e7f8f4;
}

.status.disconnected {
  color: #dc2626;
  background: #fff1f1;
}
</style>
