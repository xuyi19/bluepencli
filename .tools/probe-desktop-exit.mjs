// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版「关页即退」的端到端探针。
//
// 为什么要真浏览器：这套逻辑的**输入端在浏览器事件里**（pagehide / beforeunload /
// sendBeacon），后端单测只能验"收到 bye 之后会怎样"，验不了"关掉页面到底会不会发出 bye"。
// 而这里最容易出错的分支恰恰是**刷新** —— 刷新是「先 bye 后 hello」，
// 后端等待窗口不够、或前端 hello 发晚了，用户按一下 F5 程序就没了。
// 所以这条链路必须拿真浏览器走一遍。
//
// 四个断言（顺序即真实使用顺序）：
//   1. 打开页面 → 后端登记到会话   （attachDesktopSession 真的跑了）
//   2. 刷新页面 → 进程仍然活着      （★ 最危险的一条，刷新不等于关闭）
//   3. 离开页面 → 会话归零          （bye 真的发出去了）
//   4. 再等片刻 → 进程自己退出      （优雅退出，端口关闭）
//
// 用法：node .tools/probe-desktop-exit.mjs
// 前置：已 `npm run build`（桌面版托管的是 frontend/dist）

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

const PY = [
  path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe'),
  path.join(ROOT, 'backend', '.venv', 'bin', 'python'),
].find(existsSync)
if (!PY) {
  console.error('找不到 backend/.venv 里的 Python')
  process.exit(1)
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
if (!CHROME) {
  console.error('找不到 Chrome / Edge')
  process.exit(1)
}

// ── 起桌面版（默认 8765，被占则顺延，所以扫一段） ─────────────
const CANDIDATE_PORTS = Array.from({ length: 20 }, (_, i) => 8765 + i)

/** 读某个端口上的同族实例信息；不是蓝笔申论就返回 null。 */
async function peek(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(400),
    })
    if (!res.ok) return null
    const b = await res.json()
    if (!String(b.app || '').includes('BluePencil')) return null
    return { version: String(b.version || ''), desktop: b.desktop === true }
  } catch {
    return null
  }
}

// ⚠️ **必须显式指定一个非默认端口**，否则会撞上 desktop.py 的「同版本复用」逻辑：
// 默认端口上若已有一个同版本实例，`main()` 会**直接 return**（把浏览器指向那个旧实例），
// 我起的进程随即退出 —— 探针就只能连到别人的实例上，断言全打偏。
// 实测踩过：8765 上放一个同版本 v0.13.4 的残留，探针"4/4 通过"，但**退掉的是那个残留**，
// 而起进程这一步压根没成功。这正是"假绿"最典型的样子。
const PROBE_PORT = 8877
// 基线要覆盖探针自己用的端口，否则"8877 本来就被占"这种情况看不见
const BASELINE_PORTS = [...CANDIDATE_PORTS, PROBE_PORT]

// ⚠️ **起进程之前**先拍一张基线快照：记下这段端口上已经活着的实例。
//
// 为什么需要它：这里曾经只判 `desktop === true`，于是**端口上任何同族实例都会被
// 认成自家人**。真实踩过 —— 8765 上残留着一个 v0.13.3 的桌面版（上次探针没收干净，
// 或用户自己开着），它保着 1 个会话，探针的断言就全打在了旧实例上：
//   · sessions 变成 2（旧实例 1 + 探针页面 1），bye 之后只回到 1 → 第 3 条假红
//   · 更糟的是第 4 条**假绿**："进程已退出"退掉的是那个残留实例，自己起的那个还活着
// 这和桌面版 v0.13.2 修的「复用旧实例、把用户带去旧界面」是同一个病根，
// 只是发生在探针这一侧：**"我这边是好的"和"真的测到了"之间，隔着"测的是不是我起的那个"**。
//
// 判据用「基线差集」而不是版本号：版本比对要先从日志里挖出版本（日志是异步的、
// 文案还可能改），而"起进程前它就在了"这个事实不依赖任何解析，最稳。
const baseline = new Map()
for (const p of BASELINE_PORTS) {
  const info = await peek(p)
  if (info) baseline.set(p, info)
}
if (baseline.size) {
  const desc = [...baseline.entries()].map(([p, i]) => `:${p} v${i.version}`).join('、')
  console.log(`⚠️  起进程前，这些端口上已存在同族实例：${desc}`)
  console.log('    它们不会参与本次断言（否则退的可能不是我自己起的那个）。\n')
}

// 起哪个：默认起 backend/desktop.py（源码），也可以用 `--exe` 指定一个**打包后的**
// 蓝笔申论.exe —— 源码能跑不等于用户双击的那个包里能跑。
// 打包产物和源码是两份不同的东西：PyInstaller 看不到动态导入、`_internal/web` 与
// `frontend/dist` 也不是同一份文件，端口参数、静态托管、关页即退全都要在产物里再验一遍。
const exeArg = (() => {
  const i = process.argv.indexOf('--exe')
  return i >= 0 ? process.argv[i + 1] : null
})()
if (exeArg && !existsSync(exeArg)) {
  console.error(`--exe 指定的文件不存在：${exeArg}`)
  process.exit(1)
}

