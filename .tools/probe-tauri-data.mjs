// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版「记账 + 记录归档」的端到端探针。
//
// ── 为什么需要它 ──
//   这两个通道**失败时是静默的**：
//   · 记录归档写不进去 → 前端存了 IndexedDB，界面一切正常，只是 `docs/practice/`
//     里永远不出现文件。用户很久之后才发现"我的记录呢"。
//   · 记账写不进去 → 界面更看不出任何异常，只是成本报告里数字永远是 0。
//   所以必须有一处**真的落盘、再读回来**的验证，而不是"接口返回 200 就算过"。
//
// ── 判据 ──
//   ⑩ 记录归档：POST → 磁盘上真有 .md 与 .json → md 内容符合渲染规范 →
//      列表/详情/markdown/删除 四个读接口都对
//   ⑪ 记账：POST 任务 → score_rate 算得对 → 列表查得到 → /stats 聚合得到
//   收尾时把自己造的数据**全部删掉**（探针不能污染用户真实的 docs/practice/）
//
// ── 用法 ──
//   node .tools/probe-tauri-data.mjs               # 自动找 target/release 下的 exe
//   node .tools/probe-tauri-data.mjs --exe <路径>   # 指定 exe

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const getArg = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : null
}
const KEEP = argv.includes('--keep')
const EXE_ARG = getArg('--exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

const CDP_PORT = 9300 + Math.floor(Math.random() * 400)
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function fetchTargets(timeoutMs = 1200) {
  try {
    const res = await fetch(`${CDP_URL}/json`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const list = await res.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

function evaluate(wsUrl, expression, timeoutMs = 10000) {
  return new Promise((done) => {
    let ws
    const timer = setTimeout(() => {
      try {
        ws?.close()
      } catch {}
      done({ ok: false, error: 'CDP 求值超时' })
    }, timeoutMs)
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      clearTimeout(timer)
      return done({ ok: false, error: String(e) })
    }
    const finish = (payload) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      done(payload)
    }
    ws.onerror = () => finish({ ok: false, error: 'CDP WebSocket 连接失败' })
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      )
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        if (msg.id !== 1) return
        if (msg.result?.exceptionDetails) {
          return finish({ ok: false, error: msg.result.exceptionDetails.text || '页面内抛错' })
        }
        finish({ ok: true, value: msg.result?.result?.value })
      } catch (e) {
        finish({ ok: false, error: String(e) })
      }
    }
  })
}

/** 打本地服务（从 Node 侧直接打，不经过页面 —— 测的是网关本身） */
async function api(base, path, options = {}) {
  const url = `${base}/api/v1${path}`
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 200)
    }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, error: String(e) }
  }
}

// ─────────────────────────── 主流程 ───────────────────────────

const exe = findExe()
if (!exe) {
  console.log('✗ 找不到待测 exe（先跑 cd desktop && npm run build）')
  process.exit(1)
}
console.log(`  被测产物：${exe}（${(statSync(exe).size / 1048576).toFixed(1)} MB）`)

const before = await fetchTargets(600)
check(
  '探针端口起进程前是干净的（不会认错对象）',
  before === null,
  before ? `⚠️ ${CDP_PORT} 上已有 ${before.length} 个 target` : `端口 ${CDP_PORT} 空闲`
)

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
  },
  stdio: 'ignore',
  detached: false,
})

function killApp() {
  try {
    child.kill('SIGKILL')
  } catch {}
}

// 记下自己造的数据，收尾时删干净
const created = { recordId: null, taskId: null }

async function cleanup() {
  if (KEEP) {
    console.log(`\n（--keep：进程保留，PID ${child.pid}）`)
    return
  }
  killApp()
}

// 等页面就绪（WebView2 起来 ≠ 页面加载完：加了单实例插件后启动会慢一点）
let page = null
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  const targets = await fetchTargets()
  const pages = (targets || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  const ready = pages.find((t) => t.url && t.url !== 'about:blank')
  if (ready) {
    page = ready
    break
  }
  await sleep(700)
}
check('页面加载完成（拿到真实 url 的 target）', !!page, page?.url || '40 秒内没就绪')
if (!page) {
  await cleanup()
  console.log('\n数据通道探针：中止（页面没起来）')
  process.exit(1)
}

