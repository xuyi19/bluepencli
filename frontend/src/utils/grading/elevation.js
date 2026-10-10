// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 升格引擎 · 纯核心（提示词组装 + 输出校验，零副作用，Node 可直测）
//
// 批改回答「这份答案几分、哪里差」；升格回答「从这份答案到高分答案，
// 每一句怎么变」。一次调用产出三样东西：
//   ① diagnosis  本质差距诊断（一段话）
//   ② rows       逐句升格桥：考生原句 → 问题定性（12 类口径）→ 升格句 → 理由
//   ③ upgraded   升格后全文（融合全部升格句并补漏，可整体对照背诵）
//   ④ strategy   升格要点（3 条左右，按优先级）
//
// 与批改链路的关系：批改的 rewrites 是各老师在自己输出里零散给的单句改写；
// 升格引擎在终分定了之后做**整题结构化升格**，quote 定位规则与批注契约同款
// （前端靠字符串精确匹配定位，改写过的片段定位不到）。
// ⚠️ 本文件要保持能被 Node 直接 import：相对引用必须带 .js 后缀（同 profile.js 约定）。

// 升格提示词版本：改本文件的提示词就往上加一位（同 PROMPT_VERSION 道理，
// 存档时冻结进记录，半年后能回答「当时为什么给出这个升格句」）。
export const ELEVATE_VERSION = 'elevate-v1'

// 逐句桥上限：条数太多会稀释重点，也撑大输出 token。
export const ELEVATE_MAX_ROWS = 6
export const ELEVATE_MAX_STRATEGY = 5

import { errorTypePromptList } from '../../data/error-taxonomy.js'

const ELEVATE_RULES = `
【通用铁律】
1. 禁止空话。「表述不够准确」「逻辑不够清晰」一律不许出现：
   每一条都必须落到考生的一句原话上，说清为什么不行、改成什么、改完好在哪。
2. quote 必须**原样复制**考生作答里的一段连续文字（10~40 字），
   标点、空格、引号一模一样，不要省略号、不要改字、不要跨段拼接。
   前端靠字符串精确匹配定位；改写过的片段会定位失败。
3. type 必须从下面这张表里挑一个 id（不自造词、不用近义词）：
   ${errorTypePromptList()}
   表里实在没有合适的才用 other，并在 problem 里说清。
4. rewrite 必须是**可直接替换原句的成句**，不能只给方向（如「应更具体」）。
   升格句要贴着材料写，不得编造材料里没有的事实、数字、政策名词。
5. upgraded 是把所有 rewrite 融进去、并补齐漏掉要点之后的**完整答案**，
   与 rows 必须自洽：不能 rows 里改了开头，upgraded 里还是老开头。
6. rows 挑最要命的 3~6 条，按对得分的影响从大到小排；宁缺毋滥。
7. 严格输出 JSON，不要 markdown 代码块标记，不要任何解释性前后缀。`

const ELEVATE_SCHEMA = `
JSON 结构：
{
  "diagnosis": "本质差距诊断：这份答案和一类文之间差在哪，2~3 句，直接说",
  "rows": [
    { "quote": "考生原句（原样复制）", "type": "问题类型 id", "problem": "一句话定性这句的问题",
      "rewrite": "升格句（可直接替换）", "why": "为什么这样改（一句话，可引用材料依据）" }
  ],
  "strategy": ["如果只做三件事：按优先级排列的升格要点", "…"],
  "upgraded": "升格后的完整答案"
}`

/**
 * 组装升格调用的 messages。
 * @param {object} p
 * @param {string} p.title        题目标题
 * @param {string} p.requirement  作答要求
 * @param {string} p.answer       考生作答（必填，quote 定位的基准）
 * @param {string} p.material     材料（调用方已裁剪）
 * @param {number|null} p.wordLimit
 * @param {number} p.maxScore
 * @param {string} p.gradingDigest 批改摘要（buildGradingDigest 产出）
 * @param {string} p.standardPrompt 采分点标准注入串（无标准传空串）
 * @returns {{ system: string, user: string }}
 */
