// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// M9 导出与纸质复盘（2026-10-08）
//
// 导出的是**纯文字 Word 文档**（.docx），不是界面截图 —— 给用户拿去打印。
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
// docx 走动态 import —— 不点导出不加载，主包体积零增长。

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

/** 荧光色 → 打印用实底淡色（Word 不支持半透明，给等效浅色） */
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

// ─────────────────────────── 复盘文档 ───────────────────────────

const BODY_SIZE = 21 // 10.5pt（五号）
const NOTE_SIZE = 15 // 7.5pt —— 批注小字

/**
 * 组装「练习复盘」文档，返回 docx Document。
 * data 字段（与 record.js 的 buildRecord 输出对齐）：
 *   title, createdAt, mode, finalScore, maxScore, level, requirement, material, answer,
 *   questionType, results[{teacherId,score,maxScore,summary,advice,annotations}],
 *   summary, suggestions, credibility, marks {material, answer}
 */
export async function buildReviewDocument(data) {
  const { Document, Paragraph, TextRun, ShadingType, BorderStyle } = await import('docx')
  const marks = data.marks || {}
  const matMarks = Array.isArray(marks.material) ? marks.material : []
  const ansMarks = Array.isArray(marks.answer) ? marks.answer : []
  const children = []

  const base = { font: '宋体', size: BODY_SIZE, color: '2B2B2B' }
  const mkRun = (o) =>
    new TextRun({
      ...base,
      ...(o.fill ? { shading: { type: ShadingType.CLEAR, fill: o.fill } } : {}),
      ...o,
    })
  const para = (runs, opts = {}) =>
    new Paragraph({
      children: runs,
      spacing: { before: opts.before || 0, after: opts.after ?? 120, line: 320 },
    })
  const heading = (text) =>
    new Paragraph({
      children: [new TextRun({ text, bold: true, size: 24, color: '1F3A2E', font: '宋体' })],
      spacing: { before: 280, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9C4B4' } },
    })

  // ── 题头 ──
  children.push(para([mkRun({ text: `复盘 · ${data.title || '未命名练习'}`, bold: true, size: 30 })], { after: 80 }))
  const modeLabel = { practice: '练习', real: '真题', exam: '考场', paper: '整卷考试' }[data.mode] || data.mode || ''
  const metaBits = [
    data.createdAt ? fmtCn(data.createdAt) : '',
    modeLabel,
    data.questionType || '',
    `得分 ${data.finalScore ?? '—'} / ${data.maxScore ?? '—'}`,
    data.level || '',
  ].filter(Boolean)
  children.push(para([mkRun({ text: metaBits.join('　｜　'), color: '8A8578', size: 18 })], { after: 200 }))

  // ── 一、题目与作答要求 ──
  children.push(heading('一、题目与作答要求'))
  children.push(para([mkRun({ text: data.requirement || '（本记录未存作答要求）', size: 20, color: data.requirement ? '4A4A4A' : 'AAAAAA' })]))

  // ── 二、给定资料（含我的标记） ──
  children.push(heading('二、给定资料'))
  if (matMarks.length) {
    children.push(para([mkRun({ text: '（底色 = 你自己划的荧光标记）', color: '8A8578', size: 16 })], { after: 100 }))
  }
  if (data.material) {
    for (const b of materialBlocks(data.material)) {
      if (b.label) {
        children.push(para([mkRun({ text: b.label, bold: true, size: 20, color: '5B5B4A' })], { before: 140, after: 80 }))
      }
      for (const line of b.body.split('\n')) {
        if (!line.trim()) continue
        const segs = splitByMarks(line, matMarks)
        children.push(
          para(
            segs.map((s) => mkRun({ text: s.text, ...(s.mark ? { fill: MARK_FILL[s.mark.color] || MARK_FILL.yellow } : {}) })),
            { after: 100 }
          )
        )
      }
    }
  } else {
    children.push(para([mkRun({ text: '（本记录未存材料原文）', color: 'AAAAAA', size: 18 })]))
  }

  // ── 三、我的作答（老师批注内联） ──
  children.push(heading('三、我的作答（老师批注内联标注）'))
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

  // 图例
  const legendRuns = []
  const byTeacher = new Map()
  for (const r of annRanges) {
    byTeacher.set(r.colorHex, (byTeacher.get(r.colorHex) || 0) + 1)
  }
  for (const [color, n] of byTeacher) {
    const name = annRanges.find((r) => r.colorHex === color)?.teacherName || ''
    legendRuns.push(mkRun({ text: `■ ${name}`, color, bold: true, size: 16 }))
    legendRuns.push(mkRun({ text: ` ${n} 处　`, color: '8A8578', size: 16 }))
  }
  if (hlRanges.length) legendRuns.push(mkRun({ text: '□ 底色 = 我的荧光', color: '8A8578', size: 16 }))
  if (legendRuns.length) children.push(para(legendRuns, { after: 140 }))

  // 正文：区间按换行切开后逐行事件化游走
  if (!answer) {
    children.push(para([mkRun({ text: '（无作答内容）', color: 'AAAAAA' })]))
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
        children.push(para([mkRun({ text: line })], { after: 100 }))
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
          runs.push(mkRun({ text: line.slice(cursor, ev.pos), ...(top ? { fill: top.isAnn ? tint(top.colorHex) : top.fill } : {}) }))
          cursor = ev.pos
        }
        if (ev.kind === 'open') active.push(ev.r)
        else {
          active = active.filter((r) => r !== ev.r)
          if (ev.r.isAnn) {
            const noteText = `　〔${ev.r.teacherName}·${ev.r.type}〕${ev.r.comment}${ev.r.fix ? '　改：' + ev.r.fix : ''}`
            runs.push(mkRun({ text: noteText, color: ev.r.colorHex, size: NOTE_SIZE }))
          }
        }
      }
      if (cursor < line.length) {
        const top = active.find((r) => r.isAnn) || active[0]
        runs.push(mkRun({ text: line.slice(cursor), ...(top ? { fill: top.isAnn ? tint(top.colorHex) : top.fill } : {}) }))
      }
      children.push(para(runs, { after: 100 }))
    })
  }

  // 未能定位的批注 —— 单独列出来，不能默默吞掉（与屏幕端同规矩）
  if (unlocated.length) {
    children.push(para([mkRun({ text: '以下批注未能定位到原文片段（AI 引句与作答有出入）：', color: '8A8578', size: 16 })], { before: 160, after: 60 }))
    for (const a of unlocated) {
      children.push(para([mkRun({ text: `■ ${a.teacherName}·${a.type}　`, color: a.colorHex, bold: true, size: 16 }), mkRun({ text: a.comment + (a.fix ? '　改：' + a.fix : ''), size: 18, color: '4A4A4A' })], { after: 60 }))
    }
  }

  // ── 四、老师意见 ──
  children.push(heading('四、老师意见'))
  if (data.summary) children.push(para([mkRun({ text: `总评：${data.summary}`, size: 20 })]))
  for (const r of data.results || []) {
    const meta = teacherMeta(r.teacherId)
    const head = `${meta.name}　${r.error ? '（批改失败）' : `${r.score ?? '—'} / ${r.maxScore ?? '—'} 分`}`
    children.push(para([mkRun({ text: head, bold: true, color: meta.color })], { before: 140, after: 60 }))
    const body = r.advice || r.summary || ''
    if (body) children.push(para([mkRun({ text: body, size: 20, color: '3A3A3A' })]))
  }
  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    children.push(para([mkRun({ text: '改进清单', bold: true, size: 20 })], { before: 180, after: 60 }))
    for (const s of data.suggestions) {
      children.push(para([mkRun({ text: `· ${typeof s === 'string' ? s : s.text || ''}`, size: 20, color: '3A3A3A' })], { after: 60 }))
    }
  }
  if (data.credibility?.label) {
    children.push(
      para([mkRun({ text: `批改可信度：${data.credibility.label}${data.credibility.note ? '（' + data.credibility.note + '）' : ''}`, color: '8A8578', size: 16 })], { before: 180 })
    )
  }

  return new Document({
    styles: { default: { document: { run: { font: '宋体', size: BODY_SIZE, color: '2B2B2B' }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ children }],
  })
}

