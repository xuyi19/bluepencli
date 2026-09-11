<template>
  <div class="w-full">

    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">题库</h1>
        <p class="text-sm text-gray-500 mt-1">
          内置 {{ builtin.length }} 道真题 · 自建 {{ mine.length }} 道
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="keyword" type="text" placeholder="搜索题目"
          class="px-3 py-2 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none w-48
            text-gray-700 placeholder:text-gray-400" />
        <button @click="showImport = !showImport"
          class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-[#6d5dfc]">
          + 录入题目
        </button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="rounded-2xl p-5 neu mb-6">
      <div class="text-xs text-gray-500 mb-2">按题型</div>
      <div class="flex flex-wrap gap-1.5">
        <button @click="typeFilter = ''"
          class="px-3 py-1.5 rounded-lg text-xs transition-all"
          :class="!typeFilter ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
          全部
        </button>
        <button v-for="t in QUESTION_TYPES" :key="t" @click="typeFilter = t"
          class="px-3 py-1.5 rounded-lg text-xs transition-all"
          :class="typeFilter === t ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
          {{ t }}
          <span class="tnum opacity-60">{{ countByType(t) }}</span>
        </button>
      </div>
    </div>

    <!-- 录入面板 -->
    <div v-if="showImport" class="rounded-2xl p-5 neu mb-6">
      <div class="text-sm font-medium text-gray-700 mb-3">录入题目</div>
      <div class="space-y-3">
        <input v-model="draft.title" type="text" placeholder="题干"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
            text-gray-700 placeholder:text-gray-400" />
        <div class="grid grid-cols-3 gap-3">
          <select v-model="draft.type"
            class="px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none text-gray-700">
            <option value="">题型</option>
            <option v-for="t in QUESTION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model.number="draft.maxScore" type="number" placeholder="满分"
            class="px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
              text-gray-700 placeholder:text-gray-400 tnum" />
          <input v-model.number="draft.wordLimit" type="number" placeholder="字数"
            class="px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
              text-gray-700 placeholder:text-gray-400 tnum" />
        </div>
        <input v-model="draft.exam" type="text" placeholder="来源（如 2024 国考副省级）"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
            text-gray-700 placeholder:text-gray-400" />
        <textarea v-model="draft.requirement" rows="2" placeholder="作答要求"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
            text-gray-700 placeholder:text-gray-400" />
        <textarea v-model="draft.material" rows="6" placeholder="给定资料"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
            text-gray-700 placeholder:text-gray-400" />
        <textarea v-model="draft.reference" rows="4" placeholder="参考答案 / 范文（选填）"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
            text-gray-700 placeholder:text-gray-400" />
        <div class="flex gap-2">
          <button @click="saveQuestion" :disabled="!draft.title"
            class="px-4 py-2 rounded-xl text-sm font-medium neu text-[#6d5dfc] disabled:opacity-40">
            保存
          </button>
          <button @click="showImport = false"
            class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-gray-500">取消</button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="filtered.length" class="space-y-3">
      <div v-for="q in filtered" :key="q.id" class="rounded-2xl p-5 neu-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span v-if="q.builtin" class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #eeedfe; color: #534ab7">内置</span>
              <span v-if="q.type" class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #e6f1fb; color: #185fa5">{{ q.type }}</span>
              <div class="text-sm font-medium text-gray-800 truncate">{{ q.title }}</div>
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <span v-if="q.exam" class="text-xs px-2 py-0.5 rounded-md neu-inset text-gray-500">
                {{ q.exam }}
              </span>
              <span v-if="q.maxScore" class="text-xs text-gray-400 tnum">{{ q.maxScore }} 分</span>
              <span v-if="q.wordLimit" class="text-xs text-gray-400 tnum">≤{{ q.wordLimit }} 字</span>
              <span v-for="t in q.topics || []" :key="t"
                class="text-xs px-1.5 py-0.5 rounded" style="background: #f1efe8; color: #5f5e5a">
                {{ t }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click="practiceWith(q)"
              class="px-3 py-1.5 rounded-lg text-xs neu-inset text-gray-600 hover:text-[#6d5dfc]">
              做这道题
            </button>
            <button v-if="!q.builtin" @click="del(q.id)"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400
                hover:text-red-500 hover:bg-white/50 transition-colors">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="rounded-2xl p-12 neu text-center text-gray-400">
      <div class="text-sm">{{ keyword || typeFilter ? '没有匹配的题目' : '题库还是空的' }}</div>
      <div class="text-xs text-gray-400 mt-2 leading-5">
        可以录入自己的题目，或等内置题库补充
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Message } from '@arco-design/web-vue'
import { getAll, put, remove, uid, STORES } from '../store/db'
import { BUILTIN_QUESTIONS, QUESTION_TYPES, withPrefix } from '../data/builtin-questions'

const router = useRouter()

const builtin = ref(BUILTIN_QUESTIONS.map(withPrefix))
const mine = ref([])
const keyword = ref('')
const typeFilter = ref('')
const showImport = ref(false)

const draft = reactive({
  title: '', type: '', exam: '', requirement: '',
  material: '', reference: '', maxScore: 25, wordLimit: null,
})

const pool = computed(() => [...mine.value, ...builtin.value])

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return pool.value.filter((q) => {
    if (typeFilter.value && q.type !== typeFilter.value) return false
    if (!k) return true
    return q.title.toLowerCase().includes(k) || (q.exam || '').toLowerCase().includes(k)
  })
})

function countByType(t) {
  return pool.value.filter((q) => q.type === t).length
}

async function load() {
  mine.value = await getAll(STORES.questions)
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
  Message.success('已保存')
}

async function del(id) {
  await remove(STORES.questions, id)
  await load()
}

function practiceWith(q) {
  router.push({
    path: '/practice',
    query: { title: q.title, material: q.material, questionId: q.id },
  })
}

onMounted(load)
</script>
