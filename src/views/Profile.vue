<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import AppHeader from '@/components/layout/AppHeader.vue'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import type { UpdateProfileDTO, UserVO } from '@/types/user'

const authStore = useAuthStore()
const loading = ref(false)
const initLoading = ref(false)
const formRef = ref<FormInstance>()
const currentUser = ref<UserVO | null>(null)

const form = reactive({
  username: '',
  avatar: '',
})

const registerTimeText = computed(() => {
  if (!currentUser.value?.createdAt) {
    return '-'
  }
  const date = new Date(currentUser.value.createdAt)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return date.toLocaleString('zh-CN', { hour12: false })
})

const avatarPreview = computed(() => form.avatar || currentUser.value?.avatar || '')

const validateAvatar = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback()
    return
  }

  if (value.length > 500) {
    callback(new Error('头像地址长度不能超过 500'))
    return
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      callback(new Error('头像地址必须为 http/https URL'))
      return
    }
    callback()
  } catch {
    callback(new Error('请输入合法的 URL'))
  }
}

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 4, max: 20, message: '用户名长度在 4 到 20 个字符', trigger: 'blur' },
  ],
  avatar: [{ validator: validateAvatar, trigger: 'blur' }],
}

const hydrateForm = (user: UserVO) => {
  currentUser.value = user
  form.username = user.username
  form.avatar = user.avatar ?? ''
}

const fetchProfile = async () => {
  initLoading.value = true
  try {
    const me = await userApi.getMe()
    authStore.setUser(me)
    hydrateForm(me)
  } catch (error: any) {
    ElMessage.error(error.message || '加载个人信息失败')
  } finally {
    initLoading.value = false
  }
}

const handleSave = async () => {
  if (!formRef.value || !currentUser.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid || !currentUser.value) return

    const payload: UpdateProfileDTO = {}
    const nextUsername = form.username.trim()
    const nextAvatar = form.avatar.trim()

    if (nextUsername !== currentUser.value.username) {
      payload.username = nextUsername
    }

    if (nextAvatar && nextAvatar !== (currentUser.value.avatar ?? '')) {
      payload.avatar = nextAvatar
    }

    if (!payload.username && !payload.avatar) {
      ElMessage.info('未检测到变更')
      return
    }

    loading.value = true
    try {
      const updated = await userApi.updateProfile(payload)
      authStore.setUser(updated)
      hydrateForm(updated)
      ElMessage.success('保存成功')
    } catch (error: any) {
      ElMessage.error(error.message || '保存失败')
    } finally {
      loading.value = false
    }
  })
}

onMounted(() => {
  fetchProfile()
})
</script>

<template>
  <div class="profile-page">
    <app-header />

    <main class="profile-content" v-loading="initLoading">
      <el-card class="profile-card">
        <template #header>
          <div class="profile-title">个人中心</div>
        </template>

        <div class="profile-meta">
          <el-avatar :size="72" :src="avatarPreview">{{ form.username.slice(0, 1).toUpperCase() }}</el-avatar>
          <div class="profile-meta-text">
            <div class="meta-row"><span>当前用户名：</span>{{ currentUser?.username || '-' }}</div>
            <div class="meta-row"><span>注册时间：</span>{{ registerTimeText }}</div>
          </div>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" class="profile-form">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" maxlength="20" show-word-limit />
          </el-form-item>

          <el-form-item label="头像 URL" prop="avatar">
            <el-input v-model="form.avatar" placeholder="https://example.com/avatar.png" maxlength="500" show-word-limit />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" @click="handleSave">保存修改</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </main>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: #f5f7fb;
}

.profile-content {
  padding: 24px;
  display: flex;
  justify-content: center;
}

.profile-card {
  width: 100%;
  max-width: 760px;
  border-radius: 12px;
}

.profile-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2d3d;
}

.profile-meta {
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px;
  border-radius: 10px;
  background: #f7faff;
}

.profile-meta-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #3c4b63;
}

.meta-row span {
  color: #7b8797;
}

.profile-form {
  margin-top: 8px;
}

@media (max-width: 900px) {
  .profile-content {
    padding: 16px;
  }

  .profile-meta {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
