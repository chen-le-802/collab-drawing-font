<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CollaborationConflictType, SessionOperationItemVO, SessionOperationType } from '@/types/session'

const props = defineProps<{
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
  formatFieldNameLabel: (value: string) => string
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

type TimelineRow = {
  kind: 'single' | 'group'
  key: string
  anchor: SessionOperationItemVO
  items: SessionOperationItemVO[]
  fieldKeys: string[]
}

const expandedGroupKeys = ref<string[]>([])

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const getOperationFieldKeys = (item: SessionOperationItemVO): string[] => {
  const payload = isRecord(item.operationData) ? item.operationData : {}
  const ignore = new Set([
    'objectKey',
    'operationId',
    'baseVersion',
    'clientId',
    'lamportTime',
    '__systemEvent',
    'targetVersion',
    'previousVersion',
    'restoredVersion',
    'createdCount',
    'updatedCount',
    'deletedCount',
  ])
  return Object.keys(payload).filter((key) => !ignore.has(key))
}

const getFieldSignature = (item: SessionOperationItemVO): string => {
  return getOperationFieldKeys(item).sort().join('|')
}

const canGroup = (item: SessionOperationItemVO): boolean => {
  if (isRestoreEvent(item)) {
    return false
  }
  return item.operationType === 'update'
}

const resolveBatchGroupKey = (item: SessionOperationItemVO): string | null => {
  if (typeof item.batchId === 'string' && item.batchId.trim().length > 0) {
    return item.batchId.trim()
  }
  return null
}

const timelineRows = computed<TimelineRow[]>(() => {
  const rows: TimelineRow[] = []
  const list = props.list
  const consumedBatchIds = new Set<string>()
  for (let i = 0; i < list.length; i += 1) {
    const current = list[i]
    if (!current) {
      continue
    }
    const backendBatchId = resolveBatchGroupKey(current)
    if (backendBatchId && !isRestoreEvent(current)) {
      if (consumedBatchIds.has(backendBatchId)) {
        continue
      }
      consumedBatchIds.add(backendBatchId)
      const batchItems = list.filter((item) => resolveBatchGroupKey(item) === backendBatchId)
      const unique = new Map<number, SessionOperationItemVO>()
      batchItems.forEach((item) => {
        unique.set(item.id, item)
      })
      const grouped = Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp)
      if (grouped.length <= 1) {
        rows.push({
          kind: 'single',
          key: `single_${current.id}`,
          anchor: current,
          items: [current],
          fieldKeys: getOperationFieldKeys(current),
        })
      } else {
        rows.push({
          kind: 'group',
          key: `group_batch_${backendBatchId}`,
          anchor: grouped[0] ?? current,
          items: grouped,
          fieldKeys: Array.from(new Set(grouped.flatMap((item) => getOperationFieldKeys(item)))),
        })
      }
      continue
    }

    if (!canGroup(current)) {
      rows.push({
        kind: 'single',
        key: `single_${current.id}`,
        anchor: current,
        items: [current],
        fieldKeys: getOperationFieldKeys(current),
      })
      continue
    }

    const currentSignature = getFieldSignature(current)
    const group: SessionOperationItemVO[] = [current]
    let cursor = i + 1
    while (cursor < list.length) {
      const next = list[cursor]
      if (!next || !canGroup(next)) {
        break
      }
      if (next.userId !== current.userId || next.operationType !== current.operationType || next.conflictType !== current.conflictType) {
        break
      }
      if (getFieldSignature(next) !== currentSignature) {
        break
      }
      if (Math.abs(next.timestamp - current.timestamp) > 2000) {
        break
      }
      group.push(next)
      cursor += 1
    }

    if (group.length <= 1) {
      rows.push({
        kind: 'single',
        key: `single_${current.id}`,
        anchor: current,
        items: [current],
        fieldKeys: getOperationFieldKeys(current),
      })
      continue
    }

    rows.push({
      kind: 'group',
      key: `group_${group.map((item) => item.id).join('_')}`,
      anchor: current,
      items: group,
      fieldKeys: getOperationFieldKeys(current),
    })
    i = cursor - 1
  }
  return rows
})

const toggleGroup = (key: string) => {
  if (expandedGroupKeys.value.includes(key)) {
    expandedGroupKeys.value = expandedGroupKeys.value.filter((item) => item !== key)
    return
  }
  expandedGroupKeys.value = [...expandedGroupKeys.value, key]
}

const isGroupExpanded = (key: string) => expandedGroupKeys.value.includes(key)

