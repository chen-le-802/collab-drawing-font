<script setup lang="ts">
import { Delete, EditPen, Minus, Pointer, RefreshLeft, RefreshRight, Top, Bottom, Rank, Lock, Unlock, Picture, Loading } from '@element-plus/icons-vue'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ColorPicker from './ColorPicker.vue'

export type CanvasTool = 'select' | 'line' | 'arrow' | 'rect' | 'circle' | 'ellipse' | 'shape' | 'text' | 'brush'
export type ShapeToolType = 'diamond' | 'triangle' | 'pentagon' | 'hexagon'
export type GraphicLineStyle = 'solid' | 'dashed'

const props = withDefaults(
  defineProps<{
    activeTool: CanvasTool
    shapeType: ShapeToolType
    strokeColor: string
    fillColor: string
    strokeWidth: number
    lineStyle: GraphicLineStyle
    canUndo: boolean
    canRedo: boolean
    zoomPercent: number
    canDelete?: boolean
    canBringForward?: boolean
    canSendBackward?: boolean
    canToggleLock?: boolean
    selectedLocked?: boolean
    canEditLineStyle?: boolean
    panMode?: boolean
    readOnly?: boolean
    importingImage?: boolean
    layout?: 'vertical' | 'horizontal'
  }>(),
  {
    canDelete: false,
    canBringForward: false,
    canSendBackward: false,
    canToggleLock: false,
    selectedLocked: false,
    canEditLineStyle: true,
    panMode: false,
    readOnly: false,
    importingImage: false,
    layout: 'vertical',
  },
)

const emit = defineEmits<{
  'update:activeTool': [tool: CanvasTool]
  'update:shapeType': [value: ShapeToolType]
  'update:strokeColor': [value: string]
  'update:fillColor': [value: string]
  'update:strokeWidth': [value: number]
  'update:lineStyle': [value: GraphicLineStyle]
  'update:panMode': [value: boolean]
  undo: []
  redo: []
  delete: []
  bringForward: []
  sendBackward: []
  toggleLock: []
  importImage: []
}>()

const strokeWidths = [1, 2, 4, 6, 8]
const lineStyleOptions: Array<{ value: GraphicLineStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
]
const shapePickerVisible = ref(false)
const shapeToolWrapRef = ref<HTMLElement | null>(null)
const shapeTriggerRef = ref<HTMLElement | null>(null)
const shapePickerPanelRef = ref<HTMLElement | null>(null)
const shapePickerTop = ref(0)
const shapePickerLeft = ref(0)
const SHAPE_PICKER_WIDTH = 78
const SHAPE_PICKER_OFFSET = 6
const shapeOptions: Array<{ value: ShapeToolType; label: string }> = [
  { value: 'diamond', label: '菱形' },
  { value: 'triangle', label: '三角形' },
  { value: 'pentagon', label: '五边形' },
  { value: 'hexagon', label: '六边形' },
]

const getShapePolygonPoints = (type: ShapeToolType): string => {
  if (type === 'diamond') {
    return '10,2.5 17,10 10,17.5 3,10'
  }
  if (type === 'triangle') {
    return '10,3 17,16.5 3,16.5'
  }
  if (type === 'pentagon') {
    return '10,2.5 17,8 14.4,17 5.6,17 3,8'
  }
  return '5,3.5 15,3.5 18,10 15,16.5 5,16.5 2,10'
}

const updateShapePickerPosition = () => {
  const trigger = shapeTriggerRef.value
  if (!trigger) {
    return
  }
  const rect = trigger.getBoundingClientRect()
  let nextLeft = rect.right - SHAPE_PICKER_WIDTH
  nextLeft = Math.max(8, Math.min(nextLeft, window.innerWidth - SHAPE_PICKER_WIDTH - 8))
  shapePickerLeft.value = Math.round(nextLeft)
  shapePickerTop.value = Math.round(rect.bottom + SHAPE_PICKER_OFFSET)
}

const setTool = (tool: CanvasTool) => {
  if (props.readOnly) {
    return
  }
  if (tool !== 'shape') {
    shapePickerVisible.value = false
  }
  emit('update:activeTool', tool)
}

const toggleShapePicker = () => {
  if (props.readOnly) {
    return
  }
  emit('update:activeTool', 'shape')
  const nextVisible = props.activeTool !== 'shape' ? true : !shapePickerVisible.value
  shapePickerVisible.value = nextVisible
  if (nextVisible) {
    nextTick(() => {
      updateShapePickerPosition()
    })
  }
}

