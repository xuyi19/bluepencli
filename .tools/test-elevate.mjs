// ──────────────────────────────────────────────────────────────
// 蓝笔申论 · 升格引擎护栏（纯函数，Node 直跑）
//   node .tools/test-elevate.mjs
// 覆盖：提示词契约（quote 原样复制 / 12 类口径 / upgraded 融合要求）、
//        buildGradingDigest 摘要、validateElevation 的定位/丢弃/钳制行为。
// 纪律：断言「用户看得见的结果」（产出对象与问题清单），不断言内部写法。
// ⚠️ 本文件被 test-all.mjs 自动收集，exit 0 才算绿。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const { buildElevateMessages, buildGradingDigest, validateElevation, ELEVATE_VERSION, ELEVATE_MAX_ROWS, ELEVATE_MAX_STRATEGY } = await import(
  'file:///' + here.replace(/\\/g, '/') + '../frontend/src/utils/grading/elevation.js'
)

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`✅ ${name}`)
  } else {
    fail++
    console.log(`❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

// ---------- 源码级：提示词契约的关键句子必须真的在文件里 ----------
const src = readFileSync(here + '../frontend/src/utils/grading/elevation.js', 'utf8')
check('ELEVATE_VERSION 是 elevate-vN 形态', /^elevate-v\d+$/.test(ELEVATE_VERSION), ELEVATE_VERSION)
check('上限常量：rows=6 / strategy=5', ELEVATE_MAX_ROWS === 6 && ELEVATE_MAX_STRATEGY === 5)

// ---------- buildElevateMessages ----------
const { system, user } = buildElevateMessages({
  title: '概括题',
  requirement: '根据资料2，概括做法。字数300字。',
  answer: '县委成立领导小组，压实各方责任。',
  material: '给定资料2：……成立领导小组……',
  wordLimit: 300,
  maxScore: 40,
  gradingDigest: '终分 20/40（二类下）',
  standardPrompt: '【本题采分点标准】p1 …',
})
check('system 含 quote 原样复制铁律', system.includes('原样复制'))
check('system 含 12 类口径表（copy-raw 可见）', system.includes('copy-raw'))
check('system 含 upgraded 融合自洽要求', system.includes('自洽'))
check('system 含「可直接替换的成句」要求', system.includes('可直接替换'))
check('system 含严格 JSON 输出要求', system.includes('严格输出 JSON'))
check('system 含禁空话铁律', system.includes('禁止空话'))
check('user 含题目', user.includes('概括题'))
check('user 含作答', user.includes('县委成立领导小组'))
check('user 含材料', user.includes('给定资料2'))
check('user 含批改摘要（升格不得推翻采分点判断）', user.includes('终分 20/40'))
check('user 含采分点标准注入', user.includes('本题采分点标准'))
check('user 含字数要求（300 字）', user.includes('300 字'))

const { user: u2 } = buildElevateMessages({ answer: '答', wordLimit: null })
check('wordLimit 为空 → 按题目要求', u2.includes('按题目要求'))

// ---------- buildGradingDigest ----------
check('digest 带终分与档位', buildGradingDigest({ finalScore: 20, maxScore: 40, level: '二类' }).includes('20/40'))
check('digest 带漏掉的要点', buildGradingDigest(null, [{ status: 'miss', point: '资金保障' }]).includes('资金保障'))
check('digest 不带命中要点（只带 miss）', !buildGradingDigest(null, [{ status: 'hit', point: '领导小组' }]).includes('领导小组'))
check('digest 带主要问题', buildGradingDigest(null, [], [{ issue: '整段照抄材料' }]).includes('整段照抄材料'))
check('digest 全空 → 空串', buildGradingDigest(null, [], []) === '')

// ---------- validateElevation ----------
const ANSWER = '县委成立领导小组，压实各方责任。同时安排专项资金。'

const bad = validateElevation(null, ANSWER)
check('解析失败 → elevation null', bad.elevation === null && bad.problems.length > 0)

const good = validateElevation(
  {
    diagnosis: '差在要点不全',
    rows: [{ quote: '压实各方责任', type: 'copy-raw', problem: '抄材料', rewrite: '压实县级统筹责任', why: '去材料化' }],
    strategy: ['先补漏点'],
    upgraded: '县委成立领导小组，压实县级统筹责任。同时安排专项资金。',
  },
  ANSWER
)
check('合格输出 → problems 为空', good.problems.length === 0, JSON.stringify(good.problems))
check('quote 能定位 → located true', good.elevation.rows[0].located === true)
check('type 原样保留（交给 annotationTypeLabel 显示）', good.elevation.rows[0].type === 'copy-raw')

const notFound = validateElevation(
  { diagnosis: 'd', rows: [{ quote: '原文里没有这句话', type: 'over-generalize', problem: 'p', rewrite: 'r', why: 'w' }], strategy: [], upgraded: 'u' },
  ANSWER
)
check('quote 定位不到 → 保留但标记 located false（不静默丢）', notFound.elevation.rows.length === 1 && notFound.elevation.rows[0].located === false)
check('定位失败大声报问题', notFound.problems.some((p) => p.includes('定位不到')))

const dropped = validateElevation(
  {
    diagnosis: 'd',
    rows: [
      { quote: 'a', rewrite: '', why: '缺 rewrite' },
      { quote: '', rewrite: 'r', why: '缺 quote' },
      { quote: '压实各方责任', rewrite: 'r2', why: 'w' },
    ],
    strategy: [],
    upgraded: 'u',
  },
  ANSWER
)
check('缺 quote/rewrite 的行丢弃（保留合格的 1 条）', dropped.elevation.rows.length === 1)
check('丢弃行为大声报问题', dropped.problems.filter((p) => p.includes('丢弃')).length === 2)

const many = { diagnosis: 'd', strategy: [], upgraded: 'u', rows: [] }
for (let i = 0; i < 9; i++) many.rows.push({ quote: `第${i}句`, type: 'other', problem: 'p', rewrite: `改${i}`, why: 'w' })
const clamped = validateElevation(many, '第0句 第1句 第2句 第3句 第4句 第5句 第6句 第7句 第8句')
check(`rows 超上限钳到 ${ELEVATE_MAX_ROWS}`, clamped.elevation.rows.length === ELEVATE_MAX_ROWS)
check('钳制行为报问题', clamped.problems.some((p) => p.includes('超上限')))

const strat = validateElevation(
  { diagnosis: 'd', rows: [], strategy: ['一', '二', '三', '四', '五', '六', '七'], upgraded: 'u' },
  ANSWER
)
check('strategy 钳到上限 5', strat.elevation.strategy.length === ELEVATE_MAX_STRATEGY)

const missing = validateElevation({ rows: [], strategy: [] }, ANSWER)
check('diagnosis 缺失 → 空串 + 报问题', missing.elevation.diagnosis === '' && missing.problems.some((p) => p.includes('diagnosis')))
check('upgraded 缺失 → 空串 + 报问题', missing.elevation.upgraded === '' && missing.problems.some((p) => p.includes('upgraded')))
check('rows 为空 → 报问题', missing.problems.some((p) => p.includes('rows')))

// ---------- 汇总 ----------
console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail ? 1 : 0)
