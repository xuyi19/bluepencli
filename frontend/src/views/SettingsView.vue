<template>
  <div class="w-full max-w-5xl">

    <h1 class="text-xl font-semibold text-c-ink mb-1">设置</h1>
    <p class="text-sm text-c-muted mb-8">配置大模型 API。Key 只保存在这台电脑的浏览器里，不上传服务器</p>

    <!-- ==================== 状态总览 ==================== -->
    <section class="rounded-2xl p-5 md:p-6 neu mb-6">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
          :style="{ background: ready ? '#dce2cf' : '#f2ebe2' }">
          <span v-if="ready" class="w-3.5 h-3.5 rounded-full" style="background: #8b9d77" />
          <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#b4552d" stroke-width="2">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          </svg>
        </div>
        <div class="min-w-0">
          <div class="font-medium text-c-ink">{{ ready ? 'API 已就绪' : '尚未配置 API' }}</div>
          <div class="text-xs text-c-muted mt-1 leading-5">{{ readyHint }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 mt-5 border-t border-c-line">
        <div v-for="s in summary" :key="s.label">
          <div class="text-xs text-c-muted">{{ s.label }}</div>
          <div class="text-sm font-medium mt-1.5 leading-5" :style="{ color: s.color }">{{ s.value }}</div>
          <div class="text-xs text-c-muted mt-1 leading-5">{{ s.hint }}</div>
        </div>
      </div>
    </section>

    <!-- ==================== API 配置 ==================== -->
    <section class="rounded-2xl p-6 md:p-8 neu mb-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-base font-medium text-c-ink">API 配置</h2>
        <button @click="showAdvanced = !showAdvanced"
          class="text-xs text-c-muted hover:text-c-bark transition-colors">
          {{ showAdvanced ? '收起高级' : '高级设置' }}
        </button>
      </div>

      <div class="space-y-6">

        <!-- 服务商预设 -->
        <div>
          <label class="text-xs text-c-muted mb-3 block">服务商预设（点一下自动填地址与模型）</label>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button v-for="p in PRESETS" :key="p.name" @click="applyPreset(p)"
              class="px-3 py-3.5 text-xs md:text-sm font-medium rounded-xl transition-all duration-300 text-left"
              :class="samePreset(p) ? 'neu-inset' : 'neu-sm'">
              <span :class="samePreset(p) ? 'text-c-bark' : 'text-c-body'">{{ p.name }}</span>
              <span class="block text-xs font-normal mt-1 truncate"
                :class="samePreset(p) ? 'text-c-bark' : 'text-c-muted'">{{ p.model }}</span>
            </button>
          </div>
          <div class="text-xs text-c-muted mt-3">
            还没有 Key？
            <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
              class="text-c-bark hover:underline">DeepSeek 注册</a>
            ·
            <a href="https://open.bigmodel.cn" target="_blank" rel="noreferrer"
              class="text-c-bark hover:underline">智谱 GLM 注册</a>
          </div>
        </div>

        <!-- API Key -->
        <div>
          <label class="text-xs text-c-muted mb-2.5 block">
            API Key
            <span v-if="serverKey" class="text-c-muted">（服务端已托管，可留空）</span>
            <span v-else class="text-c-clay">*</span>
          </label>
          <div class="relative">
            <input v-model="cfg.api_key" :type="showKey ? 'text' : 'password'" placeholder="sk-..."
              class="w-full px-4 py-3 pr-16 rounded-xl text-sm text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
            <button @click="showKey = !showKey"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-c-muted hover:text-c-bark">
              {{ showKey ? '隐藏' : '显示' }}
            </button>
          </div>
          <div class="text-xs text-c-muted mt-2">只保存在浏览器 localStorage，不会上传服务器</div>
        </div>

        <!-- Base URL / 模型 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-c-muted mb-2.5 block">Base URL</label>
            <input v-model="cfg.base_url" type="text" placeholder="https://api.deepseek.com/v1"
              class="w-full px-4 py-3 rounded-xl text-xs text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
          </div>
          <div>
            <label class="text-xs text-c-muted mb-2.5 block">模型名称</label>
            <input v-model="cfg.model" type="text" placeholder="deepseek-chat"
              class="w-full px-4 py-3 rounded-xl text-xs text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
          </div>
        </div>

        <!-- 高级：自定义服务端地址 -->
        <div v-if="showAdvanced" class="rounded-xl p-4 md:p-5 neu-inset space-y-3">
          <div>
            <label class="text-xs text-c-muted mb-2 block">自定义服务端地址（可选）</label>
            <input v-model="backendUrl" type="text" placeholder="留空则自动探测"
              class="w-full px-4 py-3 rounded-xl text-xs text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
            <div class="text-xs text-c-muted mt-2 leading-5">
              当前通道：<span :style="{ color: channel.color }">{{ channel.label }}</span>。
              填域名即可，程序会自动补 /api/v1。
            </div>
          </div>
          <button @click="saveBackend"
            class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-body hover:text-c-bark">
            保存并重新探测
          </button>
        </div>
      </div>

      <div v-if="testResult" class="mt-6 p-4 rounded-xl text-xs leading-6"
        :class="testResult.ok ? 'bg-[#e8ecdf] text-[#4f7d5e]' : 'bg-[#f7e9e4] text-[#b4552d]'">
        <div class="whitespace-pre-wrap">{{ testResult.msg }}</div>
      </div>

      <div class="flex flex-wrap gap-3 mt-8 pt-6 border-t border-c-line">
        <button @click="clearConfig"
          class="px-5 py-3 rounded-xl text-sm font-medium neu-sm text-c-muted hover:text-c-clay">
          清空
        </button>
        <button @click="test" :disabled="testing || !ready"
          class="px-5 py-3 rounded-xl text-sm font-medium neu-sm text-c-body
            hover:text-c-bark disabled:opacity-50">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button @click="save" :disabled="!ready"
          class="flex-1 min-w-[8rem] px-5 py-3 rounded-xl text-sm font-medium text-c-cream
            bg-c-bark disabled:opacity-50 transition-colors duration-300">
          保存配置
        </button>
      </div>
    </section>

    <!-- ==================== 使用说明 + 数据 ==================== -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

      <section class="rounded-2xl p-6 neu">
        <h2 class="text-base font-medium text-c-ink mb-5">使用说明</h2>
        <div class="space-y-3.5">
          <div v-for="(s, i) in steps" :key="i" class="flex gap-3">
            <span class="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 tnum"
              style="background: #f2ebe2; color: #5c4033">{{ i + 1 }}</span>
            <span class="text-sm text-c-body leading-6">{{ s }}</span>
          </div>
        </div>
        <div class="mt-5 p-4 rounded-xl text-xs leading-6"
          style="background: #f7eddc; color: #9c6b2f">
          <strong>说明：</strong>{{ note }}
        </div>
      </section>

      <section class="rounded-2xl p-6 neu">
        <h2 class="text-base font-medium text-c-ink mb-5">数据</h2>
        <div class="space-y-3">
          <button v-for="a in DATA_ACTIONS" :key="a.key" @click="a.run()"
            class="w-full flex items-center gap-3 rounded-xl p-4 neu-sm text-left
              transition-all duration-300 hover:translate-y-px">
            <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 neu-inset"
              :style="{ color: a.danger ? '#b4552d' : '#5c4033' }" v-html="a.icon" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-c-body">{{ a.label }}</span>
              <span class="block text-xs text-c-muted mt-0.5 leading-5">{{ a.desc }}</span>
            </span>
          </button>
        </div>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="doImport" />
      </section>
    </div>

    <!-- ==================== 关于 ==================== -->
    <section class="rounded-2xl p-6 neu-sm">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-medium text-c-body">关于</div>
        <div class="text-xs text-c-muted tnum">v{{ appVersion }}</div>
      </div>
      <div class="text-xs text-c-muted leading-6 space-y-1.5">
        <div>蓝笔申论 · 公考申论 AI 批改工具</div>
        <div>作答、笔记、错题全部存在本机，后端不保存这些内容</div>
        <div>批改费用由你自己的 API 账户承担，单次约几分钱</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import { toast } from '../utils/toast'
import { getConfig, saveConfig, testConnection } from '../api/llm'
import {
  backendInfo,
  fetchLLMDefault,
  getBackendUrl,
  probeBackend,
  setBackendUrl,
} from '../api/backend'
import { exportAll, importAll, clear, STORES } from '../store/db'
import { CURRENT_VERSION } from '../data/changelog'

// 服务商预设：点了自动填 Base URL 与模型名，省得用户去查文档
const PRESETS = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

const ICONS = {
  export: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  import: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 8l5-5 5 5M12 3v12"/></svg>',
  clear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
}

const cfg = reactive({ base_url: '', api_key: '', model: '' })
const showKey = ref(false)
const showAdvanced = ref(false)
const testing = ref(false)
const testResult = ref(null)
const fileInput = ref(null)

const backendUrl = ref('')
const backendAvailable = ref(false)
const backendMeta = ref(null)
const serverKey = ref(null) // 服务端托管的 LLM 配置（不含 Key 本身）

/** 能不能直接开批改：要么服务端托管了 Key，要么自己填了 */
const ready = computed(() => !!serverKey.value || !!cfg.api_key)

const appVersion = computed(() => backendMeta.value?.version || CURRENT_VERSION)

const readyHint = computed(() => {
  if (serverKey.value) {
    return `由服务端统一提供（${serverKey.value.model}），本机什么都不用填`
  }
  if (cfg.api_key) return `当前模型：${cfg.model || '未设置'}`
  return '填入下方 API Key 即可开始批改'
})

const channel = computed(() =>
  backendAvailable.value
    ? { label: '已连上本地服务', color: '#4f7d5e' }
    : { label: '浏览器直连', color: '#a8a29e' }
)

/** 状态总览三栏：通道 / 模型 / Key 来源 */
const summary = computed(() => [
  {
    label: '当前通道',
    value: backendAvailable.value ? '本地服务转发' : '浏览器直连',
    hint: backendAvailable.value
      ? '后端已就绪，请求经后端转发'
      : '后端未连接，请求由浏览器直接发出',
    color: backendAvailable.value ? '#4f7d5e' : '#78716c',
  },
  {
    label: '使用模型',
    value: serverKey.value?.model || cfg.model || '未设置',
    hint: serverKey.value ? '由服务端指定' : '取本机配置',
    color: '#5c4033',
  },
  {
    label: 'Key 来源',
    value: serverKey.value ? '服务端托管' : cfg.api_key ? '本机浏览器' : '未配置',
    hint: serverKey.value
      ? 'Key 不下发到浏览器'
      : cfg.api_key
        ? '仅存 localStorage'
        : '批改功能不可用',
    color: cfg.api_key || serverKey.value ? '#4f7d5e' : '#b4552d',
  },
])

const steps = computed(() =>
  serverKey.value
    ? [
        '服务端已经配好了模型，本机不用填任何东西，直接去「练习批改」开始用',
        '想换成自己的账号：点上面的服务商预设自动填地址与模型，再粘贴自己的 Key',
        '点「测试连接」验证通路，通过后点「保存配置」',
      ]
    : [
        '注册 DeepSeek 或智谱账号，在控制台创建 API Key',
        '点上面的服务商预设，自动填充 Base URL 与模型名',
        '粘贴你的 API Key，点「测试连接」验证',
        '点「保存配置」，即可开始使用',
      ]
)

const note = computed(() =>
  serverKey.value
    ? 'API Key 由服务端统一提供，不会下发到浏览器——上面的输入框留空即可正常批改。'
    : '你的 API Key 只保存在浏览器 localStorage，不上传服务器。更换设备需要重新配置。'
)

const DATA_ACTIONS = [
  {
    key: 'export', label: '导出全部数据', desc: '存成 JSON，可换设备导入或备份',
    icon: ICONS.export, run: () => doExport(),
  },
  {
    key: 'import', label: '导入数据', desc: '从备份文件恢复练习记录与文章笔记',
    icon: ICONS.import, run: () => fileInput.value?.click(),
  },
  {
    key: 'clear', label: '清空所有数据', desc: '删除本机全部练习记录，无法恢复',
    icon: ICONS.clear, danger: true, run: () => doClearAll(),
  },
]

onMounted(async () => {
  const saved = getConfig()
  cfg.base_url = saved.base_url || PRESETS[0].base_url
  cfg.api_key = saved.api_key || ''
  cfg.model = saved.model || PRESETS[0].model
  backendUrl.value = getBackendUrl()
  await refreshBackend()
})

async function refreshBackend(force = false) {
  const ok = await probeBackend({ force })
  backendAvailable.value = ok
  backendMeta.value = backendInfo()
  const def = await fetchLLMDefault()
  serverKey.value = def?.server_key_configured ? def : null
  if (force) toast.success(ok ? '已连接本地服务' : '未检测到本地服务，将使用浏览器直连')
}

function samePreset(p) {
  return cfg.base_url.replace(/\/+$/, '') === p.base_url.replace(/\/+$/, '')
}

function applyPreset(p) {
  cfg.base_url = p.base_url
  cfg.model = p.model
  testResult.value = null
}

function saveBackend() {
  setBackendUrl(backendUrl.value)
  refreshBackend(true)
}

/** 组装一份干净配置写入 localStorage */
function persist() {
  saveConfig({
    base_url: cfg.base_url.trim() || PRESETS[0].base_url,
    api_key: cfg.api_key.trim(),
    model: cfg.model.trim() || PRESETS[0].model,
  })
}

function save() {
  persist()
  testResult.value = null
  toast.success('配置已保存')
}

function clearConfig() {
  cfg.api_key = ''
  cfg.base_url = PRESETS[0].base_url
  cfg.model = PRESETS[0].model
  saveConfig({ base_url: cfg.base_url, api_key: '', model: cfg.model })
  testResult.value = null
  toast.success('已清空')
}

async function test() {
  persist() // 测试用的就是当前输入，所以先落盘
  testing.value = true
  testResult.value = null
  try {
    const r = await testConnection()
    const via = r.via === 'backend' ? '经服务端' : '浏览器直连'
    testResult.value = { ok: true, msg: `✓ ${via} · 连接正常（${r.ms}ms）\n模型返回：${r.text}` }
  } catch (e) {
    testResult.value = { ok: false, msg: `✗ ${e.message}` }
  } finally {
    testing.value = false
  }
}

async function doExport() {
  const snapshot = await exportAll()
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  a.download = `蓝笔申论-备份-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  toast.success('已导出')
}

async function doImport(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const count = await importAll(JSON.parse(text))
    toast.success(`已导入 ${count} 条记录`)
  } catch (err) {
    toast.error('导入失败：文件格式不对')
  }
  e.target.value = ''
}

async function doClearAll() {
  const ok = await toast.confirm(
    '会删除所有练习记录、文章和笔记，且无法恢复。建议先导出备份。',
    { title: '确认清空', okText: '确认清空' },
  )
  if (!ok) return
  for (const s of Object.values(STORES)) await clear(s)
  toast.success('已清空')
}
</script>