const selectShapeType = (value: ShapeToolType) => {
  if (props.readOnly) {
    return
  }
  emit('update:shapeType', value)
  emit('update:activeTool', 'shape')
  shapePickerVisible.value = false
}

const handleViewportOrScrollChange = () => {
  if (!shapePickerVisible.value) {
    return
  }
  updateShapePickerPosition()
}

const handleGlobalPointerDown = (event: MouseEvent) => {
  if (!shapePickerVisible.value) {
    return
  }
  const target = event.target as Node | null
  if (!target) {
    return
  }
  if (shapeToolWrapRef.value?.contains(target)) {
    return
  }
  if (shapePickerPanelRef.value?.contains(target)) {
    return
  }
  shapePickerVisible.value = false
}

watch(
  () => props.activeTool,
  (value) => {
    if (value !== 'shape') {
      shapePickerVisible.value = false
      return
    }
    if (shapePickerVisible.value) {
      nextTick(() => {
        updateShapePickerPosition()
      })
    }
  },
)

onMounted(() => {
  window.addEventListener('resize', handleViewportOrScrollChange, { passive: true })
  window.addEventListener('scroll', handleViewportOrScrollChange, true)
  window.addEventListener('pointerdown', handleGlobalPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportOrScrollChange)
  window.removeEventListener('scroll', handleViewportOrScrollChange, true)
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
})
</script>

<template>
  <aside class="toolbar-wrap" :class="{ 'toolbar-wrap-horizontal': layout === 'horizontal' }" data-guide="toolbar">
    <div class="tools">
      <button class="tool-btn" :class="{ active: activeTool === 'select' }" @click="setTool('select')" title="选择 (V)">
        <el-icon><Pointer /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: panMode }" @click="$emit('update:panMode', !panMode)" title="平移 (H)">
        <el-icon><Rank /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'line' }" @click="setTool('line')" title="直线 (L)">
        <el-icon><Minus /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'arrow' }" @click="setTool('arrow')" title="箭头">
        <span class="arrow-icon"></span>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'rect' }" @click="setTool('rect')" title="矩形 (R)">
        <span class="rect-icon"></span>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'circle' }" @click="setTool('circle')" title="圆形 (O)">
        <span class="circle-icon"></span>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'ellipse' }" @click="setTool('ellipse')" title="椭圆 (E)">
        <span class="ellipse-icon"></span>
      </button>
      <div class="shape-tool-wrap" ref="shapeToolWrapRef">
        <button ref="shapeTriggerRef" class="tool-btn" :class="{ active: activeTool === 'shape' }" @click="toggleShapePicker" title="图形">
          <svg class="shape-tool-icon" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="5.4" cy="12.8" r="2.8" fill="currentColor" />
            <rect x="8.4" y="10.2" width="4.6" height="4.6" rx="0.8" fill="currentColor" />
            <polygon points="14,9.2 18.2,9.2 16.1,4.6" fill="currentColor" />
          </svg>
        </button>
      </div>
      <button class="tool-btn" :class="{ active: activeTool === 'text' }" @click="setTool('text')" title="文本 (T)">
        <span class="text-icon">A</span>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'brush' }" @click="setTool('brush')" title="画笔 (B)">
        <el-icon><EditPen /></el-icon>
      </button>
      <button class="tool-btn" :disabled="readOnly || importingImage" @click="$emit('importImage')" :title="importingImage ? '图片上传中…' : '导入图片'">
        <el-icon><Loading v-if="importingImage" /><Picture v-else /></el-icon>
      </button>
    </div>

    <div class="separator"></div>

    <div class="section">
      <div class="section-label">描边</div>
      <ColorPicker
        :model-value="strokeColor"
        :compact="layout === 'horizontal'"
        :disabled="readOnly"
        @update:model-value="$emit('update:strokeColor', $event)"
      />
    </div>

    <div class="section" data-guide="style-section">
      <div class="section-label">填充</div>
      <ColorPicker
        :model-value="fillColor"
        :compact="layout === 'horizontal'"
        :allow-transparent="true"
        :disabled="readOnly"
        @update:model-value="$emit('update:fillColor', $event)"
      />
    </div>

    <div class="section">
      <div class="section-label">线宽</div>
      <div class="width-row">
        <button
          v-for="item in strokeWidths"
          :key="item"
          class="width-chip"
          :class="{ active: strokeWidth === item }"
          :disabled="readOnly"
          @click="$emit('update:strokeWidth', item)"
        >
          {{ item }}
        </button>
      </div>
    </div>

    <div class="section">
      <div class="section-label">线型</div>
      <div class="style-row">
        <button
          v-for="item in lineStyleOptions"
          :key="item.value"
          class="style-chip"
          :class="{ active: lineStyle === item.value }"
          :disabled="readOnly || !canEditLineStyle"
          @click="$emit('update:lineStyle', item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="separator"></div>

    <div class="action-row">
      <button class="action-btn" :disabled="readOnly || !canUndo" @click="$emit('undo')" title="撤销">
        <el-icon><RefreshLeft /></el-icon>
      </button>
      <button class="action-btn" :disabled="readOnly || !canRedo" @click="$emit('redo')" title="重做">
        <el-icon><RefreshRight /></el-icon>
      </button>
      <button
        class="action-btn"
        :disabled="readOnly || !canToggleLock"
        :title="selectedLocked ? '解锁对象 (Ctrl/Cmd + L)' : '锁定对象 (Ctrl/Cmd + L)'"
        @click="$emit('toggleLock')"
      >
        <el-icon><Lock v-if="!selectedLocked" /><Unlock v-else /></el-icon>
      </button>
      <button class="action-btn" :disabled="readOnly || !canBringForward" @click="$emit('bringForward')" title="上移一层">
        <el-icon><Top /></el-icon>
      </button>
      <button class="action-btn" :disabled="readOnly || !canSendBackward" @click="$emit('sendBackward')" title="下移一层">
        <el-icon><Bottom /></el-icon>
      </button>
      <button class="action-btn danger" :disabled="readOnly || !canDelete" @click="$emit('delete')" title="删除">
        <el-icon><Delete /></el-icon>
      </button>
    </div>

    <div class="zoom-display">{{ zoomPercent }}%</div>
  </aside>

  <teleport to="body">
    <div
      v-if="shapePickerVisible"
      ref="shapePickerPanelRef"
      class="shape-picker-panel shape-picker-panel-floating"
      :style="{ top: `${shapePickerTop}px`, left: `${shapePickerLeft}px` }"
    >
      <button
        v-for="item in shapeOptions"
        :key="item.value"
        class="shape-item-btn"
        :class="{ active: shapeType === item.value }"
        :data-label="item.label"
        :title="item.label"
        @click="selectShapeType(item.value)"
      >
        <svg class="shape-item-svg" viewBox="0 0 20 20" aria-hidden="true">
          <polygon
            :points="getShapePolygonPoints(item.value)"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </teleport>
