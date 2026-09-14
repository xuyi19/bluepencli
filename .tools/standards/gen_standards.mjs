// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 采分点预解析生成器
//
//   node .tools/standards/gen_standards.mjs --mock --limit 3        # 零 Key 跑通链路（只写中间产物）
//   node .tools/standards/gen_standards.mjs --limit 5 --write      # 用真 Key 试跑 5 道并落库
//   node .tools/standards/gen_standards.mjs --ids real-2010-dishi-1
//   node .tools/standards/gen_standards.mjs --include-private      # 连私有卷一起（本机才有）
//
// 为什么要做成工具而不是手写：
//   164 道题手写采分点不现实；但让模型"顺手"在批改时现编采分点更糟——
//   同一题每次的采分点都不一样，分数就永远不可复算。
//   所以**离线生成一次、人工复核、之后固定复用**，这是评分可信度的地基。
//
// 输出分层（与题库一致）：
//   公开卷/仿真题 → frontend/src/data/standards/generated.js          （进仓库）
//   私有卷        → frontend/src/data/standards-private/index.js      （不进仓库）
//   逐题原始产物  → .tools/standards/out/*.json                       （中间产物，重跑即复现）
//
// ⚠️ 生成结果**未经人工复核前不要当真**：source 恒为 'llm'，
//    人工校过的题请移进 standards/public.js（优先级更高，见 standards/index.js）。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const OUT_DIR = resolve(HERE, 'out')
const PUBLIC_DIR = resolve(ROOT, 'frontend/src/data/real-exams')
const PRIVATE_DIR = resolve(ROOT, 'frontend/src/data/real-exams-private')
const PUBLIC_STD_FILE = resolve(ROOT, 'frontend/src/data/standards/generated.js')
const PRIVATE_STD_FILE = resolve(ROOT, 'frontend/src/data/standards-private/index.js')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d = null) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const MOCK = has('--mock')
const WRITE = has('--write')
const INCLUDE_PRIVATE = has('--include-private')
const LIMIT = Number(val('--limit', 0)) || 0
const IDS = (val('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const CONCURRENCY = Number(val('--concurrency', 3)) || 3

// ─────────────────────────── LLM 配置 ───────────────────────────
// 与前端 api/llm.js::buildUrl、后端 app/agents/llm.py::build_url 保持同一套拼接规则。
// ⚠️ 版本段必须用 /v\d+$/ 通配，**不要写死 /v1**（智谱兼容地址是 .../paas/v4）。
function buildUrl(base) {
  const b = String(base || '').trim().replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (/\/v\d+$/.test(b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

/** 从环境变量或 backend/.env 取配置（不进版本库，避免把 Key 写进脚本） */
function loadConfig() {
  const env = { ...process.env }
  const envFile = resolve(ROOT, 'backend/.env')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return {
    key: val('--key', env.LLM_API_KEY || ''),
    base: val('--base', env.LLM_BASE_URL || 'https://api.deepseek.com'),
    model: val('--model', env.LLM_MODEL || 'deepseek-chat'),
  }
}

// ─────────────────────────── 提示词 ───────────────────────────

const SYSTEM = `你是申论命题与阅卷专家。任务：把一道申论题的**采分点**提取成一份可复用的评分标准。

要求：
1. 采分点必须**来自给定资料**，不是凭空总结。每个点给出：
   - label：一句话说清这个点（20~40 字，动宾结构）
   - weight：分值（整数或 .5）。**所有点之和必须恰好等于该题满分**。
   - evidence：材料中的**原文片段**（每条 10~30 字）。必须**原样复制**，一个字都不能改，
     不加省略号、不补标点。这是人工核对与程序比对的锚点，改写了就失效。
   - keywords：3~6 个关键判据词——考生答案里表达出这个意思就该算命中，不是死抠字面。
   - note：可选，辨析提示（易混淆、不给分的情形）。
2. 分值分配按"要点重要性 + 材料篇幅"来，**不要平均主义**。
3. 采分点数量与分值匹配：10 分题 3~5 个点，15~20 分题 4~7 个点。
4. 大作文（分值 ≥35）不拆细点，改为 4~5 个**评分维度**（如立意与思想/结构层次/论证质量/语言表达/卷面），
   weight 之和仍等于满分，evidence 可留空数组。
5. 宁可少而准：拿不准的点不要凑数。

严格输出 JSON，不要 markdown 代码块，不要任何解释前后缀：
{ "points": [ { "label": "", "weight": 0, "evidence": [""], "keywords": [""], "note": "" } ] }`

function buildUser(q, exam) {
  return `【题目】${q.stem}
【作答要求】${q.requirement || '（无）'}
【题型】${q.type || '（未标注）'}　【满分】${q.score} 分　【字数要求】${q.wordLimit ? q.wordLimit + ' 字' : '（未标注）'}
【卷别】${exam ? `${exam.year} 年 · ${exam.paper}` : '内置仿真题'}

【给定资料】
${q.material || exam?.material || '（无）'}

【参考答案（评分参考，用于理解出题意图；**不要直接抄成采分点**）】
${q.reference || '（本题无参考答案）'}

请输出这道题的采分点标准 JSON。`
}

// ─────────────────────────── mock 通道 ───────────────────────────

/**
 * 离线假数据：只保证**结构合法、分值自洽**，内容明显是占位。
 * 目的是让"生成 → 校验 → 落库 → 前端消费"这条链路能在没有 Key 时也跑通、可回归。
 */
function mockStandard(q) {
  const big = q.score >= 35
  const n = big ? 5 : q.score >= 15 ? 5 : 4
  const ref = String(q.reference || '')
  const chunks = ref.split(/[；。]/).map((s) => s.trim()).filter((s) => s.length >= 6)
  const base = Math.floor((q.score / n) * 2) / 2
  let rest = q.score - base * n
  const points = []
  for (let i = 0; i < n; i++) {
    const bump = rest > 0 ? 0.5 : 0
    rest -= bump
    const src = chunks[i] || `材料中的第 ${i + 1} 个要点`
    points.push({
      label: big ? `【mock】评分维度 ${i + 1}` : `【mock】${src.slice(0, 26)}`,
      weight: base + bump,
      evidence: big ? [] : [src.slice(0, 18)],
      keywords: src.slice(0, 8).split('').filter(Boolean).slice(0, 4),
      note: '由 --mock 生成的占位标准，不可用于真实阅卷',
    })
  }
  return { points }
}

// ─────────────────────────── 调用 ───────────────────────────

async function callLLM(cfg, q, exam) {
  const url = buildUrl(cfg.base)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUser(q, exam) },
      ],
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

/** 从模型输出里抠出 JSON（模型常裹上 ```json 围栏或多说一句） */
function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try {
    return JSON.parse(s.slice(i, j + 1))
  } catch {
    return null
  }
}

/** 把模型给的 points 补成合法标准（缺 totalScore 就用分数之和） */
function toStandard(questionId, raw, maxScore) {
  const points = (raw?.points || [])
    .filter((p) => p && p.label)
    .map((p, i) => ({
      id: `p${i + 1}`,
      label: String(p.label).trim(),
      weight: Number(p.weight) || 0,
      evidence: Array.isArray(p.evidence) ? p.evidence.map(String) : [],
      keywords: Array.isArray(p.keywords) ? p.keywords.map(String) : [],
      note: p.note ? String(p.note) : '',
    }))
  if (!points.length) return { errors: ['模型没有返回任何采分点'] }

  const sum = points.reduce((s, p) => s + p.weight, 0)
  // 分值对不上是最常见的失败：让模型自己修不准，这里直接按比例归一，
  // 并把"修正过"记进 meta，人工复核时能看见。
  let normalized = false
  if (Math.abs(sum - maxScore) > 0.01 && sum > 0) {
    const k = maxScore / sum
    for (const p of points) p.weight = Math.round(p.weight * k * 2) / 2
    normalized = true
  }
  const finalSum = points.reduce((s, p) => s + p.weight, 0)

  return {
    standard: {
      questionId,
      totalScore: finalSum,
      source: 'llm',
      meta: { normalized, originalSum: sum, model: null, generatedAt: new Date().toISOString() },
      points,
    },
    warnings: normalized ? [`分值之和 ${sum} ≠ 满分 ${maxScore}，已按比例归一为 ${finalSum}`] : [],
  }
}

// ─────────────────────────── 题目收集 ───────────────────────────

async function loadExamDir(dir, tier) {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((f) => /^exam-.*\.js$/.test(f))
  const exams = []
  for (const f of files.sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href)
    exams.push({ ...mod.default, tier })
  }
  return exams
}

async function collectQuestions() {
  const items = []

  for (const ex of await loadExamDir(PUBLIC_DIR, 'public')) {
    for (const q of ex.questions) {
      items.push({
        id: `real-${ex.id}-${q.no}`,
        tier: 'public',
        exam: ex,
        q: { ...q, material: ex.material },
      })
    }
  }

  if (INCLUDE_PRIVATE) {
    const priv = await loadExamDir(PRIVATE_DIR, 'private')
    if (!priv.length) console.log('⚠ 指定了 --include-private，但本机没有私有卷目录，跳过。')
    for (const ex of priv) {
      for (const q of ex.questions) {
        items.push({
          id: `real-${ex.id}-${q.no}`,
          tier: 'private',
          exam: ex,
          q: { ...q, material: ex.material },
        })
      }
    }
  }

  // 内置仿真题。⚠️ 前缀必须与 builtin-questions.js::withPrefix 一致——
  //    练习页拿到的是 `builtin-q-01`，标准键写 `q-01` 会**静默地永远匹配不上**。
  const simPath = resolve(ROOT, 'frontend/src/data/builtin-questions.js')
  if (existsSync(simPath)) {
    const { BUILTIN_QUESTIONS } = await import(pathToFileURL(simPath).href)
    for (const q of BUILTIN_QUESTIONS) {
      items.push({ id: `builtin-${q.id}`, tier: 'public', exam: null, q })
    }
  }

  return items
}

// ─────────────────────────── 落库 ───────────────────────────

/** 把 {id: standard} 写成前端可 import 的模块 */
function renderModule(constName, map, { header }) {
  const body = JSON.stringify(map, null, 2)
    // 单文件版会把这些模块内联进 <script>，字符串里的 </script> 会提前闭合标签
    .replace(/</g, '\\u003c')
  return `${header}\nexport const ${constName} = ${body}\n`
}

function readExisting(file, constName) {
  if (!existsSync(file)) return {}
  try {
    const m = readFileSync(file, 'utf8').match(new RegExp(`export const ${constName} = (\\{[\\s\\S]*?\\})\\n?$`))
    return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : {}
  } catch {
    return {}
  }
}

async function pool(items, n, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const cfg = loadConfig()
  if (!MOCK && !cfg.key) {
    console.error(
      '✗ 未找到 LLM_API_KEY。三种给法：\n' +
        '    · 环境变量 LLM_API_KEY=sk-...\n' +
        '    · backend/.env 里写 LLM_API_KEY=sk-...\n' +
        '    · 命令行 --key sk-...\n' +
        '  只想验链路不花钱：加 --mock'
    )
    process.exit(1)
  }

  let items = await collectQuestions()
  if (IDS.length) items = items.filter((it) => IDS.includes(it.id))
  if (LIMIT) items = items.slice(0, LIMIT)
  if (!items.length) {
    console.error('✗ 没有匹配到任何题目')
    process.exit(1)
  }

  console.log(
    `\n采分点预解析：${items.length} 道题　模式=${MOCK ? 'mock（离线占位）' : cfg.model}　并发=${CONCURRENCY}`
  )
  console.log(`  公开 ${items.filter((i) => i.tier === 'public').length} 道 / 私有 ${items.filter((i) => i.tier === 'private').length} 道\n`)

  mkdirSync(OUT_DIR, { recursive: true })

  const results = await pool(items, CONCURRENCY, async (it) => {
    const maxScore = it.q.score || 20
    try {
      let raw
      if (MOCK) {
        raw = mockStandard(it.q)
      } else {
        const text = await callLLM(cfg, it.q, it.exam)
        raw = parseJson(text)
        if (!raw) {
          // 再试一次：模型偶发输出围栏或多余说明，重试比报错划算
          raw = parseJson(await callLLM(cfg, it.q, it.exam))
        }
      }
      const { standard, errors, warnings } = toStandard(it.id, raw, maxScore)
      if (!standard) throw new Error(errors?.join('; ') || '解析失败')
      standard.meta.model = MOCK ? 'mock' : cfg.model
      if (warnings?.length) console.log(`  ⚠ ${it.id}：${warnings.join('；')}`)

      writeFileSync(join(OUT_DIR, `${it.id}.json`), JSON.stringify(standard, null, 2), 'utf8')
      console.log(`  ✓ ${it.id}　${standard.points.length} 个点 / ${standard.totalScore} 分`)
      return { id: it.id, tier: it.tier, standard }
    } catch (e) {
      console.log(`  ✗ ${it.id}　${e.message}`)
      return { id: it.id, tier: it.tier, error: e.message }
    }
  })

  const ok = results.filter((r) => r.standard)
  const bad = results.filter((r) => r.error)
  console.log(`\n完成：${ok.length} 成功 / ${bad.length} 失败`)

  const shouldWrite = WRITE || !MOCK
  if (!shouldWrite) {
    console.log('\n（mock 模式默认不写前端数据；确认无误后加 --write 落库）')
    return
  }

  const pubNew = {}
  const privNew = {}
  for (const r of ok) {
    if (r.tier === 'private') privNew[r.id] = r.standard
    else pubNew[r.id] = r.standard
  }

  // 只覆盖本次生成的题，其余保留（--ids 只跑几道时不会把其他标准抹掉）
  const pubOld = readExisting(PUBLIC_STD_FILE, 'GENERATED_STANDARDS')
  const merged = { ...pubOld, ...pubNew }
  writeFileSync(
    PUBLIC_STD_FILE,
    renderModule('GENERATED_STANDARDS', merged, {
      header:
        '// 采分点标准 · 生成产物（公开部分）\n' +
        '//\n' +
        '// ⚠️ 由 .tools/standards/gen_standards.mjs 生成，请勿手改。\n' +
        '//    人工精校的标准请放进同目录 public.js（优先级更高）。\n' +
        `//    本次生成 ${Object.keys(pubNew).length} 道，累计 ${Object.keys(merged).length} 道。\n`,
    }),
    'utf8'
  )
  console.log(`  → ${PUBLIC_STD_FILE.replace(ROOT + '\\', '')}（累计 ${Object.keys(merged).length} 道）`)

  if (Object.keys(privNew).length) {
    mkdirSync(dirname(PRIVATE_STD_FILE), { recursive: true })
    const privOld = readExisting(PRIVATE_STD_FILE, 'PRIVATE_STANDARDS')
    const privMerged = { ...privOld, ...privNew }
    writeFileSync(
      PRIVATE_STD_FILE,
      renderModule('PRIVATE_STANDARDS', privMerged, {
        header:
          '// 私有卷的采分点标准（⚠️ 不进版本库，与私有卷正文同等对待）\n' +
          '//\n' +
          '// ⚠️ 由 .tools/standards/gen_standards.mjs 生成，请勿手改。\n' +
          `//    本次生成 ${Object.keys(privNew).length} 道，累计 ${Object.keys(privMerged).length} 道。\n`,
      }),
      'utf8'
    )
    console.log(`  → ${PRIVATE_STD_FILE.replace(ROOT + '\\', '')}（累计 ${Object.keys(privMerged).length} 道）`)
  }

  if (bad.length) {
    console.log('\n以下题目未生成标准，练习时会走"无标准裸判"（不阻塞功能）：')
    for (const b of bad) console.log(`  · ${b.id}: ${b.error}`)
  }
}

main().catch((e) => {
  console.error('\n✗ 生成器异常：', e.message)
  process.exit(1)
})
