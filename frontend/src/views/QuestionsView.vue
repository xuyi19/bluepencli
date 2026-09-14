<template>
  <div class="w-full">

    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-c-ink">题库</h1>
        <p class="text-sm text-c-muted mt-1.5">
          国考真题 {{ countBySource('真题') }} 道（{{ REAL_EXAMS.length }} 套）· 仿真 {{ SIM_QUESTIONS.length }} 道 · 自建 {{ mine.length }} 道
          <span class="text-c-muted">· 题型覆盖 {{ coveredTypes }} / 5</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="keyword" type="text" placeholder="搜索题目 / 来源 / 主题"
          class="px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none w-52
            text-c-body placeholder:text-c-muted" />
        <button @click="packInput?.click()" :disabled="importing"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark disabled:opacity-40">
          {{ importing ? '导入中…' : '导入题库包' }}
        </button>
        <button @click="showImport = !showImport"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-bark">
          {{ showImport ? '收起录入' : '+ 录入题目' }}
        </button>
        <!-- 一次只能选一个包：分开的包分别导入，避免一次误吞几个来源不明的文件 -->
        <input ref="packInput" type="file" accept=".bpq,application/json,.json"
          class="hidden" @change="onPackFile" />
      </div>
    </div>

    <!-- 诚实说明：真题（公开 / 私有）与仿真分别标明，不混为一谈 -->
    <div class="rounded-2xl px-5 py-4 mb-6 text-xs leading-6"
      style="background: #f7eddc; color: #9c6b2f">
      <strong>真题（{{ REAL_EXAMS.length }} 套）</strong>为 2010–{{ PUBLIC_MAX_YEAR }} 年国考申论卷，
      材料与参考答案由 PDF 自动提取后过质量闸门（分题/字段/分值合计/字数/答案齐全），
      标注「真题」；<strong>仿真</strong>为按真题风格自编的材料，用于快速专项练。
      真题的「给定资料」是整卷共用的，练一题即载入该卷全部材料。
      <template v-if="privateExamCount">
        <br />另有 <strong>{{ privateExamCount }} 套私有真题</strong>（{{ PUBLIC_MAX_YEAR + 1 }} 年起）已通过题库包导入，
        标为「私有」——这些卷不随软件分发，请勿对外转发。
      </template>
      <template v-else>
        <br />{{ PUBLIC_MAX_YEAR + 1 }} 年起的国考卷为<strong>私有题库</strong>，不在软件本体里 ——
        向作者索取题库包后，用右上角「导入题库包」加入即可。
        <button @click="showGetPack = !showGetPack"
          class="ml-1 underline decoration-dotted hover:text-c-bark">
          {{ showGetPack ? '收起' : '怎么获取？' }}
        </button>
      </template>
    </div>

    <!-- 获取私有题库：作者联系方式 + 说明。默认收起，不打扰正常刷题 -->
    <div v-if="showGetPack && !privateExamCount"
      class="rounded-2xl p-5 neu-sm mb-6 text-xs leading-6 text-c-body">
      <div class="font-medium mb-2">获取私有题库包（{{ PUBLIC_MAX_YEAR + 1 }} 年起国考真题）</div>
      <p class="text-c-muted">
        这些卷是人工校准过的私有资产，不随开源版分发。联系作者获取 <code>.bpq</code> 题库包，
        在「导入题库包」里选文件即可入库 —— 材料与参考答案都在包里，导入完就能直接练。
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
        <span>作者 <span class="text-c-ink font-medium">{{ AUTHOR.name }}</span></span>
        <a :href="`mailto:${AUTHOR.email}`" class="hover:text-c-bark">{{ AUTHOR.email }}</a>
        <a :href="AUTHOR.gitee" target="_blank" rel="noopener" class="hover:text-c-bark">Gitee</a>
        <a :href="AUTHOR.github" target="_blank" rel="noopener" class="hover:text-c-bark">GitHub</a>
        <button @click="onCopyStamp" class="hover:text-c-bark">复制联系方式</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="rounded-2xl p-5 neu mb-6">
      <div class="text-xs text-c-muted mb-2.5">按来源</div>
      <div class="flex flex-wrap gap-1.5 mb-4">
        <button @click="sourceFilter = ''"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="!sourceFilter ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          全部
          <span class="tnum opacity-60">{{ pool.length }}</span>
        </button>
        <button v-for="s in SOURCES" :key="s.key" @click="sourceFilter = s.key" :title="s.hint"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="sourceFilter === s.key ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          {{ s.key }}
          <span class="tnum opacity-60">{{ countBySource(s.key) }}</span>
        </button>
      </div>
      <div class="text-xs text-c-muted mb-2.5">按题型</div>
      <div class="flex flex-wrap gap-1.5">
        <button @click="typeFilter = ''"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="!typeFilter ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          全部
          <span class="tnum opacity-60">{{ filteredSource.length }}</span>
        </button>
        <button v-for="t in QUESTION_TYPES" :key="t" @click="typeFilter = t"
          class="px-3 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="typeFilter === t ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body'">
          {{ t }}
          <span class="tnum opacity-60">{{ countByType(t) }}</span>
        </button>
      </div>
    </div>

    <!-- 录入面板 -->
    <div v-if="showImport" class="rounded-2xl p-5 neu mb-6">
      <div class="text-sm font-medium text-c-body mb-1">录入题目</div>
      <div class="text-xs text-c-muted mb-4 leading-5">
        材料与作答要求一起填，练习页才能一键带入完整题目
      </div>
      <div class="space-y-3">
        <textarea v-model="draft.title" rows="2" placeholder="题干"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select v-model="draft.type"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none text-c-body">
            <option value="">题型</option>
            <option v-for="t in QUESTION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="draft.exam" type="text" placeholder="来源"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted" />
          <input v-model.number="draft.maxScore" type="number" placeholder="满分"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted tnum" />
          <input v-model.number="draft.wordLimit" type="number" placeholder="字数"
            class="px-3 py-2.5 rounded-xl text-xs neu-inset outline-none
              text-c-body placeholder:text-c-muted tnum" />
        </div>
        <textarea v-model="draft.requirement" rows="2" placeholder="作答要求"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <textarea v-model="draft.material" rows="8" placeholder="给定资料（建议按「材料1 / 材料2」分行写）"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <textarea v-model="draft.reference" rows="4" placeholder="参考答案 / 范文（选填）"
          class="w-full px-3.5 py-2.5 rounded-xl text-xs neu-inset outline-none resize-none
            text-c-body placeholder:text-c-muted leading-6" />
        <div class="flex gap-2">
          <button @click="saveQuestion" :disabled="!draft.title.trim()"
            class="px-4 py-2 rounded-xl text-xs font-medium neu text-c-bark disabled:opacity-40">
            保存
          </button>
          <button @click="showImport = false"
            class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-muted">取消</button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="filtered.length" class="space-y-3">
      <div v-for="q in filtered" :key="q.id" class="rounded-2xl p-5 neu-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="q.id === dailyId" class="text-xs px-2 py-0.5 rounded-full shrink-0 font-medium"
                style="background: #f2ebe2; color: #5c4033">今日一练</span>
              <span class="text-xs px-1.5 py-0.5 rounded shrink-0 font-medium"
                :style="kindStyle(q)">{{ kindOf(q) }}</span>
              <span v-if="q.year" class="text-xs text-c-muted shrink-0 tnum">{{ q.year }}</span>
              <span v-if="q.type" class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #e8ecdf; color: #3d5a7a">{{ q.type }}</span>
            </div>
            <div class="text-sm font-medium text-c-ink mt-2 leading-6">{{ q.title }}</div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2.5 text-xs text-c-muted">
              <span v-if="q.exam">{{ q.exam }}</span>
              <span v-if="q.maxScore" class="tnum">{{ q.maxScore }} 分</span>
              <span v-if="q.wordLimit" class="tnum">≤{{ q.wordLimit }} 字</span>
              <span v-if="q.difficulty">{{ DIFFICULTY_LABEL[q.difficulty] }}</span>
              <span v-if="q.materialChars || q.material" class="tnum">
                材料 {{ q.materialChars || q.material.length }} 字
              </span>
              <span v-if="q.needLoad" class="text-c-muted">（材料进入练习后载入）</span>
              <span v-for="t in q.topics || []" :key="t"
                class="px-1.5 py-0.5 rounded" style="background: #f5f1ea; color: #78716c">
                {{ t }}
              </span>
            </div>
            <div v-if="q.requirement" class="text-xs text-c-muted mt-2.5 leading-5">
              要求：{{ q.requirement }}
            </div>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            <button @click="practiceWith(q)"
              class="px-3.5 py-2 rounded-lg text-xs font-medium neu-inset text-c-bark whitespace-nowrap">
              做这道题
            </button>
            <button v-if="!q.builtin" @click="del(q.id)"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-c-muted
                hover:text-c-clay hover:bg-c-paper/50 transition-colors">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>

        <!-- 参考答案：折叠，做完再看。真题按需载入 -->
        <details v-if="q.needLoad || q.reference" class="mt-3 pt-3 border-t border-c-line"
          @toggle="onToggleRef($event, q)">
          <summary class="text-xs text-c-muted cursor-pointer hover:text-c-bark list-none">
            ▸ 参考答案
          </summary>
          <div v-if="!q.reference" class="mt-2.5 text-xs text-c-muted">载入中…</div>
          <div v-else class="mt-2.5 text-xs text-c-body leading-7 whitespace-pre-wrap
            max-h-72 overflow-y-auto pr-1">{{ q.reference }}</div>
        </details>
      </div>
    </div>

    <div v-else class="rounded-2xl p-12 neu text-center text-c-muted">
      <div class="text-sm">{{ keyword || typeFilter ? '没有匹配的题目' : '题库还是空的' }}</div>
      <div class="text-xs text-c-muted mt-2 leading-5">
        可以录入自己的题目，或清空筛选看看内置题库
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from '../utils/toast'
import { getAll, put, remove, uid, STORES } from '../store/db'
import { QUESTION_TYPES, DIFFICULTY_LABEL } from '../data/builtin-questions'
import {
  BUILTIN_POOL, REAL_EXAMS, SIM_QUESTIONS, PUBLIC_MAX_YEAR, PRIVATE_EXAM_COUNT,
  loadFullQuestion,
} from '../data/questions'
import { pickDaily } from '../data/daily'
import { AUTHOR } from '../data/author'
import { readPackFile, importPack } from '../bpq/importer'
import { copyAuthorLine } from '../utils/watermark'

