import { ref } from 'vue'

import { sessionApi } from '@/api/session'
import type { MemberVO, SessionInviteItemVO } from '@/types/session'

type UseInviteMemberManagementOptions = {
  getSessionKey: () => string
  canRemoveMember: () => boolean
  refreshSessionMembers: () => Promise<void>
  confirmDanger: (message: string, title: string, options?: { confirmButtonText?: string }) => Promise<boolean>
  onSuccess: (message: string) => void
  onError: (error: unknown, fallback: string) => void
  onWarning: (message: string) => void
}

// 邀请码与成员管理模块：
// 负责邀请码列表/创建/复制/作废，以及成员角色调整与移除流程。
export const useInviteMemberManagement = (options: UseInviteMemberManagementOptions) => {
  const inviteDialogVisible = ref(false)
  const inviteDialogLoading = ref(false)
  const inviteListLoading = ref(false)
  const inviteList = ref<SessionInviteItemVO[]>([])

  const memberManageDialogVisible = ref(false)
  const shareQrcodePendingLink = ref('')
  const shareQrcodeVisible = ref(false)

  const loadInviteList = async () => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    inviteListLoading.value = true
    try {
      const result = await sessionApi.getInviteList(sessionKey)
      inviteList.value = result.list
    } catch (error) {
      options.onError(error, '加载邀请码失败')
    } finally {
      inviteListLoading.value = false
    }
  }

  // 打开邀请弹窗后立即拉取列表，保证数据新鲜。
  const openInviteDialog = async () => {
    inviteDialogVisible.value = true
    await loadInviteList()
  }

  const handleCreateInvite = async (payload: { role: 0 | 1 | 2 }) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    inviteDialogLoading.value = true
    try {
      await sessionApi.createInvite(sessionKey, payload.role)
      options.onSuccess('邀请码创建成功')
      await loadInviteList()
    } catch (error) {
      options.onError(error, '创建邀请码失败')
    } finally {
      inviteDialogLoading.value = false
    }
  }

  const copyInviteLinkText = async (invitePath?: string) => {
    if (!invitePath) {
      options.onWarning('邀请码链接缺失')
      return
    }
    const isAbsolute = /^https?:\/\//i.test(invitePath)
    const link = isAbsolute ? invitePath : `${window.location.origin}${invitePath}`
    await navigator.clipboard.writeText(link)
  }

  const handleCopyInvite = async (invite: SessionInviteItemVO) => {
    try {
      await copyInviteLinkText(invite.invitePath)
      options.onSuccess('邀请码链接已复制')
    } catch {
      options.onError(new Error('copy_failed'), '复制失败，请稍后重试')
    }
  }

  const handleShowInviteQr = async (invite: SessionInviteItemVO) => {
    if (!invite.invitePath) {
      options.onWarning('邀请码链接缺失')
      return
    }
    const isAbsolute = /^https?:\/\//i.test(invite.invitePath)
    shareQrcodePendingLink.value = isAbsolute ? invite.invitePath : `${window.location.origin}${invite.invitePath}`
    shareQrcodeVisible.value = true
  }

  const handleRevokeInvite = async (invite: SessionInviteItemVO) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    try {
      const confirmed = await options.confirmDanger('确认作废该邀请码吗？', '邀请码作废', { confirmButtonText: '确认作废' })
      if (!confirmed) {
        return
      }
      await sessionApi.revokeInvite(sessionKey, invite.id)
      options.onSuccess('邀请码已作废')
      await loadInviteList()
    } catch (error) {
      options.onError(error, '作废邀请码失败')
    }
  }

  // 打开成员管理弹窗时同步刷新成员信息。
  const handleShowMembersManage = async () => {
    memberManageDialogVisible.value = true
    await options.refreshSessionMembers()
  }

  const handleUpdateMemberRole = async (payload: { member: MemberVO; role: 0 | 1 | 2 }) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey) {
      return
    }
    try {
      await sessionApi.updateMemberRole(sessionKey, payload.member.userId, payload.role)
      options.onSuccess(`已将 ${payload.member.username} 设为 ${payload.role === 2 ? 'manager' : payload.role === 1 ? 'editor' : 'viewer'}`)
      await options.refreshSessionMembers()
    } catch (error) {
      options.onError(error, '更新成员角色失败')
    }
  }

  const handleRemoveMember = async (member: MemberVO) => {
    const sessionKey = options.getSessionKey()
    if (!sessionKey || !options.canRemoveMember()) {
      return
    }
    try {
      const confirmed = await options.confirmDanger(`确认移除成员“${member.username}”吗？`, '移除成员', {
        confirmButtonText: '确认移除',
      })
      if (!confirmed) {
        return
      }
      await sessionApi.removeMember(sessionKey, member.userId)
      options.onSuccess('成员已移除')
      await options.refreshSessionMembers()
    } catch (error) {
      options.onError(error, '移除成员失败')
    }
  }

  return {
    inviteDialogVisible,
    inviteDialogLoading,
    inviteListLoading,
    inviteList,
    memberManageDialogVisible,
    shareQrcodePendingLink,
    shareQrcodeVisible,
    loadInviteList,
    openInviteDialog,
    handleCreateInvite,
    handleCopyInvite,
    handleShowInviteQr,
    handleRevokeInvite,
    handleShowMembersManage,
    handleUpdateMemberRole,
    handleRemoveMember,
  }
}
