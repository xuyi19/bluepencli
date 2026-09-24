// ──────────────────────────────────────────────────────────────
// 蓝笔申论 · 管理员端功能验证探针
//   node .tools/probe-admin-ui.mjs [--exe <路径>] [--tool "盘点题库"]
//
// 为什么需要它：管理员端过去只做过**启动冒烟**（进程活着就算过）——
// 而"按钮点了没反应"恰恰是启动正常、功能全废的那种失败（实测踩到：
// 事件通道权限没声明，子进程在跑但输出到不了界面，界面看着像卡住）。
// 所以这里必须验到**输出回显**与**状态回到就绪**，不能只看进程在不在。
//
// 做法：给 WebView2 开 CDP，点按钮 → 等输出 → 读 #console/#status 的真实文本。

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
const arg = (n) => {
  const i = argv.indexOf('--' + n)
  return i >= 0 ? argv[i + 1] : undefined
}

function findExe() {
  if (arg('exe')) return arg('exe')
  const dir = path.join(ROOT, 'admin/src-tauri/target/release')
  if (!existsSync(dir)) return null
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => path.join(dir, f))
    .find((p) => statSync(p).isFile())
}

const exe = findExe()
if (!exe) {
  console.error('✗ 找不到管理员端 exe（先 cd admin/src-tauri && cargo build --release）')
  process.exit(1)
}

const CDP_PORT = 9500 + Math.floor(Math.random() * 300)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 独立的 WebView2 数据目录：否则会复用残留实例的 browser process，
// 而**调试端口只在创建 browser process 那次生效** → 新实例的端口参数被忽略、
// CDP 连不上，看起来像"exe 起不来"（其实是连错了对象）。
const USER_DATA = path.join(os.tmpdir(), `bp-admin-probe-${Date.now()}`)

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: USER_DATA,
  },
  stdio: 'ignore',
  detached: false,
})

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

function cleanup(code) {
  try {
    child.kill('SIGKILL')
  } catch {}
  process.exit(code)
}

// 连 CDP
let wsUrl = ''
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page' && t.url && t.url !== 'about:blank')
    if (page?.webSocketDebuggerUrl) {
      wsUrl = page.webSocketDebuggerUrl
      break
    }
  } catch {}
  await sleep(500)
}
if (!wsUrl) {
  console.log('✗ CDP 连不上（窗口没起来？）')
  cleanup(1)
}

const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' :: ' + (exceptionDetails.exception?.description || ''))
  return result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await sleep(2500) // 等 Vue 渲染完成

console.log(`被测产物：${exe}\n`)

// ① 基础：仓库根探测 + 按钮渲染
const base = await evaluate(`(function(){
  const root = document.getElementById('root').value || '';
  const btns = [...document.querySelectorAll('button.run')].map(b => b.querySelector('span')?.textContent || b.textContent.trim());
  return { root, btns };
})()`)
ok('仓库根已探测', !!(base.root && base.root.length > 3), base.root)
ok('工具按钮已渲染', base.btns.length >= 10, `${base.btns.length} 个：${base.btns.slice(0, 4).join(' / ')}…`)

// ② 功能：点一个工具（默认盘点题库，1 秒内应出结果）
const toolName = arg('tool') || '盘点题库'
// 可选：先把「卷 id」填上再点（PDF 提取用它圈定范围，留空=全量跑很久）
if (arg('exam-id')) {
  await evaluate(
    `(function(){ const el = document.getElementById('exam-ids'); el.value = ${JSON.stringify(arg('exam-id'))}; return el.value })()`
  )
}
const clicked = await evaluate(`(function(){
  gotOutput = false;
  const btn = [...document.querySelectorAll('button.run')].find(b => (b.querySelector('span')?.textContent || '').includes(${JSON.stringify(toolName)}));
  if (!btn) return 'no-btn';
  btn.click(); return 'clicked';
})()`)
ok(`点「${toolName}」`, clicked === 'clicked', clicked)

// ③ 等输出回显（最多 25 秒）
let consoleText = ''
let statusText = ''
for (let i = 0; i < 25; i++) {
  await sleep(1000)
  const st = await evaluate(`(function(){
    return { c: document.getElementById('console').innerText, s: document.getElementById('status').innerText };
  })()`)
  consoleText = st.c
  statusText = st.s
  if (/✓ 完成（exit 0）|✗ 失败/.test(consoleText)) break
}

