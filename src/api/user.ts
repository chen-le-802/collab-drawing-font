import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { LoginVO, RegisterVO, UserVO } from '@/types/user'
import type { ApiResponse } from '@/types/api'

function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

export const userApi = {
  login: async (username: string, password: string): Promise<LoginVO> => {
    const res = await http.post<ApiResponse<LoginVO>>('/user/login', { username, password })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  register: async (username: string, password: string): Promise<RegisterVO> => {
    const res = await http.post<ApiResponse<RegisterVO>>('/user/register', { username, password })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },

  logout: async (): Promise<void> => {
    await http.post('/user/logout')
  },

  getMe: async (): Promise<UserVO> => {
    const res = await http.get<ApiResponse<UserVO>>('/user/me')
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return res.data.data!
  },
}