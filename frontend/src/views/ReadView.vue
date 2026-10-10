<template>
  <div class="max-w-4xl mx-auto">
    <!-- ==================== 页头 ==================== -->
    <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 class="text-lg font-semibold text-c-bark">精读训练</h1>
        <p class="text-xs text-c-muted mt-0.5 leading-5">
          在材料里划出你认为的「要点句」，对照采分点看找点正确率 ——
          申论的分数一半在动笔之前。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <select v-if="pool.length > 1" v-model="qid"
          class="px-3 py-2 rounded-xl text-xs neu-inset outline-none text-c-body max-w-[16rem]">
          <option v-for="q in pool" :key="q.id" :value="q.id">
            {{ shortLabel(q) }}
          </option>
        </select>
        <button @click="pickRandom"
          class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-bark hover:translate-y-px transition-transform">
          随机一题
        </button>
      </div>
    </div>

    <!-- 题池空态：精读对照依赖采分点标准，一道都没有时说明白 -->
    <section v-if="!pool.length" class="rounded-2xl p-8 neu text-center">
      <div class="text-sm text-c-body mb-1.5">还没有可对照的题目</div>
      <div class="text-xs text-c-muted leading-6 max-w-md mx-auto">
        精读训练的对照依赖采分点标准。标准会随校准工作台逐题产出，
        每校准一道，这里自动多一道。
      </div>
    </section>

    <template v-else>
      <!-- ==================== 题目卡 ==================== -->
      <section class="rounded-2xl p-4 neu mb-4">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-sm font-medium text-c-body">题目</span>
          <div class="flex items-center gap-1.5">
            <span class="text-xs px-1.5 py-0.5 rounded font-medium" :style="kindBadgeStyle">{{ kindLabel }}</span>
            <span v-if="question?.type" class="text-xs px-1.5 py-0.5 rounded"
              style="background: #e8ecdf; color: #3d5a7a">{{ question.type }}</span>
          </div>
        </div>
        <div class="rounded-xl neu-inset px-2.5 py-1.5 text-[11px] leading-5 text-c-body whitespace-pre-line">{{ question?.title }}</div>
        <div v-if="question?.requirement" class="rounded-xl neu-inset px-2.5 py-1.5 text-[11px] leading-5 text-c-muted whitespace-pre-line mt-1.5">{{ question.requirement }}</div>
        <div class="text-[11px] text-c-muted tnum mt-2">
          满分 {{ question?.maxScore }} 分<template v-if="question?.wordLimit"> · 限 {{ question.wordLimit }} 字</template>
        </div>
      </section>

      <!-- 无标准：自由精读降级（明确说，不假装能对照） -->
      <div v-if="!standard" class="rounded-xl px-4 py-2.5 mb-4 text-xs leading-5"
        style="background: #f3efe6; color: #8b6d4b">
        该题暂无采分点标准，先自由精读（标注会保存在本机）；待该题校准后即可开放对照。
      </div>

      <!-- ==================== 材料 ==================== -->
      <section class="rounded-2xl p-5 neu">
        <div class="flex items-center justify-between gap-3 mb-3">
          <span class="text-sm font-medium text-c-body">
            给定资料
            <span v-if="material" class="text-xs text-c-muted font-normal tnum ml-1">{{ countChars(material) }} 字</span>
          </span>
          <span v-if="trimNote" class="text-xs text-c-muted">{{ trimNote }}</span>
        </div>
        <div class="overflow-y-auto pr-1 max-h-[36rem]">
          <Highlightable :blocks="materialBlocks(material)" :marks="displayMarks"
            @change="onMarksChange" class="space-y-3.5" />
        </div>
        <p class="text-[11px] text-c-muted mt-2.5">
          选中文字后选颜色划荧光；标注存在本机，下次打开还在。
          <template v-if="phase === 'result' && overlay.length">
            <span style="color: #b4552d">红色</span>是你漏掉的要点原文 —— 对照完再读一遍材料，看看当时为什么没圈出来。
          </template>
        </p>
      </section>

      <!-- ==================== 操作条 ==================== -->
      <div class="flex flex-wrap items-center gap-2 mt-4">
        <button v-if="phase === 'mark'" @click="submit" :disabled="!canSubmit"
          class="px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
            disabled:opacity-40 disabled:cursor-not-allowed neu-sm"
          :class="canSubmit ? 'text-c-bark hover:translate-y-px' : 'text-c-muted'">
          对照采分点{{ standard ? '' : '（暂无标准）' }}
        </button>
        <button v-else @click="phase = 'mark'"
          class="px-5 py-2.5 rounded-xl text-sm font-medium neu-sm text-c-bark hover:translate-y-px transition-transform">
          返回标注
        </button>
        <button v-if="phase === 'result'" @click="restart"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-body">
          清空重练
        </button>
        <button v-if="marks.length && qid" @click="sendMarksToOutline"
          title="把划过的句子追加到练习页提纲（同一道题）"
          class="px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-body hover:text-c-bark transition-colors">
          📎 收进练习提纲
        </button>
        <span v-if="sentNote" class="text-xs" style="color:#4f7d5e">{{ sentNote }}</span>
        <span class="text-xs text-c-muted tnum ml-auto">
          已划 {{ marks.length }} 处<template v-if="standard && phase === 'mark'"> · 划完点「对照采分点」</template>
        </span>
      </div>
      <div v-if="phase === 'mark' && standard && !marks.length"
        class="text-xs text-c-muted mt-1.5">
        还没划：先通读材料，再回头把「答案可能出自的句子」划出来 —— 划少比划多更接近真实考场。
      </div>

      <!-- ==================== 对照结果 ==================== -->
      <section v-if="phase === 'result' && result" class="mt-5">
        <!-- 三数卡 -->
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="rounded-2xl p-4 neu text-center">
            <div class="text-2xl font-semibold tnum" :style="{ color: rateColor }">{{ result.stats.scoreRate }}%</div>
            <div class="text-[11px] text-c-muted mt-1">找点得分率（按分值加权）</div>
          </div>
          <div class="rounded-2xl p-4 neu text-center">
            <div class="text-2xl font-semibold tnum text-c-bark">
              {{ result.stats.hitPoints }}<span class="text-sm text-c-muted">/{{ result.stats.totalPoints }}</span>
            </div>
            <div class="text-[11px] text-c-muted mt-1">
              命中采分点<template v-if="result.stats.partialPoints > 0">（部分 {{ result.stats.partialPoints }}）</template>
            </div>
          </div>
          <div class="rounded-2xl p-4 neu text-center">
            <div class="text-2xl font-semibold tnum text-c-bark">
              {{ result.stats.validMarks }}<span class="text-sm text-c-muted">/{{ result.stats.totalMarks }}</span>
            </div>
            <div class="text-[11px] text-c-muted mt-1">标注有效（误划 {{ result.stats.missMarks }} 处）</div>
          </div>
        </div>

        <!-- 逐点对照 -->
        <div class="space-y-2.5">
          <div v-for="(pr, i) in result.pointResults" :key="pr.point.id || i"
            class="rounded-2xl p-4 neu"
            :style="pr.hit ? '' : 'background: #faf3ef'">
            <div class="flex items-start gap-2.5">
              <span class="shrink-0 w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-medium mt-0.5"
                :style="pr.hit
                  ? (pr.grade === 'full' ? 'background:#e4ead8;color:#5a7247' : 'background:#f2ebe2;color:#a07d3c')
                  : 'background:#f0ddd2;color:#a05a3c'">
                {{ pr.hit ? (pr.grade === 'full' ? '✓' : '◐') : '✗' }}
              </span>
              <div class="min-w-0">
                <div class="text-xs text-c-body leading-5">
                  {{ pr.point.label }}
                  <span class="text-c-muted tnum ml-1">（{{ pr.point.weight }} 分）</span>
                  <span v-if="pr.hit && pr.grade === 'partial'" class="text-[10px] ml-1" style="color:#a07d3c">部分命中</span>
                </div>
                <div v-if="pr.hit" class="text-[11px] text-c-muted leading-5 mt-1">
                  命中：划了「{{ pr.matched[0].markText.slice(0, 24) }}{{ pr.matched[0].markText.length > 24 ? '…' : '' }}」
                  <template v-if="pr.matched[0].way === 'keyword'">（含关键词「{{ pr.matched[0].keyword }}」）</template>
                  <template v-else-if="pr.matched[0].way === 'partial'">（只覆盖证据 {{ Math.round(pr.matched[0].markText.length / pr.matched[0].evidence.length * 100) }}%，找对地方但没找全）</template>
                </div>
                <div v-else class="text-[11px] leading-5 mt-1" style="color:#a05a3c">
                  漏掉的原文：{{ (pr.point.evidence || []).join('；') }}
                </div>
                <div v-if="pr.point.note" class="text-[11px] text-c-muted/80 leading-5 mt-1">{{ pr.point.note }}</div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="overlayMissing > 0" class="text-[11px] text-c-muted mt-3">
          有 {{ overlayMissing }} 条漏点原文在当前材料里定位不到（材料被裁剪过），红色叠加可能不完整 —— 可在练习批改页用「查看整卷」核对。
        </div>
        <div v-if="result.stats.wideMarks > 0" class="text-[11px] leading-5 mt-3 rounded-xl px-3 py-2"
          style="background:#faf3e8;color:#a07d3c">
          有 {{ result.stats.wideMarks }} 处标注划得太宽（远超要点句长度）—— 找点尽量精确到句，
          划半段材料等于没训练到「定位」这件事。
        </div>
        <div class="text-[11px] text-c-muted mt-3 leading-5">
          找点得分率 = 找到的采分点分值合计 ÷ 总分（{{ result.stats.hitWeight }}/{{ result.stats.totalWeight }}），
          部分命中按半分计。判定依据是标准里的材料原文证据，与你划中的位置逐字比对。
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
// M4 材料精读训练（2026-10-08）。
// 定位：训练「找点」这个申论第一能力 —— 批改解决"写得怎么样"，这里解决"会不会读"。
// 复用两套既有基建，本页只新增"对照"这一步：
//   · 荧光标注（Highlightable + 文本片段锚点）—— 划句交互与练习页完全同款；
//   · 采分点标准层（getStandard）—— 选题池 = 有标准的题，随校准自动扩大（D1 推进一道多一道）。
// 匹配是纯代码（utils/grading/pointMatch.js），零 LLM 成本。
import { computed, ref, watch } from 'vue'
import Highlightable from '../components/Highlightable.vue'
import { BUILTIN_POOL, loadFullQuestion } from '../data/questions'
import { getStandard } from '../data/standards/index'
import { trimMaterial } from '../utils/grading/materialTrim'
import { materialBlocks } from '../utils/materialBlocks'
import { countOccurrences } from '../utils/highlight'
import { matchMarksToPoints, buildMissedOverlay } from '../utils/grading/pointMatch'

