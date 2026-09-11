<template>
  <div>
    <!-- 图例：谁标了什么颜色 -->
    <div v-if="legend.length" class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
      <span v-for="l in legend" :key="l.id" class="inline-flex items-center gap-1.5 text-xs">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: l.color }" />
        <span class="text-gray-600">{{ l.name }}</span>
        <span class="text-gray-400">{{ l.count }} 处</span>
      </span>
      <span class="text-xs text-gray-400 ml-auto">划色处悬停看批注</span>
    </div>

    <!-- 正文：保留原始换行，按老师颜色划色 -->
    <div class="text-sm leading-8 text-gray-700 whitespace-pre-wrap"><span
      v-for="(seg, i) in segments" :key="i"
      :class="seg.color ? 'rounded-sm cursor-help' : ''"
      :style="segStyle(seg)"
      :title="seg.tip || undefined">{{ seg.text }}</span></div>

    <!-- 没能在原文里定位到的批注，单独列出来，不能默默吞掉 -->
    <div v-if="unlocated.length" class="mt-4 rounded-xl p-3 neu-inset">
      <div class="text-xs text-gray-500 mb-2">以下批注未能定位到原文片段（AI 引用的句子与作答有出入）</div>
      <div v-for="(a, i) in unlocated" :key="i" class="text-xs leading-6">
        <span class="font-medium" :style="{ color: a.color }">{{ a.teacherName }}</span>
        <span class="text-gray-500"> ｜ {{ a.type }}</span>
        <div class="text-gray-600">{{ a.comment }}</div>
        <div v-if="a.fix" class="text-[#0f6e56]">改：{{ a.fix }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { TEACHERS } from '../agents/teachers'

const props = defineProps({
  answer: { type: String, default: '' },
  results: { type: Array, default: () => [] },
})

function metaOf(id) {
  const t = TEACHERS[id]
  return { name: t?.name || id, color: t?.color || '#6d5dfc' }
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
 * 一处的下划线样式。
 * 多位老师标同一句时，下划线按老师数量切成等分色段——
 * 比「只显示第一位老师的颜色」更能说明这里有分歧。
 */
function segStyle(seg) {
  const cs = seg.colors?.length ? seg.colors : seg.color ? [seg.color] : []
  if (!cs.length) return {}

  const base = { backgroundColor: cs[0] + '16', paddingBottom: '1px' }
  if (cs.length === 1) {
    return { ...base, borderBottom: `2px solid ${cs[0]}` }
  }
  const n = cs.length
  const stops = cs.flatMap((c, i) => [`${c} ${(i / n) * 100}%`, `${c} ${((i + 1) / n) * 100}%`])
  return {
    ...base,
    backgroundImage: `linear-gradient(to right, ${stops.join(', ')})`,
    backgroundSize: '100% 2px',
    backgroundPosition: 'bottom',
    backgroundRepeat: 'no-repeat',
    borderBottom: '2px solid transparent',
  }
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

  const out = []
  let pos = 0
  for (const g of groups) {
    if (g.start > pos) out.push({ text: answer.slice(pos, g.start) })
    const tip = g.items
      .map((m) => `${m.teacherName}｜${m.type}\n${m.comment}${m.fix ? '\n改：' + m.fix : ''}`)
      .join('\n\n———\n\n')
    const colors = [...new Set(g.items.map((m) => m.color))]
    out.push({
      text: answer.slice(g.start, g.end),
      color: colors[0],
      colors,
      tip,
    })
    pos = g.end
  }
  if (pos < answer.length) out.push({ text: answer.slice(pos) })
  return out
})
</script>
