<template>
  <div class="md-view" :class="{ compact }">
    <template v-for="(b, i) in blocks" :key="i">

      <!-- 标题：h1-h3 按层级递减，色条标记 -->
      <div v-if="b.t === 'h'" :class="headCls(b.level)" class="flex items-baseline gap-2">
        <span class="shrink-0 self-center w-[3px] rounded-full bg-current opacity-40"
          :class="b.level === 1 ? 'h-4' : b.level === 2 ? 'h-3.5' : 'h-3'" />
        <span>{{ b.text }}</span>
      </div>

      <!-- 引用块 -->
      <blockquote v-else-if="b.t === 'quote'" class="border-l-[3px] border-c-barkSoft pl-3 py-0.5
        text-[0.95em] text-c-muted leading-7 my-2">
        <Inline :parts="b.parts" />
      </blockquote>

      <!-- 无序列表：连续 - / * 行归为一组 -->
      <ul v-else-if="b.t === 'ul'" class="my-2 space-y-1.5">
        <li v-for="(li, j) in b.items" :key="j" class="flex items-start gap-2">
          <span class="shrink-0 mt-[0.62em] w-1.5 h-1.5 rounded-full bg-c-barkSoft" />
          <span class="min-w-0 flex-1"><Inline :parts="li" /></span>
        </li>
      </ul>

      <!-- 有序列表 -->
      <ol v-else-if="b.t === 'ol'" class="my-2 space-y-1.5">
        <li v-for="(li, j) in b.items" :key="j" class="flex items-start gap-2">
          <span class="shrink-0 mt-px min-w-[1.4em] text-[0.85em] tnum font-medium text-c-bark">{{ j + 1 }}.</span>
          <span class="min-w-0 flex-1"><Inline :parts="li" /></span>
        </li>
      </ol>

      <!-- 分隔线 -->
      <div v-else-if="b.t === 'hr'" class="my-3 border-t border-dashed border-c-line" />

      <!-- 普通段落 -->
      <p v-else class="my-1.5"><Inline :parts="b.parts" /></p>
    </template>
  </div>
</template>

<script setup>
/**
 * MdView —— 轻量 Markdown 渲染（纯 Vue 模板，不开 v-html 口子）。
 *
 * 为什么不用 marked/markdown-it：文档是自己写的，把 Markdown 当 HTML 解析
 * 这件事本身就不该开这个口子（与更新日志页同一立场）。
 * 块级语法支持：# 标题、- / * 列表、1. 有序列表、> 引用、--- 分隔线、段落。
 * 行内语法复用 changelog-parse 的 parseInline（`代码` / **加粗** / *斜体*），
 * 那份实现有单测钉着（test-changelog），不在这里复制第二份。
 */
import { computed, h } from 'vue'
import { parseInline } from '../data/changelog-parse'

// 行内片段渲染：函数式组件，模板里 <Inline :parts="..." /> 直接用
const CODE_CLS = 'px-1 py-px rounded text-[0.92em] text-c-bark bg-c-barkSoft'
function Inline(props) {
  return h(
    'span',
    null,
    props.parts.map((p, i) => {
      if (p.t === 'code') return h('code', { class: CODE_CLS, key: i }, p.v)
      if (p.t === 'bold') return h('strong', { class: 'font-medium text-c-ink', key: i }, p.v)
      if (p.t === 'em') return h('em', { class: 'italic', key: i }, p.v)
      return p.v
    }),
  )
}
Inline.props = ['parts']

const props = defineProps({
  src: { type: String, default: '' },
  /** compact：更紧的行距与间距（塞进小卡片时用） */
  compact: { type: Boolean, default: false },
})

const H_CLS = {
  1: 'text-[1.05em] font-semibold text-c-ink mt-4 mb-1.5 first:mt-0',
  2: 'text-[1em] font-semibold text-c-ink mt-3.5 mb-1.5 first:mt-0',
  3: 'text-[0.95em] font-medium text-c-bark mt-3 mb-1 first:mt-0',
}
const headCls = (lv) => H_CLS[lv] || H_CLS[3]

const UL_RE = /^\s*[-*]\s+(.*)$/
const OL_RE = /^\s*\d+[.、)]\s+(.*)$/
const H_RE = /^(#{1,6})\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

/** 块级解析：逐行扫，连续同类行归成一块 */
const blocks = computed(() => {
  const out = []
  let ul = null
  let ol = null
  const flush = () => {
    ul = ol = null
  }

  for (const rawLine of String(props.src ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) {
      flush()
      continue
    }

    const h = line.match(H_RE)
    if (h) {
      flush()
      out.push({ t: 'h', level: Math.min(h[1].length, 3), text: h[2].trim() })
      continue
    }

    if (HR_RE.test(line)) {
      flush()
      out.push({ t: 'hr' })
      continue
    }

    const q = line.match(QUOTE_RE)
    if (q) {
      flush()
      const last = out[out.length - 1]
      // 连续引用行接到同一块
      if (last?.t === 'quote') last.raw.push(q[1])
      else out.push({ t: 'quote', raw: [q[1]] })
      continue
    }

    const li = line.match(UL_RE)
    if (li) {
      ol = null
      if (!ul) out.push((ul = { t: 'ul', items: [] }))
      ul.items.push(parseInline(li[1]))
      continue
    }

    const oli = line.match(OL_RE)
    if (oli) {
      ul = null
      if (!ol) out.push((ol = { t: 'ol', items: [] }))
      ol.items.push(parseInline(oli[1]))
      continue
    }

    // 普通行：列表的缩进续行归入上一条，否则自成段落
    const trimmed = line.trim()
    if ((ul || ol) && /^\s{2,}/.test(line)) {
      const items = (ul || ol).items
      items[items.length - 1] = parseInline(
        items[items.length - 1].map((p) => p.v).join('') + trimmed,
      )
      continue
    }
    flush()
    const last = out[out.length - 1]
    if (last?.t === 'p') last.parts = parseInline(last.parts.map((p) => p.v).join('') + trimmed)
    else out.push({ t: 'p', parts: parseInline(trimmed) })
  }

  // 引用块的 raw 行在收尾时统一做行内解析
  for (const b of out) if (b.t === 'quote') b.parts = parseInline(b.raw.join('\n'))
  return out
})
</script>

<style scoped>
.md-view {
  font-size: 13px;
  line-height: 1.85;
  color: var(--c-body, #44403c);
}
.md-view.compact {
  line-height: 1.7;
}
.md-view :deep(ul),
.md-view :deep(ol) {
  padding-left: 0;
}
</style>