// ── 选题池：有采分点标准的题 ──
// ⚠️ 池子**必须是派生而非写死**：D1 校准每产出一道标准，这里自动多一道 —— 零代码改动。
const pool = BUILTIN_POOL.filter((q) => {
  const s = getStandard(q.id)
  return s && (s.points || []).length > 0
})

const qid = ref(pool[0]?.id || '')
const question = ref(null)
const material = ref('')
const trimNote = ref('')
const marks = ref([])
const phase = ref('mark') // 'mark' 划句中 | 'result' 已对照
const result = ref(null)
const overlayMissing = ref(0)

const standard = computed(() => (qid.value ? getStandard(qid.value) : null))

// ── 标注存储：按题独立（bp-read:），与练习批改的 bp-marks: 分开 ——
//    精读划的是"答案候选"，练习划的是"自己的阅读笔记"，混在一起两边都会失真。
function marksKey(id) {
  return `bp-read:${id}`
}
function loadMarks(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(marksKey(id)) || 'null')
    return Array.isArray(raw) ? raw.filter(Boolean) : []
  } catch {
    return []
  }
}
function saveMarks(id, list) {
  try {
    localStorage.setItem(marksKey(id), JSON.stringify(list))
  } catch { /* 存储满等：标注属增强数据，静默失败可接受 */ }
}

