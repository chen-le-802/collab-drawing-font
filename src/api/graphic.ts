import http from './request'
import { ErrorCode, ErrorMessage } from '@/utils/errors'
import type { ApiResponse } from '@/types/api'
import type { GraphicVO } from '@/types/graphic'

// 与其他 API 模块保持一致：统一将业务错误码转换为异常抛给调用方。
function handleApiError(code: number, message?: string): never {
  const msg = message || ErrorMessage[code] || '请求失败'
  throw new Error(msg)
}

interface GraphicsResponseVO {
  currentVersion: number
  graphics: GraphicVO[]
}

export interface GraphicAPI {
  // sinceVersion 不传时拉取全量；传值时拉取增量。
  getGraphics(sessionKey: string, sinceVersion?: number): Promise<{
    currentVersion: number
    graphics: GraphicVO[]
  }>
}

export const graphicApi: GraphicAPI = {
  async getGraphics(sessionKey: string, sinceVersion?: number) {
    // 对齐后端：GET /api/v1/sessions/:sessionKey/graphics?sinceVersion=
    const res = await http.get<ApiResponse<GraphicsResponseVO>>(`v1/sessions/${sessionKey}/graphics`, {
      params: { sinceVersion },
    })

    if (res.data.code !== ErrorCode.SUCCESS) {
      handleApiError(res.data.code, res.data.message)
    }

    // 后端 data 为 null 时兜底为空集合，减少页面层判空分支。
    return res.data.data ?? { currentVersion: 0, graphics: [] }
  },
}
