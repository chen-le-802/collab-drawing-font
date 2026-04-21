import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { ApiResponse } from '@/types/api'
import type { GraphicVO } from '@/types/graphic'

function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

interface GraphicsResponseVO {
  currentVersion: number
  graphics: GraphicVO[]
}

export interface GraphicAPI {
  getGraphics(sessionKey: string, sinceVersion?: number): Promise<{
    currentVersion: number
    graphics: GraphicVO[]
  }>
}

export const graphicApi: GraphicAPI = {
  async getGraphics(sessionKey: string, sinceVersion?: number) {
    const res = await http.get<ApiResponse<GraphicsResponseVO>>(`/v1/sessions/${sessionKey}/graphics`, {
      params: { sinceVersion },
    })

    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }

    return res.data.data ?? { currentVersion: 0, graphics: [] }
  },
}
