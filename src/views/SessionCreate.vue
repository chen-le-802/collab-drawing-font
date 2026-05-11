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
    { min: 1, max: 100, message: '会话名称长度在 1 到 100 个字符', trigger: 'blur' },
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
    title="创建新会话"
    width="440px"
    :close-on-click-modal="false"
    class="create-dialog"
    @closed="formRef?.resetFields()"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="会话名称" prop="name">
        <el-input
          v-model="form.name"
          placeholder="为你的画布起个名字"
          maxlength="100"
          show-word-limit
          size="large"
          @keyup.enter="handleConfirm"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <button class="btn-cancel" @click="handleClose">取消</button>
        <button class="btn-confirm" :disabled="loading" @click="handleConfirm">
          {{ loading ? '创建中...' : '创建会话' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 10px 20px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: var(--cd-bg-card);
  color: var(--cd-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: border-color var(--cd-transition), color var(--cd-transition);
}

.btn-cancel:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
}

.btn-confirm {
  padding: 10px 24px;
  border: none;
  border-radius: var(--cd-radius-sm);
  background: linear-gradient(135deg, var(--cd-primary) 0%, #7b93fa 100%);
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--cd-transition), transform var(--cd-transition);
}

.btn-confirm:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
</style>

<style>
.create-dialog .el-dialog__header {
  padding: 24px 24px 0;
}

.create-dialog .el-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--cd-text-primary);
}

.create-dialog .el-dialog__body {
  padding: 20px 24px;
}

.create-dialog .el-dialog__footer {
  padding: 0 24px 24px;
}
</style>