const formatBatchTitle = (row: TimelineRow): string => {
  const label = row.anchor.batchLabel
  if (typeof label === 'string' && label.trim().length > 0) {
    return label.trim()
  }
  return '批量更新'
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
      <div v-for="row in timelineRows" :key="row.key" class="history-row">
        <template v-if="row.kind === 'single'">
          <div class="history-main">
            <span class="history-type">{{ isRestoreEvent(row.anchor) ? '恢复快照' : formatSessionOperationTypeLabel(row.anchor.operationType) }}</span>
            <span class="history-user">{{ formatOperationActorLabel(row.anchor.userId) }}</span>
            <span class="history-time">{{ formatRowTime(row.anchor.timestamp) }}</span>
            <span class="history-conflict">{{ isRestoreEvent(row.anchor) ? '系统版本操作' : formatConflictTypeLabel(row.anchor.conflictType) }}</span>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="isRestoreEvent(row.anchor) || !canLocateObject(row.anchor.objectKey)"
              @click="emit('locateObject', row.anchor)"
            >
              定位到对象
            </el-button>
            <el-button link type="info" size="small" :disabled="isRestoreEvent(row.anchor)" @click="emit('toggleTechnical', row.anchor.id)">
              {{ isTechnicalExpanded(row.anchor.id) ? '收起技术详情' : '技术详情' }}
            </el-button>
          </div>
          <div class="history-activity">{{ formatTimelineActivityText(row.anchor) }}</div>
          <div class="history-detail">{{ formatTimelineConflictHint(row.anchor) }}</div>
          <div v-if="isTechnicalExpanded(row.anchor.id)" class="history-tech">
            <div class="history-meta">
              <span class="history-object">对象: {{ row.anchor.objectKey || '-' }}</span>
              <span>版本: {{ row.anchor.serverVersion }}</span>
              <span>基线版本: {{ row.anchor.baseVersion }}</span>
              <span>Lamport: {{ row.anchor.lamportTime }}</span>
              <span>Client: {{ row.anchor.clientId || '-' }}</span>
              <span>操作ID: {{ row.anchor.operationId || '-' }}</span>
              <span class="history-time">{{ new Date(row.anchor.timestamp).toLocaleString('zh-CN', { hour12: false }) }}</span>
            </div>
            <div class="history-tech-fields">
              <span>采用字段: {{ formatFieldNamesText(getResolvedFieldList(row.anchor, 'appliedFields')) }}</span>
              <span>拒绝字段: {{ formatFieldNamesText(getResolvedFieldList(row.anchor, 'rejectedFields')) }}</span>
              <span>解决原因: {{ formatResolveReasonLabel(typeof row.anchor.resolvedResult === 'object' && row.anchor.resolvedResult ? row.anchor.resolvedResult.resolveReason : undefined) }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="history-main">
            <span class="history-type">{{ formatBatchTitle(row) }}</span>
            <span class="history-user">{{ formatOperationActorLabel(row.anchor.userId) }}</span>
            <span class="history-time">{{ formatRowTime(row.anchor.timestamp) }}</span>
            <span class="history-conflict">{{ formatConflictTypeLabel(row.anchor.conflictType) }}</span>
            <el-button link type="info" size="small" @click="emit('toggleTechnical', row.anchor.id)">
              {{ isTechnicalExpanded(row.anchor.id) ? '收起技术详情' : '技术详情' }}
            </el-button>
            <el-button link type="info" size="small" @click="toggleGroup(row.key)">
              {{ isGroupExpanded(row.key) ? '收起批量明细' : '展开批量明细' }}
            </el-button>
          </div>
          <div class="history-activity">
            {{ formatOperationActorLabel(row.anchor.userId) }} 批量更新了 {{ row.items.length }} 个图元
            <template v-if="row.fieldKeys.length > 0">
              ，字段：{{ row.fieldKeys.map((field) => formatFieldNameLabel(field)).join('、') }}
            </template>
          </div>
          <div class="history-detail">该批量操作已聚合展示，可展开查看每个图元的明细。</div>
          <div v-if="isTechnicalExpanded(row.anchor.id)" class="history-tech">
            <div class="history-meta">
              <span>批次ID: {{ row.anchor.batchId || '-' }}</span>
              <span>批次数量: {{ row.anchor.batchSize ?? row.items.length }}</span>
              <span>版本区间: {{ row.items[row.items.length - 1]?.serverVersion ?? row.anchor.serverVersion }} - {{ row.anchor.serverVersion }}</span>
              <span>Client: {{ row.anchor.clientId || '-' }}</span>
              <span>Lamport: {{ row.anchor.lamportTime }}</span>
              <span class="history-time">{{ new Date(row.anchor.timestamp).toLocaleString('zh-CN', { hour12: false }) }}</span>
            </div>
            <div class="history-tech-fields">
              <span>批量字段: {{ row.fieldKeys.length > 0 ? row.fieldKeys.map((field) => formatFieldNameLabel(field)).join('、') : '-' }}</span>
            </div>
          </div>
          <div v-if="isGroupExpanded(row.key)" class="history-tech">
            <div class="history-tech-fields">
              <div v-for="detail in row.items" :key="detail.id" class="history-group-item">
                <div class="history-main">
                  <span class="history-object">{{ detail.objectKey }}</span>
                  <span class="history-time">{{ formatRowTime(detail.timestamp) }}</span>
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :disabled="!canLocateObject(detail.objectKey)"
                    @click="emit('locateObject', detail)"
                  >
                    定位
                  </el-button>
                  <el-button link type="info" size="small" @click="emit('toggleTechnical', detail.id)">
                    {{ isTechnicalExpanded(detail.id) ? '收起技术详情' : '技术详情' }}
                  </el-button>
                </div>
                <div class="history-activity">{{ formatTimelineActivityText(detail) }}</div>
                <div class="history-detail">{{ formatTimelineConflictHint(detail) }}</div>
                <div v-if="isTechnicalExpanded(detail.id)" class="history-tech-fields">
                  <span>采用字段: {{ formatFieldNamesText(getResolvedFieldList(detail, 'appliedFields')) }}</span>
                  <span>拒绝字段: {{ formatFieldNamesText(getResolvedFieldList(detail, 'rejectedFields')) }}</span>
                  <span>解决原因: {{ formatResolveReasonLabel(typeof detail.resolvedResult === 'object' && detail.resolvedResult ? detail.resolvedResult.resolveReason : undefined) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
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
