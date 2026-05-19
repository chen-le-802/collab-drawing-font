<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Refresh, Share } from '@element-plus/icons-vue'

import type { SessionInviteItemVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    visible: boolean
    loading?: boolean
    listLoading?: boolean
    canInvite?: boolean
    canInviteManager?: boolean
    invites?: SessionInviteItemVO[]
  }>(),
  {
    loading: false,
    listLoading: false,
    canInvite: false,
    canInviteManager: false,
    invites: () => [],
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  create: [payload: { role: 0 | 1 | 2 }]
  revoke: [invite: SessionInviteItemVO]
  copy: [invite: SessionInviteItemVO]
  refresh: []
  showQr: [invite: SessionInviteItemVO]
}>()

const selectedRole = ref<0 | 1 | 2>(1)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedRole.value = 1
    }
  },
)

const roleCards = computed(() => [
  {
    role: 2 as const,
    code: 'manager',
    title: '管理员',
    desc: '可邀请 editor / viewer，可暂停与恢复画布',
    disabled: !props.canInviteManager,
  },
  {
    role: 1 as const,
    code: 'editor',
    title: '可编辑',
    desc: '可绘制与修改画布',
    disabled: false,
  },
  {
    role: 0 as const,
    code: 'viewer',
    title: '只读',
    desc: '仅查看，不能编辑',
    disabled: false,
  },
])

const displayInvites = computed(() => props.invites.filter((item) => item.status === 'active' || item.status === 'expired'))

const close = () => {
  emit('update:visible', false)
}

const submit = () => {
  if (!props.canInvite) {
    return
  }
  emit('create', { role: selectedRole.value })
}

const roleText = (role: number) => {
  if (role === 2) return 'manager'
  if (role === 1) return 'editor'
  return 'viewer'
}

const roleTagClass = (role: number) => {
  if (role === 2) return 'role-tag-manager'
  if (role === 1) return 'role-tag-editor'
  return 'role-tag-viewer'
}

const statusText = (status: SessionInviteItemVO['status']) => {
  if (status === 'active') return '可用'
  return '已过期'
}

const statusClass = (status: SessionInviteItemVO['status']) => (status === 'active' ? 'status-active' : 'status-expired')

const formatTime = (value?: string) => {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <el-dialog
    class="cd-scroll-dialog"
    :model-value="visible"
    title="邀请码管理"
    width="820px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="invite-dialog">
      <div class="invite-banner">
        <div class="banner-title">创建邀请码</div>
        <div class="banner-sub">不显示已使用和已作废邀请码，仅保留可用与已过期记录。</div>
      </div>

      <div class="create-panel">
        <div class="role-grid">
          <button
            v-for="item in roleCards"
            :key="item.role"
            class="role-card"
            :class="[
              `role-${item.code}`,
              {
                selected: selectedRole === item.role,
                disabled: item.disabled,
              },
            ]"
            :disabled="item.disabled"
            @click="selectedRole = item.role"
          >
            <div class="role-head">
              <span class="role-pill">{{ item.code }}</span>
              <span v-if="item.disabled" class="role-lock">当前不可邀请</span>
            </div>
            <div class="role-title">{{ item.title }}</div>
            <div class="role-desc">{{ item.desc }}</div>
          </button>
        </div>

        <div class="create-actions">
          <el-button type="primary" :loading="loading" :disabled="!canInvite" @click="submit">创建邀请码</el-button>
        </div>
      </div>

      <div class="list-head">
        <div class="list-title">邀请码列表</div>
        <el-button
          size="small"
          circle
          :loading="listLoading"
          class="icon-action-btn"
          title="刷新"
          @click="emit('refresh')"
        >
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>

      <div class="invite-list" v-loading="listLoading">
        <div v-if="displayInvites.length === 0" class="list-empty">暂无可展示的邀请码</div>
        <div v-else v-for="item in displayInvites" :key="item.id" class="invite-row">
          <div class="row-main">
            <div class="row-head">
              <span class="role-tag" :class="roleTagClass(item.role)">{{ roleText(item.role) }}</span>
              <span class="status-tag" :class="statusClass(item.status)">{{ statusText(item.status) }}</span>
            </div>
            <div class="row-meta">
              <span>创建时间：{{ formatTime(item.createdAt) }}</span>
              <span>有效至：{{ formatTime(item.expiresAt) }}</span>
            </div>
          </div>

          <div class="row-actions">
            <el-button
              size="small"
              class="icon-action-btn"
              title="查看二维码"
              :disabled="item.status !== 'active' || !item.invitePath"
              @click="emit('showQr', item)"
            >
              二维码
            </el-button>
            <el-button
              size="small"
              circle
              class="icon-action-btn"
              title="复制链接"
              :disabled="item.status !== 'active' || !item.invitePath"
              @click="emit('copy', item)"
            >
              <el-icon><Share /></el-icon>
            </el-button>
            <el-button
              size="small"
              circle
              class="icon-action-btn danger"
              title="作废"
              :disabled="item.status !== 'active'"
              @click="emit('revoke', item)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.invite-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.invite-banner {
  border-radius: 12px;
  padding: 14px 16px;
  border: 1px solid #dbe6ff;
  background: linear-gradient(130deg, #f4f8ff 0%, #eef3ff 100%);
}

