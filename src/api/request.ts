import axios, { type AxiosInstance } from 'axios'
import { ElMessage } from 'element-plus'
import { storage } from '@/utils/storage'
import { ErrorCode } from '@/utils/errors'

const http: AxiosInstance = axios.create({
  baseURL: 'http://localhost:3000/api/',
  timeout: 10000,
})

http.interceptors.request.use((config) => {
  const token = storage.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const { response } = error
    if (
      response?.status === 401 ||
      response?.data?.code === ErrorCode.UNAUTHORIZED ||
      response?.data?.code === ErrorCode.TOKEN_EXPIRED
    ) {
      storage.removeToken()
      window.location.href = '/login'
    } else {
      ElMessage.error(response?.data?.message || error.message || '网络错误')
    }
    return Promise.reject(error)
  },
)

export default http
