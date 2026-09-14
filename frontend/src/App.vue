<!--
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
-->
<template>
  <div class="min-h-screen bg-c-cream text-c-body">

    <!-- 移动端汉堡按钮（抽屉打开时隐藏，避免浮在抽屉之上） -->
    <button
      v-if="!drawerOpen"
      @click="drawerOpen = true"
      class="md:hidden fixed top-3 left-3 z-50 w-11 h-11 rounded-full bg-c-paper
        border border-c-line shadow-[0_1px_2px_rgba(120,113,108,0.06)]
        flex items-center justify-center text-c-body
        transition-colors duration-300 active:translate-y-px active:bg-c-barkSoft"
      aria-label="打开导航">
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- 桌面端侧边栏（固定）：用 1px 描边分区，不用阴影——纸感的做法 -->
    <aside class="hidden md:block fixed left-0 top-0 bottom-0 w-56 z-40 bg-c-cream border-r border-c-line">
      <GroupedSidebar :nav="NAV" :dot="dot" :version="version" />
    </aside>

    <!-- 移动端抽屉 -->
    <div v-if="drawerOpen" class="md:hidden fixed inset-0 z-40">
      <div class="absolute inset-0 bg-c-ink/25" @click="drawerOpen = false" />
      <aside class="relative w-56 h-full bg-c-cream border-r border-c-line">
        <GroupedSidebar :nav="NAV" :dot="dot" :version="version" @navigate="drawerOpen = false" />
      </aside>
    </div>

    <!-- 主区：内边距统一在这里给，各 view 不再各写一套 -->
    <main class="md:ml-56 min-w-0 min-h-screen px-6 md:px-10 py-10">
      <RouterView />
    </main>

    <!-- 全局提示 / 确认框（替代 Arco Message + Modal） -->
    <ToastHost />

    <!-- 微信引流弹层：侧边栏底部的「加微信」胶囊打开它。
         做成全局宿主而不是塞进某个页面，是因为入口不止一处，
         而且它得盖在任何页面之上。 -->
    <WeChatHost />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import { backendInfo, probeBackend } from './api/backend'
import { useReadiness } from './utils/readiness'
import { CURRENT_VERSION } from './data/changelog'
import GroupedSidebar from './components/GroupedSidebar.vue'
import ToastHost from './components/ToastHost.vue'
import WeChatHost from './components/WeChatHost.vue'

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
const version = ref(CURRENT_VERSION)

// 批改能否直接用：本机填了 Key，或服务端托管了 Key（桌面版/部署版）
const { ready, probeReadiness } = useReadiness()

onMounted(async () => {
  backendUp.value = await probeBackend()
  await probeReadiness()
  version.value = backendInfo()?.version || CURRENT_VERSION
})

// 一个圆点表达三种状态，避免堆太多指示器
const dot = computed(() => {
  if (backendUp.value) {
    return { color: '#8b9d77', title: '服务端通道已连接：请求经后端转发，无跨域问题' }
  }
  if (ready.value) {
    return { color: '#d4a373', title: '本地直连：已配置 API Key' }
  }
  return { color: '#d6d3d1', title: '尚未配置：请到设置页填写 API' }
})
</script>