const router = useRouter()

const builtin = ref(BUILTIN_POOL)
const mine = ref([])
const keyword = ref('')
const typeFilter = ref('')
// 来源筛选：真题 / 私有 / 仿真 / 自建。真题一进来，光靠题型分不出该练哪个，
// 而这个项目最有价值的部分正是这些真题，必须在第一屏能筛出来。
const sourceFilter = ref('')
const showImport = ref(false)
const showGetPack = ref(false)
const packInput = ref(null)
const importing = ref(false)

/** 私有卷套数：分发版恒为 0，据此决定"已导入"还是"引导获取" */
const privateExamCount = ref(PRIVATE_EXAM_COUNT)

const draft = reactive({
  title: '', type: '', exam: '', requirement: '',
  material: '', reference: '', maxScore: 25, wordLimit: null,
})

const pool = computed(() => [...mine.value, ...builtin.value])

/** 今日一练是哪道：与练习页共用同一套确定性选题，两处必然一致 */
const dailyId = computed(() => pickDaily(pool.value)?.id || '')

/** 来源归属：真题 / 仿真 / 自建。自建题存在库里时只带 kind:'自建' */
function kindOf(q) {
  if (q.kind) return q.kind
  return q.builtin ? '仿真' : '自建'
}

/** 真题用赭黄、私有用藕紫、仿真用暖棕、自建用中灰 —— 与老师色标同一套色系，不新造颜色 */
function kindStyle(q) {
  const k = kindOf(q)
  if (k === '真题') return 'background:#f7eddc;color:#9c6b2f'
  if (k === '私有') return 'background:#efeaf4;color:#7a6a9b'
  if (k === '仿真') return 'background:#f2ebe2;color:#5c4033'
  return 'background:#f5f1ea;color:#78716c'
}

