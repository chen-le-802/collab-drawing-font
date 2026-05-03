import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserVO } from '@/types/user'
import { storage } from '@/utils/storage'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(storage.getToken())
  const user = ref<UserVO | null>(null)

  const setToken = (newToken: string) => {
    token.value = newToken
    storage.setToken(newToken)
  }

  const setUser = (newUser: UserVO) => {
    user.value = {
      userId: newUser.userId,
      username: newUser.username,
      ...(newUser.avatar ? { avatar: newUser.avatar } : {}),
      ...(newUser.role !== undefined ? { role: newUser.role } : {}),
      ...(newUser.status !== undefined ? { status: newUser.status } : {}),
      ...(newUser.createdAt ? { createdAt: newUser.createdAt } : {}),
      ...(newUser.updatedAt ? { updatedAt: newUser.updatedAt } : {}),
    }
  }

  const logout = () => {
    token.value = null
    user.value = null
    storage.removeToken()
  }

  const isLoggedIn = () => !!token.value

  return {
    token,
    user,
    setToken,
    setUser,
    logout,
    isLoggedIn,
  }
})
