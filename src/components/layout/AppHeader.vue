<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
    router.push('/profile')
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
      <span class="logo-mark" aria-hidden="true"></span>
      <span class="logo-text">画协</span>
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
        <el-avatar :size="36" :src="authStore.user?.avatar" class="user-avatar">
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
  padding: 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--cd-bg-card);
  box-shadow: var(--cd-shadow-sm);
  position: relative;
  z-index: 10;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;
}

.logo-mark {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: block;
  background-image: url('/logo.png');
  background-repeat: no-repeat;
  background-size: contain;
  background-position: center;
}

.logo-text {
  color: var(--cd-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.nav-menu {
  flex: 1;
  margin-left: 40px;
  border-bottom: 0;
  min-width: 220px;
  --el-menu-border-color: transparent;
}

:deep(.el-menu--horizontal > .el-menu-item) {
  border-bottom: none;
  border-radius: var(--cd-radius-sm);
  margin: 0 4px;
  transition: background var(--cd-transition), color var(--cd-transition);
}

:deep(.el-menu--horizontal > .el-menu-item:hover) {
  background: var(--cd-primary-light);
}

:deep(.el-menu--horizontal > .el-menu-item.is-active) {
  color: var(--cd-primary);
  background: var(--cd-primary-light);
  border-bottom-color: transparent;
}

.user-trigger {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 3px;
  border-radius: 50%;
  transition: box-shadow var(--cd-transition);
}

.user-trigger:hover {
  box-shadow: 0 0 0 3px var(--cd-primary-light);
}

.user-avatar {
  background: var(--cd-primary-light);
  color: var(--cd-primary);
  font-weight: 700;
}
</style>
