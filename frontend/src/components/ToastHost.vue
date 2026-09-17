<template>
  <!-- 提示条：右上角堆叠 -->
  <div class="fixed top-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
    <TransitionGroup name="toast">
      <div v-for="t in toastState.items" :key="t.id"
        class="pointer-events-auto flex items-start gap-3 max-w-sm
          px-5 py-3.5 rounded-2xl bg-c-cream border border-c-line
          shadow-[0_2px_10px_rgba(120,113,108,0.10)]">
        <span class="w-2.5 h-2.5 rounded-full shrink-0 mt-2" :style="{ background: dotColor(t.type) }" />
        <span class="text-sm text-c-body leading-6">{{ t.text }}</span>
      </div>
    </TransitionGroup>
  </div>

  <!-- 确认框 -->
  <Transition name="fade">
    <div v-if="toastState.confirm" class="fixed inset-0 z-[110] flex items-center justify-center px-6">
      <div class="absolute inset-0 bg-c-ink/25" @click="resolveConfirm(false)" />
      <div class="relative w-full max-w-md rounded-3xl bg-c-cream border border-c-line
        p-7 shadow-[0_8px_32px_rgba(92,64,51,0.16)]">
        <h3 class="font-serif text-lg text-c-ink mb-3">{{ toastState.confirm.title }}</h3>
        <p class="text-sm text-c-body leading-7">{{ toastState.confirm.text }}</p>
        <div class="flex justify-end gap-3 mt-7">
          <button @click="resolveConfirm(false)"
            class="px-5 py-2.5 rounded-full text-sm text-c-body border border-c-lineDeep
              transition-colors duration-300 hover:bg-c-barkSoft">
            {{ toastState.confirm.cancelText }}
          </button>
          <button @click="resolveConfirm(true)"
            class="px-5 py-2.5 rounded-full text-sm text-c-cream bg-c-bark font-medium
              transition-colors duration-300 hover:bg-c-barkDeep active:translate-y-px">
            {{ toastState.confirm.okText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
  <!-- 输入框（目前用于题库包口令） -->
  <Transition name="fade">
    <div v-if="toastState.prompt" class="fixed inset-0 z-[110] flex items-center justify-center px-6">
      <div class="absolute inset-0 bg-c-ink/25" @click="resolvePrompt(null)" />
      <div class="relative w-full max-w-md rounded-3xl bg-c-cream border border-c-line
        p-7 shadow-[0_8px_32px_rgba(92,64,51,0.16)]">
        <h3 class="font-serif text-lg text-c-ink mb-3">{{ toastState.prompt.title }}</h3>
        <p class="text-sm text-c-body leading-7 whitespace-pre-line">{{ toastState.prompt.text }}</p>
        <input ref="promptInput" v-model="toastState.prompt.value" type="password"
          :placeholder="toastState.prompt.placeholder"
          autocomplete="off"
          class="mt-4 w-full px-4 py-3 rounded-2xl bg-c-paper border border-c-lineDeep
            text-sm text-c-ink outline-none transition-colors duration-300 focus:border-c-bark"
          @keydown.enter="resolvePrompt(toastState.prompt.value)"
          @keydown.esc="resolvePrompt(null)" />
        <div class="flex justify-end gap-3 mt-7">
          <button @click="resolvePrompt(null)"
            class="px-5 py-2.5 rounded-full text-sm text-c-body border border-c-lineDeep
              transition-colors duration-300 hover:bg-c-barkSoft">
            {{ toastState.prompt.cancelText }}
          </button>
          <button @click="resolvePrompt(toastState.prompt.value)"
            class="px-5 py-2.5 rounded-full text-sm text-c-cream bg-c-bark font-medium
              transition-colors duration-300 hover:bg-c-barkDeep active:translate-y-px">
            {{ toastState.prompt.okText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { toastState, resolveConfirm, resolvePrompt } from '../utils/toast'

// 弹出即聚焦：口令是"弹出来就要敲"的东西，还要用户再点一下输入框就太啰嗦
const promptInput = ref(null)
watch(
  () => toastState.prompt?.id,
  async (id) => {
    if (!id) return
    await nextTick()
    promptInput.value?.focus()
  },
)

// 类型色取自自然有机色板：成功=鼠尾草、错误=陶土、警告=赭黄、信息=主色
const TYPE_COLOR = {
  success: '#8b9d77',
  error: '#b4552d',
  warning: '#b0803f',
  info: '#5c4033',
}
function dotColor(type) {
  return TYPE_COLOR[type] || TYPE_COLOR.info
}
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 300ms ease-in-out, transform 300ms ease-in-out;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 300ms ease-in-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
