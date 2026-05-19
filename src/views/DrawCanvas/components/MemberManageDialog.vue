<script setup lang="ts">
import type { MemberVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    visible: boolean
    members: MemberVO[]
    includeHistory?: boolean
    loading?: boolean
    currentUserId?: number | null
    currentUserRole?: number | null
    canManageRoles?: boolean
    canRemoveMembers?: boolean
  }>(),
  {
    includeHistory: false,
    loading: false,
    currentUserId: null,
    currentUserRole: null,
    canManageRoles: false,
    canRemoveMembers: false,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:includeHistory': [value: boolean]
  updateRole: [payload: { member: MemberVO; role: 0 | 1 | 2 }]
  removeMember: [member: MemberVO]
}>()

const displayName = (member: MemberVO) => {
  const normalized = member.username?.trim()
  if (normalized) {
    return normalized
  }
  return `用户${member.userId}`
}

const roleText = (role: number) => {
  if (role === 3) return 'owner'
  if (role === 2) return 'manager'
  if (role === 1) return 'editor'
  return 'viewer'
}

const roleTagClass = (role: number) => {
  if (role === 3) return 'role-tag-owner'
  if (role === 2) return 'role-tag-manager'
  if (role === 1) return 'role-tag-editor'
  return ''
}

const statusText = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (status === 'left') return '已退出'
  if (status === 'removed') return '已移除'
  return member.onlineStatus === 1 ? '在线' : '离线'
}

const statusClass = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (status === 'left' || status === 'removed') return 'is-history'
  return member.onlineStatus === 1 ? 'is-online' : 'is-offline'
}

const canEditMemberRole = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (!props.canManageRoles || status !== 'active') {
    return false
  }
  if (member.role === 3) {
    return false
  }
  if (props.currentUserId && member.userId === props.currentUserId) {
    return false
  }
  if (props.currentUserRole === 2 && member.role >= 2) {
    return false
  }
  return true
}

const canSetRole = (member: MemberVO, role: 0 | 1 | 2) => {
  if (!canEditMemberRole(member)) {
    return false
  }
  if (props.currentUserRole === 2 && role === 2) {
    return false
  }
  return member.role !== role
}

const canRemove = (member: MemberVO) => {
  const status = member.membershipStatus ?? 'active'
  if (!props.canRemoveMembers || status !== 'active') {
    return false
  }
  if (member.role === 3) {
    return false
  }
  if (props.currentUserId && member.userId === props.currentUserId) {
    return false
  }
  if (props.currentUserRole === 2 && member.role >= 2) {
    return false
  }
  return true
}

const rolePermissionList = [
  {
    role: 'owner',
    title: 'owner（房主）',
    permissions: '可管理全部成员与角色、暂停/恢复画布、关闭/删除会话、恢复历史版本与创建快照。',
  },
  {
    role: 'manager',
    title: 'manager（管理员）',
    permissions: '可管理普通成员角色（editor/viewer）、邀请协作、暂停/恢复画布、恢复历史版本与创建快照。',
  },
  {
    role: 'editor',
    title: 'editor（协作者）',
    permissions: '可编辑画布（绘制、移动、删除、撤销/重做）并可创建快照，不可管理成员。',
  },
  {
    role: 'viewer',
    title: 'viewer（访客）',
    permissions: '仅查看画布与协同状态，不可编辑、不可管理成员。',
  },
]
</script>