// 从页面里把本地服务地址要过来 —— 这是唯一能确定"端口是我这一个实例的"的方式
const got = await evaluate(
  page.webSocketDebuggerUrl,
  `(async () => {
     const base = await window.__TAURI_INTERNALS__.invoke('api_base')
     return base || ''
   })()`
)
const BASE = got.ok && typeof got.value === 'string' ? got.value : ''
check('取到本地服务地址', !!BASE, BASE || got.error || '')
if (!BASE) {
  await cleanup()
  console.log('\n数据通道探针：中止（拿不到服务地址）')
  process.exit(1)
}

// ────────────────── ⑩ 记录归档 ──────────────────

const RID = `probe-${Date.now().toString(36)}`
created.recordId = RID

const sampleRecord = {
  id: RID,
  created_at: '2026-09-21 21:30:00',
  title: '探针自检记录（可删）',
  mode: 'trio',
  teacher_ids: ['yuandong', 'zhoutairan', 'bailu'],
  teachers: [{ id: 'yuandong', name: '袁东', title: '资深申论讲师' }],
  requirement: '请概括材料中的主要做法。',
  material: '（材料略）',
  answer: '第一，加强组织领导。第二，完善政策保障。',
  word_count: 22,
  word_limit: 250,
  max_score: 20,
  final_score: 17.5,
  level: '良好',
  elapsed_ms: 115800,
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
      ],
      advice: '先补第三点的展开。',
      summary: '结构完整。',
    },
  ],
  key_points: [
    { point: '加强组织领导', status: 'hit' },
    { point: '完善政策保障', status: 'hit' },
    { point: '乡村微治理', status: 'miss', note: '三位老师都漏了' },
  ],
  critical_issues: [{ issue: '第三点只有结论没有展开', source: '共识', fix: '补一句具体做法' }],
  suggestions: ['动笔前列提纲'],
}

const saved = await api(BASE, '/records', { method: 'POST', body: sampleRecord })
check('⑩ POST /records 成功', saved.ok, `HTTP ${saved.status} ${saved.ok ? '' : JSON.stringify(saved.body).slice(0, 160)}`)

let mdPath = null
if (saved.ok && saved.body) {
  const dir = saved.body.dir
  mdPath = dir ? join(dir, saved.body.markdown) : null
  check(
    '⑩ 返回里带着落盘位置与文件名',
    !!dir && !!saved.body.file && !!saved.body.markdown,
    `${saved.body.file}.{md,json}`
  )
}

// 关键一条：**磁盘上真的出现了文件** —— 接口返回 200 不等于文件写成了
if (mdPath) {
  const jsonPath = mdPath.replace(/\.md$/, '.json')
  const mdExists = existsSync(mdPath)
  const jsonExists = existsSync(jsonPath)
  check('⑩ 磁盘上真的生成了 .md 与 .json', mdExists && jsonExists, mdPath)

  if (mdExists) {
    const md = readFileSync(mdPath, 'utf8')
    // 抽查几处渲染规范：标题、分数（整数/小数各一种）、可信度口径、采分点符号
    const checks = [
      ['标题行', md.includes('# 探针自检记录（可删）')],
      ['分数保留小数且满分不带 .0', md.includes('**17.5 / 20 分**')],
      ['模式中文名', md.includes('三师圆桌合议')],
      ['可信度等级与分数', md.includes('评分可信度：可信度高 · 96')],
      ['每个信号带口径', md.includes('口径：取每位老师得分÷满分的极差。')],
      ['采分点命中符号', md.includes('✓ 加强组织领导')],
      ['采分点未命中符号', md.includes('✗ 乡村微治理')],
      ['老师批注带「改：」', md.includes('- 改：可以更具体')],
      ['结尾署名', md.includes('由 蓝笔申论 BluePencil 生成')],
    ]
    const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
    check('⑩ md 渲染符合规范（9 处抽查）', bad.length === 0, bad.length ? `缺：${bad.join('、')}` : '全部命中')
  }
}