// 对照后材料上叠加"漏点原文"红色荧光 —— 是**计算叠加**（displayMarks = 我的 + 叠加），
// 不写进存储：重练/切题后不残留，我的标注始终是干净的。
const overlay = ref([])
const displayMarks = computed(() =>
  phase.value === 'result' ? [...marks.value, ...overlay.value] : marks.value
)

// ── 载入题目 ──
async function loadQuestion(id) {
  phase.value = 'mark'
  result.value = null
  overlay.value = []
  overlayMissing.value = 0
  trimNote.value = ''
  marks.value = id ? loadMarks(id) : []

  if (!id) {
    question.value = null
    material.value = ''
    return
  }
  const q = await loadFullQuestion(id)
  question.value = q
  const fullMat = q?.material || ''

  // 与练习页同一套裁剪规矩（按题裁、大作文不裁、解析不出不裁）。
  // 多一条精读特有的兜底：**漏点原文在裁后材料里找不到就整卷展示** ——
  // 证据分散在没引用的资料里时，裁掉它对照就废了。
  let mat = fullMat
  const std = standard.value
  if (std && (std.points || []).length && fullMat) {
    const stem = [q.title, q.requirement].filter(Boolean).join(' ')
    const t = trimMaterial(fullMat, stem)
    if (t.trimmed) {
      const allFound = (std.points || []).every((p) =>
        (p.evidence || []).every((ev) => t.text.includes(ev)))
      if (allFound) {
        mat = t.text
        trimNote.value = `本题用给定资料${(t.used || []).join('、')}（${t.before} → ${t.after} 字）`
      } else {
        trimNote.value = '采分点原文分布在其余资料里，已按整卷展示'
      }
    }
  }
  material.value = mat
}

