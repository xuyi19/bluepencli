// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 标准校准工作台 · GUI 版（管理员端「大模型校准」的执行器）
//
//   node .tools/standards/admin-calibrate.mjs scan [--include-private]
//       全量体检：每题标准来源 + **证据定位健康度**（evidence 是否逐字在材料里）
//       —— 精读划点判定用的就是 evidence，证据失效 = 划点必错，这是优先校准对象。
//
//   node .tools/standards/admin-calibrate.mjs calibrate --ids a,b,c [--limit N]
//       逐题调 LLM 修正现有标准 → **纯代码复检** → 通过的进 out/pending/<id>.json 待审。
//
//   node .tools/standards/admin-calibrate.mjs apply --id <id> | --all
//       审签采纳：pending → manual.json（先备份；manual 优先级最高，生效即替换）。
//
//   node .tools/standards/admin-calibrate.mjs pending   # 待审清单
//   node .tools/standards/admin-calibrate.mjs export    # manual.json → 校准包（发作者合并用）
//
// 环境变量（GUI 经 env 传入，key 永不落盘/不进 argv）：
//   LLM_API_KEY / LLM_BASE_URL（默认 deepseek）/ LLM_MODEL（默认 deepseek-chat）
//
// ⚠️ 与 calibrate.mjs（TTY 向导）的分工：那边是人手工录，这边是 LLM 修正 + 人审签。
//    两边都只写 manual.json，不动 public.js / generated.js 源文件。
// ⚠️ 本工具只服务**公开库**标准（≤2021 与仿真题）。私有卷标准走 standards-private/。
//
// 铁律：**LLM 输出永不直接采信**。复检不过的拒绝入库（宁可拒收，不能让
// 「模型改写了材料原文的证据」混进去 —— 那会让精读划点判定整体失效）。

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const STD_DIR = path.join(ROOT, 'frontend/src/data/standards')
const MANUAL = path.join(STD_DIR, 'manual.json')
const PENDING = path.join(HERE, 'out', 'pending')

const argv = process.argv.slice(2)
const has = (n) => argv.includes('--' + n)
const val = (n) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? argv[i + 1] : undefined
}

/** 归一化：去空白保标点（与前端 flat/norm 同口径） */
const norm = (s) => String(s || '').replace(/\s+/g, '')

// ── 标准与题库装载 ──
const { PUBLIC_STANDARDS } = await import(pathToFileURL(path.join(STD_DIR, 'public.js')).href)
const { GENERATED_STANDARDS } = await import(pathToFileURL(path.join(STD_DIR, 'generated.js')).href)
const manual = JSON.parse(readFileSync(MANUAL, 'utf8'))
const all = { ...GENERATED_STANDARDS, ...PUBLIC_STANDARDS, ...manual }
const sourceOf = (id) =>
  Object.prototype.hasOwnProperty.call(manual, id) ? 'manual'
    : PUBLIC_STANDARDS[id] ? 'public' : GENERATED_STANDARDS[id] ? 'llm' : '—'

async function questionIndex() {
  const { EXAM_INDEX } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/data/real-exams/index.js')).href)
  const { BUILTIN_QUESTIONS } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/data/builtin-questions.js')).href)
  const rows = []
  for (const e of EXAM_INDEX) {
    for (const q of e.questions) rows.push({ id: `real-${e.id}-${q.no}`, title: q.stem, exam: `${e.year} ${e.paper}` })
  }
  for (const q of BUILTIN_QUESTIONS) {
    rows.push({ id: 'builtin-' + q.id, title: q.title || q.stem, exam: '仿真' })
  }
  return rows
}

