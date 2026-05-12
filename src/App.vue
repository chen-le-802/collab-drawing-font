<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>

<style>
:root {
  --cd-primary: #2563eb;
  --cd-primary-hover: #1d4ed8;
  --cd-primary-light: #e8efff;
  --cd-primary-lighter: #f3f6ff;
  --cd-accent-coral: #ff6b6b;
  --cd-accent-mint: #31d3bd;
  --cd-accent-sky: #62b7ff;
  --cd-accent-amber: #f6b84b;

  --cd-radius-sm: 8px;
  --cd-radius-md: 12px;
  --cd-radius-lg: 16px;
  --cd-radius-xl: 20px;

  --cd-shadow-sm: 0 8px 24px rgba(20, 30, 55, 0.05);
  --cd-shadow-md: 0 16px 44px rgba(20, 30, 55, 0.08);
  --cd-shadow-lg: 0 24px 60px rgba(20, 30, 55, 0.12);
  --cd-shadow-card: 0 14px 34px rgba(20, 30, 55, 0.07);

  --cd-bg-page: #f1f3f8;
  --cd-bg-card: #ffffff;
  --cd-bg-sidebar: #ffffff;

  --cd-text-primary: #202331;
  --cd-text-secondary: #5e6474;
  --cd-text-muted: #9aa1ad;

  --cd-border: #e2e6ef;
  --cd-transition: 0.2s ease;

  --el-color-primary: #2563eb;
  --el-color-primary-light-3: #5d8af2;
  --el-color-primary-light-5: #92b0f6;
  --el-color-primary-light-7: #c8d7fb;
  --el-color-primary-light-9: #e8efff;
  --el-color-primary-dark-2: #1d4ed8;
  --el-border-radius-base: 8px;
  --el-border-radius-small: 6px;
  --el-border-radius-round: 999px;
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
  border: 1px solid rgba(226, 230, 239, 0.86);
  box-shadow: var(--cd-shadow-card);
}

.el-dialog {
  --el-dialog-border-radius: var(--cd-radius-lg);
}

.el-input__wrapper {
  border-radius: var(--cd-radius-sm);
}
</style>