<template>
  <el-dialog
    :model-value="visible"
    class="member-manage-dialog cd-scroll-dialog"
    title="成员管理"
    width="760px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="member-manage-body">
      <div class="manage-toolbar">
        <div class="toolbar-tip">可在此管理成员角色与协作权限</div>
        <el-switch
          :model-value="includeHistory"
          size="small"
          inline-prompt
          active-text="历史"
          inactive-text="当前"
          @update:model-value="emit('update:includeHistory', $event)"
        />
      </div>

      <div class="permission-panel">
        <div class="permission-title">角色权限说明</div>
        <div class="permission-list">
          <div
            v-for="item in rolePermissionList"
            :key="item.role"
            class="permission-item"
            :class="`permission-item--${item.role}`"
          >
            <div class="permission-role">{{ item.title }}</div>
            <div class="permission-text">{{ item.permissions }}</div>
          </div>
        </div>
      </div>

      <div class="manage-list" v-loading="loading">
        <div v-for="member in members" :key="member.userId" class="manage-row">
          <div class="left">
            <el-avatar :size="34" :src="member.avatar">
              {{ displayName(member).slice(0, 1).toUpperCase() }}
            </el-avatar>
            <div class="meta">
              <div class="name">
                <span class="name-text">{{ displayName(member) }}</span>
                <span class="role-tag" :class="roleTagClass(member.role)">{{ roleText(member.role) }}</span>
              </div>
              <div class="sub">
                <span class="status-dot" :class="statusClass(member)" />
                {{ statusText(member) }} · 当前角色 {{ roleText(member.role) }}
              </div>
            </div>
          </div>
          <div class="right">
            <el-dropdown v-if="canEditMemberRole(member)" trigger="click">
              <el-button size="small" type="primary" plain>修改角色</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :disabled="!canSetRole(member, 2)" @click="emit('updateRole', { member, role: 2 })">
                    设为 manager
                  </el-dropdown-item>
                  <el-dropdown-item :disabled="!canSetRole(member, 1)" @click="emit('updateRole', { member, role: 1 })">
                    设为 editor
                  </el-dropdown-item>
                  <el-dropdown-item :disabled="!canSetRole(member, 0)" @click="emit('updateRole', { member, role: 0 })">
                    设为 viewer
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button v-if="canRemove(member)" size="small" type="danger" text @click="emit('removeMember', member)">
              移除
            </el-button>
          </div>
        </div>
        <div v-if="members.length === 0" class="empty">暂无成员</div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.member-manage-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.manage-list {
  max-height: 420px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.manage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #e6ebf5;
  border-radius: 10px;
  background: linear-gradient(180deg, #f8faff 0%, #f4f7ff 100%);
  padding: 9px 12px;
}

.toolbar-tip {
  font-size: 12px;
  color: #475569;
}

.manage-row {
  border: 1px solid #e7ecf6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
  padding: 11px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}

.manage-row:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
  border-color: #d8e2f2;
}

.permission-panel {
  border: 1px solid #e5eaf4;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #f5f8fd 100%);
  padding: 12px;
}

.permission-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 10px;
}

.permission-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.permission-item {
  background: #ffffff;
  border: 1px solid #e6ebf3;
  border-radius: 10px;
  padding: 10px;
  position: relative;
}

.permission-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 10px 0 0 10px;
  background: #cbd5e1;
}

.permission-item--owner::before {
  background: #f59e0b;
}

.permission-item--manager::before {
  background: #0ea5a8;
}

.permission-item--editor::before {
  background: #3b82f6;
}

.permission-item--viewer::before {
  background: #94a3b8;
}

.permission-role {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 5px;
}

.permission-text {
  font-size: 12px;
  line-height: 1.5;
  color: #4b5568;
}

.left {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.meta {
  min-width: 0;
}

.name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: #111827;
  font-weight: 700;
}

.name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 18px;
  padding: 0 8px;
  border-radius: 999px;
  color: #475569;
  background: #eff4fb;
  border: 1px solid #dfe8f5;
  text-transform: lowercase;
  font-weight: 600;
}

.role-tag-owner {
  color: #ffffff;
  background: #f59e0b;
  border-color: #f59e0b;
}

.role-tag-manager {
  color: #ffffff;
  background: #14b8a6;
  border-color: #14b8a6;
}

.role-tag-editor {
  color: #1d4ed8;
  background: #eaf2ff;
  border-color: #d5e3ff;
}

.sub {
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.status-dot.is-online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
}

.status-dot.is-offline {
  background: #94a3b8;
}

.status-dot.is-history {
  background: #f59e0b;
}

.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.empty {
  text-align: center;
  color: #64748b;
  font-size: 13px;
  border: 1px dashed #dbe4f1;
  border-radius: 10px;
  background: #f8fbff;
  padding: 22px 0;
}

@media (max-width: 900px) {
  .permission-list {
    grid-template-columns: 1fr;
  }

  .manage-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .manage-row {
    align-items: flex-start;
  }
}
</style>