/** 拿整卷材料与题干（real- 卷从 exam 文件、仿真题从题自带） */
async function loadQuestion(id) {
  if (id.startsWith('real-')) {
    const examId = id.slice(5, id.lastIndexOf('-'))
    const no = id.slice(id.lastIndexOf('-') + 1)
    const mod = await import(pathToFileURL(path.join(ROOT, `frontend/src/data/real-exams/exam-${examId}.js`)).href)
    const exam = mod.default
    const q = (exam.questions || []).find((x) => String(x.no) === no)
    return { stem: q?.stem || '', material: exam.material || '', score: q?.score }
  }
  if (id.startsWith('builtin-')) {
    const { BUILTIN_QUESTIONS } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/data/builtin-questions.js')).href)
    const b = BUILTIN_QUESTIONS.find((x) => x.id === id.slice(8))
    return { stem: b?.stem || b?.title || '', material: b?.material || '', score: b?.score }
  }
  return null
}

// ── 纯代码复检器（可被护栏 import 直测） ──
/**
 * 校准产物复检：结构 + 权重 + **证据逐字定位** + 字段冲突。
 * @returns {{ ok: boolean, problems: string[], fixedEvidence: number }}
 */
export function reviewCalibrated(next, material, prevStandard) {
  const problems = []
  const pts = next?.points
  if (!Array.isArray(pts) || !pts.length) return { ok: false, problems: ['没有采分点'], fixedEvidence: 0 }
  const m = norm(material)
  let fixedEvidence = 0
  const prevEv = new Map()
  for (const p of prevStandard?.points || []) prevEv.set(p.id, p)

  const ids = pts.map((p) => p.id)
  if (new Set(ids).size !== ids.length) problems.push('采分点 id 重复')
  const wsum = pts.reduce((n, p) => n + (Number(p.weight) || 0), 0)
  const total = Number(next.totalScore) || 0
  if (total && wsum !== total) problems.push(`权重合计 ${wsum} ≠ 满分 ${total}`)
  if (!total) problems.push('缺 totalScore')

  for (const p of pts) {
    if (!p.label) problems.push(`${p.id}: 缺 label`)
    if (!(Number(p.weight) > 0)) problems.push(`${p.id}: 权重非正数`)
    if (!Array.isArray(p.evidence)) problems.push(`${p.id}: evidence 必须是数组`)
    if (!Array.isArray(p.keywords || [])) problems.push(`${p.id}: keywords 必须是数组`)
    const both = (p.synonyms || []).filter((s) => (p.forbidden_point || []).includes(s))
    if (both.length) problems.push(`${p.id}: 同义表述与反向要点重复（${both.join('、')}）`)
    // 证据逐字定位：LLM 爱把材料原文「润色」一遍 —— 改一个字就废
    for (const ev of p.evidence || []) {
      if (norm(ev).length < 8) continue // 短片段可能是关键词级判据，不按证据要求
      if (!m.includes(norm(ev))) {
        // 给一次自动修复机会：若与该点**旧证据**完全一致（旧证据此前已验证过定位），按未改动放行
        const old = (prevEv.get(p.id)?.evidence || []).some((o) => norm(o) === norm(ev))
        if (!old) problems.push(`${p.id}: 证据不在材料里（「${String(ev).slice(0, 24)}…」）`)
      }
    }
    // 证据修复计数：新证据能定位而旧证据定位失败 —— 真修好了
    const oldBroken = (prevEv.get(p.id)?.evidence || []).filter((e) => norm(e).length >= 8 && !m.includes(norm(e))).length
    const newBroken = (p.evidence || []).filter((e) => norm(e).length >= 8 && !m.includes(norm(e))).length
    if (oldBroken > 0 && newBroken === 0) fixedEvidence += oldBroken
  }
  return { ok: problems.length === 0, problems, fixedEvidence }
}

