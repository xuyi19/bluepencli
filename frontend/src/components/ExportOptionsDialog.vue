<script setup>
// ──────────────────────────────────────────────────────────────
// 导出排版选项弹窗（2026-10-09 用户要求：让用户自己排版、选字体、多种选择）
//
// 职责分界：本组件只管「选项 UI + 实时预览 + 两个下载按钮」的壳；
// 文档怎么构建是视图层的事——视图传三个函数进来：
//   build   — 返回内容模型节点（预览用，弹窗打开时算一次）
//   doWord  — (style) => 导出 Word，返回 { ok, way, path, error }
//   doPdf   — (style) => 导出 PDF
// 选项持久化在 localStorage（utils/exportStyle.js），下次导出记得上次的排法。
// ──────────────────────────────────────────────────────────────
import { ref, computed, onMounted } from 'vue'
import {
  loadExportStyle, saveExportStyle,
  FONT_OPTIONS, SIZE_OPTIONS, SPACING_OPTIONS,
} from '../utils/exportStyle'
import { buildHtmlPreview } from '../utils/exportDoc'

const props = defineProps({
  title: { type: String, default: '导出文档' },
  build: { type: Function, required: true },   // () => Promise<nodes> | nodes
  doWord: { type: Function, required: true },  // async (style) => res
  doPdf: { type: Function, required: true },   // async (style) => res
})
const emit = defineEmits(['close'])

const style = ref(loadExportStyle())
const nodes = ref(null)
const state = ref('') // '' | 'busy:word' | 'busy:pdf' | 'ok:...' | 'err:...'

onMounted(async () => {
  try { nodes.value = await props.build() }
  catch (e) { nodes.value = [] /* 预览失败不挡下载 */ }
})

// 预览 = 同一份模型 + 同一套 resolveStyle，选项一变立刻重排
const previewHtml = computed(() => {
  if (!nodes.value) return '<div style="color:#999;padding:40px;text-align:center">正在生成预览…</div>'
  try { return buildHtmlPreview(nodes.value, style.value) }
  catch { return '<div style="color:#999;padding:40px;text-align:center">预览生成失败（不影响下载）</div>' }
})

function setOpt(key, value) {
  style.value = { ...style.value, [key]: value }
  saveExportStyle(style.value)
}

async function download(kind) {
  if (state.value.startsWith('busy')) return
  state.value = `busy:${kind}`
  try {
    const fn = kind === 'word' ? props.doWord : props.doPdf
    const res = await fn(style.value)
    state.value = res?.ok
      ? (res.way === 'desktop' ? `ok:已保存：${res.path || res.fileName || ''}` : 'ok:已开始下载')
      : `err:${res?.error || '未知错误'}`
  } catch (e) {
    state.value = `err:${e?.message || e}`
  }
}

