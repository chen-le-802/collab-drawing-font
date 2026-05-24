import type { Ref } from 'vue'

import { generateGraphicObjectKey, type GraphicVO } from '@/types/graphic'

type UseCanvasKeyboardOptions = {
  textEditingRef: Ref<boolean>
  focusModeRef: Ref<boolean>
  isReadOnlyRef: Ref<boolean>
  clipboardGraphicsRef: Ref<GraphicVO[]>
  pasteCountRef: Ref<number>
  selectedGraphicsRef: Ref<GraphicVO[]>
  selectedObjectKeysRef: Ref<string[]>
  selectedObjectKeyRef: Ref<string | null>
  canvasStoreRef: Ref<{
    currentSession: { sessionId: number } | null
    graphics: GraphicVO[]
  }>
  currentUserIdRef: Ref<number | null>
  undoStepCountsRef: Ref<number[]>
  commitTextEditing: () => void
  cancelTextEditing: () => void
  isInputTarget: (target: EventTarget | null) => boolean
  deleteSelectedGraphic: () => void
  handleToggleFocusMode: () => void
  beginWsBatch: (size: number, label?: string) => void
  endWsBatch: () => void
  upsertGraphic: (graphic: GraphicVO) => void
  sendCreateGraphic: (graphic: GraphicVO) => void
  handleUndo: () => Promise<void>
  handleRedo: () => Promise<void>
  handleToggleLock: () => void
  onSuccess: (message: string) => void
}

// 键盘快捷键模块：
// 负责删除、撤销重做、复制粘贴、锁定切换、专注模式退出等快捷键行为。
export const useCanvasKeyboard = (options: UseCanvasKeyboardOptions) => {
  // 全局按键入口：会优先避开文本编辑态与输入框焦点场景。
  const handleKeydown = (event: KeyboardEvent) => {
    if (options.textEditingRef.value) {
      if (event.key === 'Enter') {
        event.preventDefault()
        options.commitTextEditing()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        options.cancelTextEditing()
        return
      }
      return
    }

    if (options.isInputTarget(event.target)) {
      return
    }

    if (event.key === 'Delete') {
      event.preventDefault()
      options.deleteSelectedGraphic()
      return
    }

    if (!event.ctrlKey && !event.metaKey) {
      if (event.key === 'Escape' && options.focusModeRef.value) {
        event.preventDefault()
        options.handleToggleFocusMode()
        return
      }
      return
    }

    const key = event.key.toLowerCase()
    if (key === 'c') {
      if (options.selectedGraphicsRef.value.length > 0) {
        event.preventDefault()
        options.clipboardGraphicsRef.value = options.selectedGraphicsRef.value.map((item) => ({
          ...item,
          pathPoints: item.pathPoints ? item.pathPoints.map((p) => ({ x: p.x, y: p.y })) : null,
        }))
        options.pasteCountRef.value = 0
        options.onSuccess(`已复制 ${options.clipboardGraphicsRef.value.length} 个图元`)
      }
      return
    }

    if (key === 'v') {
      if (!options.isReadOnlyRef.value && options.clipboardGraphicsRef.value.length > 0 && options.canvasStoreRef.value.currentSession) {
        event.preventDefault()
        options.pasteCountRef.value += 1
        const offset = 24 * options.pasteCountRef.value
        const created: GraphicVO[] = options.clipboardGraphicsRef.value.map((item, idx) => {
          const nextKey = generateGraphicObjectKey()
          const next: GraphicVO = {
            ...item,
            id: 0,
            objectKey: nextKey,
            sessionId: options.canvasStoreRef.value.currentSession?.sessionId ?? item.sessionId,
            positionX: item.positionX + offset,
            positionY: item.positionY + offset,
            pathPoints: item.pathPoints
              ? item.pathPoints.map((p) => ({ x: p.x + offset, y: p.y + offset }))
              : null,
            zIndex: options.canvasStoreRef.value.graphics.length + idx + 1,
            creatorId: options.currentUserIdRef.value ?? 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          return next
        })
        options.beginWsBatch(created.length, 'multi_paste')
        try {
          created.forEach((item) => {
            options.upsertGraphic(item)
            options.sendCreateGraphic(item)
          })
        } finally {
          options.endWsBatch()
        }
        if (created.length > 1) {
          // 把“多图元粘贴”合并成一个撤销步，避免撤销要点很多次。
          const stack = [...options.undoStepCountsRef.value]
          stack.splice(Math.max(0, stack.length - created.length), created.length, created.length)
          options.undoStepCountsRef.value = stack
        }
        options.selectedObjectKeysRef.value = created.map((item) => item.objectKey)
        options.selectedObjectKeyRef.value = options.selectedObjectKeysRef.value[options.selectedObjectKeysRef.value.length - 1] ?? null
        options.onSuccess(`已粘贴 ${created.length} 个图元`)
      }
      return
    }

    if (key === 'z' && event.shiftKey) {
      event.preventDefault()
      void options.handleRedo()
      return
    }
    if (key === 'z') {
      event.preventDefault()
      void options.handleUndo()
      return
    }
    if (key === 'y') {
      event.preventDefault()
      void options.handleRedo()
      return
    }
    if (key === 'l') {
      event.preventDefault()
      options.handleToggleLock()
    }
  }

  return {
    handleKeydown,
  }
}
