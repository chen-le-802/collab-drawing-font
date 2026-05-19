<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    visible: boolean
  }>(),
  {
    visible: false,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    title="快捷键帮助"
    width="460px"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="shortcut-list">
      <div class="shortcut-row"><span class="shortcut-action">撤销</span><code>Ctrl/Cmd + Z</code></div>
      <div class="shortcut-row"><span class="shortcut-action">重做</span><code>Ctrl/Cmd + Y / Ctrl/Cmd + Shift + Z</code></div>
      <div class="shortcut-row"><span class="shortcut-action">复制图元</span><code>Ctrl/Cmd + C</code></div>
      <div class="shortcut-row"><span class="shortcut-action">粘贴图元</span><code>Ctrl/Cmd + V</code></div>
      <div class="shortcut-row"><span class="shortcut-action">锁定/解锁</span><code>Ctrl/Cmd + L</code></div>
      <div class="shortcut-row"><span class="shortcut-action">删除选中</span><code>Delete</code></div>
      <div class="shortcut-row"><span class="shortcut-action">专注模式</span><code>顶栏按钮 / Esc 退出</code></div>
    </div>
    <template #footer>
      <el-button @click="emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>
