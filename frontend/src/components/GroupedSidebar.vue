<template>
  <div class="h-full flex flex-col">

    <!-- Logo 区：印章 + 纸背层次，撑起"这是一支写申论的笔"的辨识度 -->
    <RouterLink to="/" class="block px-4 pt-6 pb-5 shrink-0 border-b border-c-line group">
      <div class="flex items-center gap-3">
        <!-- 印章：后面垫一张微旋的纸，做出叠纸的厚度感 -->
        <div class="relative w-12 h-12 shrink-0">
          <div class="absolute inset-0 rounded-[1.1rem] bg-c-barkSoft rotate-6
            transition-transform duration-500 ease-in-out group-hover:rotate-12" />
          <div class="relative w-12 h-12 rounded-[1.1rem] bg-c-bark
            flex items-center justify-center text-c-cream
            font-serif text-xl leading-none ring-1 ring-white/20
            shadow-[0_3px_10px_rgba(92,64,51,0.22)]">
            笔
          </div>
        </div>

        <div class="min-w-0 flex-1">
          <div class="font-serif font-semibold text-lg text-c-ink leading-tight tracking-tight">
            蓝笔申论
          </div>
          <div class="text-xs text-c-muted mt-1">申论 AI 批改</div>
        </div>
      </div>

      <div class="flex items-center gap-2 mt-3.5">
        <span class="text-[10px] tnum px-2 py-0.5 rounded-full bg-c-barkSoft text-c-bark leading-4">
          v{{ version }}
        </span>
        <span class="text-[10px] text-c-muted leading-4">本地存储 · 五位老师</span>
      </div>
    </RouterLink>

    <!-- 分组导航 -->
    <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      <div v-for="g in groups" :key="g.title">
        <div class="px-3 mb-2 text-[11px] font-medium text-c-muted tracking-widest">{{ g.title }}</div>
        <div class="space-y-1">
          <RouterLink v-for="item in g.items" :key="item.path" :to="item.path"
            @click="emit('navigate')"
            class="flex items-center px-3.5 py-2.5 rounded-full text-sm
              transition-colors duration-300 ease-in-out"
            :class="isActive(item.path)
              ? 'bg-c-barkSoft text-c-bark font-medium'
              : 'text-c-body hover:bg-c-barkSoft/60'">
            {{ item.label }}
          </RouterLink>
        </div>
      </div>
    </nav>

    <!-- 底部：开源入口 + 设置 + 作者水印 -->
    <div class="px-3 py-4 border-t border-c-line space-y-2 shrink-0">

      <!-- 微信入口：单占一行。四个胶囊并排的话每个只剩 ~45px，
           "GitHub" 都塞不下，所以它自己一行、用整行按钮。
           图标带微信绿是刻意的——这个绿是识别色（像老师色标），不参与主题换肤。 -->
      <button @click="openWeChat()" title="加作者微信 / 进交流群"
        class="w-full h-7 rounded-lg border border-c-line flex items-center justify-center gap-1.5
          text-[11px] text-c-muted leading-none transition-colors duration-300 ease-in-out
          hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent">
        <svg class="w-3.5 h-3.5 shrink-0" style="color: #07c160" viewBox="0 0 24 24"
          fill="currentColor" aria-hidden="true">
          <path d="M9.1 3C5.2 3 2 5.7 2 9c0 1.9 1 3.6 2.7 4.7l-.7 2.2 2.5-1.3c.6.2 1.3.3 2 .3h.5c-.1-.4-.2-.9-.2-1.4 0-3 2.9-5.4 6.5-5.4h.5C15.1 5.4 12.4 3 9.1 3zM6.7 7.6a.9.9 0 110-1.8.9.9 0 010 1.8zm4.8 0a.9.9 0 110-1.8.9.9 0 010 1.8z"/>
          <path d="M22 13.5c0-2.7-2.7-4.9-6-4.9s-6 2.2-6 4.9 2.7 4.9 6 4.9c.7 0 1.4-.1 2-.3l2.1 1.1-.6-1.8c1.5-.9 2.5-2.3 2.5-3.9zm-8-1.2a.8.8 0 110-1.6.8.8 0 010 1.6zm4 0a.8.8 0 110-1.6.8.8 0 010 1.6z"/>
        </svg>
        <span>加微信 / 交流群</span>
      </button>

      <!-- 开源入口：GitHub / Gitee / 更新日志。
           放侧边栏而不是首页页脚 —— 这是"关于这个项目"的信息，任何时候都该够得着，
           不该只在首页出现。三个挤在 200px 里，所以用等宽小胶囊而不是大按钮。 -->
      <div class="flex items-center gap-1.5 px-0.5">
        <a :href="AUTHOR.github" target="_blank" rel="noopener" title="GitHub 仓库"
          class="flex-1 h-7 rounded-lg border border-c-line flex items-center justify-center gap-1
            text-[11px] text-c-muted leading-none transition-colors duration-300 ease-in-out
            hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.4-.5-1.7.1-3.5 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.8.3 3.1.1 3.5.8.8 1.2 1.9 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/>
          </svg>
          <span>GitHub</span>
        </a>

        <a :href="AUTHOR.gitee" target="_blank" rel="noopener" title="Gitee 仓库"
          class="flex-1 h-7 rounded-lg border border-c-line flex items-center justify-center gap-1
            text-[11px] text-c-muted leading-none transition-colors duration-300 ease-in-out
            hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 00-.9-2.6c3.1-.4 6.4-1.5 6.4-7A5.4 5.4 0 0020 4.8 5.1 5.1 0 0019.9 1S18.7.7 16 2.5a13.4 13.4 0 00-7 0C6.3.7 5.1 1 5.1 1A5.1 5.1 0 005 4.8a5.4 5.4 0 00-1.5 3.7c0 5.4 3.3 6.6 6.4 7A3.4 3.4 0 009 18.1V22"/>
          </svg>
          <span>Gitee</span>
        </a>

        <RouterLink to="/changelog" @click="emit('navigate')" title="更新日志"
          class="flex-1 h-7 rounded-lg border border-c-line flex items-center justify-center gap-1
            text-[11px] text-c-muted leading-none transition-colors duration-300 ease-in-out
            hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent"
          :class="route.path.startsWith('/changelog') ? 'bg-c-barkSoft text-c-bark border-transparent' : ''">
          <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
          </svg>
          <span>日志</span>
        </RouterLink>
      </div>

      <RouterLink to="/settings"
        @click="emit('navigate')"
        class="flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm
          transition-colors duration-300 ease-in-out"
        :class="route.path.startsWith('/settings')
          ? 'bg-c-barkSoft text-c-bark font-medium'
          : 'text-c-body hover:bg-c-barkSoft/60'">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.68 15a1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
        <span class="flex-1">设置</span>
        <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: dot.color }" :title="dot.title" />
      </RouterLink>

      <!-- 作者水印：小、但一直在。title 里给全量信息（邮箱 + 两个仓库）。 -->
      <div class="px-3.5 pt-0.5 text-[10px] leading-4 text-c-muted truncate cursor-default"
        :title="AUTHOR_LINE">
        {{ AUTHOR_SHORT }}
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { AUTHOR, AUTHOR_LINE, AUTHOR_SHORT } from '../data/author'
import { openWeChat } from '../utils/wechatPanel'

const props = defineProps({
  nav: { type: Array, required: true },     // 含 group 字段的导航数组
  dot: { type: Object, required: true },    // { color, title }
  version: { type: String, default: '0.2.0' },
})

const emit = defineEmits(['navigate'])

const route = useRoute()

// 把扁平数组按 group 字段折叠成分组结构
const groups = computed(() => {
  const map = new Map()
  for (const item of props.nav) {
    if (!map.has(item.group)) map.set(item.group, [])
    map.get(item.group).push(item)
  }
  return [...map.entries()].map(([title, items]) => ({ title, items }))
})

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>
