import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { LoginVO, RegisterVO, UserVO } from '@/types/user'
import type { ApiResponse } from '@/types/api'

function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

type RawUserVO = UserVO & { id?: number }
type RawRegisterVO = RegisterVO & { id?: number }

function normalizeUser(raw: RawUserVO): UserVO {
  return {
    ...raw,
    userId: raw.userId ?? raw.id ?? 0,
  }
}

function normalizeRegister(raw: RawRegisterVO): RegisterVO {
  return {
    ...raw,
    userId: raw.userId ?? raw.id ?? 0,
  }
}

export const userApi = {
  login: async (username: string, password: string): Promise<LoginVO> => {
    const res = await http.post<ApiResponse<{ token: string; user: RawUserVO }>>('/v1/user/login', {
      username,
      password,
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }

    const loginData = res.data.data!
    return {
      token: loginData.token,
      user: normalizeUser(loginData.user),
    }
  },

  register: async (username: string, password: string): Promise<RegisterVO> => {
    const res = await http.post<ApiResponse<RawRegisterVO>>('/v1/user/register', {
      username,
      password,
    })
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return normalizeRegister(res.data.data!)
  },

  logout: async (): Promise<void> => {
    await http.post('/v1/user/logout')
  },

  getMe: async (): Promise<UserVO> => {
    const res = await http.get<ApiResponse<RawUserVO>>('/v1/user/me')
    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }
    return normalizeUser(res.data.data!)
  },
}
