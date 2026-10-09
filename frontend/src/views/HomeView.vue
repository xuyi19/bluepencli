<template>
  <div class="w-full max-w-6xl">

    <!-- 首屏 hero：一句话说清这个工具和别的 AI 批改的分界（不是多一层包装，是模拟一场阅卷）。
         M1 之后这页是"工作台"，hero 收窄成一行标语 + 主行动，把首屏让给今日任务。 -->
    <section class="mb-8">
      <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full neu-sm text-xs text-c-muted mb-4">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="9" cy="8" r="3.2" /><circle cx="16.5" cy="9.5" r="2.6" />
          <path d="M3 19c0-3.2 2.7-5 6-5s6 1.8 6 5" /><path d="M16.5 14.5c2.6.2 4.5 1.8 4.5 4.5" />
        </svg>
        五位老师圆桌合议 · 数据存本机 · 无需注册
      </div>
      <h1 class="font-serif text-3xl md:text-4xl font-semibold text-c-ink leading-tight tracking-tight">
        申论批改，<span class="text-c-bark">不该只有一个分数</span>
      </h1>
      <p class="text-sm text-c-muted mt-3 leading-7 max-w-xl">
        五位老师各按自己的方法论独立阅卷，分歧自动复核、圆桌合议；每个分数都给得出依据。
      </p>
      <div class="flex flex-wrap items-center gap-3 mt-5">
        <RouterLink to="/practice"
          class="px-6 py-3 rounded-full text-sm font-medium text-c-cream bg-c-bark
            shadow-[0_4px_14px_rgba(92,64,51,0.28)] hover:translate-y-px transition-all duration-300">
          开始批改
        </RouterLink>
        <RouterLink to="/guide"
          class="inline-flex items-center gap-1.5 px-5 py-3 rounded-full text-sm font-medium text-c-body
            neu-sm hover:text-c-bark hover:translate-y-px transition-all duration-300">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            <path d="M9 7h7M9 11h5" />
          </svg>
          使用文档
        </RouterLink>
      </div>
    </section>

    <!-- ==================== M1 学习中心 · 今日工作台 ====================
         三张状态卡（倒计时/打卡/画像）+ 三张任务卡（练一题/精读一则/积累一组）。
         铁律：状态与真实数据一致——做完的任务不假装没做，没数据的明说没数据。 -->
    <section data-testid="workbench" class="mb-10">
      <div class="flex items-baseline justify-between mb-4">
        <h2 class="text-sm font-medium text-c-body">今日工作台</h2>
        <span class="text-xs text-c-muted tnum">{{ todayLabel }}</span>
      </div>

      <!-- 状态行：倒计时 / 打卡 / 画像 -->
      <div class="grid md:grid-cols-3 gap-4 mb-4">
        <!-- 备考倒计时：没设日期不显示倒计时（不编造）；只存本机 -->
        <div data-testid="countdown-card" class="rounded-2xl p-5 neu">
          <div class="text-xs text-c-muted mb-2">备考倒计时</div>
          <template v-if="countdown === null">
            <div class="flex items-center gap-2">
              <input v-model="examInput" type="date"
                class="px-2.5 py-1.5 rounded-xl text-xs neu-inset outline-none text-c-body tnum" />
              <button @click="saveExamDate"
                class="px-3 py-1.5 rounded-xl text-xs font-medium neu-sm text-c-bark hover:translate-y-px transition-transform">
                设目标
              </button>
            </div>
            <p class="text-[11px] text-c-muted mt-2 leading-4">
              填考试日期，每天打开先看还剩几天。只存本机，随时可改。
            </p>
          </template>
          <template v-else>
            <div class="flex items-baseline gap-2">
              <span class="text-3xl font-semibold tnum"
                :class="countdown >= 0 ? 'text-c-ink' : 'text-c-muted'">
                {{ countdown > 0 ? `D-${countdown}` : (countdown === 0 ? '就是今天' : `已过 ${-countdown} 天`) }}
              </span>
            </div>
            <div class="text-xs text-c-muted tnum mt-1">{{ examDate }}</div>
            <div class="flex items-center gap-3 mt-2">
              <button @click="examInput = examDate" class="text-[11px] text-c-muted hover:text-c-bark">改日期</button>
              <button @click="clearExamDate" class="text-[11px] text-c-muted hover:text-c-bark">清除</button>
            </div>
          </template>
        </div>

        <!-- 打卡连击：练习/精读/收藏任一都算一天；今天没做不断签（从昨天起算） -->
        <div data-testid="streak-card" class="rounded-2xl p-5 neu">
          <div class="text-xs text-c-muted mb-1">连续打卡</div>
          <div class="flex items-baseline gap-1">
            <span class="text-3xl font-semibold tnum text-c-ink">{{ streak }}</span>
            <span class="text-sm text-c-muted">天</span>
          </div>
          <div class="flex flex-wrap gap-1 mt-3" data-testid="streak-dots">
            <span v-for="d in last14" :key="d.key" :title="d.key"
              class="w-2.5 h-2.5 rounded-full"
              :style="d.active ? 'background:#5c8a64' : (d.isToday ? 'background:#ddd5c7' : 'background:#ece7de')" />
          </div>
          <p class="text-[11px] text-c-muted mt-2 leading-4">练一题 / 精读一则 / 收藏一条，任一都算打卡。</p>
        </div>

        <!-- 画像速览：样本不足就明说，不硬画 -->
        <div data-testid="profile-glance" class="rounded-2xl p-5 neu">
          <div class="text-xs text-c-muted mb-2">能力画像</div>
          <template v-if="profile.ready">
            <div class="space-y-1.5">
              <div v-for="d in profile.dimensions" :key="d.id" class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-[11px] text-c-muted truncate">{{ d.label }}</span>
                <div class="flex-1 h-1.5 rounded-full" style="background:#ece7de">
                  <div class="h-full rounded-full" :style="{ width: (d.score ?? 0) + '%', background: '#8a9a6b' }" />
                </div>
                <span class="w-8 text-right text-[11px] tnum text-c-muted">{{ d.score ?? '—' }}</span>
              </div>
            </div>
            <p v-if="weakest" class="text-[11px] mt-2" style="color:#8b6d4b">
              先补：{{ weakest.label }}（{{ weakest.score }}）
            </p>
            <RouterLink to="/stats" class="text-[11px] text-c-muted hover:text-c-bark">看完整画像 →</RouterLink>
          </template>
          <template v-else>
            <p class="text-xs text-c-muted leading-5">
              批改满 {{ profile.need + (profile.recordCount || 0) }} 篇后出画像——样本不够不硬编。
            </p>
            <RouterLink to="/practice" class="text-[11px] text-c-muted hover:text-c-bark">先去练一篇 →</RouterLink>
          </template>
        </div>
      </div>

      <!-- 任务行：练一题 / 精读一则 / 积累一组（点击直达，状态真实） -->
      <div class="grid sm:grid-cols-3 gap-4">
        <!-- 练一题（原「今日一练」折进来） -->
        <div data-testid="task-practice" class="rounded-2xl p-5 neu flex flex-col">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:#f2ebe2;color:#5c4033">练一题</span>
            <span v-if="tasks.practice.done" class="text-[11px]" style="color:#4f7d5e">✓ 已练 {{ tasks.practice.count }} 次</span>
          </div>
          <template v-if="todayQ">
            <div class="flex-1">
              <div class="text-sm text-c-body leading-6 line-clamp-2">{{ todayQ.title }}</div>
              <div class="text-[11px] text-c-muted mt-1.5 tnum">
                {{ todayQ.exam }}<template v-if="todayQ.maxScore"> · {{ todayQ.maxScore }} 分</template>
              </div>
            </div>
            <RouterLink :to="`/practice?questionId=${todayQ.id}`"
              class="mt-3 inline-flex justify-center px-4 py-2.5 rounded-xl text-xs font-medium text-c-cream bg-c-bark">
              {{ tasks.practice.done ? '再练一遍' : '开始今日一练' }}
            </RouterLink>
          </template>
          <template v-else>
            <div class="flex-1 text-xs text-c-muted leading-5">题库是空的——先去题库看看。</div>
            <RouterLink to="/questions"
              class="mt-3 inline-flex justify-center px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
              去题库
            </RouterLink>
          </template>
        </div>

        <!-- 精读一则 -->
        <div data-testid="task-read" class="rounded-2xl p-5 neu flex flex-col">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:#e8ecdf;color:#3d5a7a">精读一则</span>
            <span v-if="tasks.read.done" class="text-[11px]" style="color:#4f7d5e">✓ 已读 {{ tasks.read.count }} 则</span>
          </div>
          <div class="flex-1 text-xs text-c-muted leading-5">
            在材料里划出「要点句」，对照采分点看找点正确率——分数一半在动笔之前。
          </div>
          <RouterLink to="/read"
            class="mt-3 inline-flex justify-center px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
            {{ tasks.read.done ? '再读一则' : '去精读' }}
          </RouterLink>
        </div>

        <!-- 积累一组 -->
        <div data-testid="task-lexicon" class="rounded-2xl p-5 neu flex flex-col">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:#f7eddc;color:#9c6b2f">积累一组</span>
            <span v-if="tasks.lexicon.done" class="text-[11px]" style="color:#4f7d5e">✓ 已收 {{ tasks.lexicon.count }} 条</span>
          </div>
          <div class="flex-1 text-xs text-c-muted leading-5">
            从规范词库收藏一组表述；导出打印就是随身小册子。
          </div>
          <RouterLink to="/lexicon"
            class="mt-3 inline-flex justify-center px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
            {{ tasks.lexicon.done ? '再收一组' : '去词库' }}
          </RouterLink>
        </div>
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
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <button @click="openWeChat()"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
              text-c-body neu-sm hover:text-c-bark transition-colors duration-300">
            <svg class="w-3.5 h-3.5 shrink-0" style="color: #07c160" viewBox="0 0 24 24"
              fill="currentColor" aria-hidden="true">
              <path d="M9.1 3C5.2 3 2 5.7 2 9c0 1.9 1 3.6 2.7 4.7l-.7 2.2 2.5-1.3c.6.2 1.3.3 2 .3h.5c-.1-.4-.2-.9-.2-1.4 0-3 2.9-5.4 6.5-5.4h.5C15.1 5.4 12.4 3 9.1 3zM6.7 7.6a.9.9 0 110-1.8.9.9 0 010-1.8zm4.8 0a.9.9 0 110-1.8.9.9 0 010-1.8z"/>
              <path d="M22 13.5c0-2.7-2.7-4.9-6-4.9s-6 2.2-6 4.9 2.7 4.9 6 4.9c.7 0 1.4-.1 2-.3l2.1 1.1-.6-1.8c1.5-.9 2.5-2.3 2.5-3.9zm-8-1.2a.8.8 0 110-1.6.8.8 0 010-1.6zm4 0a.8.8 0 110-1.6.8.8 0 010-1.6z"/>
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
import { pickDaily } from '../data/daily'
import { buildProfile, weakestDimension } from '../utils/grading/profile'
import {
  EXAM_DATE_KEY, dayKey, daysUntil, loadReadResults, loadFavTimes,
  activityDays, calcStreak, lastNDays, taskStatus,
} from '../utils/workbench'
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
const readResults = ref([])
const favTimes = ref({})
const examDate = ref('')
const examInput = ref('')

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

