export type GraphicObjectType = 'line' | 'rect' | 'circle' | 'text'

export interface GraphicVO {
  id: number
  objectKey: string
  objectType: GraphicObjectType
  positionX: number
  positionY: number
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
export function generateGraphicObjectKey(): string {
  return `obj_${Date.now()}${Math.random().toString(36).substr(2, 9)}`
}
