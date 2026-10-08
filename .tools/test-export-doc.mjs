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

const { buildReviewDocument, buildLexiconDocument, locateQuote, tint, MARK_FILL } = await import(
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
  check('复盘：批注内联小字在文档里', xml.includes('〔袁东·问题〕批注内容甲'), '内联批注文本未找到')
  check('复盘：改法在文档里', xml.includes('改：改成更规范的说法'))
  check('复盘：老师意见段在文档里', xml.includes('建议先找全要点再动笔'))
  check('复盘：改进清单在文档里', xml.includes('建议一：多划材料'))
  check('复盘：未定位批注单独列出', xml.includes('未定位批注乙'))
  check('复盘：用户荧光底色（黄 FDE68A）', xml.includes('FDE68A'), '荧光 shading fill 未找到')
  check('复盘：老师主题色底（袁东 #3d5a7a 淡化）', xml.includes(tint('#3d5a7a')), '批注 shading fill 未找到')
  check('复盘：批注文字用老师主题色', xml.includes('w:color w:val="3D5A7A"'))
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

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
