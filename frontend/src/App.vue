<template>
  <div class="min-h-screen bg-[#e0e5ec] text-gray-800">

    <header class="fixed top-0 left-0 right-0 z-50 bg-[#e0e5ec]">
      <div class="max-w-6xl mx-auto px-6 md:px-8 h-16 flex items-center justify-between gap-4">

        <!-- 左：Logo -->
        <div class="flex items-center justify-start shrink-0">
          <RouterLink to="/" class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-[#e0e5ec]
              shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
              flex items-center justify-center text-[#6d5dfc] font-bold">
              笔
            </div>
            <span class="font-semibold text-base text-gray-800 hidden sm:inline">蓝笔申论</span>
          </RouterLink>
        </div>

        <!-- 中：主导航 -->
        <nav class="hidden md:flex items-center justify-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <RouterLink v-for="item in NAV" :key="item.path" :to="item.path"
            class="px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition-all duration-300 ease-in-out"
            :class="isActive(item.path)
              ? 'bg-[#e0e5ec] shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff] text-[#6d5dfc]'
              : 'text-gray-600 hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]'">
            {{ item.label }}
          </RouterLink>
        </nav>

        <!-- 右：设置（圆点指示运行通道） -->
        <div class="flex items-center justify-end gap-1 shrink-0">
          <RouterLink to="/settings" :title="dot.title"
            class="relative w-9 h-9 rounded-lg flex items-center justify-center text-gray-600
              transition-colors duration-200"
            :class="route.path === '/settings' ? 'text-[#6d5dfc]' : 'hover:bg-white/40'">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.68 15a1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            <span class="absolute top-1 right-1 w-2 h-2 rounded-full"
              :style="{ background: dot.color }" />
          </RouterLink>
        </div>
      </div>

      <!-- 移动端导航 -->
      <div class="md:hidden px-4 pb-2 flex gap-1 overflow-x-auto">
        <RouterLink v-for="item in NAV" :key="item.path" :to="item.path"
          class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium"
          :class="isActive(item.path) ? 'neu-inset text-[#6d5dfc]' : 'text-gray-600'">
          {{ item.label }}
        </RouterLink>
      </div>
    </header>

    <main class="pt-16 min-h-screen">
      <div class="md:hidden h-9" />
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { hasApiKey } from './api/llm'
import { probeBackend } from './api/backend'

const NAV = [
  { path: '/', label: '首页' },
  { path: '/teachers', label: '老师' },
  { path: '/questions', label: '题库' },
  { path: '/articles', label: '文章库' },
  { path: '/practice', label: '练习批改' },
  { path: '/records', label: '复盘' },
  { path: '/stats', label: '统计' },
]

const route = useRoute()
const backendUp = ref(false)

onMounted(async () => {
  backendUp.value = await probeBackend()
})

// 一个圆点表达三种状态，避免堆太多指示器
const dot = computed(() => {
  void route.path
  if (backendUp.value) {
    return { color: '#1f9d55', title: '服务端通道已连接：请求经后端转发，无跨域问题' }
  }
  if (hasApiKey()) {
    return { color: '#6d5dfc', title: '本地直连：已配置 API Key' }
  }
  return { color: '#d0d4da', title: '尚未配置：请到设置页填写 API' }
})

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>
