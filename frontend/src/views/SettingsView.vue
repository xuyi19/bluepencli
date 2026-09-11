<template>
  <div class="max-w-3xl">

    <h1 class="text-xl font-semibold text-c-ink mb-1">设置</h1>
    <p class="text-sm text-c-muted mb-8">配置大模型 API，Key 仅保存在这台电脑的浏览器里</p>

    <!-- 状态卡片 -->
    <section class="rounded-2xl p-6 neu mb-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 neu-inset">
            {{ ready ? '✅' : '⚠️' }}
          </div>
          <div>
            <div class="font-medium text-c-ink mb-0.5">
              {{ ready ? 'API 已就绪' : '尚未配置 API' }}
            </div>
            <div class="text-xs text-c-muted">{{ readyHint }}</div>
          </div>
        </div>
        <div v-if="ready" class="w-3 h-3 rounded-full bg-c-sage shrink-0"
          style="box-shadow: 0 0 0 4px rgba(139, 157, 119, 0.18)" />
      </div>
    </section>

    <!-- API 配置 -->
    <section class="rounded-2xl p-6 md:p-8 neu mb-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-base font-medium text-c-ink">API 配置</h2>
        <button @click="showAdvanced = !showAdvanced"
          class="text-xs text-c-muted hover:text-[#5c4033] transition-colors">
          {{ showAdvanced ? '收起高级' : '高级' }}
        </button>
      </div>

      <div class="space-y-5">

        <!-- 服务商预设 -->
        <div>
          <label class="text-xs text-c-muted mb-3 block">服务商预设</label>
          <div class="grid grid-cols-3 gap-3">
            <button v-for="p in PRESETS" :key="p.name" @click="applyPreset(p)"
              class="px-3 py-3 text-xs md:text-sm font-medium rounded-xl transition-all duration-300"
              :class="samePreset(p)
                ? 'neu-inset text-[#5c4033]'
                : 'neu-sm text-c-body hover:text-[#5c4033]'">
              {{ p.name }}
            </button>
          </div>
          <div class="text-xs text-c-muted mt-2">
            <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
              class="hover:text-[#5c4033]">DeepSeek 注册</a>
            ·
            <a href="https://open.bigmodel.cn" target="_blank" rel="noreferrer"
              class="hover:text-[#5c4033]">智谱 GLM 注册</a>
          </div>
        </div>

        <!-- API Key -->
        <div>
          <label class="text-xs text-c-muted mb-3 block">
            API Key
            <span v-if="serverKey" class="text-c-muted">（服务端已托管，可留空）</span>
            <span v-else class="text-c-clay">*</span>
          </label>
          <div class="relative">
            <input v-model="cfg.api_key" :type="showKey ? 'text' : 'password'" placeholder="sk-..."
              class="w-full px-4 py-3 pr-16 rounded-xl text-sm text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
            <button @click="showKey = !showKey"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-c-muted hover:text-[#5c4033]">
              {{ showKey ? '隐藏' : '显示' }}
            </button>
          </div>
          <div class="text-xs text-c-muted mt-2">只保存在浏览器 localStorage，不会上传服务器</div>
        </div>

        <!-- Base URL -->
        <div>
          <label class="text-xs text-c-muted mb-3 block">Base URL</label>
          <input v-model="cfg.base_url" type="text" placeholder="https://api.deepseek.com/v1"
            class="w-full px-4 py-3 rounded-xl text-sm text-c-body placeholder:text-c-muted
              font-mono neu-inset outline-none" />
        </div>

        <!-- 模型名称 -->
        <div>
          <label class="text-xs text-c-muted mb-3 block">模型名称</label>
          <input v-model="cfg.model" type="text" placeholder="deepseek-chat"
            class="w-full px-4 py-3 rounded-xl text-sm text-c-body placeholder:text-c-muted
              font-mono neu-inset outline-none" />
        </div>

        <!-- 高级：自定义服务端地址 -->
        <div v-if="showAdvanced" class="pt-1 space-y-3">
          <div>
            <label class="text-xs text-c-muted mb-2 block">自定义服务端地址（可选）</label>
            <input v-model="backendUrl" type="text" placeholder="留空则自动探测"
              class="w-full px-4 py-3 rounded-xl text-sm text-c-body placeholder:text-c-muted
                font-mono neu-inset outline-none" />
            <div class="text-xs text-c-muted mt-2 leading-5">
              当前：<span :style="{ color: channel.color }">{{ channel.label }}</span>。
              填域名即可，程序会自动补 /api/v1。
            </div>
          </div>
          <button @click="saveBackend"
            class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-body hover:text-[#5c4033]">
            保存并重新探测
          </button>
        </div>
      </div>

      <div v-if="testResult" class="mt-6 p-4 rounded-xl text-sm leading-6"
        :class="testResult.ok ? 'bg-[#e8ecdf] text-[#4f7d5e]' : 'bg-[#f7e9e4] text-[#b4552d]'">
        <div class="whitespace-pre-wrap">{{ testResult.msg }}</div>
      </div>

      <div class="flex gap-3 mt-8">
        <button @click="clearConfig"
          class="px-5 py-3 rounded-xl text-sm font-medium neu-sm text-c-muted hover:text-c-clay">
          清空
        </button>
        <button @click="test" :disabled="testing || !ready"
          class="px-5 py-3 rounded-xl text-sm font-medium neu-sm text-c-body
            hover:text-[#5c4033] disabled:opacity-50">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button @click="save" :disabled="!ready"
          class="flex-1 px-5 py-3 rounded-xl text-sm font-medium text-c-cream
            disabled:opacity-50"
          style="background: #5c4033; box-shadow: 0 4px 14px rgba(92,64,51,0.18)">
          保存配置
        </button>
      </div>
    </section>

    <!-- 使用说明 -->
    <section class="rounded-2xl p-6 md:p-8 neu mb-6">
      <h2 class="text-base font-medium text-c-ink mb-5">使用说明</h2>
      <div class="space-y-3 text-sm text-c-body leading-relaxed">
        <div v-for="(s, i) in steps" :key="i" class="flex gap-3">
          <span class="text-[#5c4033] font-semibold shrink-0">{{ BULLETS[i] }}</span>
          <span>{{ s }}</span>
        </div>
      </div>
      <div class="mt-5 p-4 rounded-xl text-xs leading-relaxed"
        style="background: #f7eddc; color: #9c6b2f">
        <strong>💡 说明：</strong>{{ note }}
      </div>
    </section>

    <!-- 数据 -->
    <section class="rounded-2xl p-6 neu-sm mb-6">
      <div class="text-sm font-medium text-c-body mb-4">数据</div>
      <div class="flex flex-wrap items-center gap-3">
        <button @click="doExport"
          class="px-4 py-2 rounded-xl text-xs font-medium neu-inset text-c-body hover:text-[#5c4033]">
          导出全部数据
        </button>
        <button @click="fileInput?.click()"
          class="px-4 py-2 rounded-xl text-xs font-medium neu-inset text-c-body hover:text-[#5c4033]">
          导入数据
        </button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="doImport" />
        <button @click="doClearAll"
          class="px-4 py-2 rounded-xl text-xs font-medium neu-inset text-c-muted hover:text-c-clay">
          清空所有数据
        </button>
      </div>
      <div class="text-xs text-c-muted mt-3 leading-5">
        导出的是 JSON 文件，可以拿到另一台电脑导入，或在换设备时备份
      </div>
    </section>

    <!-- 关于 -->
    <section class="rounded-2xl p-6 neu-sm">
      <div class="text-sm font-medium text-c-body mb-3">关于</div>
      <div class="text-xs text-c-muted leading-6 space-y-1.5">
        <div>蓝笔申论 · 版本 {{ backendMeta?.version || '0.2.0' }}</div>
        <div>作答、笔记、错题、复习卡片全部存在本地，后端不保存这些内容</div>
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

// 服务商预设：点了自动填 Base URL 与模型名，省得用户去查文档
const PRESETS = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]
const BULLETS = ['①', '②', '③', '④']

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