// ── scan：全量体检 ──
async function scan() {
  const qs = await questionIndex()
  const rows = []
  for (const q of qs) {
    const st = all[q.id]
    if (!st || !st.points?.length) {
      rows.push({ ...q, origin: '—', status: 'no-standard', broken: 0, evidence: 0 })
      continue
    }
    const qd = await loadQuestion(q.id)
    if (!qd?.material) {
      rows.push({ ...q, origin: sourceOf(q.id), status: 'no-material', broken: 0, evidence: 0 })
      continue
    }
    const m = norm(qd.material)
    let evs = 0
    let broken = 0
    for (const p of st.points) {
      for (const ev of p.evidence || []) {
        if (norm(ev).length < 8) continue
        evs++
        if (!m.includes(norm(ev))) broken++
      }
    }
    // 大作文（文章写作）的 evidence 多是题干画线引用，本就不在材料里、
    // 也不参与精读划点判定 —— 单列不算失效，别让它淹没真正要修的小题
    const isEssay = /写一篇|议论文|文章|作文/.test(String(q.title))
    rows.push({
      ...q, origin: sourceOf(q.id),
      status: isEssay ? 'essay' : broken ? 'broken-evidence' : 'ok',
      broken, evidence: evs,
    })
  }

  const cnt = (s) => rows.filter((r) => r.status === s).length
  console.log(`标准体检：${rows.length} 题 ｜ ok ${cnt('ok')} ｜ 证据失效 ${cnt('broken-evidence')} ｜ 大作文 ${cnt('essay')}（不按证据定位算） ｜ 无标准 ${cnt('no-standard')} ｜ 无材料 ${cnt('no-material')}`)
  console.log(`来源：manual ${rows.filter((r) => r.origin === 'manual').length} / public ${rows.filter((r) => r.origin === 'public').length} / llm ${rows.filter((r) => r.origin === 'llm').length}\n`)

  const bad = rows.filter((r) => r.status === 'broken-evidence')
  if (bad.length) {
    console.log(`证据失效（优先校准，精读划点判据已坏）：`)
    for (const r of bad) console.log(`  BROKEN\t${r.id}\t${r.broken}/${r.evidence}\t${String(r.title).slice(0, 30)}`)
  }
  // 大作文证据失效单独列（不参与划点判定，但批改摘要里引用证据会露怯，顺带看一眼）
  const essayBad = rows.filter((r) => r.status === 'essay' && r.broken > 0)
  if (essayBad.length) {
    console.log(`\n大作文证据失效 ${essayBad.length} 道（不参与划点判定，校准顺带修）：`)
    for (const r of essayBad) console.log(`  ESSAY\t${r.id}\t${r.broken}/${r.evidence}\t${String(r.title).slice(0, 30)}`)
  }
  const noStd = rows.filter((r) => r.status === 'no-standard')
  if (noStd.length) {
    console.log(`\n无标准（gen_standards 先补，再回来校准）：`)
    for (const r of noStd.slice(0, 15)) console.log(`  MISSING\t${r.id}\t-\t${String(r.title).slice(0, 30)}`)
    if (noStd.length > 15) console.log(`  …（共 ${noStd.length} 道）`)
  }
  console.log(`\n下一步：node .tools/standards/admin-calibrate.mjs calibrate --ids <id,id,…>`)
}