watch(qid, (id) => loadQuestion(id), { immediate: true })

// 切题后 question 异步到位前 standard 可能已切换 —— watch 兜住
watch(standard, () => {
  if (phase.value === 'mark' && !material.value && qid.value) loadQuestion(qid.value)
})

// ── 交互 ──
function onMarksChange(list) {
  marks.value = Array.isArray(list) ? list : []
  saveMarks(qid.value, marks.value)
  // 改了标注，旧对照结果就失效了 —— 回到划句态（结果页改标注还显示旧结果是假状态）
  if (phase.value === 'result') {
    phase.value = 'mark'
    result.value = null
    overlay.value = []
  }
}

const canSubmit = computed(() => !!standard.value && marks.value.length > 0 && !!material.value)

function submit() {
  if (!canSubmit.value) return
  const r = matchMarksToPoints(marks.value, standard.value.points)
  result.value = r
  const ov = buildMissedOverlay(material.value, r.pointResults, countOccurrences)
  overlay.value = ov.overlay
  overlayMissing.value = ov.missing
  phase.value = 'result'

  // 最近一次成绩存本机（M1 学习中心后续聚合用；失败不影响本页）
  try {
    localStorage.setItem(`bp-read-result:${qid.value}`, JSON.stringify({
      rate: r.stats.scoreRate,
      hitPoints: r.stats.hitPoints,
      totalPoints: r.stats.totalPoints,
      totalMarks: r.stats.totalMarks,
      validMarks: r.stats.validMarks,
      at: Date.now(),
    }))
  } catch { /* 忽略 */ }
}

// M8 规格增强一（跨页版）：把精读划的句子收进**练习页**的提纲。
// 同一道题（同 qid）：精读划的是"答案候选"，练习页提纲是动笔前的骨架——两侧天然衔接。
// 与 PracticeView.marksToOutline 同格式（• 句子）；重复句子不重复收（按行文本去重）。
const sentNote = ref('')
let sentTimer = null
function sendMarksToOutline() {
  const id = qid.value
  if (!id) return
  const texts = marks.value.map((m) => (m.text || '').trim()).filter(Boolean)
  if (!texts.length) return
  let cur = ''
  try { cur = localStorage.getItem(`bp-outline:${id}`) || '' } catch { /* 读不到按空提纲处理 */ }
  const seen = new Set(cur.split('\n').map((l) => l.replace(/^•\s*/, '').trim()).filter(Boolean))
  const fresh = texts.filter((t) => !seen.has(t))
  if (!fresh.length) {
    sentNote.value = '这些句子都已经在提纲里了'
  } else {
    const next = (cur.trim() ? cur.replace(/\s*$/, '\n') + '\n' : '') + fresh.map((t) => `• ${t}`).join('\n') + '\n'
    try {
      localStorage.setItem(`bp-outline:${id}`, next)
      sentNote.value = `已收进练习提纲 ${fresh.length} 句，去练习页看看`
    } catch {
      sentNote.value = '没存进去（浏览器存储满了）'
    }
  }
  clearTimeout(sentTimer)
  sentTimer = setTimeout(() => { sentNote.value = '' }, 3000)
}

function restart() {
  marks.value = []
  saveMarks(qid.value, [])
  phase.value = 'mark'
  result.value = null
  overlay.value = []
  overlayMissing.value = 0
}

function pickRandom() {
  if (pool.length < 2) return
  const others = pool.filter((q) => q.id !== qid.value)
  qid.value = others[Math.floor(Math.random() * others.length)].id
}

// ── 展示辅助 ──
function shortLabel(q) {
  const t = q.type || '题目'
  const chars = countChars(q.material || '')
  return `${t} · ${q.maxScore || q.score || '?'}分${chars ? ` · 材料${chars}字` : ''}`
}
function countChars(s) {
  return String(s || '').replace(/\s/g, '').length
}
const kindLabel = computed(() => {
  const id = qid.value || ''
  if (id.startsWith('bpq-')) return '私有真题'
  if (id.startsWith('real-')) return '真题'
  return '仿真题'
})
const kindBadgeStyle = computed(() => {
  if (kindLabel.value === '私有真题') return { background: '#f4e3e0', color: '#a05a3c' }
  if (kindLabel.value === '真题') return { background: '#e3ebdd', color: '#5a7247' }
  return { background: '#e9e4f4', color: '#6b5a9e' }
})
const rateColor = computed(() => {
  const r = result.value?.stats.scoreRate ?? 0
  if (r >= 80) return '#5a7247'
  if (r >= 50) return '#b98a2f'
  return '#a05a3c'
})
</script>
