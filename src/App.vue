<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>

<style>
:root {
  --cd-primary: #4f6ef7;
  --cd-primary-hover: #3b5de5;
  --cd-primary-light: #eef2ff;
  --cd-primary-lighter: #f5f7ff;
  --cd-accent-pink: #f8c8dc;
  --cd-accent-purple: #c4b5fd;
  --cd-accent-blue: #93c5fd;

  --cd-radius-sm: 8px;
  --cd-radius-md: 14px;
  --cd-radius-lg: 18px;
  --cd-radius-xl: 24px;

  --cd-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --cd-shadow-md: 0 4px 20px rgba(0, 0, 0, 0.06);
  --cd-shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.08);
  --cd-shadow-card: 0 2px 12px rgba(79, 110, 247, 0.06);

  --cd-bg-page: #eef0f5;
  --cd-bg-card: #ffffff;
  --cd-bg-sidebar: #ffffff;

  --cd-text-primary: #1a1a2e;
  --cd-text-secondary: #64748b;
  --cd-text-muted: #94a3b8;

  --cd-border: #e8ecf4;
  --cd-transition: 0.2s ease;

  --el-color-primary: #4f6ef7;
  --el-color-primary-light-3: #7b93fa;
  --el-color-primary-light-5: #a7b7fc;
  --el-color-primary-light-7: #d3dbfd;
  --el-color-primary-light-9: #eef2ff;
  --el-color-primary-dark-2: #3b5de5;
  --el-border-radius-base: 8px;
  --el-border-radius-small: 6px;
  --el-border-radius-round: 20px;
  --el-font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  height: 100%;
  font-family: var(--el-font-family);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.el-button--primary {
  --el-button-bg-color: var(--cd-primary);
  --el-button-border-color: var(--cd-primary);
  --el-button-hover-bg-color: var(--cd-primary-hover);
  --el-button-hover-border-color: var(--cd-primary-hover);
}

.el-card {
  --el-card-border-radius: var(--cd-radius-lg);
  border: none;
  box-shadow: var(--cd-shadow-sm);
}

.el-dialog {
  --el-dialog-border-radius: var(--cd-radius-lg);
}

.el-input__wrapper {
  border-radius: var(--cd-radius-sm);
}
</style>