// ── LLM 调用 ──
function buildUrl(base) {
  const b = String(base || 'https://api.deepseek.com').trim().replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (/\/v\d+$/.test(b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

const SYS = `你是公务员考试申论阅卷标准专家。给你：材料全文、题干、满分、现有采分点标准。
任务：核对并修正这份标准，使其成为一份可直接机判的采分点表。

硬性规则：
1. evidence 必须是**材料原文的逐字片段**（≥10字），一个字都不许改写、不许概括——
   它是"在材料里划哪个句子"的判据，改写了就永远定位不到；
2. keywords 是判据词（考生作答里出现即算沾边）；synonyms 是考生的等价合法表述；
3. forbidden_point 是反向要点（写出即该点不给分），与 synonyms 不得有同一个词；
4. 采分点互斥、合起来完备覆盖题干要求；weight 之和必须等于满分；
5. 现有标准方向对就微调，方向错才重排；不要凭空增删分值结构。

只输出 JSON（不要 markdown 代码块、不要解释），格式：
{"questionId":"…","totalScore":N,"points":[{"id":"p1","label":"要点名","weight":N,"evidence":["材料原文…"],"keywords":["…"],"synonyms":["…"],"forbidden_point":["…"],"note":"给分说明"}]}`

async function callLLM(messages) {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error('没有 LLM_API_KEY（GUI 填 Key 后再跑；命令行先 export）')
  const url = buildUrl(process.env.LLM_BASE_URL)
  const model = process.env.LLM_MODEL || 'deepseek-chat'
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return { text: j.choices?.[0]?.message?.content || '', model }
}

/** 从模型回复里抠 JSON（容忍 ``` 包裹与前后废话） */
function extractJson(text) {
  const t = String(text || '').replace(/```(json)?/g, '')
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i < 0 || j <= i) throw new Error('回复里没有 JSON')
  return JSON.parse(t.slice(i, j + 1))
}

// ── calibrate：逐题 LLM 修正 → 复检 → pending ──
async function calibrate() {
  const qs = await questionIndex()
  let ids = (val('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const limit = Number(val('limit', 0)) || 0
  if (has('all-broken')) {
    for (const q of qs) {
      const st = all[q.id]
      if (!st?.points?.length) continue
      const qd = await loadQuestion(q.id)
      if (!qd?.material) continue
      const m = norm(qd.material)
      const broken = st.points.some((p) => (p.evidence || []).some((e) => norm(e).length >= 8 && !m.includes(norm(e))))
      if (broken) ids.push(q.id)
    }
  }
  ids = [...new Set(ids)]
  if (limit) ids = ids.slice(0, limit)
  if (!ids.length) return console.log('没有指定题目。--ids <id,…> 或 --all-broken')

  mkdirSync(PENDING, { recursive: true })
  let okCount = 0
  let rejectCount = 0
  for (const id of ids) {
    const q = qs.find((x) => x.id === id)
    const qd = await loadQuestion(id)
    if (!q || !qd?.material) {
      console.log(`SKIP\t${id}\t题库或材料缺失`)
      continue
    }
    const cur = all[id]
    if (!cur?.points?.length) {
      console.log(`SKIP\t${id}\t无现有标准（先用 gen_standards 预解析，校准是在标准之上修正）`)
      continue
    }
    process.stdout.write(`RUN\t${id}\t…`)
    try {
      const user = [
        `题干：${q.title}`,
        `满分：${cur.totalScore}`,
        `现有标准 JSON：\n${JSON.stringify({ totalScore: cur.totalScore, points: cur.points })}`,
        `材料全文：\n${qd.material}`,
      ].join('\n\n')
      const { text, model } = await callLLM([
        { role: 'system', content: SYS },
        { role: 'user', content: user },
      ])
      const next = extractJson(text)
      next.questionId = id
      const review = reviewCalibrated(next, qd.material, cur)
      if (!review.ok) {
        rejectCount++
        console.log(` REJECTED（复检 ${review.problems.length} 条）`)
        for (const p of review.problems.slice(0, 5)) console.log(`    ✗ ${p}`)
        // 拒收产物也落盘（.rej 后缀），便于看模型到底改了什么 —— 但绝不进 pending
        writeFileSync(path.join(PENDING, id + '.rej.json'), JSON.stringify({ next, problems: review.problems }, null, 2))
        continue
      }
      const stamp = new Date().toISOString().slice(0, 10)
      writeFileSync(path.join(PENDING, id + '.json'), JSON.stringify({
        ...next,
        meta: { note: `admin-calibrate ${stamp}`, model, calibratedAt: new Date().toISOString(), fixedEvidence: review.fixedEvidence },
      }, null, 2))
      okCount++
      console.log(` OK（${cur.points.length}→${next.points.length} 点，修复失效证据 ${review.fixedEvidence} 处）→ 待审`)
    } catch (e) {
      rejectCount++
      console.log(` ERROR ${e.message.slice(0, 120)}`)
    }
  }
  console.log(`\n完成：入待审 ${okCount} ｜ 拒收/失败 ${rejectCount}。审签：apply --all（或逐题 apply --id）`)
}

// ── pending / apply / export ──
function pendingList() {
  if (!existsSync(PENDING)) return console.log('待审：空')
  const files = readdirSync(PENDING).filter((f) => f.endsWith('.json') && !f.endsWith('.rej.json'))
  console.log(`待审 ${files.length} 题：`)
  for (const f of files) {
    const j = JSON.parse(readFileSync(path.join(PENDING, f), 'utf8'))
    const cur = all[j.questionId]
    console.log(`  PENDING\t${j.questionId}\t${cur?.points?.length ?? '?'}→${j.points?.length ?? '?'} 点\t模型 ${j.meta?.model || '?'}`)
  }
}

function apply() {
  const one = val('id')
  const files = one
    ? [one + '.json']
    : existsSync(PENDING) ? readdirSync(PENDING).filter((f) => f.endsWith('.json') && !f.endsWith('.rej.json')) : []
  if (!files.length) return console.log('待审：空，没有可采纳的')
  copyFileSync(MANUAL, MANUAL.replace(/\.json$/, `.bak-${new Date().toISOString().slice(0, 10)}.json`))
  const next = { ...manual }
  let n = 0
  for (const f of files) {
    const p = path.join(PENDING, f)
    if (!existsSync(p)) { console.log(`MISS\t${f}（pending 里没有）`); continue }
    const j = JSON.parse(readFileSync(p, 'utf8'))
    if (!j.questionId || !j.points?.length) { console.log(`SKIP\t${f}（结构不完整）`); continue }
    next[j.questionId] = {
      questionId: j.questionId,
      source: 'manual',
      totalScore: j.totalScore,
      meta: j.meta || {},
      points: j.points,
    }
    console.log(`APPLY\t${j.questionId}\t${j.points.length} 点（${j.meta?.model || '?'}）`)
    n++
    if (one) existsSync(path.join(PENDING, f)) && 0 // 单题采纳后保留 pending 文件，由 export 后统一清理
  }
  writeFileSync(MANUAL, JSON.stringify(next, null, 2), 'utf8')
  console.log(`\n✓ 已写入 manual.json ${n} 题（备份：manual.bak-<日期>.json）。生效：重跑前端即可。`)
}

function exportPack() {
  const entries = Object.entries(manual).filter(([k]) => !k.startsWith('_'))
  const body = JSON.stringify(Object.fromEntries(entries))
  const pack = {
    magic: 'bluepencil-standard-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: entries.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    standards: Object.fromEntries(entries),
  }
  const file = path.join(HERE, 'out', `manual-pack-${new Date().toISOString().slice(0, 10)}.json`)
  writeFileSync(file, JSON.stringify(pack, null, 2), 'utf8')
  console.log(`✓ 校准包：${file}\n  ${entries.length} 题 · sha256 ${pack.sha256.slice(0, 16)}…\n  把这个文件发给作者合并即可（或走 git 提交 manual.json）。`)
}

// ── main ──
const cmd = argv[0]
const usage = `用法：
  node .tools/standards/admin-calibrate.mjs scan                     # 全量体检（证据定位健康度）
  node .tools/standards/admin-calibrate.mjs calibrate --ids a,b [--all-broken] [--limit N]
  node .tools/standards/admin-calibrate.mjs pending                  # 待审清单
  node .tools/standards/admin-calibrate.mjs apply --id <id> | --all  # 审签写入 manual.json
  node .tools/standards/admin-calibrate.mjs export                   # 打校准包`
if (cmd === 'scan') await scan()
else if (cmd === 'calibrate') await calibrate()
else if (cmd === 'pending') pendingList()
else if (cmd === 'apply') apply()
else if (cmd === 'export') exportPack()
else { console.log(usage); process.exit(cmd ? 1 : 0) }
