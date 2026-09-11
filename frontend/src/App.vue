<template>
  <div class="min-h-screen bg-[#e0e5ec] text-gray-800">

    <!-- 移动端汉堡按钮（抽屉打开时隐藏，避免浮在抽屉之上） -->
    <button
      v-if="!drawerOpen"
      @click="drawerOpen = true"
      class="md:hidden fixed top-3 left-3 z-50 w-10 h-10 rounded-xl bg-[#e0e5ec]
        shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
        flex items-center justify-center text-gray-600 active:shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff]"
      aria-label="打开导航">
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- 桌面端侧边栏（固定） -->
    <aside class="hidden md:block fixed left-0 top-0 bottom-0 w-56 z-40 bg-[#e0e5ec]">
      <GroupedSidebar :nav="NAV" :dot="dot" />
    </aside>

    <!-- 移动端抽屉 -->
    <div v-if="drawerOpen" class="md:hidden fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/30" @click="drawerOpen = false" />
      <aside class="relative w-56 h-full bg-[#e0e5ec]">
        <GroupedSidebar :nav="NAV" :dot="dot" @navigate="drawerOpen = false" />
      </aside>
    </div>

    <!-- 主区：内边距统一在这里给，各 view 不再各写一套 -->
    <main class="md:ml-56 min-w-0 min-h-screen px-6 md:px-8 py-8">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import { hasApiKey } from './api/llm'
import { probeBackend } from './api/backend'
import GroupedSidebar from './components/GroupedSidebar.vue'

// 导航数据：分组由 group 字段标定，避免再写一份冗余数组
const NAV = [
  { group: '学习', path: '/', label: '首页' },
  { group: '学习', path: '/teachers', label: '老师' },
  { group: '内容', path: '/questions', label: '题库' },
  { group: '内容', path: '/articles', label: '文章库' },
  { group: '实战', path: '/practice', label: '练习批改' },
  { group: '复盘', path: '/records', label: '复盘' },
  { group: '复盘', path: '/stats', label: '统计' },
]

const backendUp = ref(false)
const drawerOpen = ref(false)

onMounted(async () => {
  backendUp.value = await probeBackend()
})

// 一个圆点表达三种状态，避免堆太多指示器
const dot = computed(() => {
  if (backendUp.value) {
    return { color: '#1f9d55', title: '服务端通道已连接：请求经后端转发，无跨域问题' }
  }
  if (hasApiKey()) {
    return { color: '#6d5dfc', title: '本地直连：已配置 API Key' }
  }
  return { color: '#d0d4da', title: '尚未配置：请到设置页填写 API' }
})
</script>