export function buildElevateMessages({
  title = '',
  requirement = '',
  answer = '',
  material = '',
  wordLimit = null,
  maxScore = 0,
  gradingDigest = '',
  standardPrompt = '',
}) {
  const system = `你是一位申论升格教练。你面前有一份已经批改过的考生答案（分数与问题见下），
你的任务不是再评一遍分，而是搭一座桥：**逐句展示这份答案怎么变成高分答案**。
你给的不是范文赏析，而是「同一个人的下一版」——保留考生写得对的部分，
只动该动的地方，让考生看得到自己每一步能怎么改。

${ELEVATE_RULES}

${ELEVATE_SCHEMA}`

  const parts = [
    `【题目】${title || '（未填写题目）'}`,
    `【作答要求】${requirement || '（未填写）'}`,
    `【字数要求】${wordLimit ? wordLimit + ' 字' : '按题目要求'}`,
    `【该题满分】${maxScore} 分`,
    '',
    '【给定资料】',
    material || '（未提供资料）',
    '',
    '【考生作答】',
    answer || '（未提供作答）',
  ]
  if (standardPrompt) parts.push('', standardPrompt)
  if (gradingDigest) parts.push('', `【本次批改结论（升格必须与它一致，不得推翻采分点判断）】\n${gradingDigest}`)

  return { system, user: parts.join('\n') }
}

/**
 * 把一次批改的结果压缩成给升格调用的摘要。
 * 只带「升格需要知道的事」：档位与分数、漏掉的要点、最要命的批判。
 * keyPoints 用批改的归并结果（utils/grading/keyPoints.js），status 为 miss 的带上。
 */
export function buildGradingDigest(final, keyPoints = [], criticalIssues = []) {
  const bits = []
  if (final) {
    const score = final.finalScore ?? final.score
    if (score != null && final.maxScore) bits.push(`终分 ${score}/${final.maxScore}${final.level ? `（${final.level}）` : ''}`)
  }
  const misses = (keyPoints || []).filter((k) => k.status === 'miss').map((k) => k.point)
  if (misses.length) bits.push(`批改认定漏掉的要点：${misses.join('；')}`)
  const issues = (criticalIssues || []).slice(0, 2).map((d) => d.issue).filter(Boolean)
  if (issues.length) bits.push(`批改点名的主要问题：${issues.join('；')}`)
  return bits.join('\n')
}

/**
 * 校验升格输出。原则与批注同款：**可定位的才信，定位不到的不静默丢**。
 * @param {object|null} parsed   LLM 输出（parseJson 之后）
 * @param {string} answer        考生作答原文（quote 定位基准）
 * @returns {{ elevation: object|null, problems: string[] }}
 *   elevation 即便有问题也尽量返回（带 located 标记），problems 记录所有修正——大声报错，不假装。
 */
export function validateElevation(parsed, answer) {
  const problems = []
  if (!parsed || typeof parsed !== 'object') {
    return { elevation: null, problems: ['升格输出解析失败'] }
  }

  const diagnosis = typeof parsed.diagnosis === 'string' ? parsed.diagnosis.trim() : ''
  if (!diagnosis) problems.push('diagnosis 缺失或为空')

  // rows：缺 quote 或 rewrite 的整行丢弃（升格桥没有这两样就没有意义），
  // 其余保留并打 located 标记；超出上限截断（保前 N 条，模型已按影响排序）。
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows : []
  if (!rawRows.length) problems.push('rows 为空')
  const rows = []
  rawRows.forEach((r, i) => {
    const quote = typeof r?.quote === 'string' ? r.quote.trim() : ''
    const rewrite = typeof r?.rewrite === 'string' ? r.rewrite.trim() : ''
    if (!quote || !rewrite) {
      problems.push(`第 ${i + 1} 条缺 quote 或 rewrite，已丢弃`)
      return
    }
    rows.push({
      quote,
      type: typeof r?.type === 'string' ? r.type.trim() : '',
      problem: typeof r?.problem === 'string' ? r.problem.trim() : '',
      rewrite,
      why: typeof r?.why === 'string' ? r.why.trim() : '',
      located: answer.includes(quote),
    })
    if (!rows[rows.length - 1].located) problems.push(`第 ${i + 1} 条 quote 在作答原文中定位不到，已标记（未丢弃）`)
  })
  let clamped = rows
  if (rows.length > ELEVATE_MAX_ROWS) {
    clamped = rows.slice(0, ELEVATE_MAX_ROWS)
    problems.push(`rows 超上限，保留前 ${ELEVATE_MAX_ROWS} 条（共 ${rows.length} 条）`)
  }

  const strategy = (Array.isArray(parsed.strategy) ? parsed.strategy : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim())
    .slice(0, ELEVATE_MAX_STRATEGY)

  const upgraded = typeof parsed.upgraded === 'string' ? parsed.upgraded.trim() : ''
  if (!upgraded) problems.push('upgraded（升格全文）缺失')

  const elevation = { diagnosis, rows: clamped, strategy, upgraded }
  return { elevation, problems }
}
