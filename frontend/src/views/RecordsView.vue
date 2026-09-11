<template>
  <div class="max-w-6xl mx-auto px-6 md:px-8 py-10">

    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">复盘</h1>
        <p class="text-sm text-gray-500 mt-1.5">
          共 {{ filtered.length }} 篇 ·
          <span class="text-gray-400">归档在 docs/practice/，也可在这里回看</span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="keyword" type="text" placeholder="搜索题目"
          class="px-3.5 py-2 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none w-44
            text-gray-700 placeholder:text-gray-400" />
        <select v-model="modeFilter"
          class="px-3.5 py-2 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none text-gray-700">
          <option value="">全部模式</option>
          <option value="solo">单老师</option>
          <option value="duo">双老师</option>
          <option value="trio">三师圆桌</option>
          <option value="roundtable">五师圆桌</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="rounded-2xl p-16 neu text-center text-gray-400 text-sm">
      正在读取记录…
    </div>

    <div v-else-if="filtered.length" class="grid grid-cols-1 lg:grid-cols-3 gap-6">

      <!-- 左：列表 -->
      <div class="lg:col-span-1 space-y-3">
        <div v-for="r in filtered" :key="r.id" @click="select(r.id)"
          class="rounded-2xl p-4 cursor-pointer transition-all duration-300"
          :class="currentId === r.id
            ? 'neu-inset'
            : 'neu-sm hover:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]'">
          <div class="flex items-center gap-3">
            <ScoreRing :score="r.finalScore" :max="r.maxScore || 40" :size="40" :stroke="4" />
            <div class="min-w-0 flex-1">
              <div class="text-sm text-gray-700 truncate">{{ r.title || '未命名练习' }}</div>
              <div class="flex items-center gap-1.5 mt-1">
                <span v-for="id in r.teacherIds || []" :key="id"
                  class="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  :style="{ background: teacherColor(id) + '20', color: teacherColor(id), fontSize: '9px' }">
                  {{ teacherAvatar(id) }}
                </span>
                <span class="text-xs text-gray-400 tnum ml-1">{{ fmtDateTime(r.createdAt) }}</span>
              </div>
            </div>
            <span v-if="r.source === 'docs' || r.source === 'both'"
              class="text-xs px-1.5 py-0.5 rounded shrink-0"
              style="background: #e1f5ee; color: #0f6e56" title="已归档到 docs/practice/">docs</span>
          </div>
        </div>
      </div>

      <!-- 右：详情 -->
      <div class="lg:col-span-2">
        <div v-if="detail" class="rounded-2xl p-6 neu">

          <div class="flex items-start justify-between gap-4 mb-5">
            <div class="min-w-0">
              <div class="text-base font-medium text-gray-800">{{ detail.title || '未命名练习' }}</div>
              <div class="text-xs text-gray-400 mt-1.5 tnum">
                {{ fmtDateTime(detail.createdAt) }} · {{ detail.wordCount }} 字
                <span v-if="detail.elapsed"> · 耗时 {{ (detail.elapsed / 1000).toFixed(1) }}s</span>
                · {{ MODE_LABEL[detail.mode] || detail.mode }}
              </div>
            </div>
            <button @click="del(detail.id)" class="text-xs text-gray-400 hover:text-[#a32d2d] shrink-0">
              删除
            </button>
          </div>

          <!-- 分数 -->
          <div class="flex items-center gap-5 mb-6">
            <ScoreRing :score="detail.finalScore" :max="detail.maxScore || 40" />
            <div class="min-w-0">
              <div class="text-sm text-gray-700">{{ detail.level || '批改完成' }}</div>
              <div class="text-xs text-gray-500 mt-1 tnum">
                {{ detail.finalScore }} / {{ detail.maxScore || 40 }} 分
              </div>
              <div v-if="detail.roundtableNote" class="text-xs text-gray-400 mt-2 leading-5">
                {{ detail.roundtableNote }}
              </div>
            </div>
          </div>

          <!-- 老师色标批注 -->
          <div v-if="detail.answer" class="rounded-2xl p-5 neu-inset mb-6">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium text-gray-700">我的作答 · 老师批注</span>
              <button @click="showQuestion = !showQuestion"
                class="text-xs text-gray-500 hover:text-[#6d5dfc] transition-colors">
                {{ showQuestion ? '收起题目' : '查看题目' }}
              </button>
            </div>

            <div v-if="showQuestion" class="rounded-xl p-3.5 mb-4" style="background: #e0e5ec">
              <div v-if="detail.requirement" class="text-xs text-gray-600 leading-6 mb-2">
                {{ detail.requirement }}
              </div>
              <details v-if="detail.material" class="text-xs">
                <summary class="text-gray-500 cursor-pointer">给定资料（{{ countChars(detail.material) }} 字）</summary>
                <div class="text-gray-600 leading-6 mt-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {{ detail.material }}
                </div>
              </details>
            </div>

            <AnnotatedAnswer :answer="detail.answer" :results="detail.results || []" />
          </div>

          <!-- 各老师 -->
          <div v-for="r in detail.results || []" :key="r.teacherId" class="rounded-2xl p-4 mb-4"
            :style="{ borderLeft: `4px solid ${teacherColor(r.teacherId)}` }">
            <div class="flex items-center gap-3 mb-3">
              <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                :style="{ background: teacherColor(r.teacherId) + '22', color: teacherColor(r.teacherId) }">
                {{ teacherAvatar(r.teacherId) }}
              </span>
              <div class="text-sm font-medium text-gray-800">{{ teacherName(r.teacherId) }}</div>
              <div class="ml-auto text-sm tnum" :style="{ color: teacherColor(r.teacherId) }">
                {{ r.score }}<span class="text-xs text-gray-400"> / {{ r.maxScore }}</span>
              </div>
            </div>

            <div v-if="r.advice" class="rounded-xl p-3.5 mb-3" :style="{ background: teacherColor(r.teacherId) + '0f' }">
              <div class="text-xs font-medium mb-1.5" :style="{ color: teacherColor(r.teacherId) }">修改建议</div>
              <div class="text-sm text-gray-700 leading-7">{{ r.advice }}</div>
            </div>

            <details v-if="r.annotations?.length" class="mb-2">
              <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
                逐句批注（{{ r.annotations.length }}）
              </summary>
              <div class="space-y-2 mt-2">
                <div v-for="(a, j) in r.annotations" :key="j" class="text-xs leading-6">
                  <span class="px-1.5 py-0.5 rounded mr-1.5"
                    :style="{ background: teacherColor(r.teacherId) + '1f', color: teacherColor(r.teacherId) }">
                    {{ a.type || '问题' }}
                  </span>
                  <span v-if="a.quote" class="text-gray-500 italic">「{{ truncate(a.quote, 24) }}」</span>
                  <div v-if="a.comment" class="text-gray-700 mt-1">{{ a.comment }}</div>
                  <div v-if="a.fix" style="color: #0f6e56">改：{{ a.fix }}</div>
                </div>
              </div>
            </details>

            <details v-if="r.dimensions?.length" class="mb-2">
              <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
                分项得分（{{ r.dimensions.length }}）
              </summary>
              <div class="space-y-2 mt-2">
                <div v-for="d in r.dimensions" :key="d.name" class="text-xs">
                  <div class="flex justify-between mb-1">
                    <span class="text-gray-700">{{ d.name }}</span>
                    <span class="text-gray-500 tnum">{{ d.score }}/{{ d.max }}</span>
                  </div>
                  <div class="h-1 rounded-full neu-inset overflow-hidden">
                    <div class="h-full rounded-full"
                      :style="{ width: pct(d.score, d.max) + '%', background: teacherColor(r.teacherId) }" />
                  </div>
                </div>
              </div>
            </details>

            <details v-if="r.deductions?.length" class="mb-2">
              <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
                扣分点（{{ r.deductions.length }}）
              </summary>
              <div class="space-y-2 mt-2">
                <div v-for="(d, j) in r.deductions" :key="j" class="text-xs leading-6">
                  <span class="text-gray-700">{{ d.point }}</span>
                  <span v-if="d.reason" class="text-gray-500"> —— {{ d.reason }}</span>
                  <div v-if="d.fix" style="color: #0f6e56">改：{{ d.fix }}</div>
                </div>
              </div>
            </details>

            <details v-if="r.rewrites?.length" class="mb-2">
              <summary class="text-xs text-gray-500 cursor-pointer hover:text-[#6d5dfc]">
                改写示例（{{ r.rewrites.length }}）
              </summary>
              <div class="space-y-2 mt-2">
                <div v-for="(w, j) in r.rewrites" :key="j" class="text-xs leading-6">
                  <div class="text-gray-400 line-through">{{ w.original }}</div>
                  <div style="color: #0f6e56">{{ w.rewritten }}</div>
                </div>
              </div>
            </details>

            <div v-if="r.summary" class="text-xs text-gray-600 leading-6 mt-2 pt-2 border-t border-gray-200">
              {{ r.summary }}
            </div>
          </div>

          <!-- 圆桌分歧 -->
          <div v-if="detail.debate?.disputes?.length" class="mb-5">
            <div class="text-xs text-gray-500 mb-2">圆桌分歧裁定</div>
            <div class="space-y-2">
              <div v-for="(d, i) in detail.debate.disputes" :key="i" class="rounded-xl p-3 neu-inset">
                <div class="text-xs font-medium text-gray-700">{{ d.topic }}</div>
                <div class="text-xs text-[#6d5dfc] mt-1.5 leading-6">裁定：{{ d.ruling }}</div>
              </div>
            </div>
          </div>

          <!-- 综合结论 -->
          <div v-if="detail.summary">
            <div class="text-xs text-gray-500 mb-2">综合结论</div>
            <div class="text-sm text-gray-700 leading-7 whitespace-pre-wrap">{{ detail.summary }}</div>
          </div>

          <div v-if="detail.criticalIssues?.length" class="mt-5">
            <div class="text-xs text-gray-500 mb-2">优先解决</div>
            <div class="space-y-2">
              <div v-for="(d, i) in detail.criticalIssues" :key="i" class="text-xs leading-6">
                <span class="font-medium text-gray-700">{{ d.issue }}</span>
                <span v-if="d.source" class="text-gray-400">（{{ d.source }}）</span>
                <div v-if="d.fix" style="color: #0f6e56">改：{{ d.fix }}</div>
              </div>
            </div>
          </div>

          <div v-if="detail.suggestions?.length" class="mt-5">
            <div class="text-xs text-gray-500 mb-2">改进建议</div>
            <ul class="space-y-1.5">
              <li v-for="(s, i) in detail.suggestions" :key="i" class="text-sm text-gray-700 flex gap-2 leading-6">
                <span class="text-[#6d5dfc] shrink-0 tnum">{{ i + 1 }}.</span><span>{{ s }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div v-else-if="currentId" class="rounded-2xl p-16 neu text-center text-gray-400 text-sm">
          正在读取详情…
        </div>
        <div v-else class="rounded-2xl p-20 neu text-center text-gray-400 text-sm">
          左侧选一篇查看复盘
        </div>
      </div>
    </div>

    <div v-else class="rounded-2xl p-16 neu text-center text-gray-400">
      <div class="text-sm">{{ keyword || modeFilter ? '没有匹配的记录' : '还没有练习记录' }}</div>
      <RouterLink v-if="!keyword && !modeFilter" to="/practice"
        class="inline-block mt-4 px-4 py-2 rounded-xl text-xs font-medium neu text-[#6d5dfc]">
        去练习 →
      </RouterLink>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ScoreRing from '../components/ScoreRing.vue'
import AnnotatedAnswer from '../components/AnnotatedAnswer.vue'
import { TEACHERS, MODE_LABEL } from '../agents/teachers'
import {
  listAllRecords,
  loadRecordDetail,
  deleteRecordEverywhere,
  countChars,
  fmtDateTime,
} from '../utils/record'

const route = useRoute()
const records = ref([])
const keyword = ref('')
const modeFilter = ref('')
const currentId = ref('')
const detail = ref(null)
const loading = ref(true)
const showQuestion = ref(false)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  let list = records.value
  if (k) list = list.filter((r) => (r.title || '').toLowerCase().includes(k))
  if (modeFilter.value) list = list.filter((r) => r.mode === modeFilter.value)
  return list
})

const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0)
const truncate = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : s)
const teacherName = (id) => TEACHERS[id]?.name || id
const teacherAvatar = (id) => TEACHERS[id]?.avatar || '?'
const teacherColor = (id) => TEACHERS[id]?.color || '#6d5dfc'

async function load() {
  loading.value = true
  records.value = await listAllRecords()
  loading.value = false

  const target = route.query.id
  const pick = target && records.value.some((r) => r.id === target)
    ? target
    : records.value[0]?.id
  if (pick) await select(pick)
}

async function select(id) {
  currentId.value = id
  detail.value = null
  detail.value = await loadRecordDetail(id)
}

async function del(id) {
  await deleteRecordEverywhere(id)
  if (currentId.value === id) {
    currentId.value = ''
    detail.value = null
  }
  await load()
}

watch(() => route.query.id, load)
onMounted(load)
</script>
