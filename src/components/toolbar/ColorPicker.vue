<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    allowTransparent?: boolean
  }>(),
  {
    modelValue: '#1f2937',
    allowTransparent: false,
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
  emit('update:modelValue', color)
}

const onCustomColorChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  emit('update:modelValue', input.value)
}
</script>

<template>
  <div class="color-picker">
    <button
      v-if="allowTransparent"
      type="button"
      class="color-item transparent-item"
      :class="{ active: modelValue === 'transparent' }"
      @click="pickColor('transparent')"
      title="透明"
    >
      /
    </button>
    <button
      v-for="color in presetColors"
      :key="color"
      type="button"
      class="color-item"
      :class="{ active: modelValue === color }"
      :style="{ backgroundColor: color }"
      :title="color"
      @click="pickColor(color)"
    />
    <label class="custom-color">
      <input type="color" :value="customColor" @input="onCustomColorChange" />
    </label>
  </div>
</template>

<style scoped>
.color-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
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

.transparent-item {
  background: repeating-conic-gradient(#d1d5db 0% 25%, #f3f4f6 0% 50%) 50% / 10px 10px;
  color: var(--cd-text-primary);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
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
</style>
