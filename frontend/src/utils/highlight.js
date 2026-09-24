// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 荧光标记：把「用户划的重点」存成可复算的锚点。
//
// 存储形态是 `{ text, color, nth }` —— **文本片段 + 出现序号**，不是字符下标。
// 为什么不存下标：材料会被「按题裁剪 / 整卷」来回切换（同一段文本在两种口径下
// 起始位置完全不同），下标存下来一切换就全错位。文本片段 + 第几次出现，
// 换口径后仍能重新定位 —— 与逐句批注的 `quote` 是同一套思路。
//
// 反过来说：**片段在当前文本里找不到时，必须如实报出来，不能静默丢弃**。
// 用户划了 6 处、切了材料口径只剩 4 处还找得到，界面要说「2 处标记在当前材料里
// 找不到」—— 悄悄少两处，用户会以为自己没划上（本项目反复复发的"静默失效"病）。
//
// 本模块零副作用、纯函数，可被 Node 直接 import（护栏：.tools/test-highlight.mjs）。

/** 荧光色板：半透明背景压在正文下。透明度刻意给到 0.45~0.6 ——
 * 早先 0.34~0.42 太淡，用户反馈"不够突出"（划了像没划）。字是深色，
 * 这些 alpha 在暖米纸上仍能保证正文对比度。 */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: '黄', bg: 'rgba(250, 204, 21, 0.60)' },
  { id: 'green', label: '绿', bg: 'rgba(74, 222, 128, 0.52)' },
  { id: 'blue', label: '蓝', bg: 'rgba(96, 165, 250, 0.52)' },
  { id: 'pink', label: '粉', bg: 'rgba(244, 114, 182, 0.48)' },
  { id: 'purple', label: '紫', bg: 'rgba(167, 139, 250, 0.48)' },
  { id: 'orange', label: '橙', bg: 'rgba(251, 146, 60, 0.52)' },
  { id: 'cyan', label: '青', bg: 'rgba(34, 211, 238, 0.46)' },
  { id: 'red', label: '红', bg: 'rgba(248, 113, 113, 0.46)' },
]

export const DEFAULT_COLOR = 'yellow'

export function colorById(id) {
  return HIGHLIGHT_COLORS.find((c) => c.id === id) || HIGHLIGHT_COLORS[0]
}

/** 标记能划的最短长度（一个字也算，但空白与单个标点没意义） */
const MIN_LEN = 1

export function normalizeHighlight(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text || '')
  if (text.replace(/\s/g, '').length < MIN_LEN) return null
  const nth = Math.max(0, Number(raw.nth) || 0)
  return {
    id: String(raw.id || `${text.slice(0, 8)}#${nth}`),
    text,
    color: colorById(raw.color).id,
    nth,
  }
}

/**
 * 在 text 里定位一条标记，返回 [start, end)；找不到返回 null。
 * `nth` 表示"要第几次出现"（0 = 第一次），避免重复片段总落在第一处。
 */
export function findRange(text, mark) {
  const t = String(text || '')
  const q = String(mark?.text || '')
  if (!t || !q) return null
  const want = Math.max(0, Number(mark?.nth) || 0)
  let idx = -1
  let from = 0
  for (let i = 0; i <= want; i++) {
    idx = t.indexOf(q, from)
    if (idx < 0) return null
    from = idx + 1
  }
  return { start: idx, end: idx + q.length }
}

/** 从文本里数出某个片段出现的所有位置（用于生成新标记的 nth） */
export function countOccurrences(text, quote) {
  const t = String(text || '')
  const q = String(quote || '')
  if (!t || !q) return 0
  let n = 0
  let from = 0
  for (;;) {
    const i = t.indexOf(q, from)
    if (i < 0) break
    n += 1
    from = i + 1
  }
  return n
}

/**
 * 把文本切成 [{ text, mark|null }] 段落，供渲染层上色。
 * 重叠策略：**先到先得**（按起点排序，后到的重叠区间跳过）——
 * 不允许叠色，因为两层半透明叠起来颜色会变得谁也认不出，用户会以为标错了。
 */
export function splitByMarks(text, marks = []) {
  const t = String(text || '')
  if (!t) return []
  const ranges = []
  for (const raw of marks) {
    const m = normalizeHighlight(raw)
    if (!m) continue
    const r = findRange(t, m)
    if (r) ranges.push({ ...r, mark: m })
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)

  const out = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start < cursor) continue // 与已占用的区间重叠 → 跳过
    if (r.start > cursor) out.push({ text: t.slice(cursor, r.start), mark: null })
    out.push({ text: t.slice(r.start, r.end), mark: r.mark })
    cursor = r.end
  }
  if (cursor < t.length) out.push({ text: t.slice(cursor), mark: null })
  return out
}

/**
 * 分离「还能定位到」与「已失效」的标记。
 * 失效不是错误（材料被裁剪/改了都会这样），但**必须让用户看见**。
 */
export function resolveMarks(text, marks = []) {
  const ok = []
  const stale = []
  for (const raw of marks) {
    const m = normalizeHighlight(raw)
    if (!m) continue
    ;(findRange(text, m) ? ok : stale).push(m)
  }
  return { ok, stale }
}

/**
 * 从浏览器 Selection 里取选区，并算出它在容器纯文本里的位置。
 * 返回 null 表示选区无效（跨了段落/不在容器内/纯空白）。
 */
export function readSelection(containerEl, plainText) {
  if (!containerEl || typeof window === 'undefined') return null
  const sel = window.getSelection?.()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const text = String(sel.toString() || '')
  if (!text.replace(/\s/g, '').length) return null
  // 选区必须落在容器内（用户可能在页面别处选字）
  const range = sel.getRangeAt(0)
  if (!containerEl.contains(range.commonAncestorContainer)) return null
  // 用"片段 + 第几次出现"定位：先按全文 indexOf 数出现次数
  const inside = String(plainText || '').indexOf(text)
  if (inside < 0) return null
  let nth = 0
  {
    // 选区落在容器内的第几次出现：数到选区起点为止
    const before = document.createRange()
    before.selectNodeContents(containerEl)
    before.setEnd(range.startContainer, range.startOffset)
    const pre = before.toString()
    const at = pre.indexOf(text)
    if (at >= 0) {
      let from = 0
      let n = 0
      for (;;) {
        const i = String(plainText || '').indexOf(text, from)
        if (i < 0 || i >= at) break
        n += 1
        from = i + 1
      }
      nth = n
    }
  }
  return { text, nth }
}
