// ──────────────────────────────────────────────────────────────
// M9 导出文档护栏（2026-10-08）
//
//   node .tools/test-export-doc.mjs
//
// 验「导出的 Word 里真的有该有的东西」：解包 docx（zip）看 word/document.xml，
// 断言用户可感知的结果——题头文字、批注内联小字、荧光底色、老师主题色都在。
// 不测 docx 库本身，只测我们的拼装逻辑与定位/配色规则。
import { registerViteAlias } from './vite-alias.mjs'
registerViteAlias()

import { createRequire } from 'node:module'

// ESM 里 NODE_PATH 无效，docx/fflate 都从 frontend/node_modules 走 createRequire
const req = createRequire(new URL('../frontend/package.json', import.meta.url))
const { Packer } = req('docx')
const { unzipSync, strFromU8 } = req('fflate')

const { buildReviewDocument, buildLexiconDocument, buildReviewModel, buildLexiconModel, renderPdfBlob, locateQuote, tint, MARK_FILL } = await import(
  '../frontend/src/utils/exportDoc.js'
)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`)
  }
}

async function docXml(doc) {
  const buf = await Packer.toBuffer(doc)
  const files = unzipSync(new Uint8Array(buf))
  return strFromU8(files['word/document.xml'])
}

// ─────────────── locateQuote ───────────────
{
  const A = '第一句在这里。必须命中的原句是这句，后面还有内容。'
  check('定位：精确匹配', locateQuote(A, '必须命中的原句是这句')?.start === 7)
  check('定位：去首尾标点退让', locateQuote(A, '「必须命中的原句是这句，」')?.start === 7)
  check('定位：前12字头退让', locateQuote(A, '第一句在这里。必须命中的原句是这句后面还多了很多字')?.start === 0)
  check('定位：完全找不到返回 null', locateQuote(A, '压根不存在的句子内容') === null)
  check('定位：空入参返回 null', locateQuote(A, '') === null && locateQuote('', 'x') === null)
}

// ─────────────── tint ───────────────
{
  const t = tint('#3d5a7a')
  check('tint：输出 6 位大写 hex', /^[0-9A-F]{6}$/.test(t), t)
  check('tint：比原色浅', parseInt(t.slice(0, 2), 16) > 0x3d && parseInt(t.slice(2, 4), 16) > 0x5a, t)
  check('tint：t=1 全白', tint('#123456', 1) === 'FFFFFF')
}

// ─────────────── 复盘文档 ───────────────
{
  const data = {
    title: '2008年河北卷·第1题',
    createdAt: new Date('2026-10-08T10:00:00').getTime(),
    mode: 'real',
    finalScore: 14,
    maxScore: 20,
    level: '中等',
    questionType: '分析',
    requirement: '观点明确，条理清楚，400字左右。',
    material: '材料1\n这里有用户划中的要点句，以及别的内容。\n\n材料2\n第二则材料的内容。',
    marks: {
      material: [{ text: '用户划中的要点句', color: 'yellow', nth: 0 }],
      answer: [],
    },
    answer: '我认为关键在于必须命中的原句是这句这个道理。',
    results: [
      {
        teacherId: 'yuandong',
        score: 14,
        maxScore: 20,
        advice: '建议先找全要点再动笔。',
        annotations: [
          { quote: '必须命中的原句是这句', type: '问题', comment: '批注内容甲', fix: '改成更规范的说法' },
          { quote: '这句在作答里根本不存在啊', type: '问题', comment: '未定位批注乙' },
        ],
      },
    ],
    suggestions: ['建议一：多划材料', '建议二：控制字数'],
    summary: '总体尚可，找点能力待加强。',
  }
  const xml = await docXml(await buildReviewDocument(data))

  check('复盘：题头在文档里', xml.includes('复盘 · 2008年河北卷·第1题'))
  check('复盘：得分行在文档里', xml.includes('14 / 20'))
  check('复盘：题目要求在文档里', xml.includes('观点明确，条理清楚'))
  check('复盘：材料分则标题在文档里', xml.includes('材料1') && xml.includes('材料2'))
  // 批注与正文分离（2026-10-08）：正文句尾只有序号，批注集中在「四、老师批注」清单
  check('复盘：批注清单在文档里', xml.includes('〔袁东·问题〕') && xml.includes('批注内容甲'), '批注清单文本未找到')
  check('复盘：正文不再内联批注全文', !/〔袁东·问题〕批注内容甲/.test(xml.replace(/<\/w:t>/g, '')) || xml.split('〔袁东·问题〕').length === 2, '批注全文仍内联在正文')
  check('复盘：作答句尾有批注序号（①）', xml.includes('①'), '序号未找到')
  check('复盘：优化版参考答案节在文档里', xml.includes('五、参考答案'), '优化答案节未找到')
  check('复盘：改法在文档里', xml.includes('改：改成更规范的说法'))
  check('复盘：老师意见段在文档里', xml.includes('建议先找全要点再动笔'))
  check('复盘：改进清单在文档里', xml.includes('建议一：多划材料'))
  check('复盘：未定位批注单独列出', xml.includes('未定位批注乙'))
  // 黑白打印模式（2026-10-08）：彩色全压灰阶、底色换下划线 —— 断言"黑白"而非"彩色"
  check('复盘：荧光标记转为下划线（w:u）', xml.includes('<w:u '), '下划线未找到')
  check('复盘：无彩色残留（老师色 3D5A7A 不出现）', !xml.includes('3D5A7A') && !xml.includes('FDE68A'), '仍有彩色/底色')
  check('复盘：批注文字为灰阶（2B2B2B）', xml.includes('w:color w:val="2B2B2B"'))
}

// ─────────────── 词库文档 ───────────────
{
  const themes = [
    { key: 't1', name: '民生保障', items: [{ formal: '兜牢民生底线', plain: '老百姓的基本生活要保住' }] },
    { key: 't2', name: '科技创新', items: [{ formal: '攻关关键核心技术', plain: '把最难的技术搞出来' }] },
  ]
  const xmlAll = await docXml(await buildLexiconDocument(themes))
  check('词库：题头在文档里', xmlAll.includes('蓝笔申论 · 规范词库'))
  check('词库：主题分节在文档里', xmlAll.includes('民生保障（1 条）'))
  check('词库：规范表述加粗正文在文档里', xmlAll.includes('兜牢民生底线'))
  check('词库：大白话对照在文档里', xmlAll.includes('老百姓的基本生活要保住'))

  const xmlEmpty = await docXml(await buildLexiconDocument(themes, { favOnly: true, favSet: new Set() }))
  check('词库：空收藏如实提示不空白', xmlEmpty.includes('收藏夹是空的'))
}

// ─────────────── PDF 通道（2026-10-08）───────────────
// 同一份内容模型的第二个渲染器。断言用户可感知的结果：
// PDF 头合法、思源宋体两个字重都嵌入、页数合理、内容流解压后含作答文字。
{
  const zlib = await import('node:zlib')

  async function pdfText(pdfOrBuf) {
    const buf = pdfOrBuf instanceof Buffer ? pdfOrBuf : Buffer.from(await pdfOrBuf.arrayBuffer())
    const latin = buf.toString('latin1')
    let all = ''
    const re = /stream\r?\n/g
    let m
    while ((m = re.exec(latin))) {
      const start = m.index + m[0].length
      const end = latin.indexOf('endstream', start)
      if (end < 0) break
      try { all += zlib.inflateSync(buf.subarray(start, end)).toString('latin1') } catch { /* 非内容流跳过 */ }
    }
    return { buf, latin, all }
  }

  const reviewData = {
    title: 'PDF护栏题', createdAt: Date.now(), mode: 'practice', finalScore: 12, maxScore: 20,
    requirement: '观点明确，条理清楚。',
    material: '给定资料一：基层治理需要坚持问题导向。',
    answer: '基层治理要坚持问题导向。\n同时压实各级责任。',
    results: [{ teacherId: 'yuandong', score: 12, maxScore: 20, summary: '尚可',
      annotations: [{ quote: '坚持问题导向', type: '亮点', comment: '表述规范', fix: '补一句对策' }] }],
    marks: { material: [], answer: [] },
  }

  // PDF 里的中文是 CID/十六进制，拿不到明文 —— 模型层断言内容一致（这才是"内容不漂移"的真源）
  const model = buildReviewModel(reviewData)
  const modelText = model.map((n) => n.runs.map((r) => r.text).join('')).join('\n')
  check('PDF：内容模型含作答原文', modelText.includes('基层治理要坚持问题导向'))
  check('PDF：内容模型含批注内联小字', modelText.includes('〔袁东·亮点〕表述规范'))
  check('PDF：内容模型含改法', modelText.includes('改：补一句对策'))

  const { buf, latin, all } = await pdfText(await renderPdfBlob(model, '复盘 · PDF护栏题'))
  check('PDF：文件头合法（%PDF-）', latin.startsWith('%PDF-'))
  check('PDF：思源宋体 Regular 已嵌入', latin.includes('SourceHanSerifCN-Regular'))
  check('PDF：思源宋体 Bold 已嵌入', latin.includes('SourceHanSerifCN-Bold'))
  check('PDF：字体文件已内嵌（FontFile）', latin.includes('/FontFile'))
  check('PDF：页数 ≥ 1', (latin.match(/\/Type \/Page[^s]/g) || []).length >= 1)
  // 作答行本身是 ASCII 无，但「wang」图例/分数是 latin 可见的；内容流解压后非空即可
  check('PDF：内容流解压后非空', all.length > 200, `len=${all.length}`)

  const lexNodes = buildLexiconModel([
    { key: 't1', name: '民生保障', items: [{ formal: '兜牢民生底线', plain: '基本生活要保住' }] },
  ])
  const lex = await pdfText(await renderPdfBlob(lexNodes, '规范词库'))
  check('PDF：词库文档也走同一渲染器', lex.latin.startsWith('%PDF-') && lex.buf.length > 20000)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
