<template>
  <div class="w-full">

    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-gray-800">文章库</h1>
        <p class="text-sm text-gray-500 mt-1">
          内置 {{ builtin.length }} 篇官媒时评 · 自建 {{ mine.length }} 篇
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input v-model="keyword" type="text" placeholder="搜索标题或标签"
          class="px-3 py-2 rounded-xl text-sm bg-[#e0e5ec] neu-inset outline-none w-44
            text-gray-700 placeholder:text-gray-400" />
        <button @click="showImport = !showImport"
          class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-[#6d5dfc]">
          {{ showImport ? '收起' : '+ 导入' }}
        </button>
        <button v-if="mine.length" @click="exportMine"
          class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-gray-600 hover:text-[#6d5dfc]">
          导出
        </button>
      </div>
    </div>

    <!-- 来源切换 + 主题筛选 -->
    <div class="rounded-2xl p-5 neu mb-6">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <button v-for="s in SOURCES" :key="s.key" @click="source = s.key"
          class="px-3.5 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="source === s.key ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
          {{ s.label }}
          <span class="tnum ml-1 opacity-60">{{ s.count }}</span>
        </button>
      </div>

      <div v-if="topicList.length" class="pt-3 border-t border-gray-200">
        <div class="text-xs text-gray-500 mb-2">按主题</div>
        <div class="flex flex-wrap gap-1.5">
          <button @click="topic = ''"
            class="px-2.5 py-1 rounded-lg text-xs transition-all"
            :class="!topic ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
            全部
          </button>
          <button v-for="t in topicList" :key="t.name" @click="topic = t.name"
            class="px-2.5 py-1 rounded-lg text-xs transition-all"
            :class="topic === t.name ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
            {{ t.name }} <span class="tnum opacity-60">{{ t.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 导入面板 ============ -->
    <div v-if="showImport" class="rounded-2xl p-5 neu mb-6">
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <button v-for="m in IMPORT_MODES" :key="m.key" @click="importMode = m.key"
          class="px-3.5 py-1.5 rounded-lg text-xs transition-all duration-200"
          :class="importMode === m.key ? 'neu-inset text-[#6d5dfc] font-medium' : 'neu-sm text-gray-600'">
          {{ m.label }}
        </button>
      </div>

      <!-- 模式一：粘贴 -->
      <div v-if="importMode === 'paste'" class="space-y-3">
        <input v-model="draft.title" type="text" placeholder="标题"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
            text-gray-700 placeholder:text-gray-400" />
        <div class="grid grid-cols-2 gap-3">
          <input v-model="draft.source" type="text" placeholder="来源"
            class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
              text-gray-700 placeholder:text-gray-400" />
          <input v-model="draft.topics" type="text" placeholder="主题标签，逗号分隔"
            class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
              text-gray-700 placeholder:text-gray-400" />
        </div>
        <input v-model="draft.url" type="text" placeholder="原文链接（选填）"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
            text-gray-700 placeholder:text-gray-400" />
        <textarea v-model="draft.content" rows="8" placeholder="粘贴文章全文"
          class="w-full px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none resize-none
            text-gray-700 placeholder:text-gray-400" />
        <div class="flex gap-2">
          <button @click="saveArticle" :disabled="!draft.title || !draft.content"
            class="px-4 py-2 rounded-xl text-sm font-medium neu text-[#6d5dfc] disabled:opacity-40">
            保存
          </button>
          <button @click="showImport = false"
            class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-gray-500">取消</button>
        </div>
      </div>

      <!-- 模式二：上传文件 / 文件夹 -->
      <div v-else-if="importMode === 'file'" class="space-y-4">
        <div class="rounded-xl p-4 neu-inset">
          <div class="text-xs text-gray-500 leading-6">
            支持 <span class="text-gray-700">.txt / .md</span> 单篇或整个文件夹批量导入，
            也支持本工具导出的 <span class="text-gray-700">.json 文章包</span>。
            标题自动取 Markdown 首个 # 标题，没标题就用文件名。
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button @click="fileInput?.click()"
            class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-[#6d5dfc]">
            选择文件
          </button>
          <button @click="folderInput?.click()"
            class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-[#6d5dfc]">
            选择文件夹
          </button>
          <button v-if="pending.length" @click="pending = []"
            class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-gray-500">清空</button>
        </div>

        <input ref="fileInput" type="file" multiple accept=".txt,.md,.markdown,.json,text/plain"
          class="hidden" @change="onPick" />
        <input ref="folderInput" type="file" webkitdirectory directory multiple
          class="hidden" @change="onPick" />

        <div v-if="pending.length" class="space-y-3">
          <div class="flex items-center gap-2">
            <input v-model="batchTopics" type="text" placeholder="给这批文章统一加主题（选填，逗号分隔）"
              class="flex-1 px-3 py-2 rounded-lg text-sm bg-[#e0e5ec] neu-inset outline-none
                text-gray-700 placeholder:text-gray-400" />
            <button @click="confirmPending"
              class="px-4 py-2 rounded-xl text-sm font-medium neu text-[#6d5dfc] shrink-0">
              导入 {{ pending.length }} 篇
            </button>
          </div>

          <div class="max-h-64 overflow-y-auto space-y-1.5">
            <label v-for="(p, i) in pending" :key="i"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg neu-inset cursor-pointer">
              <input type="checkbox" v-model="p._keep" class="accent-[#6d5dfc] shrink-0" />
              <span class="text-xs text-gray-700 truncate flex-1">{{ p.title }}</span>
              <span class="text-xs text-gray-400 tnum shrink-0">{{ p.wordCount }} 字</span>
            </label>
          </div>
        </div>

        <div v-else-if="skipped.length" class="text-xs text-gray-400 leading-6">
          已跳过 {{ skipped.length }} 个不支持的文件
        </div>
      </div>

      <!-- 模式三：导入文章包（JSON） -->
      <div v-else class="space-y-3">
        <div class="rounded-xl p-4 neu-inset">
          <div class="text-xs text-gray-500 leading-6">
            粘贴或选择一个文章包 JSON，格式为
            <code class="text-gray-700">{ "articles": [ { "title": "...", "content": "..." } ] }</code>。
            这是本工具「导出」功能的逆操作。
          </div>
        </div>
        <textarea v-model="packText" rows="10" placeholder="粘贴 JSON 内容…"
          class="w-full px-3 py-2 rounded-lg text-xs bg-[#e0e5ec] neu-inset outline-none resize-none
            text-gray-700 placeholder:text-gray-400 font-mono" />
        <div class="flex gap-2">
          <button @click="importPack" :disabled="!packText.trim()"
            class="px-4 py-2 rounded-xl text-sm font-medium neu text-[#6d5dfc] disabled:opacity-40">
            解析并导入
          </button>
          <button @click="packInput?.click()"
            class="px-4 py-2 rounded-xl text-sm font-medium neu-sm text-gray-600">选择文件</button>
          <input ref="packInput" type="file" accept=".json" class="hidden" @change="onPickPack" />
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="filtered.length" class="space-y-3">
      <div v-for="a in paged" :key="a.id" class="rounded-2xl p-5 neu-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span v-if="a.builtin"
                class="text-xs px-1.5 py-0.5 rounded shrink-0"
                style="background: #eeedfe; color: #534ab7">内置</span>
              <div class="text-sm font-medium text-gray-800 cursor-pointer hover:text-[#6d5dfc]
                transition-colors truncate" @click="open(a)">
                {{ a.title }}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <span v-if="a.source" class="text-xs px-2 py-0.5 rounded-md neu-inset text-gray-500">
                {{ a.source }}
              </span>
              <span v-for="t in a.topics" :key="t"
                class="text-xs px-2 py-0.5 rounded-md neu-inset text-[#6d5dfc]">{{ t }}</span>
              <span class="text-xs text-gray-400 tnum">{{ a.wordCount }} 字</span>
              <span v-if="a.date" class="text-xs text-gray-400 tnum">{{ a.date }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click="practiceWith(a)" title="用这篇文章出题练习"
              class="px-3 py-1.5 rounded-lg text-xs neu-inset text-gray-600 hover:text-[#6d5dfc]">
              练习
            </button>
            <button v-if="!a.builtin" @click="del(a.id)" title="删除"
              class="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400
                hover:text-red-500 hover:bg-white/50 transition-colors">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="filtered.length > pageSize" class="text-center pt-4">
        <button @click="pageSize += 20"
          class="px-5 py-2 rounded-xl text-xs font-medium neu-sm text-gray-600 hover:text-[#6d5dfc]">
          加载更多（{{ pageSize }} / {{ filtered.length }}）
        </button>
      </div>
    </div>

    <div v-else class="rounded-2xl p-10 neu text-center text-gray-400">
      <div class="text-sm">{{ keyword || topic ? '没有匹配的文章' : '这里还没有内容' }}</div>
    </div>

    <!-- 阅读弹窗 -->
    <div v-if="reading" class="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6"
      @click.self="reading = null">
      <div class="rounded-2xl neu max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div class="px-6 py-4 flex items-start justify-between gap-4 border-b border-gray-200">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800">{{ reading.title }}</div>
            <div class="text-xs text-gray-400 mt-1">
              {{ reading.source }}
              <span v-if="reading.date"> · {{ reading.date }}</span>
              <span class="tnum"> · {{ reading.wordCount }} 字</span>
            </div>
          </div>
          <button @click="reading = null"
            class="text-gray-400 hover:text-gray-700 text-lg leading-none shrink-0">×</button>
        </div>
        <div class="px-6 py-5 overflow-y-auto text-sm text-gray-700 leading-8 whitespace-pre-wrap">
          {{ reading.content }}
        </div>
        <div class="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <a v-if="reading.url" :href="reading.url" target="_blank" rel="noopener"
            class="text-xs text-gray-400 hover:text-[#6d5dfc] truncate">查看原文 →</a>
          <span v-else />
          <button @click="practiceWith(reading); reading = null"
            class="px-4 py-2 rounded-xl text-xs font-medium neu text-[#6d5dfc] shrink-0">
            用这篇练习
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Message } from '@arco-design/web-vue'
import { getAll, put, putMany, remove, uid, STORES } from '../store/db'
import { readFilesAsArticles, parseJsonPack, toPackJson, download } from '../utils/import'
import builtinData from '../data/builtin-articles.json'

const router = useRouter()

const IMPORT_MODES = [
  { key: 'paste', label: '粘贴文本' },
  { key: 'file', label: '上传文件 / 文件夹' },
  { key: 'pack', label: '导入文章包' },
]

const builtin = ref(
  (builtinData.articles || []).map((a) => ({ ...a, builtin: true, createdAt: 0 }))
)
const mine = ref([])
const keyword = ref('')
const topic = ref('')
const source = ref('all')
const showImport = ref(false)
const importMode = ref('file')
const reading = ref(null)
const pageSize = ref(20)

const draft = reactive({ title: '', source: '', topics: '', url: '', content: '' })
const pending = ref([])
const skipped = ref([])
const batchTopics = ref('')
const packText = ref('')
const fileInput = ref(null)
const folderInput = ref(null)
const packInput = ref(null)

const SOURCES = computed(() => [
  { key: 'all', label: '全部', count: builtin.value.length + mine.value.length },
  { key: 'builtin', label: '内置', count: builtin.value.length },
  { key: 'mine', label: '我导入的', count: mine.value.length },
])

const pool = computed(() => {
  if (source.value === 'builtin') return builtin.value
  if (source.value === 'mine') return mine.value
  return [...mine.value, ...builtin.value]
})

const topicList = computed(() => {
  const map = new Map()
  for (const a of pool.value) {
    for (const t of a.topics || []) map.set(t, (map.get(t) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return pool.value.filter((a) => {
    if (topic.value && !(a.topics || []).includes(topic.value)) return false
    if (!k) return true
    return (
      a.title.toLowerCase().includes(k) ||
      (a.topics || []).some((t) => String(t).toLowerCase().includes(k))
    )
  })
})

const paged = computed(() => filtered.value.slice(0, pageSize.value))

watch([keyword, topic, source], () => { pageSize.value = 20 })

async function load() {
  mine.value = await getAll(STORES.articles)
}

function normalize(a) {
  const now = Date.now()
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    title: String(a.title || '').trim() || '未命名文章',
    source: String(a.source || '').trim(),
    url: String(a.url || '').trim(),
    date: a.date || '',
    topics: Array.isArray(a.topics) ? a.topics : [],
    content: a.content,
    wordCount: a.wordCount || String(a.content || '').replace(/\s/g, '').length,
  }
}

async function saveArticle() {
  await put(STORES.articles, normalize({ ...draft, topics: splitTopics(draft.topics) }))
  Object.assign(draft, { title: '', source: '', topics: '', url: '', content: '' })
  showImport.value = false
  await load()
  Message.success('已保存')
}

function splitTopics(s) {
  return String(s || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
}

async function onPick(e) {
  const files = e.target.files
  if (!files?.length) return
  Message.info(`正在读取 ${files.length} 个文件…`)
  const { articles, skipped: sk } = await readFilesAsArticles(files)
  skipped.value = sk
  pending.value = articles.map((a) => ({ ...a, _keep: true }))
  e.target.value = ''
  if (!articles.length) Message.warning('没有解析出可导入的文章')
}

async function onPickPack(e) {
  const f = e.target.files?.[0]
  if (!f) return
  packText.value = await f.text()
  e.target.value = ''
  Message.info('已读取，点击「解析并导入」确认')
}

async function confirmPending() {
  const keep = pending.value.filter((p) => p._keep)
  if (!keep.length) return Message.warning('没有勾选任何文章')
  const extra = splitTopics(batchTopics.value)
  const list = keep.map((p) => normalize({ ...p, topics: [...(p.topics || []), ...extra] }))
  await putMany(STORES.articles, list)
  pending.value = []
  batchTopics.value = ''
  showImport.value = false
  await load()
  Message.success(`已导入 ${list.length} 篇`)
}

async function importPack() {
  try {
    const list = parseJsonPack(packText.value)
    if (!list.length) return Message.warning('文章包里没有有效文章')
    await putMany(STORES.articles, list.map(normalize))
    packText.value = ''
    showImport.value = false
    await load()
    Message.success(`已导入 ${list.length} 篇`)
  } catch (e) {
    Message.error(e.message)
  }
}

function exportMine() {
  if (!mine.value.length) return
  download(`蓝笔文章包-${new Date().toISOString().slice(0, 10)}.json`, toPackJson(mine.value))
  Message.success(`已导出 ${mine.value.length} 篇`)
}

async function del(id) {
  await remove(STORES.articles, id)
  await load()
  Message.success('已删除')
}

function open(a) {
  reading.value = a
}

function practiceWith(a) {
  router.push({
    path: '/practice',
    query: { title: `结合「${a.title}」相关主题，自拟题目作答`, material: a.content },
  })
}

onMounted(load)
</script>
