// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// M9 导出与纸质复盘（2026-10-08，同日加 PDF 通道）
//
// 导出的是**纯文字文档**（Word .docx / PDF），不是界面截图 —— 给用户拿去打印。
//   · 网页版：浏览器直接下载；
//   · 桌面版：写到设置里的导出目录（localStorage `bp-export-dir`，相对路径相对 exe），
//     按「练习复盘 / 素材本」分类建子目录。Rust 侧命令见 desktop/src-tauri/src/lib.rs。
//
// 复盘文档的排版约定（用户原话：「不同颜色画出，然后在批改的句子那里
// 用和批注相同颜色的笔小一点的字显示出来打印」）：
//   · 老师批注 = 该老师的主题色：引文句底色加淡、句后跟**同色小号字**批注；
//   · 我自己划的荧光 = 各标记色的淡底色（与批注色分得清）；
//   · 多位老师引同一句 → 各自的批注在各自的终点依次内联，颜色各随各的老师。
//
// 架构（2026-10-08）：「内容模型」一份、渲染器两个。
//   buildXxxModel() 产出与格式无关的节点数组（runs + 段距 + 标题线），
//   Word 走 docx、PDF 走 @react-pdf/renderer —— 两格式内容永远一致，
//   以后改排版只改模型层，不会出现"Word 改了 PDF 没改"的漂移。
//
// docx / react-pdf 都走动态 import —— 不点导出不加载，主包体积零增长。
// PDF 中文字体：思源宋体 GB2312 子集（public/fonts/，~2.8MB×2 字重），
//   第一次导出 PDF 时才由 @react-pdf/renderer 加载。

import { HIGHLIGHT_COLORS, splitByMarks, normalizeHighlight, findRange, locateQuote } from './highlight'
import { materialBlocks } from './materialBlocks'
import { TEACHERS } from '../agents/teachers'

// 批注引文定位与屏幕端 AnnotatedAnswer 共用同一实现（含「」退让），这里只转出口
export { locateQuote }

export const EXPORT_DIR_KEY = 'bp-export-dir'

/** 是否跑在 Tauri 桌面壳里 */
export function isDesktop() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

// ─────────────────────────── 颜色 ───────────────────────────

/** 荧光色 → 打印用实底淡色（Word/PDF 都不支持半透明文字底，给等效浅色） */
export const MARK_FILL = {
  yellow: 'FDE68A',
  green: 'BBF7D0',
  blue: 'BFDBFE',
  pink: 'FBCFE8',
  purple: 'DDD6FE',
  orange: 'FED7AA',
  cyan: 'A5F3FC',
  red: 'FECACA',
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const n = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h.padEnd(6, '0')
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0)
}

/** 主题色和白色按比例混合出淡底色（t=0.82 → 82% 白），返回 RRGGBB */
export function tint(hex, t = 0.82) {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c) => Math.round(c + (255 - c) * t)
  return [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function teacherMeta(id) {
  const t = TEACHERS[id]
  return { name: t?.name || id, color: String(t?.color || '#5c4033').replace('#', '').toUpperCase() }
}

// ─────────────────────────── 保存通道 ───────────────────────────

async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < buf.length; i += CH) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH))
  }
  return btoa(bin)
}

/**
 * 统一出口：桌面版走 Rust 命令写文件（返回落盘路径），网页版浏览器下载。
 * @returns {Promise<{ok:boolean, way:'desktop'|'web', path?:string, error?:string}>}
 */
export async function exportBlob(fileName, category, blob) {
  if (isDesktop()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const baseDir = localStorage.getItem(EXPORT_DIR_KEY) || ''
      const saved = await invoke('save_export_file', {
        baseDir,
        category,
        fileName,
        contentsB64: await blobToB64(blob),
      })
      return { ok: true, way: 'desktop', path: saved }
    } catch (e) {
      return { ok: false, way: 'desktop', error: String(e?.message || e) }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { ok: true, way: 'web' }
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 60)
}

