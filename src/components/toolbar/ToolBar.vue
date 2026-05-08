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
      <button class="tool-btn" :class="{ active: activeTool === 'select' }" @click="setTool('select')" title="选择">
        <el-icon><Pointer /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'line' }" @click="setTool('line')" title="直线">
        <el-icon><Minus /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'arrow' }" @click="setTool('arrow')" title="箭头">
        →
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'rect' }" @click="setTool('rect')" title="矩形">
        <el-icon><SemiSelect /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'circle' }" @click="setTool('circle')" title="圆形">
        <el-icon><RefreshLeft /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'text' }" @click="setTool('text')" title="文本">
        <el-icon><EditPen /></el-icon>
      </button>
      <button class="tool-btn" :class="{ active: activeTool === 'brush' }" @click="setTool('brush')" title="画笔">
        B
      </button>
      <button class="tool-btn danger" :disabled="!canDelete" @click="$emit('delete')" title="删除图形">
        <el-icon><Delete /></el-icon>
      </button>
    </div>

    <div class="section">
      <div class="title">边框颜色</div>
      <ColorPicker :model-value="strokeColor" @update:model-value="$emit('update:strokeColor', $event)" />
    </div>

    <div class="section">
      <div class="title">填充颜色</div>
      <ColorPicker
        :model-value="fillColor"
        :allow-transparent="true"
        @update:model-value="$emit('update:fillColor', $event)"
      />
    </div>

    <div class="section">
      <div class="title">线宽</div>
      <div class="width-list">
        <button
          v-for="item in strokeWidths"
          :key="item"
          class="width-btn"
          :class="{ active: strokeWidth === item }"
          @click="$emit('update:strokeWidth', item)"
        >
          {{ item }}px
        </button>
      </div>
    </div>

    <div class="section">
      <div class="title">层级</div>
      <div class="assist">
        <button class="assist-btn" :disabled="!canBringForward" @click="$emit('bringForward')" title="上移一层">
          <el-icon><Top /></el-icon>
        </button>
        <button class="assist-btn" :disabled="!canSendBackward" @click="$emit('sendBackward')" title="下移一层">
          <el-icon><Bottom /></el-icon>
        </button>
      </div>
    </div>

    <div class="section">
      <div class="title">辅助</div>
      <div class="assist">
        <button class="assist-btn" :disabled="!canUndo" @click="$emit('undo')">
          <el-icon><RefreshLeft /></el-icon>
        </button>
        <button class="assist-btn" :disabled="!canRedo" @click="$emit('redo')">
          <el-icon><RefreshRight /></el-icon>
        </button>
      </div>
      <div class="assist">
        <button class="assist-btn" :class="{ active: panMode }" @click="$emit('update:panMode', !panMode)">
          平移
        </button>
      </div>
      <div class="zoom">{{ zoomPercent }}%</div>
    </div>
  </aside>
</template>

<style scoped>
.toolbar-wrap {
  width: 136px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 8px;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
}

.tools {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.tool-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #595959;
  cursor: pointer;
}

.tool-btn.active {
  background: #1890ff;
  color: #ffffff;
}

.tool-btn.danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 12px;
  color: #6b7280;
}

.width-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.width-btn {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  height: 28px;
  cursor: pointer;
}

.width-btn.active {
  border-color: #1890ff;
  color: #1890ff;
}

.assist {
  display: flex;
  gap: 6px;
}

.assist-btn {
  width: 36px;
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.assist-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.assist-btn.active {
  border-color: #1890ff;
  color: #1890ff;
  background: #eff6ff;
}

.zoom {
  font-size: 16px;
  font-weight: 500;
  color: #6b7280;
}
</style>
