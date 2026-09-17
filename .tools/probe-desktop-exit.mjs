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
const desk = spawn(PY, ['desktop.py', '--no-browser'], {
  cwd: path.join(ROOT, 'backend'),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let deskLog = ''
desk.stdout.on('data', (d) => (deskLog += d))
desk.stderr.on('data', (d) => (deskLog += d))

const CANDIDATE_PORTS = Array.from({ length: 20 }, (_, i) => 8765 + i)

async function findPort() {
  for (let i = 0; i < 60; i++) {
    for (const port of CANDIDATE_PORTS) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
          signal: AbortSignal.timeout(400),
        })
        if (!res.ok) continue
        const body = await res.json()
        if (String(body.app || '').includes('BluePencil') && body.desktop === true) return port
      } catch {
        /* 还没起来 */
      }
    }
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
  console.error('桌面版没起来，日志尾部：')
  console.error(deskLog.slice(-1500))
  desk.kill()
  process.exit(1)
}
console.log(`桌面版已就绪：http://127.0.0.1:${port}/\n`)

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