function dateTag(ts) {
  const d = new Date(ts || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function fmtCn(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

// ─────────────────────────── 黑白打印模式 ───────────────────────────
// 2026-10-08 用户要求「文档直接黑白色就行」：彩色（老师色/主题绿）压成灰阶，
// 所有底色（荧光标记/批注便签浅底）删掉换成下划线 —— 彩打费墨，黑白打印机
// 把浅底打出来还发灰。两个渲染器入口统一过 toPrint，模型层不用感知。
const GRAY_MAP = { '1F3A2E': '2B2B2B', '5B5B4A': '5B5B5B', '8A8578': '8A8A8A', 'B0AA9A': 'AAAAAA' }
const GRAY_KEEP = new Set(['2B2B2B', '3A3A3A', '4A4A4A', '8A8A8A', 'AAAAAA', '5B5B5B'])

function toPrint(nodes) {
  return nodes.map((n) => ({
    ...n,
    runs: n.runs.map(({ fill, ...r }) => ({
      ...r,
      color: !r.color ? undefined
        : GRAY_MAP[r.color] || (GRAY_KEEP.has(r.color) ? r.color : '2B2B2B'),
      // 正文级（≥9pt）加粗：黑白打印下宋体 9pt 偏细（用户反馈），粗体才压得住纸面；
      // 批注小字/图例/序号（≤8pt）保持细体，粗了会糊
      bold: r.bold || (r.size || BODY_SIZE) >= BODY_SIZE,
      ...(fill ? { underline: true } : {}),
    })),
  }))
}

// ─────────────────────────── 内容模型 ───────────────────────────
// 节点 = { runs:[Run], before?, after?, border? }   before/after 单位 twip（1pt=20）
// Run  = { text, color?, size?, bold?, fill? }      size 半点（五号=21）；颜色 RRGGBB 无 #

const BODY_SIZE = 18 // 9pt（小五）—— 整体调小省纸
const NOTE_SIZE = 16 // 8pt —— 批注小字（有同色浅底保底，8pt 打印仍可辨）

function mkNode(runs, opts = {}) {
  return { runs, before: opts.before || 0, after: opts.after ?? 120, border: !!opts.border }
}

/**
 * 组装「练习复盘」内容模型。
 * data 字段（与 record.js 的 buildRecord 输出对齐）：
 *   title, createdAt, mode, finalScore, maxScore, level, requirement, material, answer,
 *   questionType, results[{teacherId,score,maxScore,summary,advice,annotations}],
 *   summary, suggestions, credibility, marks {material, answer}
 */
export function buildReviewModel(data) {
  const marks = data.marks || {}
  const matMarks = Array.isArray(marks.material) ? marks.material : []
  const ansMarks = Array.isArray(marks.answer) ? marks.answer : []
  const R = (o) => ({ size: BODY_SIZE, color: '2B2B2B', ...o })
  const nodes = []

  // ── 题头 ──
  nodes.push(mkNode([R({ text: `复盘 · ${data.title || '未命名练习'}`, bold: true, size: 26 })], { after: 80 }))
  const modeLabel = { practice: '练习', real: '真题', exam: '考场', paper: '整卷考试' }[data.mode] || data.mode || ''
  const metaBits = [
    data.createdAt ? fmtCn(data.createdAt) : '',
    modeLabel,
    data.questionType || '',
    `得分 ${data.finalScore ?? '—'} / ${data.maxScore ?? '—'}`,
    data.level || '',
  ].filter(Boolean)
  nodes.push(mkNode([R({ text: metaBits.join('　｜　'), color: '8A8578', size: 16 })], { after: 200 }))

  // ── 一、题目与作答要求 ──
  nodes.push(mkNode([R({ text: '一、题目与作答要求', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
  nodes.push(mkNode([R({ text: data.requirement || '（本记录未存作答要求）', size: 18, color: data.requirement ? '4A4A4A' : 'AAAAAA' })]))

  // ── 二、给定资料（含我的标记） ──
  nodes.push(mkNode([R({ text: '二、给定资料', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
  if (matMarks.length) {
    nodes.push(mkNode([R({ text: '（下划线 = 你自己划的标记）', color: '8A8578', size: 14 })], { after: 100 }))
  }
  if (data.material) {
    for (const b of materialBlocks(data.material)) {
      if (b.label) {
        nodes.push(mkNode([R({ text: b.label, bold: true, size: 18, color: '5B5B4A' })], { before: 140, after: 80 }))
      }
      for (const line of b.body.split('\n')) {
        if (!line.trim()) continue
        const segs = splitByMarks(line, matMarks)
        nodes.push(mkNode(segs.map((s) => R({ text: s.text, ...(s.mark ? { fill: MARK_FILL[s.mark.color] || MARK_FILL.yellow } : {}) })), { after: 100 }))
      }
    }
  } else {
    nodes.push(mkNode([R({ text: '（本记录未存材料原文）', color: 'AAAAAA', size: 16 })]))
  }

  // ── 三、我的作答（老师批注内联） ──
  nodes.push(mkNode([R({ text: '三、我的作答（句尾序号对应「老师批注」）', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
  const answer = data.answer || ''

  // 收集批注区间（可定位/不可定位分开——和屏幕端 AnnotatedAnswer 同一套规则）
  const annRanges = []
  const unlocated = []
  const seen = new Set()
  for (const r of data.results || []) {
    const meta = teacherMeta(r.teacherId)
    for (const a of r.annotations || []) {
      const key = `${r.teacherId}|${a.quote}`
      if (seen.has(key)) continue
      seen.add(key)
      const info = {
        teacherName: meta.name,
        colorHex: meta.color,
        type: a.type || '问题',
        comment: a.comment || '',
        fix: a.fix || '',
      }
      const span = locateQuote(answer, a.quote)
      if (span) annRanges.push({ ...span, ...info })
      else unlocated.push(info)
    }
  }
  // 我的荧光区间（低优先级：批注在场的句子上不叠荧光底）
  const hlRanges = []
  for (const raw of ansMarks) {
    const h = normalizeHighlight(raw)
    if (!h) continue
    const r = findRange(answer, h)
    if (r) hlRanges.push({ ...r, fill: MARK_FILL[h.color] || MARK_FILL.yellow })
  }

  // 批注编号（2026-10-08 用户要求：标注与正文分开 —— 正文句尾只留序号，
  // 批注内容集中在「老师批注」一节按序号列出，正文读起来才连贯）
  const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
  annRanges.sort((a, b) => a.start - b.start || a.end - b.end)
  annRanges.forEach((r, i) => { r.no = CIRC[i] || `[${i + 1}]` })

  // 图例（黑白打印：老师色块没意义，改纯文字计数）
  const legendRuns = [R({ text: '批注：', bold: true, size: 14 })]
  const byTeacher = new Map()
  for (const r of annRanges) {
    byTeacher.set(r.colorHex, (byTeacher.get(r.colorHex) || 0) + 1)
  }
  for (const [color, n] of byTeacher) {
    const name = annRanges.find((r) => r.colorHex === color)?.teacherName || ''
    legendRuns.push(R({ text: `${name} ${n} 处　`, color: '4A4A4A', size: 14 }))
  }
  if (hlRanges.length) legendRuns.push(R({ text: '下划线 = 我的标记', color: '8A8578', size: 14 }))
  if (annRanges.length || hlRanges.length) nodes.push(mkNode(legendRuns, { after: 140 }))

  // 正文：区间按换行切开后逐行事件化游走
  if (!answer) {
    nodes.push(mkNode([R({ text: '（无作答内容）', color: 'AAAAAA' })]))
  } else {
    const lineStarts = [0]
    for (let i = 0; i < answer.length; i++) if (answer[i] === '\n') lineStarts.push(i + 1)
    const lines = answer.split('\n')
    const lineRanges = lines.map(() => [])
    for (const r of [...annRanges.map((r) => ({ ...r, isAnn: true })), ...hlRanges]) {
      for (let li = 0; li < lines.length; li++) {
        const ls = lineStarts[li]
        const le = ls + lines[li].length
        if (r.end <= ls || r.start >= le) continue
        lineRanges[li].push({ ...r, start: Math.max(r.start, ls) - ls, end: Math.min(r.end, le) - ls })
      }
    }
    lines.forEach((line, li) => {
      const rs = lineRanges[li]
      if (!rs.length) {
        nodes.push(mkNode([R({ text: line })], { after: 100 }))
        return
      }
      // 事件化：open/close 扫描；批注在 close 时内联同色小字
      const events = []
      for (const r of rs) {
        events.push({ pos: r.start, kind: 'open', r })
        events.push({ pos: r.end, kind: 'close', r })
      }
      events.sort((a, b) => a.pos - b.pos || (a.kind === 'close' && b.kind === 'open' ? -1 : 1))
      const runs = []
      let cursor = 0
      let active = []
      for (const ev of events) {
        if (ev.pos > cursor) {
          const top = active.find((r) => r.isAnn) || active[0]
          runs.push(R({ text: line.slice(cursor, ev.pos), ...(top ? { fill: top.isAnn ? tint(top.colorHex) : top.fill } : {}) }))
          cursor = ev.pos
        }
        if (ev.kind === 'open') active.push(ev.r)
        else {
          active = active.filter((r) => r !== ev.r)
          if (ev.r.isAnn) {
            // 只在句尾留序号（批注内容见「老师批注」清单），正文保持连贯
            runs.push(R({ text: ev.r.no, size: 14, color: '8A8578' }))
          }
        }
      }
      if (cursor < line.length) {
        const top = active.find((r) => r.isAnn) || active[0]
        runs.push(R({ text: line.slice(cursor), ...(top ? { fill: top.isAnn ? tint(top.colorHex) : top.fill } : {}) }))
      }
      nodes.push(mkNode(runs, { after: 100 }))
    })
  }

  // ── 四、老师批注（序号对应正文句尾） ──
  if (annRanges.length || unlocated.length) {
    nodes.push(mkNode([R({ text: '四、老师批注（序号对应作答中的标注）', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
    for (const a of annRanges) {
      nodes.push(mkNode([
        R({ text: `${a.no}　`, bold: true }),
        R({ text: `〔${a.teacherName}·${a.type}〕`, size: NOTE_SIZE, color: '4A4A4A' }),
        R({ text: a.comment || '', size: NOTE_SIZE, color: '3A3A3A' }),
        ...(a.fix ? [R({ text: `　改：${a.fix}`, size: NOTE_SIZE, color: '3A3A3A' })] : []),
      ], { after: 60 }))
    }
    if (unlocated.length) {
      nodes.push(mkNode([R({ text: '以下批注未能定位到原文片段（AI 引句与作答有出入）：', color: '8A8578', size: 14 })], { before: 120, after: 60 }))
      for (const a of unlocated) {
        nodes.push(mkNode([
          R({ text: `■ ${a.teacherName}·${a.type}　`, bold: true, size: 14 }),
          R({ text: a.comment + (a.fix ? '　改：' + a.fix : ''), size: 16, color: '4A4A4A' }),
        ], { after: 60 }))
      }
    }
  }

  // ── 五、参考答案（AI 优化版）：把每条批注的「改」替换回原文生成整段可背的升级版 ──
  if (answer && annRanges.some((r) => r.fix)) {
    let optimized = ''
    let cur = 0
    for (const r of annRanges) {
      if (!r.fix || r.start < cur) continue // 无改法/与上一处重叠 → 保留原文
      optimized += answer.slice(cur, r.start) + r.fix
      cur = r.end
    }
    optimized += answer.slice(cur)
    if (optimized.trim() && optimized !== answer) {
      nodes.push(mkNode([R({ text: '五、参考答案（AI 优化版，改法已合入原文）', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
      for (const line of optimized.split('\n')) {
        if (!line.trim()) continue
        nodes.push(mkNode([R({ text: line })], { after: 100 }))
      }
    }
  }

  // ── 六、老师意见 ──
  nodes.push(mkNode([R({ text: '六、老师意见', bold: true, size: 21, color: '1F3A2E' })], { before: 280, border: true }))
  if (data.summary) nodes.push(mkNode([R({ text: `总评：${data.summary}`, size: 18 })]))
  for (const r of data.results || []) {
    const meta = teacherMeta(r.teacherId)
    const head = `${meta.name}　${r.error ? '（批改失败）' : `${r.score ?? '—'} / ${r.maxScore ?? '—'} 分`}`
    nodes.push(mkNode([R({ text: head, bold: true, color: meta.color })], { before: 140, after: 60 }))
    const body = r.advice || r.summary || ''
    if (body) nodes.push(mkNode([R({ text: body, size: 18, color: '3A3A3A' })]))
  }
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    nodes.push(mkNode([R({ text: '改进清单', bold: true, size: 18 })], { before: 180, after: 60 }))
    for (const s of data.suggestions) {
      nodes.push(mkNode([R({ text: `· ${typeof s === 'string' ? s : s.text || ''}`, size: 18, color: '3A3A3A' })], { after: 60 }))
    }
  }
  if (data.credibility?.label) {
    nodes.push(mkNode([R({ text: `批改可信度：${data.credibility.label}${data.credibility.note ? '（' + data.credibility.note + '）' : ''}`, color: '8A8578', size: 14 })], { before: 180 }))
  }

  return nodes
}

/**
 * 组装「规范词库 / 素材本」内容模型。
 * @param themes LEXICON_THEMES（[{key,name,items:[{formal,plain}]}]）
 * @param opts.favOnly 只导收藏；favSet 收藏 id 集合（Set）
 */
export function buildLexiconModel(themes, { favOnly = false, favSet = null } = {}) {
  const nodes = []
  // 素材本条目短、量大：正文 8pt、间距收紧，整册打印才不浪费纸（2026-10-08 用户反馈）
  const R = (o) => ({ size: 16, color: '2B2B2B', ...o })

  const total = themes.reduce((s, t) => s + t.items.length, 0)
  nodes.push(mkNode([R({ text: '蓝笔申论 · 规范词库', bold: true, size: 22 })], { after: 40 }))
  nodes.push(
    mkNode([R({ text: `${fmtCn(Date.now())} 导出 · 共 ${total} 条 · 主题与文章库九大主题对齐 · 背一组规范词，顶刷十篇时评`, color: '8A8578', size: 14 })], { after: 160 })
  )

  let n = 0
  for (const t of themes) {
    const items = favOnly && favSet ? t.items.filter((it) => favSet.has(it.id)) : t.items
    if (!items.length) continue
    n += items.length
    nodes.push(mkNode([R({ text: `${t.name}（${items.length} 条）`, bold: true, size: 18, color: '1F3A2E' })], { before: 200, border: true }))
    for (const it of items) {
      nodes.push(
        mkNode([
          R({ text: it.plain, color: '8A8578', size: 14 }),
          R({ text: ' → ', color: 'B0AA9A', size: 14 }),
          R({ text: it.formal, bold: true }),
        ], { after: 50 })
      )
    }
  }
  if (!n) nodes.push(mkNode([R({ text: favOnly ? '收藏夹是空的 —— 先在词库里点 ⭐ 收藏几条' : '（无内容）', color: 'AAAAAA' })]))

  return nodes
}

// ─────────────────────────── Word 渲染器（docx） ───────────────────────────

export async function buildReviewDocument(data) {
  const { Document } = await import('docx')
  return renderDocxDocument(buildReviewModel(data))
}

export async function buildLexiconDocument(themes, opts = {}) {
  const { Document } = await import('docx')
  return renderDocxDocument(buildLexiconModel(themes, opts))
}

async function renderDocxDocument(nodes) {
  const { Document, Paragraph, TextRun, BorderStyle } = await import('docx')
  const children = toPrint(nodes).map((node) => {
    const runs = node.runs.map((r) =>
      new TextRun({
        text: r.text,
        size: r.size || BODY_SIZE,
        color: r.color || '2B2B2B',
        ...(r.bold ? { bold: true } : {}),
        ...(r.underline ? { underline: {} } : {}),
        font: '宋体',
      })
    )
    return new Paragraph({
      children: runs,
      spacing: { before: node.before, after: node.after, line: 280 },
      ...(node.border
        ? { border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9C4B4' } } }
        : {}),
    })
  })
  return new Document({
    styles: { default: { document: { run: { font: '宋体', size: BODY_SIZE, color: '2B2B2B' }, paragraph: { spacing: { line: 280 } } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  })
}

// ─────────────────────────── PDF 渲染器（@react-pdf/renderer） ───────────────────────────
// 中文字体：思源宋体 CN 子集（GB2312+ASCII+常用符号，~2.8MB/字重），放 public/fonts/，
// 第一次导出 PDF 才加载。fontkit 读 OTF；bold 用独立字重文件（不做伪粗）。
// CJK 换行：react-pdf 默认把无空格长句当一个词 → 注册逐字 hyphenation 才能正常折行。

const PDF_FONT_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
// node 环境（护栏测试）没有静态服务：从本模块位置推出 public/fonts 的本地绝对路径。
// @react-pdf/font 用 is-url 判 src：http(s)/file:// 都走 fetch（node 的 fetch 不支持 file://），
// 只有普通本地路径才走 fs —— 所以这里手工把 file URL 转回 'E:/...' 形式，不引 node 模块
// （顶层 import 'node:url' 会进浏览器 bundle，炸构建）。
const PDF_FONT_DIR_PATH = (() => {
  if (typeof window !== 'undefined') return ''
  const p = decodeURIComponent(new URL('../../public/fonts/', import.meta.url).pathname)
  return p.replace(/^\/([A-Za-z]:)/, '$1')
})()
const pdfFontSrc = (file) =>
  typeof window !== 'undefined'
    ? `${PDF_FONT_BASE}fonts/${file}`
    : PDF_FONT_DIR_PATH + file

let pdfFontRegistered = false

async function ensurePdfFont() {
  if (pdfFontRegistered) return
  const { Font } = await import('@react-pdf/renderer')
  Font.register({
    family: 'BPSerif',
    fonts: [
      { src: pdfFontSrc('bp-serif-regular.otf'), fontWeight: 400 },
      { src: pdfFontSrc('bp-serif-bold.otf'), fontWeight: 700 },
    ],
  })
  // 中文逐字断行：无空格长句被当成一个"词"，不逐字拆就溢出页面
  Font.registerHyphenationCallback((word) => word.split(''))
  pdfFontRegistered = true
}

export async function renderPdfBlob(nodes, title) {
  await ensurePdfFont()
  const R = await import('@react-pdf/renderer')
  const { createElement: h } = await import('react')
  const pt = (twip) => (twip || 0) / 20

  const children = toPrint(nodes).map((node, ni) => {
    const runs = node.runs.map((r, ri) =>
      h(R.Text, {
        key: ri,
        style: {
          color: r.color ? `#${r.color}` : '#2B2B2B',
          textDecoration: r.underline ? 'underline' : undefined,
          fontWeight: r.bold ? 700 : 400,
          fontSize: (r.size || BODY_SIZE) / 2,
        },
      }, r.text)
    )
    const spacing = { marginTop: pt(node.before), marginBottom: pt(node.after), lineHeight: 1.45 }
    if (node.border) {
      // 标题：底下一条分隔线（Word 端是段落 bottom border）
      return h(R.View, {
        key: ni,
        style: { ...spacing, borderBottomWidth: 1, borderBottomColor: '#C9C4B4', paddingBottom: 4 },
      }, h(R.Text, null, runs))
    }
    return h(R.Text, { key: ni, style: spacing }, runs)
  })

  const doc = h(
    R.Document,
    { title, author: '许一（蓝笔申论）', creator: '蓝笔申论 BluePencil' },
    h(
      R.Page,
      {
        size: 'A4',
        style: {
          paddingVertical: 44, paddingHorizontal: 46,
          fontFamily: 'BPSerif', fontSize: BODY_SIZE / 2, color: '#2B2B2B',
        },
      },
      children
    )
  )
  // v4 API：pdf(doc) 实例，浏览器 toBlob()；node（护栏测试）toBuffer()
  const instance = R.pdf(doc)
  if (instance.toBlob) return instance.toBlob()
  return instance.toBuffer()
}

// ─────────────────────────── 高层入口 ───────────────────────────

/** 复盘 · Word */
export async function exportReview(data) {
  const { Packer } = await import('docx')
  const doc = await buildReviewDocument(data)
  const blob = await Packer.toBlob(doc)
  const name = safeName(`复盘-${data.title || '练习'}-${dateTag(data.createdAt)}`) + '.docx'
  const res = await exportBlob(name, '练习复盘', blob)
  return { ...res, fileName: name }
}

/** 复盘 · PDF（内容与 Word 同一份模型，样式等价） */
export async function exportReviewPdf(data) {
  const blob = await renderPdfBlob(buildReviewModel(data), `复盘 · ${data.title || '练习'}`)
  const name = safeName(`复盘-${data.title || '练习'}-${dateTag(data.createdAt)}`) + '.pdf'
  const res = await exportBlob(name, '练习复盘', blob)
  return { ...res, fileName: name }
}

/** 词库 · Word */
export async function exportLexicon(themes, opts = {}) {
  const { Packer } = await import('docx')
  const doc = await buildLexiconDocument(themes, opts)
  const blob = await Packer.toBlob(doc)
  const scope = opts.favOnly ? '我的收藏' : '全册'
  const name = safeName(`规范词库-${scope}-${dateTag()}`) + '.docx'
  const res = await exportBlob(name, '素材本', blob)
  return { ...res, fileName: name }
}

/** 词库 · PDF */
export async function exportLexiconPdf(themes, opts = {}) {
  const scope = opts.favOnly ? '我的收藏' : '全册'
  const blob = await renderPdfBlob(buildLexiconModel(themes, opts), `蓝笔申论 · 规范词库（${scope}）`)
  const name = safeName(`规范词库-${scope}-${dateTag()}`) + '.pdf'
  const res = await exportBlob(name, '素材本', blob)
  return { ...res, fileName: name }
}
