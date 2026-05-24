import { ElMessageBox } from 'element-plus'

import { sessionApi } from '@/api/session'
import { confirmDanger, feedback } from '@/utils/feedback'
import type { GraphicVO } from '@/types/graphic'
import type { SessionSnapshotItemVO } from '@/types/session'

// 版本快照模块：
// 负责快照列表拉取、创建快照、回放预览、恢复版本等完整流程。
type UseVersionSnapshotsOptions = {
  getSessionKey: () => string
  getCurrentSessionName: () => string
  getCurrentVersion: () => number
  formatNowForFilename: () => string
  // 这些 loading 状态由 index.vue 持有，本模块只负责读写。
  loadingSnapshotsRef: { value: boolean }
  replayLoadingRef: { value: boolean }
  replayTargetVersionRef: { value: number | null }
  snapshotsRef: { value: SessionSnapshotItemVO[] }
  currentSnapshotVersionRef: { value: number | null }
  // 回放解析工具由 index.vue 提供，避免重复实现数据转换逻辑。
  isRecord: (value: unknown) => value is Record<string, unknown>
  toGraphicFromUnknown: (value: unknown, fallbackObjectKey?: string) => GraphicVO | null
  toOperationPathPoints: (value: unknown) => Array<{ x: number; y: number }> | null
  setGraphics: (graphics: GraphicVO[]) => void
  syncGraphicsFromServer: (forceFull?: boolean) => Promise<void>
  updateSessionVersion: (version: number) => void
  scheduleRender: () => void
}