ok('输出有回显（不是"点了没反应"）', consoleText.length > 40 && !/^（等待操作）/.test(consoleText.trim()), `${consoleText.length} 字`)
ok('命令跑到了完成', /✓ 完成（exit 0）/.test(consoleText), statusText)
ok('状态回到就绪', /就绪/.test(statusText), statusText)
// 内容级判据（不是"有字就行"）：换工具时用 --expect 指定关键词
const expectRe = arg('expect') ? new RegExp(arg('expect')) : /公开卷源|私有卷源|分发包/
ok('输出是真实业务内容', expectRe.test(consoleText))
ok('没有输出通道错误', !/输出通道注册失败/.test(consoleText))

// ④ python 解析：必须解析到**仓库内 venv**，不是 PATH 上随便一个解释器
// （旧版传相对路径 backend/.venv/Scripts/python.exe → Windows 按父进程 CWD 解析 →
//   os error 3；PATH 第一条又是别的工具带的 python，管线依赖根本没装）
let pyText = ''
const invoked = await evaluate(`(async function(){
  const root = document.getElementById('root').value;
  document.getElementById('console').textContent = '';
  gotOutput = false;
  try {
    await window.__TAURI__.core.invoke('run_tool', {
      root, program: 'python',
      args: ['-c', 'import sys; print("PYEXE=" + sys.executable)'],
      envs: {}
    });
    return 'invoked';
  } catch (e) { return 'invoke-fail: ' + e }
})()`)
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  pyText = await evaluate(`document.getElementById('console').innerText`)
  if (/PYEXE=|启动失败|✗ 失败|✓ 完成/.test(pyText)) break
}
ok('python 命令能启动（不再 os error 3）', invoked === 'invoked' && !/启动失败/.test(pyText), pyText.split('\n')[0])
ok(
  'python 解析到仓库 venv（不是 PATH 上那个）',
  /PYEXE=[^\n]*[\\/]backend[\\/]\.venv[\\/]/.test(pyText),
  (pyText.match(/PYEXE=\S+/) || [''])[0]
)

// ⑤ GUI 子系统：console 子系统编译的 exe 每次运行都会弹一个黑窗（用户明确不要）
function peSubsystem(file) {
  const buf = Buffer.alloc(1024)
  const fd = openSync(file, 'r')
  readSync(fd, buf, 0, 1024, 0)
  closeSync(fd)
  if (buf.toString('ascii', 0, 2) !== 'MZ') return -1
  const lf = buf.readUInt32LE(0x3c)
  if (buf.toString('ascii', lf, lf + 4) !== 'PE\0\0') return -1
  return buf.readUInt16LE(lf + 24 + 68) // Optional Header +68 = Subsystem
}
const sub = peSubsystem(exe)
ok('exe 是 GUI 子系统（不弹控制台窗口）', sub === 2, `Subsystem=${sub}（2=GUI / 3=Console）`)

// ⑥ 源码级护栏：spawn 前必须过 quiet()（漏一行就每跑一步闪一次黑窗）
const rsSrc = readFileSync(path.join(ROOT, 'admin/src-tauri/src/main.rs'), 'utf8')
ok(
  '启动子进程前有静默标志',
  /quiet\(&mut cmd\)/.test(rsSrc) && /CREATE_NO_WINDOW/.test(rsSrc)
)

// 截图：界面改动光靠文字断言不够，留一张图人工复核布局
if (arg('shot')) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(arg('shot'), Buffer.from(data, 'base64'))
  console.log(`\n截图：${arg('shot')}`)
}

// ⑦ 长输出压力测试：灌 3000 行后，输出区必须还锁在设定高度、工具区必须还可见
// （曾因 flex item 缺 min-height:0，长输出把 220px 的输出区撑爆、工具区被挤到 0）
if (arg('flood')) {
  const m = await evaluate(`(function(){
    const c = document.getElementById('console');
    const lines = [];
    for (let i = 1; i <= 3000; i++) lines.push('第 ' + i + ' 行：模拟一键回归测试的长输出内容，足够长足够长足够长足够长足够长');
    c.textContent = lines.join('\\n');
    const r = (el) => el.getBoundingClientRect().height;
    return {
      wrapH: r(document.querySelector('.console-wrap')),
      mainH: r(document.querySelector('main')),
      bodyH: r(document.body),
    };
  })()`)
  ok('长输出不撑爆输出区', m.wrapH < 240, `输出区 ${Math.round(m.wrapH)}px（设定 220）`)
  ok('长输出不挤没工具区', m.mainH > 150, `工具区 ${Math.round(m.mainH)}px`)
}

console.log(`\n② 控制台尾部：\n${consoleText.split('\n').slice(-5).join('\n')}`)
console.log(`\n④ python 解析：${(pyText.match(/PYEXE=\S+/) || ['(无)'])[0]}`)
console.log(`\n管理员端功能探针：${pass} passed, ${fail} failed`)
cleanup(fail ? 1 : 0)
