// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// markdown 渲染的**两套实现一致性**测试：Python 一份、Rust 一份。
//
// ── 为什么这条最重要 ──
//   `docs/practice/*.md` 是用户会长期留存、对比、甚至打印的产物。
//   网站版用 Python 写它，桌面版用 Rust 写它 —— 同一份记录在两边长得不一样，
//   是那种"没人会报错、但用户一眼看出不对劲"的问题。
//   而且它属于本项目最怕的一类：**漂移是静默的**，没有测试就永远发现不了。
//
// ── 怎么比 ──
//   同一份结构化记录，两边各渲染一次，**逐字符 diff**。
//   样本刻意覆盖所有分支：可信度块、逐句批注、分项、扣分、分歧裁定、
//   采分点、优先解决 / 次要问题 / 亮点 / 建议，以及"字段缺失时的章节跳号"。
//
// ── 用法 ──
//   node .tools/test-md-parity.mjs              # 自动找 exe
//   node .tools/test-md-parity.mjs --exe <路径>

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const getArg = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : null
}
const EXE_ARG = getArg('--exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

// 网关地址不再走 CDP（见主流程里的说明），这里只留一个监听端口枚举器。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 当前所有 127.0.0.1 上的 TCP 监听端口（netstat 解析；失败返回空集 = 上层轮询自然超时变红） */
function listeningPorts() {
  const set = new Set()
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s/)
      if (m) set.add(Number(m[1]))
    }
  } catch {}
  return set
}

