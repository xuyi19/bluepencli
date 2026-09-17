// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 「把题库包拖进窗口就导入」的真浏览器验证。
//
// 为什么拖拽必须真浏览器验：
//   拖拽是一串**浏览器原生事件**（dragenter/over/leave/drop），拿不到自己写的
//   单元测试里。合成事件跟真实拖拽的差别恰恰在最容易写错的地方 ——
//   dragenter 会随鼠标划过每个子元素反复触发，纯逻辑测试根本模拟不出这种"重复"。
//   所以这里在真实 Chrome 里合成 DragEvent（带 DataTransfer），走完整条链路。
//
// 覆盖：
//   1. 拖文件进来 → 出现提示层
//   2. 提示层不吃点击（pointer-events: none），否则挡住底下的按钮
//   3. 划过子元素 → 提示层不闪（进出计数正确，这是最容易写错的一条）
//   4. 拖纯文本（DataTransfer 里没有 Files）→ 不弹提示层
//   5. 松手 .bpq → 真的走完导入链路（加密包会弹出口令框）
//   6. 松手不支持的类型 → 什么都不发生，且提示层归位
//
// 用法：node .tools/probe-pack-drop.mjs

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { encryptPayload, keyIdOf, signText, signingText, toB64 } from '../frontend/src/bpq/crypto.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const FRONTEND = path.join(ROOT, 'frontend')
const VITE_PORT = 5273
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
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

async function serverUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${VITE_PORT}/`, { signal: AbortSignal.timeout(800) })
    return res.ok
  } catch {
    return false
  }
}

let vite = null
if (!(await serverUp())) {
  const viteBin = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    console.error('找不到 vite，先在 frontend/ 执行 npm install')
    process.exit(1)
  }
  vite = spawn(process.execPath, [viteBin], { cwd: FRONTEND, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    if (await serverUp()) break
    await sleep(500)
  }
  if (!(await serverUp())) {
    console.error('dev server 没起来（端口 ' + VITE_PORT + ' 可能被占）')
    vite?.kill()
    process.exit(1)
  }
  console.log(`dev server 已就绪：http://127.0.0.1:${VITE_PORT}/\n`)
} else {
  console.log(`复用已在运行的 dev server：http://127.0.0.1:${VITE_PORT}/\n`)
}

