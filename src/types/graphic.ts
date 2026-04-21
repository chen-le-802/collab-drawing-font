export type GraphicObjectType = 'line' | 'rect' | 'circle' | 'text'

// 与后端 graphic_objects 表一一对应的前端实体。
export interface GraphicVO {
  id: number
  objectKey: string
  objectType: GraphicObjectType
  // 位置语义：
  // line: 起点坐标；rect/text: 左上角；circle: 圆心。
  positionX: number
  positionY: number
  // 尺寸语义：
  // line: 终点相对偏移；rect: 宽高；circle: 直径；text: 文本区域大小。
  width?: number
  height?: number
  strokeColor: string
  fillColor?: string
  strokeWidth: number
  textContent?: string
  fontSize?: number
  zIndex: number
  version: number
  creatorId: number
  isDeleted: number
  createdAt: string
  updatedAt: string
}

export interface CreateGraphicDTO {
  objectKey: string
  objectType: GraphicObjectType
  positionX: number
  positionY: number
  width?: number
  height?: number
  strokeColor: string
  fillColor?: string
  strokeWidth: number
  zIndex: number
  textContent?: string
  fontSize?: number
}

// 对齐约定：'obj_' + Date.now() + Math.random().toString(36).substr(2, 9)
// objectKey 由前端生成并随创建请求传给后端。
export function generateGraphicObjectKey(): string {
  return `obj_${Date.now()}${Math.random().toString(36).substr(2, 9)}`
}
