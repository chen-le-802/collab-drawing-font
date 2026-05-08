<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  zoomPercent: number
  zoomOptions: number[]
  graphicCount: number
  currentVersion: number
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
    <div class="item">v{{ currentVersion }}</div>
    <div class="item">同步: {{ syncText }}</div>
    <div class="item">{{ reconnectText }}</div>
    <div class="item status" :class="connectionClass">● {{ connectionText }}</div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 32px;
  border-top: 1px solid #e5e7eb;
  background: #ffffff;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  font-size: 12px;
  color: #4b5563;
}

.item {
  white-space: nowrap;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-select {
  width: 92px;
}

:deep(.zoom-select .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
}

.status.connected {
  color: #16a34a;
}

.status.disconnected {
  color: #dc2626;
}
</style>
