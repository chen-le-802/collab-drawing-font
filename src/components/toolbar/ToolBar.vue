<script setup lang="ts">
import { Delete, EditPen, Minus, Pointer, RefreshLeft, RefreshRight, SemiSelect, Top, Bottom } from '@element-plus/icons-vue'
import ColorPicker from './ColorPicker.vue'

export type CanvasTool = 'select' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'brush'

const props = withDefaults(
  defineProps<{
    activeTool: CanvasTool
    strokeColor: string
    fillColor: string
    strokeWidth: number
    canUndo: boolean
    canRedo: boolean
    zoomPercent: number
    canDelete?: boolean
    canBringForward?: boolean
    canSendBackward?: boolean
    panMode?: boolean
  }>(),
  {
    canDelete: false,
    canBringForward: false,
    canSendBackward: false,
    panMode: false,
  },
)

const emit = defineEmits<{
  'update:activeTool': [tool: CanvasTool]
  'update:strokeColor': [value: string]
  'update:fillColor': [value: string]
  'update:strokeWidth': [value: number]
  'update:panMode': [value: boolean]
  undo: []
  redo: []
  delete: []
  bringForward: []
  sendBackward: []
}>()

const strokeWidths = [1, 2, 4, 6, 8]

const setTool = (tool: CanvasTool) => {
  emit('update:activeTool', tool)
}
</script>

<template>
  <aside class="toolbar-wrap">
    <div class="tools">
      <button class="tool-btn" :class="{ active: activeTool === 'select' }" @click="setTool('select')" title="选择 (V)">
        <el-icon><Pointer /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: panMode }" @click="$emit('update:panMode', !panMode)" title="平移 (H)">
        &#9995;
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'line' }" @click="setTool('line')" title="直线 (L)">
        <el-icon><Minus /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'arrow' }" @click="setTool('arrow')" title="箭头">
        &#10132;
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'rect' }" @click="setTool('rect')" title="矩形 (R)">
        <el-icon><SemiSelect /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'circle' }" @click="setTool('circle')" title="圆形 (O)">
        &#9711;
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'text' }" @click="setTool('text')" title="文本 (T)">
        <el-icon><EditPen /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'brush' }" @click="setTool('brush')" title="画笔 (B)">
        &#9998;
      </button>
    </div>

    <div class="separator"></div>

    <div class="section">
      <div class="section-label">描边</div>
      <ColorPicker :model-value="strokeColor" @update:model-value="$emit('update:strokeColor', $event)" />
    </div>

    <div class="section">
      <div class="section-label">填充</div>
      <ColorPicker
        :model-value="fillColor"
        :allow-transparent="true"
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
          @click="$emit('update:strokeWidth', item)"
        >
          {{ item }}
        </button>
      </div>
    </div>

    <div class="separator"></div>

    <div class="action-row">
      <button class="action-btn" :disabled="!canUndo" @click="$emit('undo')" title="撤销">
        <el-icon><RefreshLeft /></el-icon>
      </button>
      <button class="action-btn" :disabled="!canRedo" @click="$emit('redo')" title="重做">
        <el-icon><RefreshRight /></el-icon>
      </button>
      <button class="action-btn" :disabled="!canBringForward" @click="$emit('bringForward')" title="上移一层">
        <el-icon><Top /></el-icon>
      </button>
      <button class="action-btn" :disabled="!canSendBackward" @click="$emit('sendBackward')" title="下移一层">
        <el-icon><Bottom /></el-icon>
      </button>
      <button class="action-btn danger" :disabled="!canDelete" @click="$emit('delete')" title="删除">
        <el-icon><Delete /></el-icon>
      </button>
    </div>

    <div class="zoom-display">{{ zoomPercent }}%</div>
  </aside>
</template>

<style scoped>
.toolbar-wrap {
  width: 140px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 10px;
  margin: 10px 0 10px 10px;
  background: var(--cd-bg-card);
  border-radius: var(--cd-radius-lg);
  box-shadow: var(--cd-shadow-md);
  overflow-y: auto;
  max-height: calc(100vh - 52px - 30px - 40px);
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
  width: 44px;
  height: 44px;
  border-radius: var(--cd-radius-md);
  border: none;
  background: transparent;
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
  background: var(--cd-primary-light);
  color: var(--cd-primary);
}

.tool-btn.active {
  background: var(--cd-primary);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(79, 110, 247, 0.3);
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
  letter-spacing: 0.5px;
}

.width-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
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
  border-color: var(--cd-primary);
  color: var(--cd-primary);
  background: var(--cd-primary-light);
  font-weight: 600;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: var(--cd-bg-card);
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
  color: var(--cd-text-muted);
  padding: 4px 0;
}
</style>