/** 设目标日期：非法输入不写盘（daysUntil 返回 null 就是格式不对） */
function saveExamDate() {
  const v = (examInput.value || '').trim()
  const n = daysUntil(v)
  if (n === null) {
    toast.warning('日期格式不对，用日期选择器选一下就好')
    return
  }
  examDate.value = v
  try { localStorage.setItem(EXAM_DATE_KEY, v) } catch { /* 存不下不拦流程 */ }
}
function clearExamDate() {
  examDate.value = ''
  examInput.value = ''
  try { localStorage.removeItem(EXAM_DATE_KEY) } catch { /* 同上 */ }
}

const countdown = computed(() => (examDate.value ? daysUntil(examDate.value) : null))

/** 打卡：三源并集 → 连击 + 近 14 天点阵 */
const activity = computed(() => activityDays({
  records: records.value,
  readResults: readResults.value,
  favTimes: favTimes.value,
}))
const streak = computed(() => calcStreak(activity.value))
const last14 = computed(() => lastNDays(activity.value, 14))

/** 三任务卡状态（纯派生，诚实） */
const tasks = computed(() => taskStatus({
  records: records.value,
  readResults: readResults.value,
  favTimes: favTimes.value,
}))

/** 画像速览（buildProfile 有 MIN_RECORDS 门槛，不足时 ready=false） */
const profile = computed(() => buildProfile(records.value))
const weakest = computed(() => weakestDimension(profile.value))

const ACTIONS = [
  {
    path: '/practice',
    title: '练习批改',
    desc: '先把题答完，再交给老师批改；不同老师用不同颜色标出问题',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  },
  {
    path: '/exam',
    title: '考场模式',
    desc: '落笔即计时，时间到自动交卷 —— 按真实考场练节奏，作答用时记进报告',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>',
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
  readResults.value = loadReadResults()
  favTimes.value = loadFavTimes()
  try {
    const saved = localStorage.getItem(EXAM_DATE_KEY)
    if (saved && daysUntil(saved) !== null) {
      examDate.value = saved
      examInput.value = saved
    }
  } catch { /* 读不到就当没设过 */ }
})
</script>