.banner-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2a44;
}

.banner-sub {
  margin-top: 6px;
  font-size: 13px;
  color: #5b6478;
}

.create-panel {
  border: 1px solid #e6e9f2;
  border-radius: 12px;
  background: #ffffff;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.role-card {
  border: 1px solid #e4e8f1;
  border-radius: 12px;
  background: #ffffff;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: transform var(--cd-transition), border-color var(--cd-transition), box-shadow var(--cd-transition);
}

.role-card:hover {
  transform: translateY(-2px);
  border-color: #c8d7ff;
  box-shadow: 0 12px 24px rgba(18, 33, 73, 0.08);
}

.role-card.selected {
  border-color: #4f6ef7;
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.12);
}

.role-card.disabled {
  opacity: 0.58;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.role-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.role-pill {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  text-transform: uppercase;
}

.role-manager .role-pill {
  color: #ffffff;
  background: #4dd6c8;
}

.role-editor .role-pill {
  color: #1f4fbd;
  background: #eef3ff;
}

.role-viewer .role-pill {
  color: #4f5b72;
  background: #f2f4f8;
}

.role-lock {
  font-size: 11px;
  color: #7b8190;
}

.role-title {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #202331;
}

.role-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #636a7a;
}

.create-actions {
  display: flex;
  justify-content: flex-end;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-title {
  font-size: 14px;
  font-weight: 700;
  color: #202331;
}

.invite-list {
  max-height: 360px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-empty {
  text-align: center;
  color: #7b8190;
  padding: 16px 0;
  font-size: 13px;
}

.invite-row {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.role-tag {
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  text-transform: lowercase;
  font-weight: 700;
}

.role-tag-manager {
  color: #ffffff;
  background: #4dd6c8;
}

.role-tag-editor {
  color: #1f4fbd;
  background: #eef3ff;
}

.role-tag-viewer {
  color: #4f5b72;
  background: #f2f4f8;
}

.status-tag {
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  font-weight: 700;
}

.status-active {
  color: #0f766e;
  background: #e8fbf7;
}

.status-expired {
  color: #b36b00;
  background: #fff4dd;
}

.row-meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  font-size: 11px;
  color: #667085;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.icon-action-btn {
  border-color: var(--cd-border);
  color: var(--cd-text-secondary);
  background: #ffffff;
}

.icon-action-btn:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
  background: var(--cd-primary-lighter);
}

.icon-action-btn.danger:hover {
  border-color: #f7b4b4;
  color: #d93838;
  background: #fff2f2;
}

@media (max-width: 900px) {
  .role-grid {
    grid-template-columns: 1fr;
  }

  .invite-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .row-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
