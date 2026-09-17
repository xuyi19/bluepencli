// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包加密签名的**跨运行时**验证：作者在 Node 里封装 → 用户在浏览器里打开。
//
// 为什么单靠 Node 侧测试不够：作者打包和用户打开，跑在**两个不同的 JS 运行时**里。
// 加密、PBKDF2、ECDSA 都由 WebCrypto 提供，标准是统一的，但实现各有版本差异；
// 一旦某一边算出来不一致，症状就是"用户那边打不开"，而作者自测一切正常 ——
// 这是最坏的失败模式（发出去的包用不了，还得挨个解释）。
// 所以这里真起一个浏览器，让它去解 Node 加出来的密。
//
// 覆盖：
//   1. Node 加密+签名 → 浏览器解密+验签，内容一致（真·跨运行时）
//   2. 浏览器里错口令同样打不开（且提示是口令问题）
//   3. 密文被改 → 浏览器验签拦截
//   4. 不是内置公钥签的包 → 浏览器拒绝（冒充不了作者）
//   5. 页面上真能弹出「输入口令」的框（UI 接线没断）
//
// 用法：node .tools/probe-bpq-browser.mjs
// 说明：需要 frontend 依赖已安装；dev server 没起就自己起（跑完会关掉）。

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

// ── dev server：已在跑就用现成的，否则自己起 ──────────────────
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

// ── 临时密钥 + 一份小包（只 1 套 1 题，内容要内联进页面表达式，别太大） ──
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const privateB64 = toB64(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
const publicB64 = toB64(await crypto.subtle.exportKey('spki', kp.publicKey))
const strangerKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const strangerPrivate = toB64(await crypto.subtle.exportKey('pkcs8', strangerKp.privateKey))

const STEM = '请概括数字乡村建设的主要做法。'
const PASSPHRASE = '跨运行时验证口令'

async function seal(passphrase, privateKey) {
  const cryptoSection = await encryptPayload({
    exams: [{
      id: 'demo-1', year: 2024, paper: '副省级', title: '演示卷',
      material: '材料1\n某市推进数字乡村建设，完善基础设施……',
      questions: [{ no: 1, type: '归纳概括', stem: STEM, requirement: '全面准确', score: 15, wordLimit: 250, reference: '一是……' }],
    }],
  }, passphrase)
  const out = {
    format: 'bluepencil-bpq', magic: 'BPQ00002', version: 2,
    issuer: '许一 <xuconghui_03@qq.com>', issuedAt: '2026-09-17T10:00:00+08:00',
    license: '仅供个人学习', userFingerprint: '跨运行时探针', tier: 'private',
    yearRange: [2024, 2024], examCount: 1, questionCount: 1,
    crypto: cryptoSection,
  }
  out.sig = {
    algo: 'ECDSA-P256-SHA256',
    keyId: await keyIdOf(publicB64),
    value: await signText(signingText(out), privateKey),
  }
  return JSON.stringify(out)
}

const sealed = await seal(PASSPHRASE, privateB64)
const forged = await seal(PASSPHRASE, strangerPrivate)

// ── 起浏览器 ─────────────────────────────────────────────
const DEBUG_PORT = 9500 + Math.floor(Math.random() * 400)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'bp-probe-bpq-profile')}`,
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
  // 先加载页面，拿到同源上下文，才能 import 到 vite 转译后的模块
  await call('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/` })
  await sleep(3500)

  /** 在页面里调 openSealedPack */
  async function openInBrowser(text, passphrase, keys) {
    const expr = `(async () => {
      const m = await import('/src/bpq/importer.js')
      const r = await m.openSealedPack(${JSON.stringify(text)}, ${JSON.stringify(passphrase)},
        { publicKeys: ${JSON.stringify(keys)} })
      return JSON.stringify({
        ok: r.ok,
        errors: r.errors || [],
        exams: r.pack ? r.pack.exams.length : 0,
        stem: r.pack?.exams?.[0]?.questions?.[0]?.stem || '',
        material: r.pack?.exams?.[0]?.material || '',
      })
    })()`
    const { result, exceptionDetails } = await call('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面里执行出错')
    return JSON.parse(result.value)
  }

  const ok = await openInBrowser(sealed, PASSPHRASE, [publicB64])
  check('Node 加密的包，浏览器能验签并通过', ok.ok, ok.ok ? '' : ok.errors.join('；'))
  check('浏览器解出的题目内容与 Node 侧一致', ok.stem === STEM, ok.stem)
  check('浏览器侧也真的解出了材料（不是空壳）', ok.material.includes('数字乡村建设'))

  const wrong = await openInBrowser(sealed, '错误口令', [publicB64])
  check('浏览器里口令错 → 报口令问题', !wrong.ok && wrong.errors.join('').includes('口令'), wrong.errors.join('；'))

  const tampered = JSON.parse(sealed)
  tampered.crypto.ciphertext = tampered.crypto.ciphertext.slice(0, -4) + 'AAAA'
  const tamperRes = await openInBrowser(JSON.stringify(tampered), PASSPHRASE, [publicB64])
  check('浏览器里密文被改 → 验签拦截', !tamperRes.ok && tamperRes.errors.join('').includes('签名'), tamperRes.errors.join('；'))

  const forgedRes = await openInBrowser(forged, PASSPHRASE, [publicB64])
  check('别人私钥签的包 → 浏览器拒绝（冒充不了作者）', !forgedRes.ok, forgedRes.errors.join('；'))

  // UI 接线：口令框真的能弹出来、并且会 resolve
  const uiExpr = `(async () => {
    const t = await import('/src/utils/toast.js')
    const p = t.toast.askPassword('测试一下口令框', { placeholder: '口令' })
    await new Promise((r) => setTimeout(r, 300))
    const shown = !!(t.toastState.prompt && document.querySelector('input[type=password]'))
    t.resolvePrompt('假装输入的口令')
    const got = await p
    return JSON.stringify({ shown, got })
  })()`
  const { result: uiRes, exceptionDetails: uiErr } = await call('Runtime.evaluate', {
    expression: uiExpr, awaitPromise: true, returnByValue: true,
  })
  if (uiErr) throw new Error(uiErr.text || '口令框测试出错')
  const ui = JSON.parse(uiRes.value)
  check('导入时会弹出遮字口令输入框，且能拿到输入值', ui.shown && ui.got === '假装输入的口令', JSON.stringify(ui))
} catch (err) {
  check('探针执行未抛异常', false, String(err?.message || err))
} finally {
  cleanup()
}

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`题库包跨运行时探针：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
