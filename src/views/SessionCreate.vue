<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { sessionApi } from '@/api/session'
import type { SessionVO } from '@/types/session'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
  }>(),
  {
    modelValue: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [session: SessionVO]
}>()

const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  name: '',
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入会话名称', trigger: 'blur' },
    { min: 2, max: 30, message: '会话名称长度在 2 到 30 个字符', trigger: 'blur' },
  ],
}

// 使用 computed 包装 v-model，保持弹窗开关与父组件状态同步。
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const handleClose = () => {
  visible.value = false
  // 每次关闭后重置表单，避免下次打开残留上一次输入。
  formRef.value?.resetFields()
}

const handleConfirm = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      const session = await sessionApi.create(form.name.trim())
      emit('created', session)
      ElMessage.success('会话创建成功')
      handleClose()
      // 创建成功后直接进入该会话的绘图页。
      await router.push(`/session/${session.sessionKey}`)
    } catch (error: any) {
      ElMessage.error(error.message || '会话创建失败')
    } finally {
      loading.value = false
    }
  })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="创建会话"
    width="460px"
    :close-on-click-modal="false"
    @closed="formRef?.resetFields()"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="会话名称" prop="name">
        <el-input
          v-model="form.name"
          placeholder="请输入会话名称"
          maxlength="30"
          show-word-limit
          @keyup.enter="handleConfirm"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleConfirm">确认</el-button>
    </template>
  </el-dialog>
</template>
