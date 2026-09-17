// CHANGELOG.md 的解析器：**唯一实现**，纯函数、零依赖。
//
// 为什么单独拆一个文件而不是塞进 changelog.js：
// changelog.js 里有 `import raw from '../../../CHANGELOG.md?raw'`，那个 `?raw` 后缀
// 只有 Vite 认，Node 直接 import 会报错。解析逻辑留在一起的话，单测就只能把正则
// **复制一份**过去 —— 而复制的那份永远是"对的"，页面照旧能坏。
// 拆出来之后 .tools/test-changelog.mjs 可以 import 本文件，测的就是页面在跑的那段代码。
//
// 支持的写法（与 CHANGELOG.md 顶部的「写法约定」一致）：
//   ## vX.Y.Z · YYYY-MM-DD · 标题        → 一个版本
//   ### 新增 / 优化 / 变更 / 修复 / 删除 / 测试  → 分组（条目靠它分类）
//   - 条目                                → 一条
//     - 子条目（缩进 2 空格）              → 附在上一条下面
//     续行（缩进但不以 - 开头）            → 接到上一条后面（原来是被丢掉的）
//   > 附注                                → 记成 note，与正文分开
//   行内 `代码` / **加粗** / *斜体*        → 解析成片段，不把记号原样显示

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HEAD_RE = /^##\s+(v[\d.]+)\s*(.*)$/
const SUB_RE = /^###\s+(.+?)\s*$/
const ITEM_RE = /^(\s*)[-*]\s+(.+?)\s*$/
const NOTE_RE = /^\s*>\s?(.*)$/
const SEP_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

/**
 * 拼接续行。
 *
 * 中文之间**不补空格**：Markdown 的软换行在英文里渲染成空格，直接照搬到中文会
 * 在句中凭空多出一个空格（「要点不全」 其实是同一件事），看着像排版事故。
 * 只要接缝两侧有一侧是 ASCII（英文单词、`/`、数字），才补空格。
 */
function joinLines(a, b) {
  if (!a) return b
  if (!b) return a
  const ascii = (c) => /[\x00-\x7F]/.test(c)
  return a + (ascii(a[a.length - 1]) || ascii(b[0]) ? ' ' : '') + b
}

const CODE_RE = /`([^`]+)`/g
const MARK_RE = /\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*/g
// 占位符：把代码段先摘出来。用 \u0000 包住序号，正文里不可能出现这个字符。
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g

/**
 * 把一行内容解析成渲染片段。
 *
 * 顺序上有个坑：**不能**先把代码段切下来再各自找加粗 ——
 * `**发放工具 \`issue.mjs\`**` 这种加粗跨过代码段，切开后两边各剩半个 `**`，
 * 于是页面上原样显示 `**`。反过来也有坑：代码里的 `*` 是字面量
 * （`/wechat/*.jpg`），直接对整行找加粗会把它当边界而失配。
 *
 * 解法是用占位符把代码**挖走**（不是切开）：整行还能当一个整体匹配加粗，
 * 而代码内容已经不在行里，它的 `*` 自然不参与匹配。最后再还原。
 *
 * @returns {{t:'text'|'bold'|'em'|'code', v:string}[]}
 */
export function parseInline(s) {
  const src = String(s ?? '')
  const codes = []
  const masked = src.replace(CODE_RE, (_, v) => `\u0000${codes.push(v) - 1}\u0000`)

  const segs = []
  let last = 0
  for (const m of masked.matchAll(MARK_RE)) {
    if (m.index > last) segs.push({ t: 'text', v: masked.slice(last, m.index) })
    segs.push(m[1] != null ? { t: 'bold', v: m[1] } : { t: 'em', v: m[2] })
    last = m.index + m[0].length
  }
  if (last < masked.length) segs.push({ t: 'text', v: masked.slice(last) })

  // 还原占位符：一个片段里可能混着文字与代码，所以还要再切一次
  return mergeText(segs.flatMap(expandCodes))

  function expandCodes(seg) {
    if (seg.t !== 'text' || !seg.v.includes('\u0000')) return [seg]
    const out = []
    let at = 0
    for (const m of seg.v.matchAll(PLACEHOLDER_RE)) {
      if (m.index > at) out.push({ t: 'text', v: seg.v.slice(at, m.index) })
      out.push({ t: 'code', v: codes[Number(m[1])] })
      at = m.index + m[0].length
    }
    if (at < seg.v.length) out.push({ t: 'text', v: seg.v.slice(at) })
    return out
  }
}

