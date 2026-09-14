<template>
  <div class="w-full max-w-6xl">

    <section class="mb-8">
      <h1 class="font-serif text-2xl font-semibold text-c-ink">蓝笔申论</h1>
      <p class="text-sm text-c-muted mt-2 leading-6">
        每日一练 → 五位老师按申论标准批改 → 记录归档到本机 docs，随时复盘<br />
        所有数据存在本机，只有批改那一刻才联网
      </p>
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
            <span v-if="todayQ.kind" class="text-xs px-1.5 py-0.5 rounded"
              :style="todayQ.kind === '真题' ? 'background:#f7eddc;color:#9c6b2f' : 'background:#f2ebe2;color:#78716c'">
              {{ todayQ.kind }}</span>
            <span v-if="doneToday" class="text-xs" style="color: #4f7d5e">✓ 今天已经练过一次</span>
          </div>
          <h2 class="font-serif text-lg md:text-xl text-c-ink leading-8">{{ todayQ.title }}</h2>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-c-muted mt-3.5">
            <span>{{ todayQ.exam }}</span>
            <span class="tnum">满分 {{ todayQ.maxScore }}</span>
            <span v-if="todayQ.wordLimit" class="tnum">≤ {{ todayQ.wordLimit }} 字</span>
            <span v-if="todayQ.difficulty">{{ DIFFICULTY_LABEL[todayQ.difficulty] }}</span>
          </div>        </div>
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

    <!-- 作者与开源：GitHub / Gitee / 更新日志三个入口已经**常驻到左侧边栏底部**
         （那里任何页面都够得着，首页页脚只有一个页面能看到）。
         这里只留"谁做的、怎么联系、什么许可"——页面末段该有的收尾信息。 -->
    <section data-testid="repo-links" class="rounded-2xl p-5 md:p-6 neu-sm mb-4">
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div class="min-w-0">
          <div class="text-sm font-medium text-c-body">
            {{ APP_NAME }}
            <span class="text-c-muted font-normal tnum">v{{ CURRENT_VERSION }}</span>
          </div>
          <p class="text-xs text-c-muted mt-1.5 leading-5">
            {{ APP_SLOGAN }}。作者 <span class="text-c-body">{{ AUTHOR.name }}</span>
            <span class="mx-1.5 opacity-50">·</span>
            <a :href="`mailto:${AUTHOR.email}`" class="hover:text-c-bark transition-colors">{{ AUTHOR.email }}</a>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <!-- 微信入口：二维码在弹层里。首页不摊大图 —— 这页是"开始做事"的地方，
               联系方式够得着就行，别抢主视觉。 -->
          <button @click="openWeChat()"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-3.5 h-3.5 shrink-0" style="color: #07c160" viewBox="0 0 24 24"
              fill="currentColor" aria-hidden="true">
              <path d="M9.1 3C5.2 3 2 5.7 2 9c0 1.9 1 3.6 2.7 4.7l-.7 2.2 2.5-1.3c.6.2 1.3.3 2 .3h.5c-.1-.4-.2-.9-.2-1.4 0-3 2.9-5.4 6.5-5.4h.5C15.1 5.4 12.4 3 9.1 3zM6.7 7.6a.9.9 0 110-1.8.9.9 0 010 1.8zm4.8 0a.9.9 0 110-1.8.9.9 0 010 1.8z"/>
              <path d="M22 13.5c0-2.7-2.7-4.9-6-4.9s-6 2.2-6 4.9 2.7 4.9 6 4.9c.7 0 1.4-.1 2-.3l2.1 1.1-.6-1.8c1.5-.9 2.5-2.3 2.5-3.9zm-8-1.2a.8.8 0 110-1.6.8.8 0 010 1.6zm4 0a.8.8 0 110-1.6.8.8 0 010 1.6z"/>
            </svg>
            加微信 / 交流群
          </button>

          <a :href="AUTHOR.openSource" target="_blank" rel="noopener" title="开源地址"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>
            </svg>
            开源地址
          </a>
          <span class="text-xs text-c-muted tnum">{{ AUTHOR.license }}</span>
          <button @click="onCopyStamp"
            class="text-xs text-c-muted hover:text-c-bark transition-colors duration-300">
            复制联系方式
          </button>
        </div>
      </div>
    </section>

    <section v-if="!hasKey" data-testid="setup-hint" class="rounded-2xl p-6 neu-sm">
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
import { DIFFICULTY_LABEL } from '../data/builtin-questions'
import { BUILTIN_POOL, REAL_EXAMS, SIM_QUESTIONS } from '../data/questions'
import { pickDaily, practicedToday } from '../data/daily'
import { APP_NAME, APP_SLOGAN } from '../data/site'
import { AUTHOR } from '../data/author'
import { CURRENT_VERSION } from '../data/changelog'
import { useReadiness } from '../utils/readiness'
import { toast } from '../utils/toast'
import { copyAuthorLine } from '../utils/watermark'
import { openWeChat } from '../utils/wechatPanel'

const records = ref([])
const mine = ref([])
const todayQ = ref(null)
const doneToday = ref(false)

const { ready: hasKey, probeReadiness } = useReadiness()

const pool = computed(() => [...mine.value, ...BUILTIN_POOL])

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
})

/** 反馈问题时把作者联系方式一并复制走，省得对方还要回来找 */
async function onCopyStamp() {
  const ok = await copyAuthorLine()
  if (ok) toast.success('已复制作者联系方式')
  else toast.warning('浏览器不允许自动复制，请手动记录')
}

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
    desc: `${REAL_EXAMS.length} 套国考真题＋${SIM_QUESTIONS.length} 道仿真题，每题都有完整材料与参考答案`,
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
  // kind 只在缺失时补「自建」，不覆盖导入题库包带的「私有」（同 PracticeView）
  mine.value = (await getAll(STORES.questions)).map((q) => ({ kind: '自建', ...q }))
  todayQ.value = pickDaily(pool.value)
  records.value = await listAllRecords()
  doneToday.value = practicedToday(records.value)
})
</script>