/**
 * 题库页展开「参考答案」时才去载真题正文。
 * 真题材料整卷共用、动辄七八千字，列表页一次性全载会白读 1MB。
 */
async function onToggleRef(e, q) {
  if (!e.target.open || !q.needLoad || q.reference) return
  const full = await loadFullQuestion(q.id)
  if (!full) return
  q.reference = full.reference          // q 是 ref 数组里的响应式对象，直接改即生效
  q.material = full.material
  q.materialChars = full.material.length
  q.needLoad = false
}

const SOURCES = [
  { key: '真题', hint: `2010–${PUBLIC_MAX_YEAR} 国考，随软件内置，含整卷材料与参考答案` },
  { key: '私有', hint: `${PUBLIC_MAX_YEAR + 1} 年起国考，题库包导入，请勿转发` },
  { key: '仿真', hint: '按真题风格自编，适合快速专项练' },
  { key: '自建', hint: '你自己录入的题目' },
]

function countBySource(s) {
  return pool.value.filter((q) => kindOf(q) === s).length
}

/** 只按「来源」过滤后的池子：题型那一排的计数跟着它走，两个筛选器才是联动的 */
const filteredSource = computed(() =>
  sourceFilter.value ? pool.value.filter((q) => kindOf(q) === sourceFilter.value) : pool.value
)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return pool.value.filter((q) => {
    if (sourceFilter.value && kindOf(q) !== sourceFilter.value) return false
    if (typeFilter.value && q.type !== typeFilter.value) return false
    if (!k) return true
    return (
      (q.title || '').toLowerCase().includes(k) ||
      (q.exam || '').toLowerCase().includes(k) ||
      (q.topics || []).some((t) => t.toLowerCase().includes(k))
    )
  })
})

