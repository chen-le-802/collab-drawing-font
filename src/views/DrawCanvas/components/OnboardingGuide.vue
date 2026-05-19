<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

type GuidePlacement = 'top' | 'right' | 'bottom' | 'left' | 'center' | 'corner'

interface GuideStep {
  selector: string
  title: string
  content: string
  placement?: GuidePlacement
  highlight?: boolean
  interactive?: boolean
}

export type { GuideStep, GuidePlacement }

const props = withDefaults(
  defineProps<{
    visible: boolean
    steps: GuideStep[]
  }>(),
  {
    visible: false,
    steps: () => [],
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  finished: []
}>()

const ACTIVE_TARGET_CLASS = 'onboarding-target-active'
const currentStepIndex = ref(0)
const tooltipTop = ref(0)
const tooltipLeft = ref(0)
const tooltipPlacement = ref<GuidePlacement>('center')
const maxTooltipWidth = 340
const targetElement = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)

const currentStep = computed(() => props.steps[currentStepIndex.value] ?? null)
const isLastStep = computed(() => currentStepIndex.value >= props.steps.length - 1)
const isInteractiveStep = computed(() => currentStep.value?.interactive === true)

const removeActiveTarget = () => {
  if (!targetElement.value) {
    return
  }
  targetElement.value.classList.remove(ACTIVE_TARGET_CLASS)
  targetElement.value = null
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

const resolvePosition = (targetRect: DOMRect | null, placement: GuidePlacement) => {
  const margin = 12
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight
  const tooltipRect = tooltipRef.value?.getBoundingClientRect() ?? null
  const width = Math.min(tooltipRect?.width ?? maxTooltipWidth, viewWidth - margin * 2)
  const height = tooltipRect?.height ?? 190
  const topBarRect = (document.querySelector('[data-guide="topbar"]') as HTMLElement | null)?.getBoundingClientRect() ?? null
  const statusBarRect =
    (document.querySelector('.status-bar') as HTMLElement | null)?.getBoundingClientRect() ?? null
  const safeTop = Math.max(margin, (topBarRect?.bottom ?? 0) + 8)
  const safeBottom = statusBarRect ? Math.max(margin, viewHeight - statusBarRect.top + 8) : margin
  const maxTop = Math.max(safeTop, viewHeight - height - safeBottom)

  if (!targetRect || placement === 'center') {
    tooltipLeft.value = Math.round((viewWidth - width) / 2)
    tooltipTop.value = Math.round(clamp((viewHeight - height) / 2, safeTop, maxTop))
    tooltipPlacement.value = 'center'
    return
  }
  if (placement === 'corner') {
    // 右下角提示模式：用于“说明类步骤”，尽量不遮挡画布主操作区。
    const nextLeft = viewWidth - width - margin
    const nextTop = maxTop
    tooltipLeft.value = Math.round(clamp(nextLeft, margin, viewWidth - width - margin))
    tooltipTop.value = Math.round(clamp(nextTop, safeTop, maxTop))
    tooltipPlacement.value = 'corner'
    return
  }

  const centerX = targetRect.left + targetRect.width / 2
  const centerY = targetRect.top + targetRect.height / 2
  let nextLeft = 0
  let nextTop = 0

  if (placement === 'top') {
    nextLeft = centerX - width / 2
    nextTop = targetRect.top - height - margin
    if (nextTop < safeTop) {
      nextTop = targetRect.bottom + margin
    }
  } else if (placement === 'right') {
    nextLeft = targetRect.right + margin
    nextTop = centerY - height / 2
  } else if (placement === 'left') {
    nextLeft = targetRect.left - width - margin
    nextTop = centerY - height / 2
  } else {
    nextLeft = centerX - width / 2
    nextTop = targetRect.bottom + margin
  }

  tooltipLeft.value = Math.round(clamp(nextLeft, margin, viewWidth - width - margin))
  tooltipTop.value = Math.round(clamp(nextTop, safeTop, maxTop))
  tooltipPlacement.value = placement
}

const activateCurrentStep = async () => {
  removeActiveTarget()
  const step = currentStep.value
  if (!props.visible || !step) {
    return
  }
  await nextTick()
  const target = document.querySelector(step.selector) as HTMLElement | null
  if (!target) {
    resolvePosition(null, 'center')
    return
  }
  if (step.highlight !== false) {
    targetElement.value = target
    target.classList.add(ACTIVE_TARGET_CLASS)
  }
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  resolvePosition(target.getBoundingClientRect(), step.placement ?? 'bottom')
}

const closeGuide = () => {
  removeActiveTarget()
  emit('update:visible', false)
  emit('finished')
}

const handleSkip = () => {
  closeGuide()
}

const handlePrev = () => {
  if (currentStepIndex.value <= 0) {
    return
  }
  currentStepIndex.value -= 1
}

const handleNext = () => {
  if (isLastStep.value) {
    closeGuide()
    return
  }
  currentStepIndex.value += 1
}

const handleWindowChange = () => {
  if (!props.visible) {
    return
  }
  const step = currentStep.value
  if (!step) {
    return
  }
  const target = document.querySelector(step.selector) as HTMLElement | null
  resolvePosition(target?.getBoundingClientRect() ?? null, step.placement ?? 'bottom')
}

watch(
  () => props.visible,
  async (value) => {
    if (!value) {
      removeActiveTarget()
      return
    }
    currentStepIndex.value = 0
    await activateCurrentStep()
  },
)

watch(
  () => currentStepIndex.value,
  async () => {
    await activateCurrentStep()
  },
)

onBeforeUnmount(() => {
  removeActiveTarget()
  window.removeEventListener('resize', handleWindowChange)
  window.removeEventListener('scroll', handleWindowChange, true)
})

window.addEventListener('resize', handleWindowChange)
window.addEventListener('scroll', handleWindowChange, true)
</script>

<template>
  <teleport to="body">
    <div v-if="visible" class="onboarding-mask" :class="{ interactive: isInteractiveStep }"></div>
    <section
      v-if="visible && currentStep"
      ref="tooltipRef"
      class="onboarding-tooltip"
      :class="`placement-${tooltipPlacement}`"
      :style="{ top: `${tooltipTop}px`, left: `${tooltipLeft}px` }"
    >
      <div class="onboarding-step-index">步骤 {{ currentStepIndex + 1 }} / {{ steps.length }}</div>
      <h3 class="onboarding-title">{{ currentStep.title }}</h3>
      <p class="onboarding-content">{{ currentStep.content }}</p>
      <div class="onboarding-actions">
        <el-button size="small" :disabled="currentStepIndex === 0" @click="handlePrev">上一步</el-button>
        <el-button size="small" @click="handleSkip">跳过</el-button>
        <el-button size="small" type="primary" @click="handleNext">{{ isLastStep ? '完成' : '下一步' }}</el-button>
      </div>
    </section>
  </teleport>
</template>

<style scoped>
.onboarding-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 22, 36, 0.55);
  z-index: 99990;
}

.onboarding-mask.interactive {
  pointer-events: none;
  background: rgba(16, 22, 36, 0.35);
}

.onboarding-tooltip {
  position: fixed;
  z-index: 99992;
  width: min(340px, calc(100vw - 24px));
  border-radius: 12px;
  border: 1px solid rgba(29, 41, 67, 0.1);
  background: #ffffff;
  box-shadow: 0 14px 32px rgba(18, 24, 38, 0.22);
  padding: 12px 12px 10px;
}

.onboarding-step-index {
  font-size: 12px;
  color: #5e6474;
  margin-bottom: 6px;
}

.onboarding-title {
  margin: 0 0 6px;
  font-size: 15px;
  line-height: 1.35;
  color: #1e2433;
}

.onboarding-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #3f475b;
}

.onboarding-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

:global(.onboarding-target-active) {
  position: relative;
  z-index: 99991 !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.45), 0 0 0 8px rgba(37, 99, 235, 0.16);
  border-radius: 10px;
}
</style>
