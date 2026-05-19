<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  zoomPercent: number
  zoomOptions: number[]
  graphicCount: number
  currentVersion: number
  snapshotCount?: number
  serverVersion?: number
  clientVersion?: number
  pendingOperations?: number
  recentConflicts?: number
  connected: boolean
  reconnecting?: boolean
  reconnectFailed?: boolean
  lastSyncAt?: string
  reconnectCount?: number
  clientId?: string
  lamportTime?: number
  lastOperationId?: string
  technicalMode?: boolean
}>()

const emit = defineEmits<{
  'update:zoomPercent': [value: number]
  'update:technicalMode': [value: boolean]
}>()

const connectionText = computed(() => (props.connected ? '已连接' : '连接断开'))
const connectionClass = computed(() => (props.connected ? 'connected' : 'disconnected'))
const pendingOps = computed(() => props.pendingOperations ?? 0)
const recentConflicts = computed(() => props.recentConflicts ?? 0)
const syncStateText = computed(() => {
  if (props.reconnecting) {
    return '重连中'
  }
  if (!props.connected) {
    return pendingOps.value > 0 ? '离线编辑中' : '离线编辑中'
  }
  if (recentConflicts.value > 0) {
    return '存在冲突'
  }
  if (pendingOps.value > 0) {
    return '同步中'
  }
  return '已同步'
})
const syncStateClass = computed(() => {
  if (props.reconnecting) {
    return 'state-reconnecting'
  }
  if (!props.connected) {
    return 'state-offline'
  }
  if (recentConflicts.value > 0) {
    return 'state-conflict'
  }
  if (pendingOps.value > 0) {
    return 'state-syncing'
  }
  return 'state-synced'
})
const syncText = computed(() => props.lastSyncAt ? `已保存 ${props.lastSyncAt}` : '未保存')
const reconnectText = computed(() => `重连: ${props.reconnectCount ?? 0}`)
const snapshotText = computed(() => `快照数: ${props.snapshotCount ?? 0}`)
const serverVersionText = computed(() => `服务端版本: v${props.serverVersion ?? props.currentVersion}`)
const clientVersionText = computed(() => `客户端版本: v${props.clientVersion ?? props.currentVersion}`)
const pendingOpsText = computed(() => `待同步操作: ${pendingOps.value}`)
const recentConflictsText = computed(() => `最近冲突: ${recentConflicts.value}`)
const technicalMode = computed(() => !!props.technicalMode)
const technicalButtonText = computed(() => (technicalMode.value ? '隐藏技术详情' : '技术详情'))
const lamportText = computed(() => `Lamport: ${props.lamportTime ?? 0}`)
const clientIdText = computed(() => `Client: ${props.clientId ?? '-'}`)
const lastOperationIdText = computed(() => `Last Op: ${props.lastOperationId ?? '-'}`)
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
    <div class="item">{{ pendingOpsText }}</div>
    <div class="item state" :class="syncStateClass">{{ syncStateText }}</div>
    <div class="item">{{ syncText }}</div>
    <div class="item">{{ snapshotText }}</div>
    <div class="item status" :class="connectionClass">● {{ connectionText }}</div>
    <div class="item">{{ reconnectText }}</div>
    <button class="item toggle-button" @click="$emit('update:technicalMode', !technicalMode)">
      {{ technicalButtonText }}
    </button>
    <template v-if="technicalMode">
      <div class="item">{{ serverVersionText }}</div>
      <div class="item">{{ clientVersionText }}</div>
      <div class="item">{{ recentConflictsText }}</div>
      <div class="item">{{ lamportText }}</div>
      <div class="item">{{ clientIdText }}</div>
      <div class="item">{{ lastOperationIdText }}</div>
    </template>
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

.state.state-synced {
  color: #166534;
  background: #e7f8f4;
}

.state.state-syncing {
  color: #92400e;
  background: #fff7ed;
}

.state.state-conflict {
  color: #b42318;
  background: #fff1f3;
}

.state.state-offline,
.state.state-reconnecting {
  color: #4b5563;
  background: #f3f4f6;
}

.toggle-button {
  border: 1px solid var(--cd-border);
  cursor: pointer;
  color: var(--cd-text-secondary);
}

.toggle-button:hover {
  border-color: rgba(37, 99, 235, 0.28);
  color: var(--cd-primary);
}
</style>
