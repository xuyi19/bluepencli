// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// E3 性能实测 · 产物浏览器探针（规划文档验收线：题库按需加载 ≤ 500ms）
//
// 测什么：
//   ① 首屏可交互：导航开始 → #app 渲染出可见文字（用户可感知的加载）
//   ② 真题分片懒加载：页面内 import() 一个真题 chunk（fetch + 解析 + 执行），
//      每个分片是自包含 ES 模块，测 3 个不同分片取最大值
//   ③ 产物体积：dist 总量 / 主 chunk / 真题分片（fs 直读，不经浏览器）
//
// 怎么防假绿：
//   - 显式独立端口 4180（strictPort），起服务前先确认端口空闲
//   - 分片 URL 从 dist/assets 目录实拍取得，不靠记忆拼名字
//   - import() 结果校验返回了真卷（id/title/material 非空），不是 404 页
//
// 用法：node .tools/probe-perf.mjs

const { spawn } = await import('node:child_process')
const { readdirSync, statSync } = await import('node:fs')
const path = await import('node:path')
const { fileURLToPath } = await import('node:url')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'frontend', 'dist')
const PORT = 4180
const BASE = `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 起服务前确认端口空闲（基线检查） ----------
let portBusy = false
try { await fetch(BASE); portBusy = true } catch { /* 空闲才对 */ }
if (portBusy) { console.error('✗ 端口 4180 已被占用（先清掉旧实例再跑）'); process.exit(1) }

// ---------- 起 vite preview（必须 cwd=frontend，产物在 dist/） ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: path.join(ROOT, 'frontend'),
  shell: true,
  stdio: 'ignore',
})

// ---------- 挑 3 个真题分片（目录实拍） ----------
const allAssets = readdirSync(path.join(DIST, 'assets'))
const examChunks = allAssets.filter((f) => /^exam-20\d{2}.*\.js$/.test(f)).sort()
if (examChunks.length < 3) { console.error('✗ dist/assets 里真题分片不足 3 个，产物不对'); preview.kill(); process.exit(1) }
// 取大中小各一个，避免只测小分片的偏乐观
const pickIdx = [0, Math.floor(examChunks.length / 2), examChunks.length - 1]
  .map((i) => examChunks[i])

// ---------- 起 headless Chrome ----------
const { existsSync } = await import('node:fs')
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))
const CDP = 9520 + Math.floor(Math.random() * 300)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-perf-' + Date.now(),
  '--window-size=1280,1000', 'about:blank',
])

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
}

try {
  // 等 CDP
  let wsUrl = null
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch { await sleep(250) }
  }
  if (!wsUrl) throw new Error('CDP 连不上')
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  }
  const send = (method, params = {}) =>
    new Promise((r) => { const myId = ++id; pending.set(myId, r); ws.send(JSON.stringify({ id: myId, method, params })) })
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result?.subtype === 'error') throw new Error(result.description)
    return result?.value
  }
  await send('Page.enable')

  // 等 preview 服务就绪
  let served = false
  for (let i = 0; i < 60 && !served; i++) {
    try { const r = await fetch(BASE); if (r.ok) served = true } catch { await sleep(250) }
  }
  if (!served) throw new Error('preview 服务没起来')

  // ---------- ① 首屏加载 ----------
  const t0 = Date.now()
  await send('Page.navigate', { url: `${BASE}/#/practice` })
  let firstContentMs = -1
  for (let i = 0; i < 100; i++) {
    const v = await evaluate(`(document.querySelector('#app')?.innerText || '').length`)
    if (v > 100) { firstContentMs = Date.now() - t0; break }
    await sleep(50)
  }
  check('① 首屏渲染出可见内容', firstContentMs > 0, `${firstContentMs}ms`)
  const netInfo = await evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const domContentLoaded = nav ? nav.domContentLoadedEventEnd : -1
    return { dcl: Math.round(domContentLoaded), transferSize: [...performance.getEntriesByType('resource')].reduce((s,e)=>s+(e.transferSize||0),0) }
  })()`)
  check('① DOMContentLoaded 正常返回', netInfo.dcl >= 0, `${netInfo.dcl}ms ｜ 资源传输 ${(netInfo.transferSize/1024).toFixed(0)}KB`)

  // ---------- ② 真题分片懒加载 ----------
  const results = []
  for (const f of pickIdx) {
    const ms = await evaluate(`(async () => {
      const t0 = performance.now()
      const m = await import('/assets/${f}')
      const dt = performance.now() - t0
      const paper = m.default || m
      return { ms: Math.round(dt * 10) / 10, id: paper.id, materialChars: (paper.material || '').length }
    })()`)
    const ok = ms.ms >= 0 && ms.id && ms.materialChars > 500
    check(`② 懒加载 ${f.split('-').slice(0, 2).join('-')}（真卷校验）`, ok,
      `${ms.ms}ms ｜ 材料 ${ms.materialChars} 字`)
    results.push(ms)
  }
  const worstLazy = Math.max(...results.map((r) => r.ms))
  check('② 题库按需加载 ≤ 500ms（验收线）', worstLazy <= 500, `最差 ${worstLazy}ms`)

  // ---------- ③ 产物体积 ----------
  const du = (p) => {
    let s = 0
    for (const f of readdirSync(p)) { const st = statSync(path.join(p, f)); s += st.isDirectory() ? du(path.join(p, f)) : st.size }
    return s
  }
  const totalMB = du(DIST) / 1024 / 1024
  const indexChunk = allAssets.find((f) => /^index-.*\.js$/.test(f))
  const idxMB = statSync(path.join(DIST, 'assets', indexChunk)).size / 1024 / 1024
  console.log(`\n③ 产物体积：dist 总计 ${totalMB.toFixed(2)} MB ｜ 主 chunk ${idxMB.toFixed(2)} MB（gzip 前）｜ 真题分片 40 个`)
} finally {
  chrome.kill()
  preview.kill()
}

console.log(failures ? `\n${failures} 项不通过` : '\n全部通过')
process.exit(failures ? 1 : 0)
