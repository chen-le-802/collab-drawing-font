import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { LoginVO, RegisterVO, UpdateProfileDTO, UserVO } from '@/types/user'
import type { ApiResponse } from '@/types/api'

function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

const requestUserWithCompat = async <T>(config: {
  method: 'get' | 'post' | 'put'
  path: string
  data?: unknown
}): Promise<ApiResponse<T>> => {
  const tryRequest = (base: 'v1/users' | 'v1/user') => {
    return http.request<ApiResponse<T>>({
      method: config.method,
      url: `${base}${config.path}`,
      ...(typeof config.data !== 'undefined' ? { data: config.data } : {}),
    })
  }

  try {
    const res = await tryRequest('v1/users')
    return res.data
  } catch (error: any) {
    if (error?.response?.status === 404) {
      const res = await tryRequest('v1/user')
      return res.data
    }
    throw error
  }
}

type RawUserVO = Omit<UserVO, 'userId' | 'avatar'> & {
  userId?: number
  id?: number
  avatar?: string | null
}
type RawRegisterVO = Omit<RegisterVO, 'userId' | 'avatar'> & {
  userId?: number
  id?: number
  avatar?: string | null
}

function normalizeUser(raw: RawUserVO): UserVO {
  return {
    userId: raw.userId ?? raw.id ?? 0,
    username: raw.username,
    ...(raw.avatar ? { avatar: raw.avatar } : {}),
    ...(raw.role !== undefined ? { role: raw.role } : {}),
    ...(raw.status !== undefined ? { status: raw.status } : {}),
    ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
  }
}

function normalizeRegister(raw: RawRegisterVO): RegisterVO {
  return {
    userId: raw.userId ?? raw.id ?? 0,
    username: raw.username,
    ...(raw.avatar ? { avatar: raw.avatar } : {}),
  }
}

export interface UserAPI {
  login(username: string, password: string): Promise<{ token: string; user: UserVO }>
  register(username: string, password: string): Promise<{ userId: number; username: string }>
  logout(): Promise<void>
  getMe(): Promise<UserVO>
  updateProfile(data: { username?: string; avatar?: string }): Promise<UserVO>
}

export const userApi: UserAPI = {
  login: async (username: string, password: string): Promise<LoginVO> => {
    const res = await requestUserWithCompat<{ token: string; user: RawUserVO }>({
      method: 'post',
      path: '/login',
      data: {
        username,
        password,
      },
    })
    if (res.code !== ErrorCode.SUCCESS) {
      handleApiError(res.code, res.message)
    }

    const loginData = res.data!
    return {
      token: loginData.token,
      user: normalizeUser(loginData.user),
    }
  },

  register: async (username: string, password: string): Promise<RegisterVO> => {
    const res = await requestUserWithCompat<RawRegisterVO>({
      method: 'post',
      path: '/register',
      data: {
        username,
        password,
      },
    })
    if (res.code !== ErrorCode.SUCCESS) {
      handleApiError(res.code, res.message)
    }
    return normalizeRegister(res.data!)
  },

  logout: async (): Promise<void> => {
    const res = await requestUserWithCompat<null>({
      method: 'post',
      path: '/logout',
    })
    if (res.code !== ErrorCode.SUCCESS) {
      handleApiError(res.code, res.message)
    }
  },

  getMe: async (): Promise<UserVO> => {
    const res = await requestUserWithCompat<RawUserVO>({
      method: 'get',
      path: '/me',
    })
    if (res.code !== ErrorCode.SUCCESS) {
      handleApiError(res.code, res.message)
    }
    return normalizeUser(res.data!)
  },

  updateProfile: async (data: UpdateProfileDTO): Promise<UserVO> => {
    const res = await requestUserWithCompat<RawUserVO>({
      method: 'put',
      path: '/profile',
      data,
    })
    if (res.code !== ErrorCode.SUCCESS) {
      handleApiError(res.code, res.message)
    }
    return normalizeUser(res.data!)
  },
}
