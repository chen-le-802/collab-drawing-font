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
    user.value = newUser
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
