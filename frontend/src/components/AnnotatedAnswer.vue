<template>
  <div>
    <!-- 图例：老师色 + 你自己划的荧光，两套必须分得清 -->
    <div v-if="legend.length || highlightRanges.length"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
      <span v-for="l in legend" :key="l.id" class="inline-flex items-center gap-1.5 text-xs">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: l.color }" />
        <span class="text-c-body">{{ l.name }}</span>
        <span class="text-c-muted">{{ l.count }} 处</span>
      </span>
      <span v-if="highlightRanges.length" class="inline-flex items-center gap-1.5 text-xs">
        <span class="w-2.5 h-2.5 rounded-sm shrink-0"
          :style="{ background: colorById(highlightRanges[0].color).bg, border: '1px solid rgba(0,0,0,.08)' }" />
        <span class="text-c-body">我的标注</span>
        <span class="text-c-muted">{{ highlightRanges.length }} 处</span>
      </span>
      <span class="text-xs text-c-muted ml-auto">
        背景色＝你自己划的 · 下划线＝老师的批注，悬停看详情
      </span>
    </div>

    <!-- 荧光失效提示：作答被改过就会这样。如实说出来，别让用户以为"我没划上" -->
    <div v-if="staleHighlights.length" class="mb-3 text-xs text-c-muted leading-6">
      有 {{ staleHighlights.length }} 处荧光在当前作答里找不到（多半是那段话被改掉了）：
      <span v-for="(h, i) in staleHighlights" :key="i"
        class="inline-block mr-1.5 px-1.5 py-0.5 rounded"
        :style="{ background: colorById(h.color).bg }">{{ h.text.slice(0, 10) }}{{ h.text.length > 10 ? '…' : '' }}</span>
    </div>

    <!-- 正文：保留原始换行，按老师颜色划色 -->
    <div class="text-sm leading-8 text-c-body whitespace-pre-wrap"><span
      v-for="(seg, i) in segments" :key="i"
      :class="seg.color ? 'rounded-sm cursor-help' : ''"
      :style="segStyle(seg)"
      :title="seg.tip || undefined">{{ seg.text }}</span></div>

    <!-- 没能在原文里定位到的批注，单独列出来，不能默默吞掉 -->
    <div v-if="unlocated.length" class="mt-4 rounded-xl p-3 neu-inset">
      <div class="text-xs text-c-muted mb-2">以下批注未能定位到原文片段（AI 引用的句子与作答有出入）</div>
      <div v-for="(a, i) in unlocated" :key="i" class="text-xs leading-6">
        <span class="font-medium" :style="{ color: a.color }">{{ a.teacherName }}</span>
        <span class="text-c-muted"> ｜ {{ a.type }}</span>
        <div class="text-c-body">{{ a.comment }}</div>
        <div v-if="a.fix" class="text-[#4f7d5e]">改：{{ a.fix }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { TEACHERS } from '../agents/teachers'
import { colorById, findRange, normalizeHighlight } from '../utils/highlight'

const props = defineProps({
  answer: { type: String, default: '' },
  results: { type: Array, default: () => [] },
  // 用户自己划的荧光（{ text, color, nth }）。它和老师的批注**叠加显示**：
  // 荧光占背景、批注走下划线 —— 一眼能分出"我划的重点"与"老师指的问题"。
  highlights: { type: Array, default: () => [] },
})

function metaOf(id) {
  const t = TEACHERS[id]
  return { name: t?.name || id, color: t?.color || '#5c4033' }
}

/**
 * 在答案里给 quote 定位。
 * AI 引原文偶尔会差一两个标点或省略后半句，所以除了精确匹配还留两级退让，
 * 全部失败就归入「未能定位」，而不是假装没这条批注。
 */
function locate(answer, quote) {
  const q = String(quote || '').trim()
  if (!q || !answer) return null

  let i = answer.indexOf(q)
  if (i >= 0) return { start: i, end: i + q.length }

  const trimmed = q
    .replace(/^[\s，。；：、“”‘’"'（）()【】\[\]…—-]+/, '')
    .replace(/[\s，。；：、“”‘’"'（）()【】\[\]…—-]+$/, '')
  if (trimmed && trimmed !== q) {
    i = answer.indexOf(trimmed)
    if (i >= 0) return { start: i, end: i + trimmed.length }
  }

  if (q.length > 12) {
    const head = q.slice(0, 12)
    i = answer.indexOf(head)
    if (i >= 0) return { start: i, end: Math.min(answer.length, i + q.length) }
  }
  return null
}

const marks = computed(() => {
  const out = []
  const seen = new Set()

  for (const r of props.results || []) {
    const m = metaOf(r.teacherId)
    for (const a of r.annotations || []) {
      const key = `${r.teacherId}|${a.quote}`
      if (seen.has(key)) continue
      seen.add(key)

      const span = locate(props.answer, a.quote)
      const base = {
        teacherId: r.teacherId,
        teacherName: m.name,
        color: m.color,
        type: a.type || '问题',
        comment: a.comment || '',
        fix: a.fix || '',
      }
      out.push(span ? { ...base, ...span, located: true } : { ...base, located: false })
    }
  }
  return out
})

const legend = computed(() => {
  const byTeacher = new Map()
  for (const mk of marks.value) {
    const cur = byTeacher.get(mk.teacherId) || { id: mk.teacherId, ...metaOf(mk.teacherId), count: 0 }
    cur.count++
    byTeacher.set(mk.teacherId, cur)
  }
  return [...byTeacher.values()]
})

const unlocated = computed(() => marks.value.filter((m) => !m.located))

/**
 * 用户的荧光区间（已定位到答案原文的那部分）。
 * ⚠️ 定位不到的**不在这里丢掉**：单独算出来给模板提示，否则用户会以为"我没划上"。
 */
const highlightRanges = computed(() => {
  const answer = props.answer || ''
  const out = []
  for (const raw of props.highlights || []) {
    const h = normalizeHighlight(raw)
    if (!h) continue
    const r = findRange(answer, h)
    if (r) out.push({ start: r.start, end: r.end, color: h.color, text: h.text })
  }
  return out
})

/** 荧光里那些在当前答案文本中找不到的（作答改过就会这样）——要如实说，不能静默吞 */
const staleHighlights = computed(() => {
  if (!props.highlights?.length) return []
  const answer = props.answer || ''
  return props.highlights
    .map((raw) => normalizeHighlight(raw))
    .filter((h) => h && !findRange(answer, h))
})

/**
 * 一处的下划线样式。
 * 多位老师标同一句时，下划线按老师数量切成等分色段——
 * 比「只显示第一位老师的颜色」更能说明这里有分歧。
 */
function segStyle(seg) {
  const cs = seg.colors?.length ? seg.colors : seg.color ? [seg.color] : []
  const style = {}

  // 背景只有一层：用户划了荧光就用荧光色（那是他亲手标的）；
  // 没有荧光时才退回老师批注的极浅底色 —— 两层半透明叠起来会脏，谁的颜色都认不出。
  if (seg.highlight) style.backgroundColor = colorById(seg.highlight).bg
  else if (cs.length) style.backgroundColor = cs[0] + '16'

  // 老师批注一律走**下划线**：这样「我划的（背景）」与「老师指的（下划线）」
  // 压在同一段文字上也能一眼分开。
  if (cs.length === 1) {
    return { ...style, borderBottom: `2px solid ${cs[0]}`, paddingBottom: '1px' }
  }
  if (cs.length > 1) {
    // 多位老师标同一句：下划线切成等分色段，比"只显示第一位"更能说明这里有分歧
    const n = cs.length
    const stops = cs.flatMap((c, i) => [`${c} ${(i / n) * 100}%`, `${c} ${((i + 1) / n) * 100}%`])
    return {
      ...style,
      backgroundImage: `linear-gradient(to right, ${stops.join(', ')})`,
      backgroundSize: '100% 2px',
      backgroundPosition: 'bottom',
      backgroundRepeat: 'no-repeat',
      borderBottom: '2px solid transparent',
      paddingBottom: '1px',
    }
  }
  return style
}

const segments = computed(() => {
  const answer = props.answer || ''
  const placed = marks.value.filter((m) => m.located).sort((a, b) => a.start - b.start || b.end - a.end)

  // 位置重叠的批注合并成一段，tooltip 里列出所有老师的意见。
  // 早先是「后来者直接跳过」——颜色不糊了，但那位老师的批注会在色标上彻底消失，
  // 既不在色标也不在「未能定位」里，属于静默丢信息。
  const groups = []
  for (const m of placed) {
    const last = groups[groups.length - 1]
    if (last && m.start < last.end) {
      last.end = Math.max(last.end, m.end)
      last.items.push(m)
    } else {
      groups.push({ start: m.start, end: m.end, items: [m] })
    }
  }

  // 边界合并：把「批注区间」与「荧光区间」的所有端点并起来切段，
  // 于是每一段同时知道自己落在哪条批注、哪条荧光里 —— 两者才能真正叠加显示。
  const points = new Set([0, answer.length])
  for (const g of groups) {
    points.add(g.start)
    points.add(g.end)
  }
  for (const h of highlightRanges.value) {
    points.add(h.start)
    points.add(h.end)
  }
  const sorted = [...points].sort((a, b) => a - b)

  const out = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]
    const e = sorted[i + 1]
    if (s >= e) continue
    const g = groups.find((x) => x.start <= s && e <= x.end)
    const hl = highlightRanges.value.find((x) => x.start <= s && e <= x.end)
    out.push({
      text: answer.slice(s, e),
      colors: g ? [...new Set(g.items.map((m) => m.color))] : [],
      color: g ? g.items[0].color : null,
      tip: g
        ? g.items
            .map((m) => `${m.teacherName}｜${m.type}\n${m.comment}${m.fix ? '\n改：' + m.fix : ''}`)
            .join('\n\n———\n\n')
        : '',
      highlight: hl ? hl.color : null,
    })
  }
  return out
})
</script>