// 产物和源码的启动方式不同：exe 自带解释器与工作目录，不能传 cwd=backend
const [cmd, args, cwd] = exeArg
  ? [exeArg, ['--no-browser', '--port', String(PROBE_PORT)], undefined]
  : [PY, ['desktop.py', '--no-browser', '--port', String(PROBE_PORT)], path.join(ROOT, 'backend')]

const desk = spawn(cmd, args, {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
})

// 万一 exe 目录本来就有实例（比如作者自己开着），退出的会是那个进程 ——
// 但下面只认 PROBE_PORT 上"基线里没有的"那一个，所以不会误判。
if (exeArg) console.log(`被测对象：打包产物 ${exeArg}\n`)
let deskLog = ''
desk.stdout.on('data', (d) => (deskLog += d))
desk.stderr.on('data', (d) => (deskLog += d))

async function findPort() {
  // 优先看我指定的那个端口 —— 那才是"我起的这个"最可靠的标志。
  // 但要确认它不在基线里（万一它早被别人占着，desktop.py 会顺延）。
  for (let i = 0; i < 60; i++) {
    const here = await peek(PROBE_PORT)
    if (here && here.desktop && !baseline.has(PROBE_PORT)) return PROBE_PORT
    await sleep(400)
  }
  return null
}

async function healthOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function sessionState(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/session/state`, {
      signal: AbortSignal.timeout(1000),
    })
    return await res.json()
  } catch {
    return null
  }
}

const port = await findPort()
if (!port) {
  console.error('没找到「我这次起的那一个」桌面版实例。')
  if (baseline.has(PROBE_PORT)) {
    console.error(
      `→ 探针专用端口 ${PROBE_PORT} 上**本来就有**实例（v${baseline.get(PROBE_PORT).version}），` +
        'desktop.py 会顺延到别的端口，探针无法确定哪个是自己起的。',
    )
    console.error(`   请先关掉占用 ${PROBE_PORT} 的实例再跑。`)
  }
  const now = []
  for (const p of BASELINE_PORTS) {
    const info = await peek(p)
    if (!info) continue
    const was = baseline.get(p)
    now.push(`  · :${p} → v${info.version}${was ? `（起进程前就在，v${was.version}）` : '（本次新出现但版本未变？）'}`)
  }
  if (now.length) {
    console.error('端口上当前的同族实例：')
    console.error(now.join('\n'))
    console.error('→ 如果它们都是"起进程前就在"，说明新实例没起来（或起了又退了）。')
  }
  console.error('启动日志尾部：')
  console.error(deskLog.slice(-1500))
  desk.kill()
  process.exit(1)
}
console.log(`桌面版已就绪：http://127.0.0.1:${port}/（本次新起的实例）\n`)

// ── 起 Chrome ────────────────────────────────────────────
// 调试端口用随机的：固定端口在 Windows 上可能连到上一次没杀干净的实例，
// 于是"探针跑通了"其实测的是上一轮的页面（本项目踩过这个坑）
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 600)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'bp-probe-desktop-profile')}`,
  'about:blank',
])

async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

let ws = null
let call = async () => {}

function cleanup() {
  try { ws?.close() } catch {}
  try { chrome.kill() } catch {}
  try { desk.kill() } catch {}
}

try {
  ws = new WebSocket(await pageSocket())
  await new Promise((r) => (ws.onopen = r))

  const pending = new Map()
  let seq = 0
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  }
  call = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++seq
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })

  await call('Page.enable')

  // ── 1) 打开页面 → 后端应登记到会话 ──────────────────────
  await call('Page.navigate', { url: `http://127.0.0.1:${port}/` })
  await sleep(3500)
  const s1 = await sessionState(port)
  check('打开页面后端登记到会话（前端 hello 发出）', (s1?.sessions || 0) >= 1, `sessions=${s1?.sessions ?? '-'}`)

  // ── 2) 刷新 → 进程必须还活着（★ 最危险的分支） ──────────
  await call('Page.reload', { ignoreCache: true })
  await sleep(4500)
  const aliveAfterReload = await healthOk(port)
  const s2 = await sessionState(port)
  check(
    '刷新页面后进程仍然活着（刷新 ≠ 关闭）',
    aliveAfterReload,
    aliveAfterReload ? `sessions=${s2?.sessions ?? '-'}` : '进程被误杀',
  )

  // ── 3) 离开页面 → 会话应归零（bye 真的发出去了） ────────
  await call('Page.navigate', { url: 'about:blank' })
  await sleep(2500)
  const s3 = await sessionState(port)
  const byeSent = s3 !== null && s3.sessions === 0
  check(
    '离开页面后 bye 送达、会话归零',
    byeSent,
    s3 === null ? '后端已退出（bye 后随即结束，同样算通过）' : `sessions=${s3.sessions}`,
  )

  // ── 4) 再等片刻 → 进程自己退出，端口关闭 ────────────────
  await sleep(9000)
  const stillUp = await healthOk(port)
  check('无页面后进程自动退出（端口关闭）', !stillUp, stillUp ? '仍在运行' : '已退出')
} catch (err) {
  check('探针执行未抛异常', false, String(err?.message || err))
} finally {
  cleanup()
}

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`桌面版关页即退探针：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
