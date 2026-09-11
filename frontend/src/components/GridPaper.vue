<!--
  方格作答纸：模拟申论真实答题纸的书写形态。

  为什么要做这个：
    申论就是写在方格纸上的。用一个 18 行普通文本框作答，和真实考场差得远——
    字数感、行数感、卷面观感全都缺失。方格纸让「我写了多少」一眼可见。

  技术方案：textarea + CSS 背景网格
    不用 contenteditable / 逐格渲染：那样输入法、光标、选择、粘贴全得自己实现，
    而且中文输入法的组合态（拼音候选）几乎没法处理。
    textarea 是原生控件，输入体验不用操心；我们只负责让它「看起来像格纸」。

  对齐原理：
    中文在宋体下，一个全角字的步进宽度 = 1em = font-size。
    设格宽 = font-size + letter-spacing，背景用 repeating-linear-gradient 每格画 1px 线，
    行高也设为格宽 —— 字符与格线就自然重合。

  ⚠️ 关键：格宽必须由容器实测宽度算出来，不能写死。
    踩过的坑：原先写死 --cell: 30px，而作答区容器只有 728px 宽，
    25 格需要 750px —— 结果每行只挤得下 24 字，格线全部错位。
    现在改成「列数固定 25，格宽 = 容器宽 / 25」，任何宽度下都严丝合缝。

  半角字符（英文/数字）宽度只有 0.5em，会占半格偏左。
  申论作答里半角少，这个偏差可接受；真要严格对齐得逐字渲染，不值得。
-->

<template>
  <div class="w-full">
    <!-- 工具条：字数 / 行数 / 每行格数 -->
    <div class="flex items-center justify-between gap-3 mb-2 px-1">
      <div class="flex items-center gap-3 text-xs text-gray-500">
        <span class="tnum"><b class="text-gray-700 font-medium">{{ charCount }}</b> 字</span>
        <span class="tnum"><b class="text-gray-700 font-medium">{{ lineCount }}</b> 行</span>
        <span v-if="wordLimit" class="tnum"
          :class="charCount > wordLimit ? 'text-[#c0392b]' : ''">
          / {{ wordLimit }} 字
        </span>
      </div>
      <span class="text-xs text-gray-400">每行 {{ cols }} 字</span>
    </div>

    <!-- 纸 -->
    <div class="rounded-xl overflow-hidden shadow-[inset_2px_2px_6px_#c8ccd2] bg-[#fffdfb]">
      <textarea
        ref="el"
        :value="modelValue"
        @input="onInput"
        :placeholder="placeholder"
        :disabled="disabled"
        spellcheck="false"
        class="grid-paper block w-full resize-none outline-none
          bg-transparent text-[#2b2b2b] placeholder:text-[#dca8a8]
          disabled:text-gray-400"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  cols: { type: Number, default: 25 },        // 每行字数（申论标准 25 字/行）
  minRows: { type: Number, default: 12 },     // 最少显示行数，避免空纸太矮
  wordLimit: { type: Number, default: 0 },    // 0 = 不限
  placeholder: { type: String, default: '在此书写你的答案…' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const el = ref(null)
let ro = null

// 字符数：按字计（代理对算一个），换行不计入
const charCount = computed(() => [...(props.modelValue || '').replace(/[\n\r]/g, '')].length)

// 行数：显式换行 + 按每行 cols 字自动折行
const lineCount = computed(() => {
  const text = props.modelValue || ''
  if (!text) return 0
  return text.split('\n').reduce((sum, para) => {
    const len = [...para].length
    return sum + Math.max(1, Math.ceil(len / props.cols))
  }, 0)
})

// 当前格宽（px）。由 layout() 写入，供高度计算复用。
const cellSize = ref(30)

/**
 * 按容器实测宽度重算格宽与字号。
 * 这是整个组件能对齐的关键：格宽 = 容器宽 / 列数，因此永远刚好放下 cols 个字。
 */
function layout() {
  const t = el.value
  if (!t) return
  const w = t.clientWidth
  if (!w) return

  const cell = w / props.cols
  // 字距随格子缩放，限制在 1~3px，避免大屏字距过散、小屏粘连
  const gap = Math.max(1, Math.min(3, cell * 0.07))
  // 字号要按「本环境下一个全角字实际占几 em」反推，不能假定就是 1em
  const font = (cell - gap) / emRatio()

  t.style.setProperty('--cell', `${cell}px`)
  t.style.fontSize = `${font}px`
  t.style.letterSpacing = `${gap}px`
  cellSize.value = cell

  fit()
}

/**
 * 实测「一个全角字占多少 em」。
 *
 * 标准中文字体（SimSun 等）的全角字正好 1em，于是 字号 = 格宽 即可对齐。
 * 但字体栈可能回退到别的字体，宽度未必是 1em —— 那时按 1em 设字号，
 * 文字会溢出格子、行尾还会提前折行。canvas 量一次，让对齐不依赖字体假设。
 */
let cachedEm = null
function emRatio() {
  if (cachedEm) return cachedEm
  try {
    const cs = getComputedStyle(el.value)
    const c = document.createElement('canvas').getContext('2d')
    c.font = `100px ${cs.fontFamily}`
    const w = c.measureText('字').width
    cachedEm = w > 0 ? w / 100 : 1
  } catch {
    cachedEm = 1
  }
  return cachedEm
}

/** textarea 不会随内容自动增高，需要手动同步 */
function fit() {
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  const rows = Math.max(props.minRows, lineCount.value + 1)
  t.style.height = `${Math.max(t.scrollHeight, rows * cellSize.value)}px`
}

function onInput(e) {
  emit('update:modelValue', e.target.value)
  // 等 Vue 把新值渲染进 value 后再量高度，否则量到的是旧内容
  nextTick(fit)
}

watch(() => props.modelValue, () => nextTick(fit))

onMounted(() => {
  nextTick(() => {
    layout()
    // 侧边栏折叠、窗口缩放都会改变作答区宽度 → 重新算格宽
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(layout)
      ro.observe(el.value)
    }
  })
})

onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.grid-paper {
  --cell: 30px;
  --line-color: #f0cfcf;

  padding: 0;
  border: 0;

  /* 宋体：中文才是等宽的，且是申论卷面的正经字体 */
  font-family: SimSun, 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', serif;
  font-size: 28px;
  line-height: var(--cell);
  letter-spacing: 2px;

  /* 网格：每层是一个 cell×cell 的图块（左/上各 1px 线），平铺成格纸。
     用 background-size 显式声明图块尺寸，比靠 repeating-linear-gradient
     的色标周期去推更确定 —— 格宽是多少就是多少，不会被浏览器解析成别的值。 */
  background-image:
    linear-gradient(to right, var(--line-color) 1px, transparent 1px),
    linear-gradient(to bottom, var(--line-color) 1px, transparent 1px);
  background-size: var(--cell) var(--cell);
  background-position: 0 0;
  background-repeat: repeat;

  overflow: hidden;
}
</style>
