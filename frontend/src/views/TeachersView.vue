<template>
  <div class="w-full max-w-[1080px] mx-auto">

    <div class="mb-5">
      <h1 class="text-xl font-semibold text-c-ink">老师档案</h1>
      <p class="text-sm text-c-muted mt-1">
        {{ TEACHER_LIST.length }} 位申论名师的方法论体系 · 每位侧重不同，批改视角不同
      </p>
    </div>

    <!-- 选人：横排一排（原来左窄列 + 右详情的两栏比例失衡，看着别扭） -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
      <button v-for="t in TEACHER_LIST" :key="t.id" @click="pick(t.id)"
        class="relative overflow-hidden text-left rounded-2xl p-3.5 transition-all duration-200"
        :class="active === t.id ? 'neu-inset' : 'neu-sm hover:translate-y-px'">
        <!-- 活跃色条：当前老师是谁，一眼可见 -->
        <div v-if="active === t.id" class="absolute left-0 top-3 bottom-3 w-1 rounded-r"
          :style="{ background: t.color }" />
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-medium shrink-0 transition-colors"
            :style="active === t.id
              ? { background: t.color, color: '#fffdfb' }
              : { background: t.color + '1A', color: t.color }">
            {{ t.avatar }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-c-ink leading-5">{{ t.name }}</div>
            <div class="text-[11px] text-c-muted truncate leading-4">{{ t.school }}</div>
          </div>
          <span class="text-[10px] tnum px-1.5 py-0.5 rounded shrink-0"
            :style="{ background: t.color + '14', color: t.color }">×{{ t.weight }}</span>
        </div>
      </button>
    </div>

    <!-- 详情：通栏，不再挤在右侧窄列里 -->
    <div v-if="teacher" class="space-y-4">

      <!-- 头部：一行身份 + 一句话立场，信息压扁 -->
      <div class="rounded-2xl p-5 neu">
        <div class="flex flex-wrap items-center gap-3">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-medium shrink-0"
            :style="{ background: teacher.color, color: '#fffdfb' }">
            {{ teacher.avatar }}
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold text-c-ink leading-6">{{ teacher.name }}</h2>
              <span class="text-xs px-2 py-0.5 rounded-md"
                :style="{ background: teacher.color + '18', color: teacher.color }">{{ teacher.school }}</span>
              <span class="text-xs px-2 py-0.5 rounded-md neu-inset text-c-muted tnum">合议权重 ×{{ teacher.weight }}</span>
            </div>
            <div class="text-sm mt-1" :style="{ color: teacher.color }">
              {{ teacher.tagline }}<span class="text-c-muted"> · {{ teacher.title }}</span>
            </div>
          </div>
        </div>

        <!-- 信息带：三列等高，比原来两列错落整齐 -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-c-line">
          <div>
            <div class="text-[11px] text-c-muted mb-1.5">评审侧重</div>
            <div class="text-sm text-c-ink leading-5">{{ teacher.focus }}</div>
            <div class="text-xs text-c-muted mt-1.5 leading-5">{{ teacher.desc }}</div>
          </div>
          <div>
            <div class="text-[11px] text-c-muted mb-1.5">适用场景</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="s in teacher.scenes" :key="s"
                class="text-xs px-2 py-0.5 rounded-md neu-inset text-c-body leading-5">{{ s }}</span>
            </div>
          </div>
          <div>
            <div class="text-[11px] text-c-muted mb-1.5">评分维度（AI 批改只看这几项）</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="(d, i) in teacher.dimensions" :key="d"
                class="text-xs px-2 py-0.5 rounded-md tnum"
                :style="{ background: teacher.color + '12', color: teacher.color }">
                {{ String(i + 1).padStart(2, '0') }} {{ d }}
              </span>
            </div>
          </div>
        </div>

        <!-- 视图切换：active 用老师主题色实底，一眼看清当前在哪一页；
             之前 active 只是「纸色变一点点」，两个状态几乎没差，用户反馈切换不明显 -->
        <div class="inline-flex rounded-xl neu-inset p-1 mt-4 gap-0.5">
          <button v-for="v in VIEWS" :key="v.key" @click="view = v.key"
            class="px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5"
            :class="view === v.key
              ? 'text-white shadow-[0_2px_6px_rgba(92,64,51,0.25)]'
              : 'text-c-muted hover:text-c-bark'"
            :style="view === v.key ? { background: teacher.color } : {}">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-if="v.key === 'method'" d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              <path v-else d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M9 13h6M9 17h4" />
            </svg>
            {{ v.label }}
            <span v-if="view === v.key" class="tnum text-[10px] opacity-75">
              {{ v.key === 'method' ? instructionSections.length : 'MD' }}
            </span>
          </button>
        </div>
      </div>

      <!-- 视图一：方法论要点——批改指令按【小节】拆开，正文走 MdView 真渲染 -->
      <div v-if="view === 'method'" class="rounded-2xl p-5 neu">
        <div class="text-sm font-medium text-c-body mb-3">
          批改指令
          <span class="text-xs text-c-muted font-normal ml-1">AI 实际收到的系统提示</span>
        </div>
        <div class="space-y-3">
          <div v-for="(sec, i) in instructionSections" :key="i" class="rounded-xl p-4 neu-inset">
            <div v-if="sec.head" class="text-[13px] font-semibold mb-2 pl-2.5 border-l-[3px]"
              :style="{ color: teacher.color, borderColor: teacher.color }">{{ sec.head }}</div>
            <MdView :src="sec.body" compact />
          </div>
        </div>
        <div class="text-xs text-c-muted mt-3 leading-5">
          上面这段就是这位老师批改时，AI 收到的核心指令。它决定了这位老师会盯什么、放过什么、怎么给分。
        </div>
      </div>

      <!-- 视图二：原文全文 -->
      <div v-else class="rounded-2xl p-5 neu">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-medium text-c-body">方法论原文（完整提炼稿）</div>
          <div class="text-xs text-c-muted tnum">{{ docLoading ? '加载中…' : `${(doc.length / 1000).toFixed(1)}k 字符` }}</div>
        </div>
        <div v-if="docLoading" class="text-xs text-c-muted py-6 text-center">正在加载…</div>
        <div v-else class="rounded-xl p-5 neu-inset max-h-[620px] overflow-y-auto">
          <MdView :src="doc" class="max-w-prose mx-auto" />
        </div>
        <div class="text-xs text-c-muted mt-3 leading-5">
          原文来自该老师公开课程/讲义的提炼稿。本工具仅提炼其公开做题方法论，与老师本人无关；
          所有批改意见均由 AI 生成，仅供学习参考。
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { TEACHER_LIST, TEACHERS } from '../agents/teachers'
import { loadTeacherDoc } from '../agents/skills'
import MdView from '../components/MdView.vue'

const VIEWS = [
  { key: 'method', label: '批改指令' },
  { key: 'raw', label: '原文全文' },
]

const active = ref(TEACHER_LIST[0].id)
const view = ref('method')
const doc = ref('')
const docLoading = ref(false)

const teacher = computed(() => TEACHERS[active.value])

/**
 * 批改指令按【小节】拆段：以「【…】」开头的行当小节标题，其后到下一个标题为止是正文。
 * 拆不开的散行归入开头的无名段 —— 拆解失败时退化为"整块原文"，不丢字。
 */
const instructionSections = computed(() => {
  const text = teacher.value?.instruction || ''
  const lines = String(text).split('\n')
  const sections = []
  let cur = { head: '', lines: [] }
  for (const line of lines) {
    const m = line.match(/^\s*【(.+?)】\s*$/) || line.match(/^\s*【(.+?)】(.*)$/)
    if (m) {
      if (cur.head || cur.lines.join('').trim()) sections.push(cur)
      cur = { head: m[1].trim(), lines: m[2] ? [m[2].trim()] : [] }
    } else {
      cur.lines.push(line)
    }
  }
  if (cur.head || cur.lines.join('').trim()) sections.push(cur)
  return sections.length
    ? sections.map((s) => ({ head: s.head, body: s.lines.join('\n').trim() }))
    : [{ head: '', body: text }]
})

async function loadDoc() {
  if (view.value !== 'raw') return
  docLoading.value = true
  doc.value = ''
  try {
    const raw = await loadTeacherDoc(active.value)
    doc.value = String(raw).replace(/^---[\s\S]*?---\s*/, '').trim()
  } catch (e) {
    doc.value = `加载失败：${e.message}`
  } finally {
    docLoading.value = false
  }
}

function pick(id) {
  active.value = id
  doc.value = ''
  loadDoc()
}

watch(view, loadDoc)
onMounted(loadDoc)
</script>
