import { getErrorMessage } from './feedback'

const normalize = (value: string) => value.trim()

const matchAndMap = (message: string): string | null => {
  if (!message) {
    return null
  }

  if (message.includes('请使用邀请链接加入会话')) {
    return '该会话需要邀请码才能加入，请先获取邀请链接'
  }
  if (message.includes('邀请链接无效或已过期')) {
    return '邀请链接已失效，请让管理员重新发送'
  }
  if (message.includes('会话不存在')) {
    return '会话不存在或已被删除'
  }
  if (message.includes('会话已结束')) {
    return '会话已结束，无法继续此操作'
  }
  if (message.includes('画布已暂停编辑')) {
    return '画布已暂停，当前无法编辑'
  }
  if (message.includes('无会话访问权限')) {
    return '你没有该会话访问权限，请确认是否已加入'
  }
  if (
    message.includes('只读成员无编辑权限') ||
    message.includes('只读成员无创建快照权限') ||
    message.includes('仅管理员和房主可恢复历史版本') ||
    message.includes('无角色管理权限') ||
    message.includes('无邀请权限') ||
    message.includes('无画布暂停权限')
  ) {
    return '当前角色无此操作权限'
  }

  return null
}

export const resolveSessionErrorMessage = (error: unknown, fallback: string): string => {
  const raw = normalize(getErrorMessage(error, fallback))
  return matchAndMap(raw) ?? raw
}

