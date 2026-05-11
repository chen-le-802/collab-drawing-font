<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import type { UploadProps } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import type { UpdateProfileDTO, UserVO } from '@/types/user'
import { storage } from '@/utils/storage'
import { feedback } from '@/utils/feedback'

const authStore = useAuthStore()
const loading = ref(false)
const initLoading = ref(false)
const passwordLoading = ref(false)
const formRef = ref<FormInstance>()
const passwordFormRef = ref<FormInstance>()
const currentUser = ref<UserVO | null>(null)

const form = reactive({
  username: '',
  avatar: '',
})

const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const localAvatarPreview = ref('')
const previewObjectUrl = ref('')
const getApiBaseUrl = () => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
const uploadAvatarAction = `${getApiBaseUrl().replace(/\/$/, '')}/v1/users/avatar`
const uploadAvatarHeaders = computed(() => {
  const token = storage.getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
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

const avatarPreview = computed(() => localAvatarPreview.value || form.avatar || currentUser.value?.avatar || '')

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 4, max: 20, message: '用户名长度在 4 到 20 个字符', trigger: 'blur' },
  ],
}

const validateConfirmPassword = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请再次输入新密码'))
    return
  }
  if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入的新密码不一致'))
    return
  }
  callback()
}

const passwordRules: FormRules = {
  currentPassword: [
    { required: true, message: '请输入当前密码', trigger: 'blur' },
    { min: 6, max: 20, message: '密码长度在 6 到 20 个字符', trigger: 'blur' },
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 20, message: '密码长度在 6 到 20 个字符', trigger: 'blur' },
  ],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: 'blur' }],
}

const hydrateForm = (user: UserVO) => {
  currentUser.value = user
  form.username = user.username
  form.avatar = user.avatar ?? ''
  localAvatarPreview.value = ''
}

const handleAvatarSuccess: UploadProps['onSuccess'] = (response, uploadFile) => {
  if (previewObjectUrl.value) {
    URL.revokeObjectURL(previewObjectUrl.value)
    previewObjectUrl.value = ''
  }
  previewObjectUrl.value = URL.createObjectURL(uploadFile.raw!)
  localAvatarPreview.value = previewObjectUrl.value
  const avatarUrl =
    typeof response === 'string'
      ? response
      : (response as { data?: { url?: unknown }; url?: unknown })?.data?.url ??
        (response as { data?: { url?: unknown }; url?: unknown })?.url
  if (typeof avatarUrl === 'string' && avatarUrl.trim()) {
    form.avatar = avatarUrl.trim()
    return
  }
  feedback.error('头像上传响应异常，请重试')
}

const beforeAvatarUpload: UploadProps['beforeUpload'] = (rawFile) => {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
  if (!allowedTypes.has(rawFile.type)) {
    feedback.error('头像图片仅支持 JPG/JPEG、PNG、WEBP 格式')
    return false
  }
  if (rawFile.size / 1024 / 1024 > 2) {
    feedback.error('头像图片大小不能超过 2MB')
    return false
  }
  return true
}

const fetchProfile = async () => {
  initLoading.value = true
  try {
    const me = await userApi.getMe()
    authStore.setUser(me)
    hydrateForm(me)
  } catch (error) {
    feedback.errorFrom(error, '加载个人信息失败')
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
      feedback.info('未检测到变更')
      return
    }

    loading.value = true
    try {
      const updated = await userApi.updateProfile(payload)
      authStore.setUser(updated)
      hydrateForm(updated)
      feedback.success('保存成功')
    } catch (error) {
      feedback.errorFrom(error, '保存失败')
    } finally {
      loading.value = false
    }
  })
}

const resetPasswordForm = () => {
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordFormRef.value?.clearValidate()
}

const handleChangePassword = async () => {
  if (!passwordFormRef.value) return

  const valid = await passwordFormRef.value
    .validate()
    .then(() => true)
    .catch(() => false)

  if (!valid) {
    return
  }

  if (passwordForm.currentPassword === passwordForm.newPassword) {
    feedback.warning('新密码不能与当前密码相同')
    return
  }

  passwordLoading.value = true
  try {
    await userApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    feedback.success('密码修改成功')
    resetPasswordForm()
  } catch (error) {
    feedback.errorFrom(error, '修改密码失败')
  } finally {
    passwordLoading.value = false
  }
}

onMounted(() => {
  fetchProfile()
})

onBeforeUnmount(() => {
  if (previewObjectUrl.value) {
    URL.revokeObjectURL(previewObjectUrl.value)
    previewObjectUrl.value = ''
  }
})
</script>

