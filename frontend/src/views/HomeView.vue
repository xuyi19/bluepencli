<template>
  <div class="w-full max-w-6xl">

    <!-- 标题 + 仓库入口：日志/仓库不放侧边栏，避免导航被工具链接冲淡 -->
    <section class="mb-8">
      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div class="min-w-0">
          <h1 class="font-serif text-2xl font-semibold text-c-ink">蓝笔申论</h1>
          <p class="text-sm text-c-muted mt-2 leading-6">
            每日一练 → 五位老师按申论标准批改 → 记录归档到本机 docs，随时复盘<br />
            所有数据存在本机，只有批改那一刻才联网
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <a :href="REPO.github" target="_blank" rel="noopener" title="GitHub 仓库"
            class="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.4-.5-1.7.1-3.5 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.8.3 3.1.1 3.5.8.8 1.2 1.9 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/>
            </svg>
            GitHub
          </a>

          <a :href="REPO.gitee" target="_blank" rel="noopener" title="Gitee 仓库"
            class="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 00-.9-2.6c3.1-.4 6.4-1.5 6.4-7A5.4 5.4 0 0020 4.8 5.1 5.1 0 0019.9 1S18.7.7 16 2.5a13.4 13.4 0 00-7 0C6.3.7 5.1 1 5.1 1A5.1 5.1 0 005 4.8a5.4 5.4 0 00-1.5 3.7c0 5.4 3.3 6.6 6.4 7A3.4 3.4 0 009 18.1V22"/>
            </svg>
            Gitee
          </a>

          <RouterLink to="/changelog" title="更新日志"
            class="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
            </svg>
            更新日志
            <span class="text-c-muted tnum">{{ currentVersion }}</span>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- 今日一练：首页最显眼的位置，进来就能开始 -->
    <section v-if="todayQ" class="rounded-2xl p-6 md:p-7 neu mb-8">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span class="px-2.5 py-1 rounded-full text-xs font-medium"
              style="background: #f2ebe2; color: #5c4033">今日一练</span>
            <span class="text-xs text-c-muted tnum">{{ todayLabel }}</span>
            <span class="text-xs px-1.5 py-0.5 rounded"
              style="background: #e8ecdf; color: #3d5a7a">{{ todayQ.type }}</span>
            <span v-if="doneToday" class="text-xs" style="color: #4f7d5e">✓ 今天已经练过一次</span>
          </div>
          <h2 class="font-serif text-lg md:text-xl text-c-ink leading-8">{{ todayQ.title }}</h2>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-c-muted mt-3.5">
            <span>{{ todayQ.exam }}</span>
            <span class="tnum">满分 {{ todayQ.maxScore }}</span>
            <span v-if="todayQ.wordLimit" class="tnum">≤ {{ todayQ.wordLimit }} 字</span>
            <span v-if="todayQ.difficulty">{{ DIFFICULTY_LABEL[todayQ.difficulty] }}</span>
          </div>
        </div>
        <RouterLink :to="`/practice?questionId=${todayQ.id}`"
          class="shrink-0 px-6 py-3 rounded-full text-sm font-medium text-c-cream
            bg-c-bark transition-colors duration-300">
          {{ doneToday ? '再练一遍' : '开始今日一练' }}
        </RouterLink>
      </div>
    </section>

    <section class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
      <div v-for="s in stats" :key="s.label" class="rounded-2xl p-5 neu">
        <div class="text-xs text-c-muted mb-2">{{ s.label }}</div>
        <div class="text-2xl font-semibold tnum text-c-ink">{{ s.value }}</div>
        <div class="text-xs text-c-muted mt-1">{{ s.hint }}</div>
      </div>
    </section>

    <section class="mb-10">
      <h2 class="text-sm font-medium text-c-body mb-4">开始</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RouterLink v-for="a in ACTIONS" :key="a.path" :to="a.path"
          class="rounded-2xl p-5 neu-sm group transition-all duration-300
            hover:translate-y-px">
          <div class="w-10 h-10 rounded-xl neu-inset flex items-center justify-center mb-3 text-c-bark">
            <span v-html="a.icon" />
          </div>
          <div class="text-sm font-medium text-c-body group-hover:text-c-bark transition-colors">
            {{ a.title }}
          </div>
          <div class="text-xs text-c-muted mt-1.5 leading-5">{{ a.desc }}</div>
        </RouterLink>
      </div>
    </section>

    <section v-if="recent.length" class="mb-10">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-medium text-c-body">最近练习</h2>
        <RouterLink to="/records" class="text-xs text-c-muted hover:text-c-bark">全部 →</RouterLink>
      </div>
      <div class="rounded-2xl neu overflow-hidden">
        <div v-for="(r, i) in recent" :key="r.id" class="px-5 py-4 flex items-center gap-4"
          :class="i ? 'border-t border-c-line' : ''">
          <ScoreRing :score="r.finalScore" :max="r.maxScore || 40" :size="44" :stroke="5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm text-c-body truncate">{{ r.title || '未命名练习' }}</div>
            <div class="text-xs text-c-muted mt-0.5 tnum">
              {{ fmtDateTime(r.createdAt) }} · {{ r.wordCount }} 字
            </div>
          </div>
          <RouterLink :to="`/records?id=${r.id}`"
            class="text-xs text-c-muted hover:text-c-bark shrink-0">复盘</RouterLink>
        </div>
      </div>
    </section>

    <section v-if="!hasKey" class="rounded-2xl p-6 neu-sm">
      <div class="text-sm font-medium text-c-body mb-2">还差一步</div>
      <p class="text-xs text-c-muted leading-6 mb-4">
        批改需要用你自己的大模型 API。到设置页填 API 地址、Key 和模型名即可，配置只存在本机浏览器里。
      </p>
      <RouterLink to="/settings"
        class="inline-block px-4 py-2 rounded-xl text-xs font-medium neu text-c-bark">
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
import { getAll, STORES } from '../store/db'
import { BUILTIN_QUESTIONS, DIFFICULTY_LABEL, withPrefix } from '../data/builtin-questions'
import { pickDaily, practicedToday } from '../data/daily'
import { CHANGELOG, REPO } from '../data/site'
import { useReadiness } from '../utils/readiness'

const records = ref([])
const mine = ref([])
const todayQ = ref(null)
const doneToday = ref(false)

const { ready: hasKey, probeReadiness } = useReadiness()

// 更新日志里最新的一版就是当前版本，避免再去问一次后端
const currentVersion = CHANGELOG[0]?.version || ''

const pool = computed(() => [...mine.value, ...BUILTIN_QUESTIONS.map(withPrefix)])

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

const ACTIONS = [
  {
    path: '/practice',
    title: '练习批改',
    desc: '先把题答完，再交给老师批改；不同老师用不同颜色标出问题',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  },
  {
    path: '/questions',
    title: '题库',
    desc: '15 道内置题目，覆盖五种题型，每题都有完整材料与参考答案',
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
  probeReadiness()
  mine.value = (await getAll(STORES.questions)).map((q) => ({ ...q, kind: '自建' }))
  todayQ.value = pickDaily(pool.value)
  records.value = await listAllRecords()
  doneToday.value = practicedToday(records.value)
})
</script>
