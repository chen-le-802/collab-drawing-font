<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import type { SessionDetailVO, SessionJoinVO } from '@/types/session'
import { wsClient } from '@/utils/wsClient'
import { sessionApi } from '@/api/session'

const route = useRoute()
const router = useRouter()

const joining = ref(false)
const joined = ref(false)
const sessionInfo = ref<SessionJoinVO | null>(null)
const sessionDetail = ref<SessionDetailVO | null>(null)

const sessionKey = computed(() => String(route.params.sessionKey || ''))

const handleBack = () => {
  router.push('/')
}

const joinSessionIfNeeded = async () => {
  if (!sessionKey.value || joined.value || joining.value) return

  joining.value = true
  try {
    // 邀请链接直接访问时，自动调用 join。
    // 后端已约定 join 幂等：已在成员表时也会成功返回当前会话数据。
    const res = await wsClient.joinSession(sessionKey.value)
    sessionInfo.value = res
    // members 不在 join 返回中，这里补一次详情查询。
    sessionDetail.value = await sessionApi.getDetail(sessionKey.value)
    joined.value = true

    // 规范化 URL，避免重复历史记录。
    await router.replace(`/session/${sessionKey.value}`)
  } catch (error: any) {
    ElMessage.error(error.message || '加入会话失败')
    await router.replace('/')
  } finally {
    joining.value = false
  }
}

onMounted(() => {
  joinSessionIfNeeded()
})
</script>

<template>
  <div class="draw-page">
    <app-header />

    <main class="draw-main">
      <el-card class="draw-card">
        <template v-if="joining">
          <el-skeleton animated>
            <template #template>
              <el-skeleton-item variant="h3" style="width: 180px" />
              <el-skeleton-item variant="text" style="margin-top: 12px; width: 70%" />
              <el-skeleton-item variant="text" style="margin-top: 8px; width: 55%" />
            </template>
          </el-skeleton>
        </template>

        <template v-else>
          <h2 class="title">绘图会话</h2>
          <p class="line">会话 Key：{{ sessionKey }}</p>
          <p class="line">会话名称：{{ sessionInfo?.name ?? sessionDetail?.name ?? '-' }}</p>
          <p class="line">成员数：{{ sessionDetail?.members?.length ?? 0 }}</p>
          <p class="line">画布全量数据：{{ sessionInfo?.graphics ? '已加载' : '暂无' }}</p>
          <p class="hint">Canvas 与 WebSocket 实时协作区域待接入。</p>
          <el-button type="primary" @click="handleBack">返回会话列表</el-button>
        </template>
      </el-card>
    </main>
  </div>
</template>

<style scoped>
.draw-page {
  min-height: 100vh;
  background: #f5f7fb;
}

.draw-main {
  padding: 24px;
}

.draw-card {
  border-radius: 8px;
}

.title {
  margin: 0 0 12px;
  color: #1f2d3d;
}

.line {
  margin: 0 0 10px;
  color: #606266;
}

.hint {
  margin: 16px 0;
  color: #909399;
}
</style>