const stateText = computed(() => {
  if (state.value === 'busy:word') return '正在生成 Word…'
  if (state.value === 'busy:pdf') return '正在生成 PDF…'
  if (state.value.startsWith('ok:')) return state.value.slice(3)
  if (state.value.startsWith('err:')) return '导出失败：' + state.value.slice(4)
  return ''
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(43,42,36,.45)" @click.self="emit('close')">
    <div class="bg-c-paper rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col neu-lg">
      <!-- 头 -->
      <div class="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
        <div>
          <div class="text-base font-semibold text-c-ink">{{ title }} · 排版与预览</div>
          <div class="text-xs text-c-muted mt-1">左边挑样式右边看效果；设置会记住，下次不用再调</div>
        </div>
        <button @click="emit('close')"
          class="w-8 h-8 rounded-xl text-c-muted hover:text-c-ink neu-sm text-sm shrink-0">✕</button>
      </div>

      <div class="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 px-6 pb-4">
        <!-- 左：选项 -->
        <div class="lg:w-56 shrink-0 space-y-4 lg:overflow-y-auto">
          <div>
            <div class="text-[11px] font-medium text-c-muted tracking-widest mb-2">字体<span class="normal-case tracking-normal">（Word 生效）</span></div>
            <div class="flex lg:flex-col gap-1.5">
              <button v-for="f in FONT_OPTIONS" :key="f.value" @click="setOpt('font', f.value)"
                class="flex-1 lg:flex-none px-3 py-1.5 rounded-xl text-sm transition-colors"
                :class="style.font === f.value ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body hover:translate-y-px'"
                :style="{ fontFamily: f.css }">
                {{ f.label }}
              </button>
            </div>
          </div>

          <div>
            <div class="text-[11px] font-medium text-c-muted tracking-widest mb-2">字号</div>
            <div class="flex lg:flex-col gap-1.5">
              <button v-for="o in SIZE_OPTIONS" :key="o.value" @click="setOpt('size', o.value)"
                class="flex-1 lg:flex-none px-3 py-1.5 rounded-xl text-xs text-left transition-colors"
                :class="style.size === o.value ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body hover:translate-y-px'">
                {{ o.label }}
              </button>
            </div>
          </div>

          <div>
            <div class="text-[11px] font-medium text-c-muted tracking-widest mb-2">行距</div>
            <div class="flex gap-1.5">
              <button v-for="o in SPACING_OPTIONS" :key="o.value" @click="setOpt('spacing', o.value)"
                class="flex-1 px-2 py-1.5 rounded-xl text-xs transition-colors"
                :class="style.spacing === o.value ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body hover:translate-y-px'">
                {{ o.label }}
              </button>
            </div>
          </div>

          <div>
            <div class="text-[11px] font-medium text-c-muted tracking-widest mb-2">配色</div>
            <div class="flex gap-1.5">
              <button @click="setOpt('color', 'bw')"
                class="flex-1 px-2 py-1.5 rounded-xl text-xs transition-colors"
                :class="style.color === 'bw' ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body hover:translate-y-px'">
                黑白<span class="hidden lg:inline text-c-muted">（省墨）</span>
              </button>
              <button @click="setOpt('color', 'color')"
                class="flex-1 px-2 py-1.5 rounded-xl text-xs transition-colors"
                :class="style.color === 'color' ? 'neu-inset text-c-bark font-medium' : 'neu-sm text-c-body hover:translate-y-px'">
                彩色<span class="hidden lg:inline text-c-muted">（荧光底色）</span>
              </button>
            </div>
          </div>

          <p class="text-[11px] text-c-muted leading-5 hidden lg:block">
            PDF 内嵌思源宋体，字体选项只对 Word 生效；分页以实际文件为准。
          </p>
        </div>

        <!-- 右：预览 -->
        <div class="flex-1 min-h-0 rounded-xl neu-inset overflow-auto p-5 bg-white">
          <!-- eslint-disable-next-line vue/no-v-html —— 预览 HTML 由 buildHtmlPreview 生成，文本都过了 escHtml -->
          <div v-if="nodes" class="max-w-[620px] mx-auto" v-html="previewHtml" />
          <div v-else class="h-full flex items-center justify-center text-c-muted text-sm">正在生成预览…</div>
        </div>
      </div>

      <!-- 底：状态 + 下载 -->
      <div class="flex items-center gap-3 px-6 py-4 border-t border-c-line shrink-0">
        <span v-if="stateText" class="text-xs flex-1 truncate"
          :style="{ color: state.startsWith('err') ? '#b4552d' : '#4f7d5e' }">{{ stateText }}</span>
        <span v-else class="flex-1" />
        <button @click="download('word')" :disabled="state.startsWith('busy')"
          class="px-4 h-9 rounded-xl text-xs font-medium neu-sm text-c-bark hover:translate-y-px transition-transform disabled:opacity-40">
          ⬇ 下载 Word
        </button>
        <button @click="download('pdf')" :disabled="state.startsWith('busy')"
          class="px-4 h-9 rounded-xl text-xs font-medium neu-sm text-c-bark hover:translate-y-px transition-transform disabled:opacity-40">
          ⬇ 下载 PDF
        </button>
      </div>
    </div>
  </div>
</template>
