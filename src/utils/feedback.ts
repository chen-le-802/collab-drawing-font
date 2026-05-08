import { ElMessage, ElMessageBox, type ElMessageBoxOptions } from 'element-plus'

const isString = (value: unknown): value is string => typeof value === 'string'

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (isString(error) && error.trim()) {
    return error
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'object' && error) {
    const maybeMessage = (error as { message?: unknown }).message
    if (isString(maybeMessage) && maybeMessage.trim()) {
      return maybeMessage
    }
  }
  return fallback
}

export const feedback = {
  success(message: string) {
    ElMessage.success(message)
  },
  info(message: string) {
    ElMessage.info(message)
  },
  warning(message: string) {
    ElMessage.warning(message)
  },
  error(message: string) {
    ElMessage.error(message)
  },
  errorFrom(error: unknown, fallback: string) {
    ElMessage.error(getErrorMessage(error, fallback))
  },
}

export const isConfirmCanceled = (error: unknown): boolean => {
  return error === 'cancel' || error === 'close'
}

export const confirmDanger = async (
  message: string,
  title: string,
  options?: Pick<ElMessageBoxOptions, 'confirmButtonText' | 'cancelButtonText'>,
): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'warning',
      confirmButtonText: options?.confirmButtonText ?? '确认',
      cancelButtonText: options?.cancelButtonText ?? '取消',
    })
    return true
  } catch (error) {
    if (isConfirmCanceled(error)) {
      return false
    }
    throw error
  }
}