/** 高层入口：记录 → 复盘文档 → 保存/下载 */
export async function exportReview(data) {
  const { Packer } = await import('docx')
  const doc = await buildReviewDocument(data)
  const blob = await Packer.toBlob(doc)
  const name = safeName(`复盘-${data.title || '练习'}-${dateTag(data.createdAt)}`) + '.docx'
  const res = await exportBlob(name, '练习复盘', blob)
  return { ...res, fileName: name }
}

// ─────────────────────────── 素材本文档 ───────────────────────────

/**
 * 组装「规范词库 / 素材本」文档。
 * @param themes LEXICON_THEMES（[{key,name,items:[{formal,plain}]}]）
 * @param opts.favOnly 只导收藏；favSet 收藏 id 集合（Set）
 */
export async function buildLexiconDocument(themes, { favOnly = false, favSet = null } = {}) {
  const { Document, Paragraph, TextRun, BorderStyle } = await import('docx')
  const children = []
  const mkRun = (o) => new TextRun({ font: '宋体', size: 21, color: '2B2B2B', ...o })
  const para = (runs, opts = {}) =>
    new Paragraph({ children: runs, spacing: { before: opts.before || 0, after: opts.after ?? 100, line: 320 } })

  const total = themes.reduce((s, t) => s + t.items.length, 0)
  children.push(para([mkRun({ text: '蓝笔申论 · 规范词库', bold: true, size: 30 })], { after: 60 }))
  children.push(
    para([mkRun({ text: `${fmtCn(Date.now())} 导出 · 共 ${total} 条 · 主题与文章库九大主题对齐 · 背一组规范词，顶刷十篇时评`, color: '8A8578', size: 16 })], { after: 200 })
  )

  let n = 0
  for (const t of themes) {
    const items = favOnly && favSet ? t.items.filter((it) => favSet.has(it.id)) : t.items
    if (!items.length) continue
    n += items.length
    children.push(
      new Paragraph({
        children: [mkRun({ text: `${t.name}（${items.length} 条）`, bold: true, size: 24, color: '1F3A2E' })],
        spacing: { before: 260, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9C4B4' } },
      })
    )
    for (const it of items) {
      children.push(
        para([
          mkRun({ text: it.plain, color: '8A8578', size: 18 }),
          mkRun({ text: '　→　', color: 'B0AA9A', size: 18 }),
          mkRun({ text: it.formal, bold: true }),
        ], { after: 90 })
      )
    }
  }
  if (!n) children.push(para([mkRun({ text: favOnly ? '收藏夹是空的 —— 先在词库里点 ⭐ 收藏几条' : '（无内容）', color: 'AAAAAA' })]))

  return new Document({
    styles: { default: { document: { run: { font: '宋体', size: 21, color: '2B2B2B' }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ children }],
  })
}

/** 高层入口：词库 → 文档 → 保存/下载 */
export async function exportLexicon(themes, opts = {}) {
  const { Packer } = await import('docx')
  const doc = await buildLexiconDocument(themes, opts)
  const blob = await Packer.toBlob(doc)
  const scope = opts.favOnly ? '我的收藏' : '全册'
  const name = safeName(`规范词库-${scope}-${dateTag()}`) + '.docx'
  const res = await exportBlob(name, '素材本', blob)
  return { ...res, fileName: name }
}
