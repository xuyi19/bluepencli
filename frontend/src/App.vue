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
import { attachDesktopSession } from './utils/desktopSession'
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
  // 考场模式独立入口（2026-09-24）：与练习批改同一组件，路由决定形态。
  // 分开的理由：一个是"随时批改随时看答案"的日常消化，一个是"计时交卷"的节奏训练，
  // 混在一个页面的切换里，用户找不到、也容易在考试时顺手点开答案。
  { group: '实战', path: '/exam', label: '考场模式' },
  // 分组名与条目名不能同名：分组头也是"复盘"，条目再叫"复盘"，
  // 侧边栏会出现两行一模一样的字，看着像重复项。
  { group: '复盘', path: '/records', label: '历史批改' },
  { group: '复盘', path: '/stats', label: '统计' },
  { group: '复盘', path: '/weakness', label: '错题本' },
  // 「更新日志」曾经只做侧边栏底部那排小胶囊（和 GitHub/Gitee 三等分，61×28px）。
  // 那排胶囊间隙只有 6px，点偏一点就落进缝里，症状是"点了没反应"——
  // 被当成"页面坏了"报过。日志是用户会主动去翻的入口，给它一个正常尺寸的条目。
  { group: '关于', path: '/changelog', label: '更新日志' },
]

const backendUp = ref(false)
const drawerOpen = ref(false)
const version = ref(CURRENT_VERSION)

// 批改能否直接用：本机填了 Key，或服务端托管了 Key（桌面版/部署版）
const { ready, probeReadiness } = useReadiness()

onMounted(async () => {
  backendUp.value = await probeBackend()
  // 桌面版专属：注册本页会话，页面全关时后端自动退出。非桌面版这里空转。
  attachDesktopSession(backendInfo())
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
