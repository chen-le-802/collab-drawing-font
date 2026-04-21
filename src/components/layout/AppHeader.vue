<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { userApi } from '@/api/user'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activePath = computed(() => {
  // “我的会话”暂复用首页容器页面，这里单独保持导航高亮一致。
  if (route.path.startsWith('/my-sessions')) {
    return '/my-sessions'
  }
  return '/'
})

const avatarText = computed(() => {
  const username = authStore.user?.username ?? 'U'
  return username.slice(0, 1).toUpperCase()
})

const handleLogoClick = () => {
  router.push('/')
}

const handleMenuSelect = (index: string) => {
  if (index === '/my-sessions') {
    router.push('/my-sessions')
    return
  }
  router.push('/')
}

const handleCommand = async (command: string) => {
  if (command === 'profile') {
    ElMessage.info('个人中心功能开发中')
    return
  }

  if (command === 'logout') {
    try {
      await userApi.logout()
    } catch {
      // 登出接口失败不阻塞本地退出，避免用户被卡在当前页面。
    }
    authStore.logout()
    router.push('/login')
  }
}
</script>

<template>
  <header class="app-header">
    <div class="logo" @click="handleLogoClick">
      <span class="logo-mark">CD</span>
      <span class="logo-text">Collab Drawing</span>
    </div>

    <el-menu
      mode="horizontal"
      :default-active="activePath"
      class="nav-menu"
      @select="handleMenuSelect"
    >
      <el-menu-item index="/">首页（我加入的会话）</el-menu-item>
      <el-menu-item index="/my-sessions">我的会话（我创建的会话）</el-menu-item>
    </el-menu>

    <el-dropdown trigger="click" @command="handleCommand">
      <div class="user-trigger">
        <el-avatar :size="36" class="user-avatar">
          {{ avatarText }}
        </el-avatar>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="profile">个人中心</el-dropdown-item>
          <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </header>
</template>

<style scoped>
.app-header {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-bottom: 1px solid #ebeef5;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2d72ff;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

.logo-text {
  color: #1f2d3d;
  font-size: 16px;
  font-weight: 600;
}

.nav-menu {
  flex: 1;
  margin-left: 40px;
  border-bottom: 0;
  min-width: 220px;
}

:deep(.el-menu--horizontal > .el-menu-item.is-active) {
  color: #2d72ff;
  border-bottom-color: #2d72ff;
}

.user-trigger {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.user-avatar {
  background: #dfe9ff;
  color: #2d72ff;
  font-weight: 700;
}
</style>
