// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 「再练一题」推荐的测试。
//
// 这套逻辑唯一值得测的东西是**它什么时候该闭嘴**：
//   推荐本身不难（挑一道题谁都会），难的是"没有依据时不硬推"——
//   数据只有一份记录、或者旧记录压根没存题型时，必须如实说攒不出来，
//   而不是随便挑一道让用户以为有依据。
//
// 所以下面每条用例都成对出现：给足数据时要说对话，数据不够时必须不给推荐。
//
// 用法：node .tools/test-next-question.mjs

import {
  analyzeByQuestionType,
  recommendNextQuestion,
} from '../frontend/src/utils/grading/nextQuestion.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

const ann = (type, quote) => ({ quote: quote || '考生原文片段', type, comment: '说明', fix: '改法' })
const ded = (point, score) => ({ point, score, reason: '为什么扣', fix: '怎么改' })

/** 造一份记录：一个老师，指定题型 + 若干类问题 */
function rec(id, questionType, issues) {
  return {
    id,
    questionType,
    results: [
      {
        teacherId: 'a',
        annotations: issues.map((it) => ann(it, `第${id}处`)),
        deductions: issues.map((it) => ded(it, 1)),
      },
    ],
  }
}

/** 造一批候选题：五种题型各若干 */
function pool(spec) {
  const out = []
  for (const [type, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) out.push({ id: `${type}-${i}`, type, title: `${type}第 ${i} 题` })
  }
  return out
}

const POOL = pool({ 归纳概括: 3, 综合分析: 3, 提出对策: 3, 贯彻执行: 3, 大作文: 3 })

// ── 一、按题型聚合 ────────────────────────────────────────
{
  const s = analyzeByQuestionType([
    rec('r1', '归纳概括', ['要点遗漏', '结构不清']),
    rec('r2', '归纳概括', ['漏点']),
    rec('r3', '大作文', ['整句照抄']),
  ])
  check('只统计带题型的记录', s.typed === 3 && s.total === 3)
  check('题型聚合出了两个题型', s.types.length === 2, s.types.map((t) => `${t.type}×${t.recordCount}`).join(' '))
  const t = s.types.find((x) => x.type === '归纳概括')
  check('归纳概括：recordCount=2，最高频问题是「要点遗漏」',
    t.recordCount === 2 && t.topIssueLabel === '要点遗漏',
    `recordCount=${t.recordCount} top=${t.topIssueLabel}`)
}

// ── 二、老记录（没存题型）必须被排除，且不能拿标题猜 ──────
{
  const old = { id: 'old1', title: '请概括 Y 省的做法', results: [{ teacherId: 'a', annotations: [ann('要点遗漏')], deductions: [] }] }
  const s = analyzeByQuestionType([old, rec('r1', '归纳概括', ['要点遗漏']), rec('r2', '归纳概括', ['漏点'])])
  check('没有 questionType 的老记录不进统计（哪怕标题里有「概括」）',
    s.typed === 2 && s.types.length === 1,
    `typed=${s.typed}`)
}

// ── 三、定向推荐：某类问题集中在某个题型上 ────────────────
{
  // 归纳概括栽了两次「要点遗漏」，其它题型没这个毛病 → 该推同题型
  const recs = [
    rec('r1', '归纳概括', ['要点遗漏']),
    rec('r2', '归纳概括', ['漏点']),
    rec('r3', '大作文', ['整句照抄']),
  ]
  const r = recommendNextQuestion(recs, POOL)
  check('定向：推同题型', r.ok && r.basis === 'typed' && r.question.type === '归纳概括',
    `basis=${r.basis} type=${r.question?.type}`)
  check('定向：话术里点名了问题和题型',
    r.reason.includes('要点遗漏') && r.reason.includes('归纳概括'), r.reason)
  check('定向：候选数是该题型的全部（3 道）', r.candidates === 3, `candidates=${r.candidates}`)
}

