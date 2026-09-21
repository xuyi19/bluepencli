// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 按题干引用的「给定资料N」裁剪材料
//
// 起因（2026-09-21 实测）：
//   一次真批改的单次 prompt 是 11,061 字符，其中**给定资料 7,009 字符**，占 63%。
//   原因是真题的 material 字段存的是**整卷材料**（一卷 6 则），而小题只问其中一则
//   （那道题问「给定资料4」）—— 其余五则与本次批改无关，却一起付了钱。
//
// ⚠️ 本模块**只做测算，不参与批改**（截至 v0.15.x 未接入 orchestrator）。
//    原因不是写不出来，而是取舍没定：
//      ・大作文（"参考给定资料，但不拘泥于给定资料"）本来就要通读全卷，裁了会失真；
//      ・正则解析不出来时若强行裁，等于让老师看不到依据 —— 分数变虚，比多花钱糟得多。
//    接入前必须先回答这两条，并且**默认关闭、UI 可见可关**。
//
// 三条硬规矩（接入时也不能破）：
//   ① **解析不出就整卷提交**。宁可不省，也不能裁错。
//   ② **大作文不裁**。题干里出现「不拘泥于给定资料」「结合给定资料，自选角度」
//      这类整卷表述时，一律返回整卷。
//   ③ 裁完要能说清"裁掉了几则、占多少"，UI 必须显示这个数字。

// ⚠️ 写全 `.js` 后缀：本模块要保持能被 Node 直接 import（.tools/test-material-trim.mjs 要跑它）。

/** 大作文特征：出现这些说法说明要通读全卷，不能裁 */
const FULL_PAPER_HINTS = [
  '不拘泥于给定资料',
  '不拘泥于资料',
  '参考给定资料',
  '结合给定资料',
  '请联系实际',
  '自选角度',
  '自拟题目',
  '写一篇文章',
  '写一篇议论文',
]

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function toNum(s) {
  const t = String(s || '').trim()
  if (/^\d+$/.test(t)) return Number(t)
  return CN_NUM[t] ?? null
}

/**
 * 把整卷材料按「材料N」拆成块。
 * 规则与 PracticeView::materialBlocks 一致（只认整行匹配），
 * 正文里提到「材料」二字不会被误切。
 *
 * @returns {Array<{label:string, no:number|null, body:string}>}
 */
export function splitMaterialBlocks(material) {
  const src = String(material || '')
  if (!src.trim()) return []
  const blocks = []
  let cur = null
  for (const line of src.split('\n')) {
    const m = line.match(/^材料\s*([0-9一二三四五六七八九十]+)\s*$/)
    if (m) {
      cur = { label: `材料${m[1]}`, no: toNum(m[1]), body: [] }
      blocks.push(cur)
      continue
    }
    if (!cur) {
      cur = { label: '', no: null, body: [] }
      blocks.push(cur)
    }
    cur.body.push(line)
  }
  return blocks.map((b) => ({ ...b, body: b.body.join('\n').trim() })).filter((b) => b.body)
}

/**
 * 从题干里解析引用了哪几则材料。
 * 支持：「给定资料4」「资料4」「材料4」「给定资料2、3」「资料4和5」「资料一至三」。
 *
 * @returns {number[]} 材料序号（去重、升序）；解析不出返回空数组
 */
export function parseMaterialRefs(text) {
  const s = String(text || '')
  if (!s.trim()) return []
  const nums = new Set()

  // 「给定资料2、3」「资料4、5、6」：逗号/顿号/和/及/与 分隔的并列
  const listRe = /(?:给定)?(?:资料|材料)\s*([0-9一二三四五六七八九十]+)(?:\s*[、,，和与及]\s*([0-9一二三四五六七八九十]+))+/g
  for (const m of s.matchAll(listRe)) {
    for (const g of m.slice(1)) {
      const n = toNum(g)
      if (n) nums.add(n)
    }
  }
  // 「资料4—5」「资料1-3」区间（只在没被上一条吃掉时补）
  const rangeRe = /(?:给定)?(?:资料|材料)\s*([0-9一二三四五六七八九十]+)\s*[—–\-~～至]\s*([0-9一二三四五六七八九十]+)/g
  for (const m of s.matchAll(rangeRe)) {
    const a = toNum(m[1])
    const b = toNum(m[2])
    if (a && b && b >= a && b - a <= 8) for (let i = a; i <= b; i++) nums.add(i)
  }
  // 单个引用（最常见）
  const oneRe = /(?:给定)?(?:资料|材料)\s*([0-9一二三四五六七八九十]+)/g
  for (const m of s.matchAll(oneRe)) {
    const n = toNum(m[1])
    if (n) nums.add(n)
  }
  return [...nums].sort((a, b) => a - b)
}

/** 这道题是不是"要通读全卷"的大作文 */
export function isFullPaperQuestion(text) {
  const s = String(text || '')
  return FULL_PAPER_HINTS.some((h) => s.includes(h))
}

/**
 * 裁剪材料（**默认不启用**，见文件头）。
 *
 * @param {string} material 整卷材料
 * @param {string} stem 题干 + 作答要求（用来解析引用）
 * @returns {{
 *   text: string, trimmed: boolean, reason: string,
 *   used: number[], dropped: number,
 *   before: number, after: number, savedPct: number
 * }}
 */
export function trimMaterial(material, stem) {
  const src = String(material || '')
  const before = src.length
  const base = { before, after: before, savedPct: 0, used: [], dropped: 0 }

  if (!src.trim()) return { ...base, text: src, trimmed: false, reason: '没有材料' }

  // 规矩②：大作文不裁
  if (isFullPaperQuestion(stem)) {
    return { ...base, text: src, trimmed: false, reason: '大作文需通读全卷' }
  }

  const refs = parseMaterialRefs(stem)
  // 规矩①：解析不出来 → 整卷提交
  if (!refs.length) {
    return { ...base, text: src, trimmed: false, reason: '题干未指明具体资料' }
  }

  const blocks = splitMaterialBlocks(src)
  // 材料没有「材料N」分则结构（比如自编题一整段），裁不动也不该裁
  if (blocks.length <= 1) {
    return { ...base, text: src, trimmed: false, reason: '材料没有分则结构' }
  }

  const keep = blocks.filter((b) => b.no !== null && refs.includes(b.no))
  // 一则都没对上（题号超出实际则数）→ 整卷提交，别赌
  if (!keep.length) {
    return { ...base, text: src, trimmed: false, reason: '引用的资料号在材料里找不到' }
  }

  const text = keep.map((b) => (b.label ? `材料${b.no}\n` : '') + b.body).join('\n\n')
  const after = text.length
  return {
    text,
    trimmed: true,
    reason: `只保留引用的第 ${refs.join('、')} 则`,
    used: refs,
    dropped: blocks.length - keep.length,
    before,
    after,
    savedPct: before ? Math.round((1 - after / before) * 100) : 0,
  }
}
