<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { userApi } from '@/api/user'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
  password: '',
})

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 4, max: 20, message: '用户名长度在 4 到 20 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 20, message: '密码长度在 6 到 20 个字符', trigger: 'blur' },
  ],
}

const handleLogin = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      const res = await userApi.login(form.username.trim(), form.password)
      authStore.setToken(res.token)
      authStore.setUser(res.user)
      ElMessage.success('登录成功')
      router.push('/')
    } catch (error: any) {
      ElMessage.error(error.message || '登录失败')
    } finally {
      loading.value = false
    }
  })
}
</script>

<template>
  <div class="auth-page">
    <div class="brand-side">
      <div class="brand-content">
        <div class="brand-logo">CD</div>
        <h1 class="brand-title">Collab Drawing</h1>
        <p class="brand-desc">多人实时协作绘图平台，让创意在团队中自由流动</p>
        <div class="brand-features">
          <div class="feature-item">
            <span class="feature-icon">&#9998;</span>
            <span>实时协作绘图</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">&#9775;</span>
            <span>版本历史管理</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">&#9733;</span>
            <span>一键分享邀请</span>
          </div>
        </div>
      </div>
      <div class="brand-circle brand-circle-1"></div>
      <div class="brand-circle brand-circle-2"></div>
      <div class="brand-circle brand-circle-3"></div>
    </div>

    <div class="form-side">
      <div class="form-card">
        <h2 class="form-title">欢迎回来</h2>
        <p class="form-subtitle">登录你的账号继续使用</p>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="login-form"
          @submit.prevent="handleLogin"
        >
          <el-form-item prop="username">
            <el-input
              v-model="form.username"
              placeholder="用户名"
              size="large"
              prefix-icon="User"
            />
          </el-form-item>

          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="密码"
              size="large"
              prefix-icon="Lock"
              show-password
            />
          </el-form-item>

          <el-form-item>
            <button
              type="submit"
              class="submit-btn"
              :disabled="loading"
            >
              {{ loading ? '登录中...' : '登 录' }}
            </button>
          </el-form-item>
        </el-form>

        <div class="footer">
          还没有账号？<router-link to="/register">立即注册</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
}

.brand-side {
  flex: 1;
  background: linear-gradient(135deg, #4f6ef7 0%, #7b93fa 50%, #a78bfa 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 60px;
}

.brand-content {
  position: relative;
  z-index: 2;
  color: #ffffff;
  max-width: 420px;
}

.brand-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 1px;
  margin-bottom: 28px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.brand-title {
  font-size: 36px;
  font-weight: 800;
  margin: 0 0 12px;
  letter-spacing: -0.5px;
}

.brand-desc {
  font-size: 16px;
  line-height: 1.7;
  opacity: 0.85;
  margin: 0 0 36px;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  opacity: 0.9;
}

.feature-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.brand-circle {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.brand-circle-1 {
  width: 500px;
  height: 500px;
  top: -150px;
  right: -100px;
  background: radial-gradient(circle, rgba(248, 200, 220, 0.3) 0%, transparent 70%);
}

.brand-circle-2 {
  width: 350px;
  height: 350px;
  bottom: -80px;
  left: -60px;
  background: radial-gradient(circle, rgba(196, 181, 253, 0.25) 0%, transparent 70%);
}

.brand-circle-3 {
  width: 200px;
  height: 200px;
  top: 50%;
  right: 10%;
  background: radial-gradient(circle, rgba(147, 197, 253, 0.2) 0%, transparent 70%);
}

.form-side {
  width: 480px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cd-bg-page);
  padding: 40px;
}

.form-card {
  width: 100%;
  max-width: 360px;
}

.form-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--cd-text-primary);
  margin: 0 0 8px;
}

.form-subtitle {
  font-size: 14px;
  color: var(--cd-text-muted);
  margin: 0 0 32px;
}

.login-form {
  width: 100%;
}

.submit-btn {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: var(--cd-radius-md);
  background: linear-gradient(135deg, var(--cd-primary) 0%, #7b93fa 100%);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--cd-transition), transform var(--cd-transition);
  letter-spacing: 2px;
}

.submit-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.footer {
  text-align: center;
  margin-top: 28px;
  color: var(--cd-text-secondary);
  font-size: 14px;
}

.footer a {
  color: var(--cd-primary);
  text-decoration: none;
  font-weight: 500;
}

.footer a:hover {
  text-decoration: underline;
}

@media (max-width: 900px) {
  .auth-page {
    flex-direction: column;
  }

  .brand-side {
    min-height: 240px;
    padding: 40px 30px;
  }

  .brand-title {
    font-size: 24px;
  }

  .brand-desc,
  .brand-features {
    display: none;
  }

  .form-side {
    width: 100%;
    flex: 1;
    padding: 30px 20px;
  }
}
</style>