const PY = existsSync(join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe'))
  ? join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
  : 'python'

function findExe() {
  if (EXE_ARG) return resolve(EXE_ARG)
  const dir = join(ROOT, 'desktop', 'src-tauri', 'target', 'release')
  if (!existsSync(dir)) return null
  return (
    readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.exe'))
      .map((f) => join(dir, f))
      .filter((p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null
  )
}

// ─────────────────────────── 样本 ───────────────────────────

/** 全字段样本：把渲染里每个分支都走一遍 */
const FULL = {
  id: 'parity-full',
  created_at: '2026-09-21 21:30:00',
  title: '一致性测试 · 全字段',
  mode: 'roundtable',
  teacher_ids: ['yuandong', 'zhoutairan', 'bailu'],
  teachers: [
    { id: 'yuandong', name: '袁东', title: '资深申论讲师' },
    { id: 'zhoutairan', name: '周泰然', title: '阅卷组组长' },
  ],
  requirement: '请概括材料中的主要做法。',
  material: '材料一：……',
  answer: '第一，加强组织领导。第二，完善政策保障。',
  word_count: 22,
  word_limit: 250,
  max_score: 20,
  final_score: 17.5,
  level: '良好',
  elapsed_ms: 115800,
  roundtable_note: '三位老师对第二点存在分歧，已按采分点标准裁定。',
  summary: '整体结构清晰，但第三点展开不足。',
  credibility: {
    version: '1.0',
    level: 'high',
    score: 96,
    headline: '可以采信：多个独立口径互相印证',
    signals: [
      {
        id: 'agreement',
        label: '老师一致性',
        valueText: '3 位老师得分率极差 2.5 个百分点',
        level: 'good',
        basis: '取每位老师得分÷满分的极差。',
      },
      {
        id: 'agreement_solo',
        label: '老师一致性（单人）',
        valueText: '不适用',
        level: 'na',
        basis: '只有一位老师的有效成绩，无从判断一致与否。',
      },
    ],
    caveats: ['客观扣分被封顶：AI 可能比规则层更宽容'],
  },
  teacher_results: [
    {
      teacherId: 'yuandong',
      score: 17.5,
      maxScore: 20,
      annotations: [
        { quote: '加强组织领导', type: '采分点', comment: '写到了核心', fix: '可以更具体' },
        { quote: '完善政策保障', type: '表述', comment: '略空' },
      ],
      advice: '先补第三点的展开。',
      dimensions: [{ name: '要点', score: 12, max: 14, comment: '基本覆盖' }],
      deductions: [{ point: '格式分', reason: '未分条', fix: '用序号分段' }],
      summary: '结构完整。',
    },
    {
      teacher_id: 'bailu',
      score: 17,
      maxScore: 20,
    },
  ],
  debate: {
    disputes: [
      {
        topic: '第二点是否算采分点',
        positions: [
          { teacher: 'yuandong', view: '算' },
          { teacher: 'bailu', view: '不算' },
        ],
        ruling: '算，但表述不完整',
        reason: '标准里写了「政策保障」',
      },
    ],
    overall: '分歧集中在第二点，已按标准裁定。',
  },
  key_points: [
    { point: '加强组织领导', status: 'hit' },
    { point: '完善政策保障', status: 'partial', note: '提到了但没展开' },
    { point: '乡村微治理', status: 'miss', note: '三位老师都漏了' },
  ],
  critical_issues: [{ issue: '第三点只有结论没有展开', source: '共识', fix: '补一句具体做法' }],
  minor_issues: [{ issue: '标点用了半角', fix: '统一成全角' }],
  highlights: [
    { point: '开头的总起句', why: '直接点题' },
    { point: '结尾的呼应', why: '' },
  ],
  suggestions: ['动笔前列提纲', '每点先写结论再写依据'],
}

/** 极简样本：只给必填 —— 测「字段缺失时章节不跳号」这类边界 */
const MINIMAL = {
  id: 'parity-minimal',
  created_at: '2026-09-21 21:31:00',
  title: '一致性测试 · 极简',
  mode: 'solo',
  max_score: 40,
  final_score: 30,
  answer: '只有一段作答。',
}

// ─────────────────────────── Python 侧渲染 ───────────────────────────

function pythonRender(sample) {
  const src = `
import json, sys
sys.path.insert(0, r'${join(ROOT, 'backend').replace(/\\/g, '\\\\')}')
from app.services.record_service import render_markdown
data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
# ⚠️ 必须走 buffer 输出：文本模式的 stdout 在 Windows 上会把 \\n 转成 \\r\\n，
#    那样测到的是「控制台的换行行为」，而不是「渲染函数真正吐出的字符」
sys.stdout.buffer.write(render_markdown(data).encode('utf-8'))
`
  return execFileSync(PY, ['-c', src], {
    input: JSON.stringify(sample),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

// ─────────────────────────── Rust 侧渲染（经真实接口） ───────────────────────────

async function api(base, path, options = {}) {
  try {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) }
    } catch {
      return { ok: res.ok, status: res.status, body: text }
    }
  } catch (e) {
    return { ok: false, status: 0, error: String(e) }
  }
}

/** 行级 diff，只报前若干处差异（避免刷屏） */
function diffLines(a, b, limit = 12) {
  const la = a.split('\n')
  const lb = b.split('\n')
  const out = []
  const n = Math.max(la.length, lb.length)
  for (let i = 0; i < n && out.length < limit; i++) {
    if (la[i] !== lb[i]) {
      out.push(`  第 ${i + 1} 行\n    Python: ${JSON.stringify(la[i] ?? '(无)')}\n    Rust  : ${JSON.stringify(lb[i] ?? '(无)')}`)
    }
  }
  if (out.length >= limit) out.push('  …（还有更多差异，已截断）')
  return out.join('\n')
}

// ─────────────────────────── 主流程 ───────────────────────────

const exe = findExe()
if (!exe) {
  console.log('✗ 找不到待测 exe（先跑 cd desktop && npm run build）')
  process.exit(1)
}
console.log(`  被测产物：${exe}`)

console.log('\n【Python 侧】')
const pyFull = pythonRender(FULL)
const pyMin = pythonRender(MINIMAL)
console.log(`  ✓ 全字段样本渲染 ${pyFull.length} 字符`)
console.log(`  ✓ 极简样本渲染 ${pyMin.length} 字符`)

console.log('\n【Rust 侧（经真实接口）】')
// spawn 前先查残留：桌面版有单实例锁（tauri_plugin_single_instance，按 identifier 互斥）。
// ⚠️ 不能只查 bluepencil.exe 进程名：**发行版 exe 是中文名**（蓝笔申论-桌面版-vX.Y.Z.exe），
//    作者本人开着软件时它就在跑——本测试照样会被单实例挡在门外。
// 所以用**秒退检测**兜底（行为判据，不依赖进程名）：spawn 后 3 秒内 exit 0
// = 单实例让路 = 有同 identifier 的实例在跑（多半是你自己开着软件）。
{
  const { execFileSync } = await import('node:child_process')
  let existing = ''
  try {
    existing = execFileSync('tasklist', ['/FI', 'IMAGENAME eq bluepencil.exe'], { encoding: 'utf8' })
  } catch {}
  if (/bluepencil\.exe/i.test(existing)) {
    console.log('✗ 检测到残留的 bluepencil.exe（上一轮测试没杀干净）。')
    console.log('  单实例锁会让本次 spawn 立即退出、探测可能连上旧实例 —— 测错对象比测不成更糟。')
    console.log('  先清进程再跑：taskkill /F /IM bluepencil.exe')
    process.exit(1)
  }
}
// ⚠️ 基线必须拍在 spawn 之前：spawn 后还要等 3 秒秒退检测，网关在这段时间里
//    早就监听上了 —— 基线拍晚了会把真实网关端口算进"基线"，后面"只认新增"永远找不到它。
const baseline = listeningPorts()
const child = spawn(exe, [], {
  env: { ...process.env },
  stdio: 'ignore',
  detached: false,
})
child.on('error', (e) => console.log('  [debug] spawn error:', String(e)))
if (process.env.MDP_DEBUG) {
  console.log('  [debug] spawned pid:', child.pid)
  child.on('exit', (code) => console.log('  [debug] child exit:', code))
}
// 秒退检测：单实例互斥的第二实例会 exit 0 退出（实测被作者自己开着的软件坑过）
const earlyExit = new Promise((resolve) => {
  child.once('exit', (code) => resolve({ early: true, code }))
  setTimeout(() => resolve({ early: false }), 3000)
})
const probe = await earlyExit
if (probe.early) {
  try {
    child.kill('SIGKILL')
  } catch {}
  console.log('✗ 桌面版 exe 启动后 3 秒内退出（exit 0）—— 单实例锁让路：已有同 identifier 的实例在跑。')
  console.log('  多半是你自己开着「蓝笔申论-桌面版」（或上次测试没杀干净）。关掉它再跑本测试。')
  process.exit(1)
}

// 网关地址怎么拿？曾经走 CDP：给 WebView2 传 --remote-debugging-port，进页面 invoke('api_base')。
// 2026-09-24 晚实测：同一份代码、同一份 exe，下午 CDP 探针还全绿，晚上该参数就不再出现在
// WebView2 browser 进程的命令行里（端口根本不开，宿主与 WebView2 全部正常）——
// 「没改代码却红」的环境漂移不该由测试承担。而网关本来就是 TCP 服务：
// 拍监听基线 → spawn → 只认新增端口 → 健康检查确认是蓝笔（app + version）。
// 依赖的只有网关本身，不依赖 WebView2 的任何内部行为。
// （基线 baseline 已在 spawn 前拍好，见上方注释）

let BASE = ''
let lastFresh = []
const deadline = Date.now() + 30000
while (Date.now() < deadline && !BASE) {
  const fresh = [...listeningPorts()].filter((p) => !baseline.has(p))
  lastFresh = fresh
  if (process.env.MDP_DEBUG && fresh.length) console.log('  [debug] fresh ports:', fresh.join(','))
  for (const port of fresh) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(800) })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.app === '蓝笔申论') {
        BASE = `http://127.0.0.1:${port}`
        check('网关健康检查（app=蓝笔申论）', true, `port ${port} · v${body.version}`)
        break
      }
    } catch {}
  }
  if (!BASE) await sleep(700)
}
if (!BASE) {
  try {
    child.kill('SIGKILL')
  } catch {}
  console.log('✗ 拿不到本地服务地址（30 秒内没有出现健康检查通过的监听端口）')
  console.log('  诊断：基线 ' + baseline.size + ' 个监听 / spawn 后新增 [' + (lastFresh.join(',') || '无') + ']')
  console.log('  新增里连网关都没有 = exe 没起来或网关没起；有网关但健康检查不过 = 接口或编码问题。')
  try {
    const tl = execFileSync('tasklist', ['/FI', 'IMAGENAME eq bluepencil.exe'], { encoding: 'utf8' })
    console.log('  进程表：' + (tl.split('\n').filter((l) => /bluepencil/i.test(l)).join(' ; ') || '(无 bluepencil 进程)'))
  } catch {}
  process.exit(1)
}
console.log(`  ✓ 本地服务 ${BASE}`)