const coveredTypes = computed(
  () => QUESTION_TYPES.filter((t) => pool.value.some((q) => q.type === t)).length
)

function countByType(t) {
  return filteredSource.value.filter((q) => q.type === t).length
}

async function load() {
  mine.value = await getAll(STORES.questions)
}

/**
 * 导入 .bpq 私有题库包。
 * 校验不过就整包拒绝 —— 半截导入会让题库里混进读不通的题，比不导入更糟。
 */
async function onPackFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''            // 清掉 value，同一个文件才能再次选择（重导/换包）
  if (!file) return
  importing.value = true
  try {
    const r = await readPackFile(file)
    if (!r.ok) {
      toast.error(r.errors[0] || '题库包不可用')
      return
    }
    for (const w of r.warnings) toast.warning(w)
    const res = await importPack(r.pack)
    await load()
    // 已导入的私有卷要从"引导获取"切成"已导入"文案
    privateExamCount.value = Math.max(privateExamCount.value, res.exams)
    toast.success(`已导入 ${res.exams} 套 / ${res.questions} 道题（水印：${res.fingerprint}）`)
  } catch (err) {
    toast.error(err?.message || '导入失败，请确认文件是 .bpq 题库包')
  } finally {
    importing.value = false
  }
}

async function onCopyStamp() {
  const ok = await copyAuthorLine()
  if (ok) toast.success('已复制作者联系方式')
  else toast.warning('浏览器不允许自动复制，请手动记录')
}

async function saveQuestion() {
  const now = Date.now()
  await put(STORES.questions, {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim(),
    type: draft.type,
    exam: draft.exam.trim(),
    requirement: draft.requirement,
    material: draft.material,
    reference: draft.reference,
    maxScore: draft.maxScore,
    wordLimit: draft.wordLimit,
    topics: [],
  })
  Object.assign(draft, {
    title: '', type: '', exam: '', requirement: '',
    material: '', reference: '', maxScore: 25, wordLimit: null,
  })
  showImport.value = false
  await load()
  toast.success('已保存')
}

async function del(id) {
  await remove(STORES.questions, id)
  await load()
}

/**
 * 带进练习页。
 * 只传 questionId —— 练习页会回题库池里按 id 取完整题目（字段最全，也不怕 URL 过长）。
 * 早期版本只传 title + material，作答要求、满分、字数全丢，用户还得手填一遍；
 * 后来改成把五个字段都塞进 query，虽然不丢了但 URL 会变成几千字符。
 * id 是唯一稳定标识，传它就够了。
 */
function practiceWith(q) {
  router.push({ path: '/practice', query: { questionId: q.id } })
}

onMounted(load)
</script>
