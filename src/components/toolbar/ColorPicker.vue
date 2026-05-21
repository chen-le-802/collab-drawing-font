<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    allowTransparent?: boolean
    disabled?: boolean
    compact?: boolean
  }>(),
  {
    modelValue: '#1f2937',
    allowTransparent: false,
    disabled: false,
    compact: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const presetColors = [
  '#1f2937',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

const customColor = ref(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    customColor.value = value
  },
)

const pickColor = (color: string) => {
  if (props.disabled) {
    return
  }
  emit('update:modelValue', color)
}

const onCustomColorChange = (event: Event) => {
  if (props.disabled) {
    return
  }
  const input = event.target as HTMLInputElement
  emit('update:modelValue', input.value)
}
</script>

<template>
  <div class="color-picker" :class="{ 'color-picker-compact': compact }">
    <button
      v-if="allowTransparent"
      type="button"
      class="color-item transparent-item"
      :class="{ active: modelValue === 'transparent' }"
      :disabled="disabled"
      @click="pickColor('transparent')"
      title="无填充（透明）"
    >
      <span class="transparent-cross" aria-hidden="true"></span>
    </button>
    <button
      v-for="color in presetColors"
      :key="color"
      type="button"
      class="color-item"
      :class="{ active: modelValue === color }"
      :style="{ backgroundColor: color }"
      :title="color"
      :disabled="disabled"
      @click="pickColor(color)"
    />
    <label class="custom-color" title="自定义颜色">
      <span class="custom-color-icon" aria-hidden="true"></span>
      <input type="color" :value="customColor" :disabled="disabled" @input="onCustomColorChange" />
    </label>
  </div>
</template>

<style scoped>
.color-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.color-picker-compact {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
}

.color-item {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform var(--cd-transition), box-shadow var(--cd-transition);
}

.color-item:hover {
  transform: scale(1.15);
}

.color-item.active {
  border-color: var(--cd-text-primary);
  box-shadow: 0 0 0 2px var(--cd-primary-light);
}

.color-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.transparent-item {
  position: relative;
  background:
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%, transparent 75%, #e2e8f0 75%, #e2e8f0),
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%, transparent 75%, #e2e8f0 75%, #e2e8f0);
  background-position: 0 0, 6px 6px;
  background-size: 12px 12px;
  background-color: #ffffff;
  border-color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
}

.transparent-cross {
  width: 2px;
  height: 18px;
  background: #ef4444;
  transform: rotate(45deg);
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
}

.color-picker-compact .transparent-cross {
  height: 13px;
}

.color-picker-compact .color-item {
  width: 22px;
  height: 22px;
  border-width: 1px;
}

.custom-color input {
  width: 30px;
  height: 30px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
}

.custom-color {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.custom-color-icon {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 1.5px solid #334155;
  border-radius: 50%;
  background: conic-gradient(from 25deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444);
  pointer-events: none;
  z-index: 1;
}

.color-picker-compact .custom-color input {
  width: 22px;
  height: 22px;
}

.color-picker-compact .custom-color-icon {
  transform: scale(0.86);
}

.custom-color input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