async function rustRender(sample, label) {
  const post = await api(BASE, '/records', { method: 'POST', body: sample })
  if (!post.ok) {
    check(`Rust 渲染「${label}」`, false, `HTTP ${post.status} ${JSON.stringify(post.body).slice(0, 160)}`)
    return null
  }
  const md = await api(BASE, `/records/${encodeURIComponent(sample.id)}/markdown`)
  // 顺手清掉，别把测试数据留在 docs/practice 里
  await api(BASE, `/records/${encodeURIComponent(sample.id)}`, { method: 'DELETE' })
  if (!md.ok) {
    check(`Rust 渲染「${label}」`, false, `取回 md 失败 HTTP ${md.status}`)
    return null
  }
  return md.body.markdown
}

const rustFull = await rustRender(FULL, '全字段')
const rustMin = await rustRender(MINIMAL, '极简')

try {
  child.kill('SIGKILL')
} catch {}

console.log('\n【逐字对比】')
for (const [label, py, rs] of [
  ['全字段样本', pyFull, rustFull],
  ['极简样本', pyMin, rustMin],
]) {
  if (rs == null) continue
  const same = py === rs
  check(
    `md 渲染两份实现完全一致（${label}）`,
    same,
    same ? `${py.length} 字符逐字相同` : `长度 Python=${py.length} / Rust=${rs.length}`
  )
  if (!same) console.log(diffLines(py, rs))
}

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length
    ? `\nmd 一致性测试：${results.length - failed.length} passed, ${failed.length} failed`
    : `\nmd 一致性测试：${results.length} 项全部通过`
)
process.exit(failed.length ? 1 : 0)