<template>
  <div class="profile-page">
    <header class="profile-header">
      <div class="header-left" @click="$router.push('/')">
        <span class="header-logo">CD</span>
        <span class="header-title">Collab Drawing</span>
      </div>
      <button class="back-btn" @click="$router.push('/')">&#8592; 返回首页</button>
    </header>

    <main class="profile-body" v-loading="initLoading">
      <div class="profile-banner">
        <div class="banner-circle"></div>
        <div class="banner-content">
          <el-avatar :size="80" :src="avatarPreview" class="banner-avatar">
            {{ form.username.slice(0, 1).toUpperCase() }}
          </el-avatar>
          <div class="banner-info">
            <h2 class="banner-name">{{ currentUser?.username || '用户' }}</h2>
            <p class="banner-time">注册于 {{ registerTimeText }}</p>
          </div>
        </div>
      </div>

      <div class="profile-sections">
        <section class="section-card">
          <h3 class="section-title">基本信息</h3>
          <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" class="profile-form">
            <el-form-item label="用户名" prop="username">
              <el-input v-model="form.username" maxlength="20" show-word-limit />
            </el-form-item>

            <el-form-item label="上传头像">
              <el-upload
                class="avatar-uploader"
                :action="uploadAvatarAction"
                :headers="uploadAvatarHeaders"
                accept="image/jpeg,image/png,image/webp"
                name="file"
                :show-file-list="false"
                :on-success="handleAvatarSuccess"
                :before-upload="beforeAvatarUpload"
              >
                <img v-if="avatarPreview" :src="avatarPreview" class="avatar" />
                <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
              </el-upload>
              <div class="upload-tip">支持 JPG/JPEG、PNG、WEBP 格式，且文件大小不超过 2MB</div>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="loading" @click="handleSave">保存修改</el-button>
            </el-form-item>
          </el-form>
        </section>

        <section class="section-card">
          <h3 class="section-title">安全设置</h3>
          <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-width="90px" class="profile-form">
            <el-form-item label="当前密码" prop="currentPassword">
              <el-input
                v-model="passwordForm.currentPassword"
                type="password"
                show-password
                maxlength="20"
                autocomplete="current-password"
              />
            </el-form-item>

            <el-form-item label="新密码" prop="newPassword">
              <el-input
                v-model="passwordForm.newPassword"
                type="password"
                show-password
                maxlength="20"
                autocomplete="new-password"
              />
            </el-form-item>

            <el-form-item label="确认新密码" prop="confirmPassword">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                maxlength="20"
                autocomplete="new-password"
              />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" :loading="passwordLoading" @click="handleChangePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: var(--cd-bg-page);
}

.profile-header {
  height: 60px;
  padding: 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--cd-bg-card);
  box-shadow: var(--cd-shadow-sm);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.header-logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--cd-primary) 0%, #7b93fa 100%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--cd-text-primary);
}

.back-btn {
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: var(--cd-bg-card);
  padding: 6px 16px;
  font-size: 13px;
  color: var(--cd-text-secondary);
  cursor: pointer;
  transition: border-color var(--cd-transition), color var(--cd-transition);
}

.back-btn:hover {
  border-color: var(--cd-primary);
  color: var(--cd-primary);
}

.profile-body {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 24px;
}

.profile-banner {
  position: relative;
  height: 160px;
  border-radius: var(--cd-radius-xl);
  background: linear-gradient(135deg, var(--cd-primary) 0%, #7b93fa 50%, #a78bfa 100%);
  overflow: hidden;
  margin-bottom: 60px;
}

.banner-circle {
  position: absolute;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  top: -100px;
  right: -50px;
  background: radial-gradient(circle, rgba(248, 200, 220, 0.3) 0%, transparent 70%);
}

.banner-content {
  position: absolute;
  bottom: -40px;
  left: 32px;
  display: flex;
  align-items: flex-end;
  gap: 18px;
}

.banner-avatar {
  border: 4px solid var(--cd-bg-card);
  box-shadow: var(--cd-shadow-md);
  background: var(--cd-primary-light);
  color: var(--cd-primary);
  font-weight: 700;
  font-size: 28px;
}

.banner-info {
  padding-bottom: 6px;
}

.banner-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--cd-text-primary);
  margin: 0;
}

.banner-time {
  font-size: 13px;
  color: var(--cd-text-muted);
  margin: 4px 0 0;
}

.profile-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-card {
  background: var(--cd-bg-card);
  border-radius: var(--cd-radius-lg);
  box-shadow: var(--cd-shadow-sm);
  padding: 28px 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--cd-text-primary);
  margin: 0 0 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--cd-border);
}

.profile-form {
  margin-top: 4px;
}

.avatar-uploader .avatar {
  width: 120px;
  height: 120px;
  display: block;
  object-fit: cover;
  border-radius: 50%;
}

.upload-tip {
  margin-top: 10px;
  color: var(--cd-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .profile-body {
    padding: 20px 12px;
  }

  .section-card {
    padding: 20px 16px;
  }

  .banner-content {
    left: 16px;
  }
}
</style>

<style>
.avatar-uploader .el-upload {
  border: 2px dashed var(--cd-border);
  border-radius: 50%;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color var(--cd-transition);
}

.avatar-uploader .el-upload:hover {
  border-color: var(--cd-primary);
}

.avatar-uploader-icon {
  font-size: 28px;
  color: var(--cd-text-muted);
  width: 120px;
  height: 120px;
  text-align: center;
  line-height: 120px;
}
</style>
