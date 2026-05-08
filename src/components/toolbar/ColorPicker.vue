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
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-item.active {
  border-color: #111827;
}

.transparent-item {
  background: repeating-linear-gradient(45deg, #d1d5db 0 4px, #f3f4f6 4px 8px);
  color: #111827;
  font-size: 12px;
}

.custom-color input {
  width: 32px;
  height: 32px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
</style>