// ── 四、泛化推荐：同一问题跨题型出现 ──────────────────────
{
  // 「整句照抄」在三个题型上都栽 → 换题型也一样，不该推同题型
  const recs = [
    rec('r1', '归纳概括', ['整句照抄']),
    rec('r2', '提出对策', ['整句照抄']),
    rec('r3', '大作文', ['整句照抄']),
  ]
  const r = recommendNextQuestion(recs, POOL)
  check('泛化：识别为跨题型的通病', r.ok && r.basis === 'spread', `basis=${r.basis}`)
  check('泛化：话术里说明它不是某个题型的问题',
    r.reason.includes('不是某个题型的问题'), r.reason)
  check('泛化：候选是全部题（换题型也练）', r.candidates === POOL.length, `candidates=${r.candidates}`)
}

// ── 五、数据不够时必须闭嘴 ────────────────────────────────
{
  const one = recommendNextQuestion([rec('r1', '归纳概括', ['要点遗漏'])], POOL)
  check('只有 1 份记录：不给推荐', one.ok === false, one.reason)
  check('只有 1 份记录：说明了原因而不是空字符串',
    one.reason.length > 10 && one.reason.includes('1 份'), one.reason)

  const none = recommendNextQuestion([], POOL)
  check('零记录：不给推荐并提示先做一道', none.ok === false && none.reason.includes('还没有'), none.reason)

  const onlyOld = recommendNextQuestion(
    [{ id: 'o1', title: 'x', results: [{ teacherId: 'a', annotations: [ann('要点遗漏')], deductions: [] }] }],
    POOL,
  )
  check('只有旧记录：说明是缺题型字段，而不是"没练过"',
    onlyOld.ok === false && onlyOld.reason.includes('旧版'), onlyOld.reason)
}

// ── 六、excludeId：刚做过的题不再推 ──────────────────────
{
  const recs = [
    rec('r1', '归纳概括', ['要点遗漏']),
    rec('r2', '归纳概括', ['漏点']),
  ]
  const first = recommendNextQuestion(recs, POOL)
  const second = recommendNextQuestion(recs, POOL, { excludeId: first.question.id })
  check('excludeId 生效：第二次推的不是同一道',
    second.ok && second.question.id !== first.question.id,
    `${first.question.id} → ${second.question.id}`)
}

// ── 七、池子里没有同题型的题 → 降级到泛化档，而不是推错题型的题 ──
{
  // 「要点遗漏」跨了归纳概括 + 提出对策两个题型（都栽过两次）
  // → 够得上泛化档（≥2 个题型）；此时池子里没有归纳概括题，应退到泛化档
  const recs = [
    rec('r1', '归纳概括', ['要点遗漏']),
    rec('r2', '归纳概括', ['漏点']),
    rec('r3', '提出对策', ['要点遗漏']),
    rec('r4', '提出对策', ['漏点']),
  ]
  const noMatch = recommendNextQuestion(recs, pool({ 大作文: 2 }))
  check('池子里没有同题型的题：退回泛化档而不是推错题型的题',
    noMatch.ok && noMatch.basis === 'spread', `basis=${noMatch.basis} type=${noMatch.question?.type}`)

  // 反面：问题只跨一个题型、池子里又没有该题型 → 不能拿别的题型凑数
  const narrow = recommendNextQuestion([rec('r1', '归纳概括', ['要点遗漏']), rec('r2', '归纳概括', ['漏点'])], pool({ 大作文: 2 }))
  check('问题只跨一个题型且池里没该题型：不给推荐（不拿别的题型凑数）',
    narrow.ok === false, narrow.reason)
}

// ── 八、该题型被排除光了时不能返回空题 ────────────────────
{
  const recs = [
    rec('r1', '归纳概括', ['要点遗漏']),
    rec('r2', '归纳概括', ['漏点']),
  ]
  const onlyOne = pool({ 归纳概括: 1 })
  const r = recommendNextQuestion(recs, onlyOne, { excludeId: '归纳概括-0' })
  check('唯一同题型题被排除后：不返回 null 装作成功', r.ok === false, r.reason)
}

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length} / ${results.length} 通过`)
if (failed.length) {
  console.log('\n未通过：')
  for (const f of failed) console.log(`  ✗ ${f.name}`)
  process.exit(1)
}
