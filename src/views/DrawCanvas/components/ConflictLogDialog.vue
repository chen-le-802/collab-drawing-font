<script setup lang="ts">
import type { CollaborationConflictType, SessionConflictLogItemVO } from '@/types/session'

defineProps<{
  visible: boolean
  loading: boolean
  list: SessionConflictLogItemVO[]
  isTechnicalExpanded: (id: number) => boolean
  formatConflictTypeLabel: (value: CollaborationConflictType) => string
  formatFieldNameLabel: (value: string) => string
  formatConflictLogSummary: (item: SessionConflictLogItemVO) => string
  formatConflictResolveStrategyLabel: (strategy: string) => string
  formatConflictValue: (value: unknown) => string
  canLocateObject: (objectKey: string) => boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  refresh: []
  toggleTechnical: [id: number]
  locateObject: [item: SessionConflictLogItemVO]
}>()

const close = () => {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    class="cd-scroll-dialog"
    :model-value="visible"
    title="冲突日志（CRDT）"
    width="760px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="conflict-toolbar">
      <el-button size="small" :loading="loading" @click="emit('refresh')">刷新</el-button>
    </div>
    <div v-if="list.length === 0" class="history-empty">暂无冲突记录</div>
    <div v-else class="conflict-list">
      <div v-for="item in list" :key="item.id" class="conflict-row">
        <div class="conflict-head">
          <span class="conflict-type">{{ formatConflictTypeLabel(item.conflictType) }}</span>
          <span class="conflict-field">{{ formatFieldNameLabel(item.fieldName || '-') }}</span>
          <span class="conflict-time">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
          <el-button link type="primary" size="small" :disabled="!canLocateObject(item.objectKey)" @click="emit('locateObject', item)">
            定位并高亮
          </el-button>
          <el-button link type="info" size="small" @click="emit('toggleTechnical', item.id)">
            {{ isTechnicalExpanded(item.id) ? '收起技术详情' : '技术详情' }}
          </el-button>
        </div>
        <div class="conflict-summary">{{ formatConflictLogSummary(item) }}</div>
        <div v-if="isTechnicalExpanded(item.id)" class="conflict-tech">
          <div class="conflict-meta">
            <span>对象: {{ item.objectKey }}</span>
            <span>策略: {{ formatConflictResolveStrategyLabel(item.resolveStrategy) }}</span>
            <span>操作ID: {{ item.operationId || '-' }}</span>
          </div>
          <div class="conflict-values">
            <div>当前值: {{ formatConflictValue(item.currentValue) }}</div>
            <div>传入值: {{ formatConflictValue(item.incomingValue) }}</div>
            <div>采用值: {{ formatConflictValue(item.resolvedValue) }}</div>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>
