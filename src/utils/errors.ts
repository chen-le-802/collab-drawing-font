export const ErrorCode = {
  SUCCESS: 0,

  // 参数错误 1001
  INVALID_PARAMS: 1001,

  // 未登录 2001，过期 2002，无权限 2003
  UNAUTHORIZED: 2001,
  TOKEN_EXPIRED: 2002,
  FORBIDDEN: 2003,

  // 资源不存在 3001，已存在 3002
  NOT_FOUND: 3001,
  ALREADY_EXISTS: 3002,

  // 服务器错误 4001
  SERVER_ERROR: 4001,
} as const

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode]

export const ErrorMessage: Record<number, string> = {
  [ErrorCode.SUCCESS]: '操作成功',
  [ErrorCode.INVALID_PARAMS]: '参数错误',
  [ErrorCode.UNAUTHORIZED]: '未登录',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期',
  [ErrorCode.FORBIDDEN]: '无权限操作',
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.ALREADY_EXISTS]: '资源已存在',
  [ErrorCode.SERVER_ERROR]: '服务器错误',
}