export const useVersionSnapshots = (options: UseVersionSnapshotsOptions) => {
  // 拉取快照列表；force=true 用于创建后强制刷新。
  const refreshSnapshots = async (force = false) => {
    if (!options.getSessionKey() || (options.loadingSnapshotsRef.value && !force)) {
      return
    }
    options.loadingSnapshotsRef.value = true
    try {
      const result = await sessionApi.getSnapshots(options.getSessionKey(), 20)
      options.snapshotsRef.value = result.snapshots
    } catch (error) {
      feedback.errorFrom(error, '加载版本快照失败')
    } finally {
      options.loadingSnapshotsRef.value = false
    }
    options.currentSnapshotVersionRef.value = options.snapshotsRef.value.length > 0 ? (options.snapshotsRef.value[0]?.version ?? null) : null
  }

  // 创建快照：支持输入名称，留空则使用默认命名。
  const createSnapshotNow = async () => {
    if (!options.getSessionKey() || options.loadingSnapshotsRef.value) {
      return
    }
    try {
      const defaultName = `${options.getCurrentSessionName() || '未命名会话'}_V${options.getCurrentVersion()}_${options.formatNowForFilename()}`
      const promptResult = await ElMessageBox.prompt('请输入快照名称（可留空）', '创建快照', {
        confirmButtonText: '创建',
        cancelButtonText: '取消',
        inputValue: defaultName,
        inputPlaceholder: '例如：联调前快照 / 答辩演示快照',
        closeOnClickModal: false,
      }).catch((error) => {
        if (error === 'cancel' || error === 'close') {
          return null
        }
        throw error
      })
      if (!promptResult) {
        return
      }
      const snapshotNameRaw = promptResult.value
      const snapshotName = typeof snapshotNameRaw === 'string' ? snapshotNameRaw.trim() : ''

      options.loadingSnapshotsRef.value = true
      await sessionApi.createSnapshot(options.getSessionKey(), snapshotName || undefined)
      feedback.success('已创建版本快照')
      // 强制刷新，确保列表无需手动刷新页面即可看到新快照。
      await refreshSnapshots(true)
    } catch (error) {
      feedback.errorFrom(error, '创建快照失败')
    } finally {
      options.loadingSnapshotsRef.value = false
    }
  }

  // 恢复版本：这是服务端确认操作，会覆盖当前画布并产生新的恢复记录。
  const restoreToVersion = async (targetVersion: number) => {
    if (!options.getSessionKey() || options.replayLoadingRef.value) {
      return
    }
    const confirmed = await confirmDanger(
      `确认恢复到版本 V${targetVersion} 吗？该操作会按目标版本内容覆盖当前画布状态，并生成新的恢复记录。`,
      '恢复快照确认',
      {
        confirmButtonText: '确认恢复',
        cancelButtonText: '取消',
      },
    )
    if (!confirmed) {
      return
    }
    options.replayLoadingRef.value = true
    options.replayTargetVersionRef.value = targetVersion
    try {
      const result = await sessionApi.restoreVersion(options.getSessionKey(), targetVersion)
      await options.syncGraphicsFromServer(true)
      await refreshSnapshots()
      options.updateSessionVersion(result.restoredVersion)
      feedback.success(
        `已恢复到版本 ${targetVersion}，当前版本 ${result.restoredVersion}（创建 ${result.createdCount}，更新 ${result.updatedCount}，删除 ${result.deletedCount}）`,
      )
    } catch (error) {
      feedback.errorFrom(error, '版本恢复失败')
    } finally {
      options.replayLoadingRef.value = false
      options.replayTargetVersionRef.value = null
    }
  }

  // 回放版本：仅用于本地预览历史画布，不直接写回服务端。
  const applyReplayToCanvas = async (targetVersion: number) => {
    if (!options.getSessionKey() || options.replayLoadingRef.value) {
      return
    }
    options.replayLoadingRef.value = true
    options.replayTargetVersionRef.value = targetVersion
    try {
      const replay = await sessionApi.getReplay(options.getSessionKey(), targetVersion)
      const replayMap = new Map<string, GraphicVO>()
      const baseGraphics = replay.baseSnapshotData?.graphics ?? []
      baseGraphics.forEach((item) => {
        if (options.isRecord(item)) {
          const next = options.toGraphicFromUnknown(item)
          if (next) {
            replayMap.set(next.objectKey, next)
          }
        }
      })

      replay.operations.forEach((op) => {
        if (op.operationType === 'delete') {
          replayMap.delete(op.objectKey)
          return
        }
        const resolvedGraphic = options.isRecord(op.resolvedResult?.graphic) ? options.toGraphicFromUnknown(op.resolvedResult.graphic) : null
        if (resolvedGraphic) {
          replayMap.set(resolvedGraphic.objectKey, resolvedGraphic)
          return
        }
        const current = replayMap.get(op.objectKey)
        if (!current) {
          return
        }
        const patch = options.isRecord(op.operationData) ? op.operationData : {}
        const updated: GraphicVO = {
          ...current,
          positionX: typeof patch.positionX === 'number' ? patch.positionX : current.positionX,
          positionY: typeof patch.positionY === 'number' ? patch.positionY : current.positionY,
          width: typeof patch.width === 'number' ? patch.width : current.width,
          height: typeof patch.height === 'number' ? patch.height : current.height,
          strokeColor: typeof patch.strokeColor === 'string' ? patch.strokeColor : current.strokeColor,
          lineStyle: patch.lineStyle === 'dashed' ? 'dashed' : (patch.lineStyle === 'solid' ? 'solid' : current.lineStyle),
          fillColor: typeof patch.fillColor === 'string' || patch.fillColor === null ? patch.fillColor : current.fillColor,
          strokeWidth: typeof patch.strokeWidth === 'number' ? patch.strokeWidth : current.strokeWidth,
          textContent: typeof patch.textContent === 'string' ? patch.textContent : current.textContent,
          fontSize: typeof patch.fontSize === 'number' ? patch.fontSize : current.fontSize,
          pathPoints: options.toOperationPathPoints(patch.pathPoints) ?? current.pathPoints,
          isLocked: typeof patch.isLocked === 'boolean' ? patch.isLocked : current.isLocked,
          rotation: typeof patch.rotation === 'number' ? patch.rotation : current.rotation,
          zIndex: typeof patch.zIndex === 'number' ? patch.zIndex : current.zIndex,
          version: op.serverVersion,
        }
        replayMap.set(op.objectKey, updated)
      })

      options.setGraphics(Array.from(replayMap.values()).sort((a, b) => a.zIndex - b.zIndex))
      options.updateSessionVersion(targetVersion)
      options.scheduleRender()
      feedback.success(`已回放到版本 ${targetVersion}`)
    } catch (error) {
      feedback.errorFrom(error, '版本回放失败')
    } finally {
      options.replayLoadingRef.value = false
      options.replayTargetVersionRef.value = null
    }
  }

  return {
    refreshSnapshots,
    createSnapshotNow,
    restoreToVersion,
    applyReplayToCanvas,
  }
}