// ── 造一个真的加密包当"拖进来那份文件" ────────────────────
// 这里只需要它是 `sealed: true`（能触发问口令那一步），
// 所以用临时密钥签就行 —— 验签通不过是后面的事，不影响"拖拽有没有接住"这件事。
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const privateB64 = toB64(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
const publicB64 = toB64(await crypto.subtle.exportKey('spki', kp.publicKey))

const sealedText = await (async () => {
  const cryptoSection = await encryptPayload({
    exams: [{
      id: 'drop-demo', year: 2024, paper: '副省级', title: '拖拽演示卷',
      material: '材料1\n某市推进数字乡村建设……',
      questions: [{ no: 1, type: '归纳概括', stem: '请概括主要做法。', requirement: '全面准确', score: 15, wordLimit: 250, reference: '一是……' }],
    }],
  }, '拖拽探针口令')
  const out = {
    format: 'bluepencil-bpq', magic: 'BPQ00002', version: 2,
    issuer: '许一 <xuconghui_03@qq.com>', issuedAt: '2026-09-17T10:00:00+08:00',
    license: '仅供个人学习', userFingerprint: '拖拽探针', tier: 'private',
    yearRange: [2024, 2024], examCount: 1, questionCount: 1,
    crypto: cryptoSection,
  }
  out.sig = {
    algo: 'ECDSA-P256-SHA256',
    keyId: await keyIdOf(publicB64),
    value: await signText(signingText(out), privateB64),
  }
  return JSON.stringify(out)
})()

// ── 起浏览器 ─────────────────────────────────────────────
const DEBUG_PORT = 9900 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'bp-probe-drop-profile')}`,
  'about:blank',
])

let ws = null
const cleanup = () => {
  try { ws?.close() } catch {}
  try { chrome.kill() } catch {}
  try { vite?.kill() } catch {}
}

try {
  let wsUrl = null
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl || null
    } catch { /* 还没起来 */ }
    if (!wsUrl) await sleep(250)
  }
  if (!wsUrl) throw new Error('CDP 连不上')

  ws = new WebSocket(wsUrl)
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
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await call('Page.enable')
  await call('Runtime.enable')
  // hash 路由：直接进题库页，拖拽监听挂在这个页面上
  await call('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/#/questions` })
  await sleep(3500)

  /** 在页面里执行一段表达式并取值 */
  async function evalInPage(expr) {
    const { result, exceptionDetails } = await call('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || '页面里执行出错')
    return result.value
  }

  // 页面里常驻的拖拽工具：合成带 DataTransfer 的原生拖拽事件
  await evalInPage(`(() => {
    window.__drop = {
      dt(name, content, type) {
        const d = new DataTransfer()
        d.items.add(new File([content], name, { type: type || 'application/octet-stream' }))
        return d
      },
      // 纯文本拖拽：DataTransfer 里没有 'Files'，不该被当成文件拖拽
      textDt() {
        const d = new DataTransfer()
        d.setData('text/plain', '一段被选中的文字')
        return d
      },
      fire(target, type, dt) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
      },
      // Vue 的 DOM 更新是异步的（微任务里 flush），派发完事件必须让它渲染完再查 DOM，
      // 否则查到的永远是「上一帧」的状态 —— 这不是产品问题，是查得太早。
      settle() {
        return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)))
      },
      overlay() {
        return [...document.querySelectorAll('div')].some((el) =>
          el.textContent?.trim() === '松手即可导入题库包')
      },
      overlayPe() {
        const el = [...document.querySelectorAll('div')].find((x) =>
          x.textContent?.trim() === '松手即可导入题库包')
        if (!el) return null
        // 提示层本体是它的父节点（fixed inset-0 那一层）
        return getComputedStyle(el.parentElement).pointerEvents
      },
      passwordShown() {
        return !!document.querySelector('input[type=password]')
      },
      hasPromptText() {
        return document.body.innerText.includes('这份题库包是加密的')
      },
      cancelPrompt() {
        return import('/src/utils/toast.js').then((t) => t.resolvePrompt(''))
      },
    }
    return true
  })()`)

  const BPQ = '演示包.bpq'

  // 1 + 2：拖文件进来 → 提示层出现，且不吃点击
  const entering = await evalInPage(`(async () => {
    window.__drop.fire(window, 'dragenter', window.__drop.dt(${JSON.stringify(BPQ)}, 'x'))
    await window.__drop.settle()
    const shown = window.__drop.overlay()
    const pe = window.__drop.overlayPe()
    window.__drop.fire(window, 'dragleave', window.__drop.dt(${JSON.stringify(BPQ)}, 'x'))
    await window.__drop.settle()
    return { shown, pe, afterLeave: window.__drop.overlay() }
  })()`)
  check('拖文件进窗口 → 出现提示层', entering.shown === true)
  check('提示层不吃点击（pointer-events: none）', entering.pe === 'none', `实际 ${entering.pe}`)
  check('真的离开窗口后提示层消失', entering.afterLeave === false)

  // 3：划过子元素不应闪掉（dragenter/dragleave 成对计数）
  // 这是最容易写错的一条：dragenter 会随鼠标划过每个子元素反复触发，
  // 用布尔值会在划过瞬间闪成"没在拖"。分四步各自断言，能定位到具体哪一步错。
  const across = await evalInPage(`(async () => {
    const child = document.querySelector('main') || document.body.firstElementChild
    const dt = window.__drop.dt('路过.bpq', 'x')
    const out = {}
    window.__drop.fire(window, 'dragenter', dt)
    await window.__drop.settle()
    out.enterWindow = window.__drop.overlay()
    window.__drop.fire(child, 'dragenter', dt)      // 划进子元素（冒泡上来再 +1）
    await window.__drop.settle()
    out.enterChild = window.__drop.overlay()
    window.__drop.fire(child, 'dragleave', dt)      // 划出子元素（-1，还剩 1）
    await window.__drop.settle()
    out.leaveChild = window.__drop.overlay()
    window.__drop.fire(window, 'dragleave', dt)     // 真离开窗口
    await window.__drop.settle()
    out.leaveWindow = window.__drop.overlay()
    return out
  })()`)
  check('划过子元素时提示层不闪（进出计数正确）',
    across.enterWindow === true && across.enterChild === true && across.leaveChild === true,
    JSON.stringify(across))
  check('划过子元素又离开后，才真的收起提示层', across.leaveWindow === false)

  // 4：纯文本拖拽不该被当成文件
  const textDrag = await evalInPage(`(async () => {
    window.__drop.fire(window, 'dragenter', window.__drop.textDt())
    await window.__drop.settle()
    const shown = window.__drop.overlay()
    window.__drop.fire(window, 'dragleave', window.__drop.textDt())
    await window.__drop.settle()
    return { shown, afterLeave: window.__drop.overlay() }
  })()`)
  check('拖纯文本 → 不弹提示层（只认 Files）', textDrag.shown === false)
  check('纯文本拖拽不会留下残留提示层', textDrag.afterLeave === false)

  // 5：松手 .bpq → 走完导入链路（加密包弹口令框）
  const dropped = await evalInPage(`(async () => {
    const dt = window.__drop.dt(${JSON.stringify(BPQ)}, ${JSON.stringify(sealedText)})
    window.__drop.fire(window, 'dragenter', dt)
    window.__drop.fire(window, 'drop', dt)
    // 读文件 + 解析 + 弹框都是异步的，等一拍
    await new Promise((r) => setTimeout(r, 1200))
    const res = {
      prompt: window.__drop.passwordShown(),
      text: window.__drop.hasPromptText(),
      overlay: window.__drop.overlay(),
    }
    await window.__drop.cancelPrompt()
    await new Promise((r) => setTimeout(r, 200))
    return res
  })()`)
  check('松手 .bpq → 真的接住了并弹出遮字口令框', dropped.prompt === true)
  check('弹的是「加密包要口令」那一步（说明走的是真导入链路）', dropped.text === true)
  check('松手后提示层立即归位', dropped.overlay === false)

  // 6：不支持的类型 → 什么都不发生
  const rejected = await evalInPage(`(async () => {
    const dt = window.__drop.dt('随手一拖.txt', '这不是题库包')
    window.__drop.fire(window, 'dragenter', dt)
    window.__drop.fire(window, 'drop', dt)
    await new Promise((r) => setTimeout(r, 900))
    return { prompt: window.__drop.passwordShown(), overlay: window.__drop.overlay() }
  })()`)
  check('松手不支持的类型 → 不弹口令框、无副作用', rejected.prompt === false)
  check('被拒的拖拽同样会让提示层归位', rejected.overlay === false)
} catch (err) {
  check('探针执行未抛异常', false, String(err?.message || err))
} finally {
  cleanup()
}

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`题库包拖拽导入探针：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
