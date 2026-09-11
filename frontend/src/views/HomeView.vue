<template>
  <div class="max-w-6xl mx-auto px-6 md:px-8 py-10">

    <section class="mb-10">
      <h1 class="text-2xl font-semibold text-gray-800">蓝笔申论</h1>
      <p class="text-sm text-gray-500 mt-2 leading-6">
        输入作答 → 五位老师按申论标准批改 → 记录归档到本机 docs，随时复盘<br />
        所有数据存在本机，只有批改那一刻才联网
      </p>
    </section>

    <section class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
      <div v-for="s in stats" :key="s.label" class="rounded-2xl p-5 neu">
        <div class="text-xs text-gray-500 mb-2">{{ s.label }}</div>
        <div class="text-2xl font-semibold tnum text-gray-800">{{ s.value }}</div>
        <div class="text-xs text-gray-400 mt-1">{{ s.hint }}</div>
      </div>
    </section>

    <section class="mb-10">
      <h2 class="text-sm font-medium text-gray-700 mb-4">开始</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RouterLink v-for="a in ACTIONS" :key="a.path" :to="a.path"
          class="rounded-2xl p-5 neu-sm group transition-all duration-300
            hover:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]">
          <div class="w-10 h-10 rounded-xl neu-inset flex items-center justify-center mb-3 text-[#6d5dfc]">
            <span v-html="a.icon" />
          </div>
          <div class="text-sm font-medium text-gray-700 group-hover:text-[#6d5dfc] transition-colors">
            {{ a.title }}
          </div>
          <div class="text-xs text-gray-500 mt-1.5 leading-5">{{ a.desc }}</div>
        </RouterLink>
      </div>
    </section>

    <section v-if="recent.length" class="mb-10">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-medium text-gray-700">最近练习</h2>
        <RouterLink to="/records" class="text-xs text-gray-500 hover:text-[#6d5dfc]">全部 →</RouterLink>
      </div>
      <div class="rounded-2xl neu overflow-hidden">
        <div v-for="(r, i) in recent" :key="r.id" class="px-5 py-4 flex items-center gap-4"
          :class="i ? 'border-t border-gray-200' : ''">
          <ScoreRing :score="r.finalScore" :max="r.maxScore || 40" :size="44" :stroke="5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-700 truncate">{{ r.title || '未命名练习' }}</div>
            <div class="text-xs text-gray-400 mt-0.5 tnum">
              {{ fmtDateTime(r.createdAt) }} · {{ r.wordCount }} 字
            </div>
          </div>
          <RouterLink :to="`/records?id=${r.id}`"
            class="text-xs text-gray-400 hover:text-[#6d5dfc] shrink-0">复盘</RouterLink>
        </div>
      </div>
    </section>

    <section v-if="!hasKey" class="rounded-2xl p-6 neu-sm">
      <div class="text-sm font-medium text-gray-700 mb-2">还差一步</div>
      <p class="text-xs text-gray-500 leading-6 mb-4">
        批改需要用你自己的大模型 API。到设置页填 API 地址、Key 和模型名即可，配置只存在本机浏览器里。
      </p>
      <RouterLink to="/settings"
        class="inline-block px-4 py-2 rounded-xl text-xs font-medium neu text-[#6d5dfc]">
        去配置 →
      </RouterLink>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import ScoreRing from '../components/ScoreRing.vue'
import { listAllRecords, fmtDateTime } from '../utils/record'
import { hasApiKey } from '../api/llm'

const records = ref([])
const hasKey = computed(() => hasApiKey())

const ACTIONS = [
  {
    path: '/practice',
    title: '练习批改',
    desc: '先把题答完，再交给老师批改；不同老师用不同颜色标出问题',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  },
  {
    path: '/articles',
    title: '文章库',
    desc: '官媒时评作为练习素材，按主题标签挑题练',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5z"/></svg>',
  },
  {
    path: '/records',
    title: '复盘',
    desc: '回看每次作答与老师的逐句批注，归档在 docs/practice/',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/></svg>',
  },
]

const recent = computed(() => records.value.slice(0, 5))

const stats = computed(() => {
  const list = records.value
  const avg = list.length
    ? (list.reduce((s, r) => s + (r.finalScore || 0) / (r.maxScore || 40), 0) / list.length) * 100
    : 0
  const best = list.length
    ? Math.max(...list.map((r) => (r.finalScore || 0) / (r.maxScore || 40))) * 100
    : 0
  const archived = list.filter((r) => r.source === 'docs' || r.source === 'both').length
  return [
    { label: '累计练习', value: list.length, hint: '篇' },
    { label: '平均得分率', value: avg.toFixed(0) + '%', hint: '越低越有提升空间' },
    { label: '最佳成绩', value: best.toFixed(0) + '%', hint: '历史最高' },
    { label: '已归档', value: archived, hint: '篇存入 docs' },
  ]
})

onMounted(async () => {
  records.value = await listAllRecords()
})
</script>
