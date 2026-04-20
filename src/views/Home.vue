<script setup lang="ts">
import { ElButton } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { userApi } from '@/api/user'

const authStore = useAuthStore()
const router = useRouter()

const handleLogout = async () => {
  try {
    await userApi.logout()
  } catch {
    // ignore
  }
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="home-container">
    <header class="header">
      <h1>🎨 协作绘图</h1>
      <div class="user-info">
        <span>{{ authStore.user?.username }}</span>
        <el-button type="danger" size="small" @click="handleLogout">退出</el-button>
      </div>
    </header>
    <main class="main">
      <div class="placeholder">
        <p>首页 - 绘图功能开发中...</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.home-container {
  min-height: 100vh;
  background: #f5f5f5;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.header h1 {
  font-size: 20px;
  color: #333;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.main {
  padding: 24px;
}

.placeholder {
  text-align: center;
  padding: 60px;
  color: #999;
  font-size: 16px;
}
</style>