const listed = await api(BASE, '/records?limit=500')
const inList =
  listed.ok && Array.isArray(listed.body) && listed.body.some((r) => r.id === RID)
check('⑩ GET /records 列表里有这一条', inList, listed.ok ? `共 ${listed.body?.length ?? 0} 条` : `HTTP ${listed.status}`)

const detail = await api(BASE, `/records/${encodeURIComponent(RID)}`)
check(
  '⑩ GET /records/{id} 取回完整记录',
  detail.ok && detail.body?.id === RID && detail.body?.final_score === 17.5,
  detail.ok ? `final_score = ${detail.body?.final_score}` : `HTTP ${detail.status}`
)

const mdBack = await api(BASE, `/records/${encodeURIComponent(RID)}/markdown`)
check(
  '⑩ GET /records/{id}/markdown 取回原文',
  mdBack.ok && typeof mdBack.body?.markdown === 'string' && mdBack.body.markdown.includes('# 探针自检记录'),
  mdBack.ok ? `${mdBack.body.markdown.length} 字符` : `HTTP ${mdBack.status}`
)

// ────────────────── ⑪ 记账 ──────────────────

const TID = `probe-task-${Date.now().toString(36)}`
created.taskId = TID

const task = await api(BASE, '/grading/tasks', {
  method: 'POST',
  body: {
    task_id: TID,
    mode: 'trio',
    teacher_ids: ['yuandong', 'zhoutairan', 'bailu'],
    question_type: '归纳概括',
    title: '探针自检任务（可删）',
    answer_chars: 22,
    deep: false,
    final_score: 17.5,
    max_score: 20,
    elapsed_ms: 115800,
    llm_calls: 4,
    disputed: false,
    status: 'success',
  },
})
check('⑪ POST /grading/tasks 成功', task.ok, `HTTP ${task.status} ${task.ok ? '' : JSON.stringify(task.body).slice(0, 160)}`)
check(
  '⑪ score_rate 算得对（17.5 / 20 = 0.875）',
  Math.abs((task.body?.score_rate ?? 0) - 0.875) < 0.0001,
  `score_rate = ${task.body?.score_rate}`
)
check(
  '⑪ 落库时间戳是 SQLite 形态（与 Python 侧同格式）',
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(task.body?.created_at || '')),
  String(task.body?.created_at || '')
)

const tasks = await api(BASE, '/grading/tasks?limit=500')
check(
  '⑪ GET /grading/tasks 列表里有这一条',
  tasks.ok && Array.isArray(tasks.body) && tasks.body.some((t) => t.task_id === TID),
  tasks.ok ? `共 ${tasks.body?.length ?? 0} 条` : `HTTP ${tasks.status}`
)

const stats = await api(BASE, '/stats')
check('⑪ GET /stats 可用', stats.ok, stats.ok ? '' : `HTTP ${stats.status}`)
if (stats.ok && stats.body) {
  const s = stats.body
  check(
    '⑪ 统计字段齐全（与 Python 的 StatsOut 同名）',
    ['total_tasks', 'total_llm_calls', 'total_prompt_tokens', 'estimated_cost_cny', 'by_mode'].every(
      (k) => k in s
    ),
    `total_tasks=${s.total_tasks} 成本=${s.estimated_cost_cny} 元`
  )
}

// ────────────────── 清理自己造的数据 ──────────────────

const delRec = await api(BASE, `/records/${encodeURIComponent(RID)}`, { method: 'DELETE' })
check('⑩ DELETE /records/{id} 成功', delRec.ok, `HTTP ${delRec.status}`)
check(
  '⑩ 删除后磁盘文件也没了（不是只删了索引）',
  mdPath ? !existsSync(mdPath) : false,
  mdPath || ''
)

const delTask = await api(BASE, `/grading/tasks/${encodeURIComponent(TID)}`, { method: 'DELETE' })
check('⑪ DELETE /grading/tasks/{id} 成功', delTask.ok, `HTTP ${delTask.status}`)

await cleanup()

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length
    ? `\n数据通道探针：${results.length - failed.length} passed, ${failed.length} failed`
    : `\n数据通道探针：${results.length} 项全部通过`
)
process.exit(failed.length ? 1 : 0)