</template>

<style scoped>
.toolbar-wrap {
  width: 140px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  margin: 10px 0 10px 10px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(226, 230, 239, 0.92);
  border-radius: var(--cd-radius-lg);
  box-shadow: var(--cd-shadow-card);
  overflow-y: auto;
  max-height: calc(100vh - 52px - 30px - 40px);
}

.toolbar-wrap-horizontal {
  width: auto;
  flex-direction: row;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 8px 10px;
  overflow-x: auto;
  overflow-y: hidden;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.toolbar-wrap-horizontal::-webkit-scrollbar {
  display: none;
}

.toolbar-wrap-horizontal .tools {
  grid-template-columns: repeat(11, 44px);
  gap: 3px;
}

.toolbar-wrap-horizontal .separator {
  width: 1px;
  height: 22px;
  margin: 0 2px;
}

.toolbar-wrap-horizontal .section {
  min-width: auto;
  gap: 4px;
}

.toolbar-wrap-horizontal .action-row {
  flex-wrap: nowrap;
}

.toolbar-wrap-horizontal .tool-btn {
  width: 44px;
  height: 34px;
  border-radius: 9px;
  font-size: 14px;
}

.toolbar-wrap-horizontal .section-label {
  font-size: 10px;
}

.toolbar-wrap-horizontal .width-row,
.toolbar-wrap-horizontal .style-row {
  flex-wrap: nowrap;
}

.toolbar-wrap-horizontal .width-chip,
.toolbar-wrap-horizontal .style-chip {
  height: 24px;
  min-width: 24px;
  font-size: 11px;
  border-radius: 6px;
}

.toolbar-wrap-horizontal .style-chip {
  min-width: 44px;
  padding: 0 8px;
}

.toolbar-wrap-horizontal .action-btn {
  width: 32px;
  height: 28px;
  border-radius: 8px;
  font-size: 13px;
}

.toolbar-wrap-horizontal .zoom-display {
  margin-left: auto;
  border-top: none;
  border-left: 1px solid var(--cd-border);
  padding: 0 0 0 8px;
  font-size: 12px;
}

.toolbar-wrap::-webkit-scrollbar {
  width: 3px;
}

.toolbar-wrap::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.tools {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.tool-btn {
  width: 54px;
  height: 40px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: #f8f9fc;
  color: var(--cd-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: background var(--cd-transition), color var(--cd-transition),
    transform var(--cd-transition);
}

.tool-btn:hover {
  border-color: rgba(37, 99, 235, 0.2);
  background: var(--cd-primary-light);
  color: var(--cd-primary);
}

.tool-btn.active {
  background: #202331;
  border-color: #202331;
  color: #ffffff;
  box-shadow: 0 12px 22px rgba(20, 30, 55, 0.14);
}

.shape-tool-wrap {
  position: relative;
}

.shape-tool-icon {
  width: 24px;
  height: 24px;
  display: block;
}

.shape-picker-panel {
  position: fixed;
  z-index: 12;
  width: 78px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--cd-border);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 12px 22px rgba(20, 30, 55, 0.14);
}

.shape-picker-panel-floating {
  z-index: 3000;
}

.shape-item-btn {
  position: relative;
  height: 28px;
  border: 1px solid var(--cd-border);
  border-radius: 6px;
  background: #fff;
  color: var(--cd-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  transition: border-color var(--cd-transition), color var(--cd-transition), background var(--cd-transition);
}

.shape-item-btn:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
}

.shape-item-btn.active {
  border-color: #202331;
  background: #202331;
  color: #fff;
}

.shape-item-btn:hover::after {
  content: attr(data-label);
  position: absolute;
  left: 50%;
  bottom: -30px;
  transform: translateX(-50%);
  padding: 3px 8px;
  border: 1px solid var(--cd-border);
  border-radius: 4px;
  background: #fff;
  color: #111827;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  box-shadow: 0 6px 14px rgba(20, 30, 55, 0.14);
  z-index: 2;
}

.shape-item-svg {
  width: 16px;
  height: 16px;
  display: block;
  flex-shrink: 0;
}

.tool-btn.danger:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.separator {
  height: 1px;
  background: var(--cd-border);
  margin: 2px 4px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 11px;
  color: var(--cd-text-muted);
  font-weight: 600;
  text-transform: uppercase;
}

.width-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.style-row {
  display: flex;
  gap: 4px;
}

.width-chip {
  min-width: 28px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--cd-border);
  border-radius: 6px;
  background: var(--cd-bg-card);
  font-size: 12px;
  color: var(--cd-text-secondary);
  cursor: pointer;
  transition: border-color var(--cd-transition), color var(--cd-transition),
    background var(--cd-transition);
}

.width-chip:hover {
  border-color: var(--cd-primary);
}

.width-chip.active {
  border-color: #202331;
  color: #ffffff;
  background: #202331;
  font-weight: 600;
}

.style-chip {
  flex: 1;
  height: 26px;
  border: 1px solid var(--cd-border);
  border-radius: 6px;
  background: var(--cd-bg-card);
  font-size: 12px;
  color: var(--cd-text-secondary);
  cursor: pointer;
  transition: border-color var(--cd-transition), color var(--cd-transition),
    background var(--cd-transition);
}

.style-chip:hover {
  border-color: var(--cd-primary);
}

.style-chip.active {
  border-color: #202331;
  color: #ffffff;
  background: #202331;
  font-weight: 600;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.action-btn {
  width: 36px;
  height: 32px;
  border: 1px solid var(--cd-border);
  border-radius: 10px;
  background: #ffffff;
  color: var(--cd-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: border-color var(--cd-transition), color var(--cd-transition),
    background var(--cd-transition);
}

.action-btn:hover:not(:disabled) {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
  background: var(--cd-primary-light);
}

.action-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-btn.danger:hover:not(:disabled) {
  border-color: #dc2626;
  color: #dc2626;
  background: #fef2f2;
}

.zoom-display {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--cd-text-secondary);
  padding: 8px 0 4px;
  border-top: 1px solid var(--cd-border);
}

.arrow-icon,
.circle-icon,
.ellipse-icon {
  display: block;
  position: relative;
}

.rect-icon {
  width: 16px;
  height: 12px;
  border: 2px solid currentColor;
  border-radius: 2px;
}

.text-icon {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.arrow-icon {
  width: 20px;
  height: 2px;
  background: currentColor;
  transform: rotate(-26deg);
}

.arrow-icon::after {
  content: '';
  position: absolute;
  right: -1px;
  top: -4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-top: 2px solid currentColor;
  transform: rotate(45deg);
}

.circle-icon {
  width: 17px;
  height: 17px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.ellipse-icon {
  width: 19px;
  height: 13px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

</style>
