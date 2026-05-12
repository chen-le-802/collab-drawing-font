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
    <div class="auth-shell">
      <section class="brand-panel">
        <div class="brand-row">
          <div class="brand-logo" aria-hidden="true"></div>
          <div>
            <div class="brand-title">画协</div>
            <div class="brand-desc">实时协作画布</div>
          </div>
        </div>
        <div class="brand-copy">
          <h1>和团队一起，把想法画清楚</h1>
          <p>创建画布、邀请成员、实时同步，每一次协作都从这里开始。</p>
        </div>
        <div class="canvas-accent" aria-hidden="true">
          <span class="accent-line accent-red"></span>
          <span class="accent-line accent-blue"></span>
          <span class="accent-line accent-mint"></span>
          <span class="accent-dot dot-red"></span>
          <span class="accent-dot dot-blue"></span>
        </div>
      </section>

      <section class="form-card">
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
      </section>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background:
    radial-gradient(circle at 15% 18%, rgba(255, 107, 107, 0.1), transparent 28%),
    radial-gradient(circle at 78% 24%, rgba(49, 211, 189, 0.12), transparent 30%),
    var(--cd-bg-page);
}

.auth-shell {
  width: min(980px, 100%);
  min-height: 560px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  overflow: hidden;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.94);
  box-shadow: var(--cd-shadow-lg);
}

.brand-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 42px;
  overflow: hidden;
  background:
    linear-gradient(#edf1f8 1px, transparent 1px),
    linear-gradient(90deg, #edf1f8 1px, transparent 1px),
    linear-gradient(145deg, #ffffff 0%, #f5f8fc 100%);
  background-size: 28px 28px, 28px 28px, auto;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background-image: url('/logo.png');
  background-repeat: no-repeat;
  background-size: contain;
  background-position: center;
}

.brand-title {
  color: var(--cd-text-primary);
  font-size: 22px;
  font-weight: 800;
}

.brand-desc {
  margin-top: 3px;
  color: var(--cd-text-muted);
  font-size: 13px;
}

.brand-copy {
  position: relative;
  z-index: 1;
  max-width: 360px;
}

.brand-copy h1 {
  margin: 0;
  color: var(--cd-text-primary);
  font-size: 34px;
  line-height: 1.2;
  font-weight: 800;
}

.brand-copy p {
  margin: 14px 0 0;
  color: var(--cd-text-secondary);
  font-size: 15px;
  line-height: 1.8;
}

.canvas-accent {
  position: absolute;
  inset: auto 38px 34px auto;
  width: 260px;
  height: 170px;
  opacity: 0.9;
}

.accent-line,
.accent-dot {
  position: absolute;
  display: block;
}

.accent-line {
  height: 5px;
  border-radius: 999px;
}

.accent-red {
  width: 190px;
  left: 10px;
  top: 82px;
  background: var(--cd-accent-coral);
  transform: rotate(-18deg);
}

.accent-blue {
  width: 170px;
  right: 0;
  top: 44px;
  background: var(--cd-accent-sky);
  transform: rotate(18deg);
}

.accent-mint {
  width: 150px;
  left: 60px;
  bottom: 24px;
  background: var(--cd-accent-mint);
  transform: rotate(8deg);
}

.accent-dot {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #ffffff;
}

.dot-red {
  left: 34px;
  top: 42px;
  border: 9px solid var(--cd-accent-coral);
}

.dot-blue {
  right: 30px;
  top: 94px;
  border: 9px solid var(--cd-accent-sky);
}

.form-card {
  display: flex;
  justify-content: center;
  flex-direction: column;
  width: 100%;
  padding: 54px 48px;
  background: rgba(255, 255, 255, 0.88);
  border-left: 1px solid var(--cd-border);
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
  border-radius: 999px;
  background: #202331;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--cd-transition), transform var(--cd-transition);
}

.submit-btn:hover {
  background: #111827;
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
    padding: 20px;
  }

  .auth-shell {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .brand-panel {
    min-height: 280px;
    padding: 28px;
  }

  .brand-copy h1 {
    font-size: 26px;
  }

  .form-card {
    padding: 32px 24px;
    border-left: none;
    border-top: 1px solid var(--cd-border);
  }
}
</style>
