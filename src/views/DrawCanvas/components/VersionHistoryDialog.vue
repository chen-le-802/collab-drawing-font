<script setup lang="ts">
import type { SessionSnapshotItemVO } from '@/types/session'

defineProps<{
  visible: boolean
  loading: boolean
  replayLoading: boolean
  replayTargetVersion: number | null
  currentVersion?: number
  currentSnapshotVersion?: number | null
  list: SessionSnapshotItemVO[]
  canCreateSnapshot?: boolean
  canRestoreSnapshot?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  refresh: []
  createSnapshot: []
  replay: [targetVersion: number]
  restore: [targetVersion: number]
}>()

const close = () => {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    class="cd-scroll-dialog"
    :model-value="visible"
    title="版本快照与回放"
    width="760px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="version-toolbar">
      <el-button size="small" :loading="loading" @click="emit('refresh')">刷新</el-button>
      <el-button size="small" type="primary" :loading="loading" :disabled="canCreateSnapshot === false" @click="emit('createSnapshot')">
        创建快照
      </el-button>
    </div>
    <div class="history-empty" style="padding-top: 0">
      提示：恢复到某个快照时，会按目标版本状态覆盖当前画布内容，并生成一条新的恢复操作记录（历史版本本身不会被删除）。
    </div>
    <div v-if="list.length === 0" class="history-empty">暂无版本快照</div>
    <div v-else class="version-list">
      <div v-for="item in list" :key="item.id" class="version-row">
        <div class="version-head">
          <span class="version-tag">{{ item.snapshotName || `快照 ${item.version}` }}</span>
          <span class="version-time">{{ new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span>
        </div>
        <div class="version-meta">
          <span>版本: V{{ item.version }}</span>
          <span
            v-if="typeof currentSnapshotVersion === 'number' && item.version === currentSnapshotVersion"
            class="current-version-tag"
          >
            当前所在快照
          </span>
          <span
            v-else-if="typeof currentVersion === 'number' && item.version === currentVersion"
            class="current-version-tag"
          >
            当前画布版本
          </span>
          <span>图元数量: {{ item.graphicCount }}</span>
          <span>创建人: {{ item.createdByName || (typeof item.createdBy === 'number' ? `用户#${item.createdBy}` : '系统') }}</span>
        </div>
        <div class="version-actions">
          <el-button size="small" :loading="replayLoading && replayTargetVersion === item.version" @click="emit('replay', item.version)">
            回放到此版本
          </el-button>
          <el-button
            size="small"
            type="warning"
            :loading="replayLoading && replayTargetVersion === item.version"
            :disabled="canRestoreSnapshot === false"
            @click="emit('restore', item.version)"
          >
            恢复到此版本
          </el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.current-version-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  color: #2563eb;
  background: #eff6ff;
}
</style>
