<template>
  <div class="w-full">

    <div class="mb-6">
      <h1 class="text-xl font-semibold text-c-ink">老师档案</h1>
      <p class="text-sm text-c-muted mt-1">
        {{ TEACHER_LIST.length }} 位申论名师的方法论体系 · 每位侧重不同，批改视角不同
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

      <!-- 左：老师列表（活跃项带老师色边条，一眼看出当前是谁） -->
      <div class="space-y-2">
        <button v-for="t in TEACHER_LIST" :key="t.id" @click="pick(t.id)"
          class="w-full text-left rounded-2xl p-3.5 transition-all duration-200 relative overflow-hidden"
          :class="active === t.id ? 'neu-inset' : 'neu-sm hover:translate-y-px'">
          <div v-if="active === t.id" class="absolute left-0 top-3 bottom-3 w-1 rounded-r"
            :style="{ background: t.color }" />
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-medium shrink-0"
              :style="{
                background: active === t.id ? t.color : '#faf6f1',
                color: active === t.id ? '#fffdfb' : t.color,
                boxShadow: 'none',
              }">
              {{ t.avatar }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-c-ink">{{ t.name }}</div>
              <div class="text-xs text-c-muted truncate">{{ t.school }}</div>
            </div>
            <span class="text-[10px] tnum px-1.5 py-0.5 rounded shrink-0"
              :style="{ background: t.color + '14', color: t.color }">×{{ t.weight }}</span>
          </div>
        </button>
      </div>

      <!-- 右：详情 -->
      <div v-if="teacher" class="space-y-5">

        <!-- 头部 -->
        <div class="rounded-2xl p-6 neu">
          <div class="flex items-start gap-4">
            <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-medium shrink-0"
              :style="{ background: teacher.color, color: '#fffdfb' }">
              {{ teacher.avatar }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-lg font-semibold text-c-ink">{{ teacher.name }}</h2>
                <span class="text-xs px-2 py-0.5 rounded-md"
                  :style="{ background: teacher.color + '18', color: teacher.color }">
                  {{ teacher.school }}
                </span>
                <span class="text-xs px-2 py-0.5 rounded-md neu-inset text-c-muted">
                  权重 {{ teacher.weight }}
                </span>
              </div>
              <div class="text-sm text-c-body mt-1.5">{{ teacher.title }}</div>
              <div class="text-sm mt-2" :style="{ color: teacher.color }">
                「{{ teacher.tagline }}」
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-c-line">
            <div>
              <div class="text-xs text-c-muted mb-1.5">评审侧重</div>
              <div class="text-sm text-c-ink">{{ teacher.focus }}</div>
              <div class="text-xs text-c-muted mt-2 leading-5">{{ teacher.desc }}</div>
            </div>
            <div>
              <div class="text-xs text-c-muted mb-1.5">适用场景</div>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="s in teacher.scenes" :key="s"
                  class="text-xs px-2 py-0.5 rounded-md neu-inset text-c-body">{{ s }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-c-line">
            <div class="text-xs text-c-muted mb-2">评分维度（AI 批改时只从这 {{ teacher.dimensions.length }} 项评判）</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="(d, i) in teacher.dimensions" :key="d"
                class="text-xs px-2 py-0.5 rounded-md tnum"
                :style="{ background: teacher.color + '12', color: teacher.color }">
                {{ String(i + 1).padStart(2, '0') }} {{ d }}
              </span>
            </div>
          </div>
        </div>

        <!-- 切换 -->
        <div class="flex flex-wrap gap-2">
          <button v-for="v in VIEWS" :key="v.key" @click="view = v.key"
            class="px-4 py-2 rounded-xl text-xs font-medium transition-all duration-200"
            :class="view === v.key ? 'neu-inset text-c-bark' : 'neu-sm text-c-body hover:text-c-bark'">
            {{ v.label }}
          </button>
        </div>

        <!-- 视图一：方法论要点 -->
        <div v-if="view === 'method'" class="rounded-2xl p-6 neu">
          <div class="text-sm font-medium text-c-body mb-3">批改指令（AI 实际收到的系统提示）</div>
          <div class="rounded-xl p-4 neu-inset">
            <pre class="text-xs text-c-body whitespace-pre-wrap leading-6"
              style="font-family: inherit">{{ teacher.instruction }}</pre>
          </div>
          <div class="text-xs text-c-muted mt-3 leading-5">
            上面这段就是这位老师批改时，AI 收到的核心指令。它决定了这位老师会盯什么、放过什么、怎么给分。
          </div>
        </div>

        <!-- 视图二：原文全文 -->
        <div v-else class="rounded-2xl p-6 neu">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-medium text-c-body">方法论原文（完整提炼稿）</div>
            <div class="text-xs text-c-muted tnum">{{ docLoading ? '加载中…' : `${(doc.length / 1000).toFixed(1)}k 字符` }}</div>
          </div>
          <div v-if="docLoading" class="text-xs text-c-muted py-6 text-center">正在加载…</div>
          <div v-else class="rounded-xl p-5 neu-inset max-h-[620px] overflow-y-auto">
            <pre class="text-[13px] text-c-body whitespace-pre-wrap leading-7 max-w-prose mx-auto"
              style="font-family: inherit">{{ doc }}</pre>
          </div>
          <div class="text-xs text-c-muted mt-3 leading-5">
            原文来自该老师公开课程/讲义的提炼稿。本工具仅提炼其公开做题方法论，与老师本人无关；
            所有批改意见均由 AI 生成，仅供学习参考。
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { TEACHER_LIST, TEACHERS } from '../agents/teachers'
import { loadTeacherDoc } from '../agents/skills'

const VIEWS = [
  { key: 'method', label: '方法论要点' },
  { key: 'raw', label: '原文全文' },
]

const active = ref(TEACHER_LIST[0].id)
const view = ref('method')
const doc = ref('')
const docLoading = ref(false)

const teacher = computed(() => TEACHERS[active.value])

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