/** 合并相邻的纯文本片段，去掉空片段 —— 渲染时少一半节点 */
function mergeText(segs) {
  const out = []
  for (const s of segs) {
    if (!s.v) continue
    const prev = out[out.length - 1]
    if (s.t === 'text' && prev?.t === 'text') prev.v += s.v
    else out.push(s)
  }
  return out.length ? out : [{ t: 'text', v: '' }]
}

/** 片段 → 纯文本（测试与搜索用，不含任何记号） */
export function plainText(parts) {
  return (parts || []).map((p) => p.v).join('')
}

/**
 * 解析整份 CHANGELOG.md。
 *
 * 返回的版本按出现顺序（文档里新的在上面）。没有条目的版本会被丢掉 ——
 * 文档顶部那段「写法约定」本身也是 `- ` 列表，但它不在任何 `##` 版本下，不会被收进来。
 */
export function parseChangelog(markdown) {
  const versions = []
  let cur = null
  let group = null
  let item = null

  // 条目是「边读边攒」的：遇到下一条/下个分组才收尾，
  // 因为续行要接到它后面，读到下一行之前不知道它写完没有。
  const flush = () => {
    if (!item) return
    item.parts = parseInline(item.raw)
    item.text = plainText(item.parts)
    delete item.raw
    item = null
  }

  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const head = line.match(HEAD_RE)
    if (head) {
      flush()
      const parts = head[2].split(/[·—–|]/).map((s) => s.trim()).filter(Boolean)
      const date = parts.find((p) => DATE_RE.test(p)) || ''
      cur = {
        version: head[1],
        date,
        title: parts.filter((p) => p !== date).join(' · '),
        items: [],
      }
      versions.push(cur)
      group = null
      continue
    }

    const sub = line.match(SUB_RE)
    if (sub && cur) {
      flush()
      group = sub[1]
      continue
    }

    if (SEP_RE.test(line)) {
      flush()
      continue
    }

    const it = line.match(ITEM_RE)
    if (it && cur && group) {
      flush()
      item = { type: group, depth: it[1].length >= 2 ? 1 : 0, raw: it[2] }
      cur.items.push(item)
      continue
    }

    // 引用附注：与正文分开存，渲染成一行小字，不跟正文糊在一起
    const note = line.match(NOTE_RE)
    if (item && note) {
      item.note = joinLines(item.note || '', note[1].trim())
      continue
    }

    // 续行：非空且正在攒条目 → 接上去
    if (item && line.trim()) {
      item.raw = joinLines(item.raw, line.trim())
      continue
    }
  }
  flush()

  // 没有任何条目的版本不渲染（文档顶部的说明性小节会被这里挡掉）
  return versions.filter((v) => v.items.length > 0)
}

/** 改动类型 → 展示配色（自然有机风的大地色系） */
export const TAG_STYLE = {
  新增: { bg: '#e8ecdf', fg: '#4f7d5e' },
  优化: { bg: '#e3e8ef', fg: '#3d5a7a' },
  变更: { bg: '#f2ebe2', fg: '#5c4033' },
  修复: { bg: '#f7e9e4', fg: '#9c4a42' },
  测试: { bg: '#efe9f4', fg: '#6d5a80' },
  删除: { bg: '#f1eceb', fg: '#8a7268' },
}

export function tagStyle(type) {
  return TAG_STYLE[type] || { bg: '#f2ebe2', fg: '#78716c' }
}
