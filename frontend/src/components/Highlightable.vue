<template>
  <div ref="rootEl" class="hl-root">
    <div v-for="(b, i) in blocks" :key="i" data-hl-block>
      <div v-if="b.label" class="text-xs font-medium text-c-bark mb-1">{{ b.label }}</div>
      <p class="text-sm text-c-body leading-7 whitespace-pre-wrap">
        <template v-for="(seg, j) in splitOf(b.body)" :key="j">
          <mark v-if="seg.mark" class="hl-mark" :style="{ background: bgOf(seg.mark.color) }">{{ seg.text }}</mark>
          <span v-else>{{ seg.text }}</span>
        </template>
      </p>
    </div>

    <!-- 浮动色板：出现在选区上方。按钮用 mousedown.prevent —— 否则点色板的一瞬间
         浏览器会把选区清掉，我们就取不到要标记哪一段了（经典坑）。 -->
    <div v-if="palette" class="hl-palette" :style="paletteStyle">
      <button v-for="c in colors" :key="c.id" type="button" :title="`标为${c.label}色`"
        class="hl-swatch" @mousedown.prevent @click="paint(c.id)">
        <span class="hl-dot" :style="{ background: c.bg }" />
      </button>
      <span class="hl-sep" />
      <button type="button" title="清除选区内的标记" class="hl-clear"
        @mousedown.prevent @click="clearInSelection">清除</button>
    </div>
  </div>
</template>

<script setup>
// 可划荧光的内容块。
// 为什么是个组件而不是直接改 GridPaper：作答区是 textarea（原生输入体验不能丢），
// 材料区与「标注视图」是只读渲染 —— 两个场景共用同一套"选区 → 色板 → 标记"逻辑，
// 但都不需要动输入控件本身。textarea 保持原样，标注走只读视图。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  HIGHLIGHT_COLORS,
  colorById,
  countOccurrences,
  normalizeHighlight,
  readSelection,
  splitByMarks,
} from '../utils/highlight'
import { toast } from '../utils/toast'

const props = defineProps({
  // [{ label?, body }]，材料按则分块；作答也可以只传一块
  blocks: { type: Array, default: () => [] },
  marks: { type: Array, default: () => [] },
})

const emit = defineEmits(['change'])

const rootEl = ref(null)
const palette = ref(null) // { text, nth, left, top }
const colors = HIGHLIGHT_COLORS

// 色板定位。⚠️ 这个值若漏定义，色板会失去坐标糊在容器左上角——
// 划了字"看起来没反应"（真踩过：探针用 querySelector 找色块照样点得到，
// 只有真实鼠标路径 + console 告警才暴露）。
const paletteStyle = computed(() =>
  palette.value ? { left: `${palette.value.left}px`, top: `${palette.value.top}px` } : {}
)

const plainText = computed(() => props.blocks.map((b) => b.body || '').join('\n'))

function bgOf(id) {
  return colorById(id).bg
}

function splitOf(body) {
  return splitByMarks(body, props.marks)
}

/** 选区是否落在**同一块**里：跨块的话锚点算不清（块之间还有 label） */
function sameBlock(range) {
  const node = range.commonAncestorContainer
  const el = node.nodeType === 1 ? node : node.parentElement
  return el?.closest('[data-hl-block]') || null
}

function showPalette() {
  const sel = readSelection(rootEl.value, plainText.value)
  if (!sel) {
    palette.value = null
    return
  }
  const s = window.getSelection()
  if (!s?.rangeCount) return
  const range = s.getRangeAt(0)
  const block = sameBlock(range)
  if (!block) {
    palette.value = null // 跨块：锚点定位不稳。但**必须说**，不能静默没反应
    toast.info('跨段选择没法稳定定位，请在同一段文字内划选')
    return
  }
  const rect = range.getBoundingClientRect()
  const rootRect = rootEl.value.getBoundingClientRect()
  palette.value = {
    text: sel.text,
    nth: sel.nth,
    // 色板放在选区上方；贴顶时改放下方，免得被容器裁掉
    left: Math.max(0, Math.min(rect.left - rootRect.left, rootRect.width - 330)),
    top: rect.top - rootRect.top - 42 < 0 ? rect.bottom - rootRect.top + 6 : rect.top - rootRect.top - 42,
  }
}

// mouseup 挂在 **window** 上而不是组件根：用户拖拽出面板外才松手是常事，
// 挂在根上时 mouseup 不冒泡回来，色板就永远不弹（"有时候会有问题"的真实来源之一）。
// 能不能弹由「选区锚点是否在容器内」决定，与松手位置无关。
function onWindowMouseUp() {
  if (!rootEl.value) return
  const s = window.getSelection?.()
  if (!s || s.isCollapsed || !s.rangeCount) {
    palette.value = null
    return
  }
  const inRoot = s.anchorNode && rootEl.value.contains(s.anchorNode)
    && rootEl.value.contains(s.focusNode ?? s.anchorNode)
  if (inRoot) showPalette()
  else palette.value = null
}

onMounted(() => window.addEventListener('mouseup', onWindowMouseUp))
onBeforeUnmount(() => window.removeEventListener('mouseup', onWindowMouseUp))

function paint(colorId) {
  const p = palette.value
  if (!p) return
  const next = normalizeHighlight({ text: p.text, color: colorId, nth: p.nth })
  if (!next) return
  // 同一位置重复划：替换颜色而不是叠一条（叠了也渲染不出来，还让"处数"虚高）
  const kept = (props.marks || []).filter((m) => !(m.text === next.text && (Number(m.nth) || 0) === next.nth))
  emit('change', [...kept, next])
  palette.value = null
  window.getSelection()?.removeAllRanges()
}

/** 清掉与选区重叠的标记（按文本出现次数近似判断） */
function clearInSelection() {
  const p = palette.value
  if (!p) return
  const kept = (props.marks || []).filter((m) => !(m.text === p.text && (Number(m.nth) || 0) === p.nth))
  emit('change', kept)
  palette.value = null
  window.getSelection()?.removeAllRanges()
}
</script>

<style scoped>
.hl-root {
  position: relative;
}
/* 荧光笔的观感：半透明色块压在字下面，字仍是原色 */
.hl-mark {
  color: inherit;
  border-radius: 3px;
  padding: 1px 0.5px;
  box-decoration-break: clone;
}
.hl-palette {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 7px;
  border-radius: 10px;
  background: #fffdf9;
  box-shadow: 0 6px 18px rgba(92, 64, 51, 0.16), 0 0 0 1px rgba(92, 64, 51, 0.08);
}
.hl-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  transition: transform 0.12s ease;
}
.hl-swatch:hover {
  transform: translateY(-1px);
}
.hl-dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(92, 64, 51, 0.14);
}
.hl-sep {
  width: 1px;
  height: 16px;
  background: rgba(92, 64, 51, 0.14);
  margin: 0 2px;
}
.hl-clear {
  font-size: 11px;
  color: var(--c-muted, #8b8178);
  padding: 0 4px;
}
.hl-clear:hover {
  color: #b4552d;
}
</style>
