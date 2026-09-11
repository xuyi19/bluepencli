<template>
  <div class="h-full flex flex-col">

    <!-- Logo：棕底米字的印章感，比拟态方块更贴"纸笔"意象 -->
    <RouterLink to="/" class="px-5 pt-6 pb-5 flex items-center gap-3 shrink-0">
      <div class="w-11 h-11 rounded-2xl bg-c-bark
        flex items-center justify-center text-c-cream font-serif text-lg shadow-[0_2px_8px_rgba(92,64,51,0.18)]">
        笔
      </div>
      <div class="min-w-0">
        <div class="font-serif font-semibold text-base text-c-ink leading-tight tracking-tight">蓝笔申论</div>
        <div class="text-[10px] text-c-muted mt-1 tnum">v0.2.0</div>
      </div>
    </RouterLink>

    <!-- 分组导航 -->
    <nav class="flex-1 overflow-y-auto px-3 py-2 space-y-6">
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

    <!-- 底部：设置 + 状态点 -->
    <div class="px-3 py-4 border-t border-c-line space-y-1 shrink-0">
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
    </div>

  </div>
</template>

<script setup>
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const props = defineProps({
  nav: { type: Array, required: true },     // 含 group 字段的导航数组
  dot: { type: Object, required: true },    // { color, title }
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
