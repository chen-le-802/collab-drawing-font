<script setup lang="ts">
import type { CollaborationConflictType, SessionOperationItemVO, SessionOperationType } from '@/types/session'

defineProps<{
  visible: boolean
  loading: boolean
  list: SessionOperationItemVO[]
  page: number
  pageSize: number
  total: number
  userOptions: Array<{ label: string; value: number }>
  filterUserId: number | null
  filterOperationType: SessionOperationType | 'all' | 'restore'
  filterConflictType: CollaborationConflictType | 'all'
  filterFromVersion: number | null
  filterToVersion: number | null
  isTechnicalExpanded: (id: number) => boolean
  canLocateObject: (objectKey: string) => boolean
  formatSessionOperationTypeLabel: (value: SessionOperationType) => string
  formatOperationActorLabel: (userId: number) => string
  formatConflictTypeLabel: (value: CollaborationConflictType) => string
  formatTimelineActivityText: (item: SessionOperationItemVO) => string
  formatTimelineConflictHint: (item: SessionOperationItemVO) => string
  formatFieldNamesText: (fields: string[]) => string
  getResolvedFieldList: (item: SessionOperationItemVO, key: 'appliedFields' | 'rejectedFields') => string[]
  formatResolveReasonLabel: (value: unknown) => string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:filterUserId': [value: number | null]
  'update:filterOperationType': [value: SessionOperationType | 'all' | 'restore']
  'update:filterConflictType': [value: CollaborationConflictType | 'all']
  'update:filterFromVersion': [value: number | null]
  'update:filterToVersion': [value: number | null]
  search: []
  reset: []
  pageChange: [page: number]
  toggleTechnical: [id: number]
  locateObject: [item: SessionOperationItemVO]
}>()

const close = () => {
  emit('update:visible', false)
}

const isRestoreEvent = (item: SessionOperationItemVO): boolean => {
  return typeof item.operationData === 'object' && item.operationData !== null && item.operationData.__systemEvent === 'restore_version'
}

const formatRowTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <el-dialog
    class="cd-scroll-dialog"
    :model-value="visible"
    title="协同操作时间线"
    width="860px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="timeline-filter">
      <el-select
        :model-value="filterUserId"
        clearable
        placeholder="操作者"
        size="small"
        style="width: 140px"
        @update:model-value="emit('update:filterUserId', $event ?? null)"
      >
        <el-option v-for="item in userOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-select
        :model-value="filterOperationType"
        placeholder="操作类型"
        size="small"
        style="width: 130px"
        @update:model-value="emit('update:filterOperationType', $event)"
      >
        <el-option label="全部操作" value="all" />
        <el-option label="创建图元" value="create" />
        <el-option label="更新图元" value="update" />
        <el-option label="删除图元" value="delete" />
        <el-option label="恢复快照" value="restore" />
      </el-select>
      <el-select
        :model-value="filterConflictType"
        placeholder="冲突类型"
        size="small"
        style="width: 130px"
        @update:model-value="emit('update:filterConflictType', $event)"
      >
        <el-option label="全部冲突" value="all" />
        <el-option label="无冲突" value="none" />
        <el-option label="字段合并" value="field_merge" />
        <el-option label="字段冲突" value="field_conflict" />
        <el-option label="删除优先" value="delete_wins" />
        <el-option label="重复操作" value="duplicate_operation" />
      </el-select>
      <el-input-number
        :model-value="filterFromVersion"
        :min="0"
        size="small"
        placeholder="起始版本"
        @update:model-value="emit('update:filterFromVersion', $event ?? null)"
      />
      <el-input-number
        :model-value="filterToVersion"
        :min="0"
        size="small"
        placeholder="结束版本"
        @update:model-value="emit('update:filterToVersion', $event ?? null)"
      />
      <el-button size="small" type="primary" :loading="loading" @click="emit('search')">查询</el-button>
      <el-button size="small" @click="emit('reset')">重置</el-button>
    </div>

    <div v-if="loading" class="history-empty">加载中...</div>
    <div v-else-if="list.length === 0" class="history-empty">暂无操作记录</div>
    <div v-else class="history-list">
      <div v-for="item in list" :key="item.id" class="history-row">
        <div class="history-main">
          <span class="history-type">{{ isRestoreEvent(item) ? '恢复快照' : formatSessionOperationTypeLabel(item.operationType) }}</span>
          <span class="history-user">{{ formatOperationActorLabel(item.userId) }}</span>
          <span class="history-time">{{ formatRowTime(item.timestamp) }}</span>
          <span class="history-conflict">{{ isRestoreEvent(item) ? '-' : formatConflictTypeLabel(item.conflictType) }}</span>
          <el-button
            link
            type="primary"
            size="small"
            :disabled="isRestoreEvent(item) || !canLocateObject(item.objectKey)"
            @click="emit('locateObject', item)"
          >
            定位到对象
          </el-button>
          <el-button link type="info" size="small" :disabled="isRestoreEvent(item)" @click="emit('toggleTechnical', item.id)">
            {{ isTechnicalExpanded(item.id) ? '收起技术详情' : '技术详情' }}
          </el-button>
        </div>
        <div class="history-activity">{{ formatTimelineActivityText(item) }}</div>
        <div class="history-detail">{{ formatTimelineConflictHint(item) }}</div>
        <div v-if="isTechnicalExpanded(item.id)" class="history-tech">
          <div class="history-meta">
            <span class="history-object">对象: {{ item.objectKey || '-' }}</span>
            <span>版本: {{ item.serverVersion }}</span>
            <span>基线版本: {{ item.baseVersion }}</span>
            <span>Lamport: {{ item.lamportTime }}</span>
            <span>Client: {{ item.clientId || '-' }}</span>
            <span>操作ID: {{ item.operationId || '-' }}</span>
            <span class="history-time">{{ new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false }) }}</span>
          </div>
          <div class="history-tech-fields">
            <span>采用字段: {{ formatFieldNamesText(getResolvedFieldList(item, 'appliedFields')) }}</span>
            <span>拒绝字段: {{ formatFieldNamesText(getResolvedFieldList(item, 'rejectedFields')) }}</span>
            <span>解决原因: {{ formatResolveReasonLabel(typeof item.resolvedResult === 'object' && item.resolvedResult ? item.resolvedResult.resolveReason : undefined) }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="timeline-pagination">
      <el-pagination
        background
        layout="prev, pager, next, total"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="emit('pageChange', $event)"
      />
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>
