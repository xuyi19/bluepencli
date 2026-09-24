// ──────────────────────────────────────────────────────────────
// 探针：导入过程逐条回显 + 「我的题库」批次管理（真实浏览器 + 真实 IndexedDB）
//
// 为什么必须真跑：这两件事的现象全在「点了之后」——
//   回显面板要等导入完成才成形、批次列表要等 IndexedDB 写完才读得到、
//   删除要经过二次确认弹窗。源码断言只能证明"代码写了"，证明不了"界面真的这样"。
//
// 用法（先起 dev server）：
//   node .tools/probe-import-ui.mjs [--shot .shots/import-ui.png]
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : ''
}
const URL_ = arg('url') || 'http://127.0.0.1:5273/#/questions'
const SHOT = arg('shot')
const PORT = 9371

// ── 造一个合法的明文包（checksum 必须对，否则会被"校验和不匹配"挡下）──
const { packChecksum } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/bpq/importer.js')).href)
const pack = {
  format: 'bluepencil-bpq',
  magic: 'BPQ00001',
  version: 1,
  issuer: '探针签发',
  issuedAt: '2026-09-24',
  license: '仅用于自动化验证，不是真卷',
  userFingerprint: 'probe@local',
  tier: 'private',
  yearRange: '2024',
  exams: [
    {
      id: 'probe-2024-jia',
      year: 2024,
      paper: '甲级',
      title: '探针测试卷（不是真卷）',
      material: '【材料一】这是探针构造的材料，仅用于验证导入链路是否把材料与参考答案一起入库。'.repeat(6),
      questions: [
        {
          no: 1,
          stem: '请概括探针材料的主要做法。',
          type: '归纳概括',
          score: 20,
          wordLimit: 200,
          requirement: '全面准确，不超过 200 字',
          reference: '探针参考答案：一是……二是……',
        },
        {
          no: 2,
          stem: '请就探针材料提出对策建议。',
          type: '提出对策',
          score: 25,
          wordLimit: 300,
          requirement: '条理清晰，不超过 300 字',
          reference: '探针参考答案二。',
        },
      ],
    },
  ],
}
pack.checksum = packChecksum(pack)
const packJson = JSON.stringify(pack)

// ── CDP 骨架（与 probe-interact.mjs 同源）──
const { spawn } = await import('node:child_process')
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome/Edge')
  process.exit(1)
}

const proc = spawn(CHROME, [
  '--headless=new',
  '--no-proxy-server',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-import-' + Date.now(),
  '--window-size=1440,1000',
  'about:blank',
])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

const ws = new WebSocket(await getWs())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}

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

const cleanup = (code) => {
  try {
    ws.close()
  } catch {}
  try {
    proc.kill()
  } catch {}
  process.exit(code)
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_ })
  await sleep(9000)

  console.log('\n① 拖入一个合法明文包 → 看回显')
  const r1 = await evaluate(`(async function(){
    const PACK = ${JSON.stringify(packJson)};
    const dt = new DataTransfer();
    dt.items.add(new File([PACK], 'probe-private.bpq', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(function(r){ setTimeout(r, 2600); });
    const panel = Array.prototype.find.call(document.querySelectorAll('div'), function(d){
      return d.textContent.indexOf('读取文件') >= 0 && d.textContent.indexOf('导入题库包') >= 0;
    });
    const btn = document.getElementById('btn-my-lib');
    return {
      panel: panel ? panel.innerText.replace(/\\n+/g, ' | ') : 'MISSING',
      libBtn: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : 'MISSING',
    };
  })()`)

  ok('回显面板出现', r1.panel !== 'MISSING')
  if (r1.panel !== 'MISSING') console.log(`      面板内容：${r1.panel.slice(0, 260)}`)
  ok('回显含「读取文件」', /读取文件/.test(r1.panel))
  ok('回显含「格式与校验和」', /格式与校验和/.test(r1.panel))
  ok('回显含「水印」并报出指纹', /水印/.test(r1.panel) && /probe@local/.test(r1.panel))
  ok('回显含「写入题库」且报出题数', /写入题库/.test(r1.panel) && /2 题/.test(r1.panel))
  ok('回显含「完成」', /完成/.test(r1.panel))
  ok('我的题库按钮计数为 1', /1/.test(r1.libBtn), r1.libBtn)

  // 这一条是补上来的：第一版把 mine 过滤掉了导入题，导入的私有卷从题库列表里消失
  // （"按来源·私有"恒为 0），而当时的护栏全绿。用户看得见什么，才该被断言。
  const r1b = await evaluate(`(function(){
    const chips = Array.prototype.filter.call(document.querySelectorAll('button'), function(b){
      return /^私有/.test(b.textContent.trim());
    });
    return chips.length ? chips[0].textContent.replace(/\\s+/g, ' ').trim() : 'MISSING';
  })()`)
  ok('导入的题进入题库列表（按来源「私有」计数 ≥ 1）', /私有\s*[1-9]/.test(r1b), r1b)

  console.log('\n② 打开「我的题库」→ 批次卡')
  const r2 = await evaluate(`(async function(){
    document.getElementById('btn-my-lib').click();
    await new Promise(function(r){ setTimeout(r, 800); });
    const t = document.body.innerText;
    return {
      hasBatch: t.indexOf('1 套 / 2 题') >= 0,
      hasStamp: t.indexOf('probe@local') >= 0,
      hasIssuer: t.indexOf('探针签发') >= 0,
      hasTime: /导入于\\s*\\d{4}-\\d{2}-\\d{2}/.test(t),
      hasExams: t.indexOf('2024 甲级') >= 0,
      hasDel: Array.prototype.some.call(document.querySelectorAll('button'), function(b){ return b.textContent.trim() === '删除整批'; }),
    };
  })()`)
  ok('批次卡显示「1 套 / 2 题」', r2.hasBatch)
  ok('批次卡显示水印', r2.hasStamp)
  ok('批次卡显示签发者', r2.hasIssuer)
  ok('批次卡显示导入时间', r2.hasTime)
  ok('批次卡列出卷（2024 甲级）', r2.hasExams)
  ok('有「删除整批」按钮', r2.hasDel)

  if (SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot?.data) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path.resolve(ROOT, SHOT), Buffer.from(shot.data, 'base64'))
      console.log(`\n截图：${SHOT}`)
    }
  }

  console.log('\n③ 删除整批（要过二次确认）')
  const r3 = await evaluate(`(async function(){
    const pick = function(){ return Array.prototype.filter.call(document.querySelectorAll('button'), function(b){ return b.textContent.trim() === '删除整批'; }); };
    const first = pick()[0];
    if (!first) return { stage: 'no-button' };
    first.click();
    await new Promise(function(r){ setTimeout(r, 700); });
    const inModal = pick().length >= 2;       // 弹窗里的确认按钮也是同一文案
    const all = pick();
    if (!inModal) return { stage: 'no-confirm', inModal: false };
    all[all.length - 1].click();
    await new Promise(function(r){ setTimeout(r, 1500); });
    const t = document.body.innerText;
    return {
      stage: 'done',
      inModal: true,
      emptied: t.indexOf('还没有导入过题库包') >= 0,
      counted: /已删除\\s*2\\s*道题/.test(t) || t.indexOf('已删除 2 道题') >= 0,
    };
  })()`)
  ok('删除前弹出二次确认', r3.inModal === true, `stage=${r3.stage}`)
  ok('确认后批次清空', r3.emptied === true)
  ok('提示里报出实际删除题数', r3.counted === true)

  console.log('\n④ 库里题目也真的删掉了（按批次反查）')
  const r4 = await evaluate(`(async function(){
    const req = indexedDB.open('bluepencil');
    const db = await new Promise(function(res){ req.onsuccess = function(){ res(req.result); }; });
    const q = db.transaction('questions','readonly').objectStore('questions').getAll();
    const rows = await new Promise(function(res){ q.onsuccess = function(){ res(q.result); }; });
    const im = db.transaction('imports','readonly').objectStore('imports').getAll();
    const batches = await new Promise(function(res){ im.onsuccess = function(){ res(im.result); }; });
    return {
      bpqLeft: rows.filter(function(r){ return r._source === 'bpq'; }).length,
      batches: batches.length,
    };
  })()`)
  ok('导入的题已从 questions 表移除', r4.bpqLeft === 0, `剩余 ${r4.bpqLeft} 道`)
  ok('批次记录也已删除', r4.batches === 0, `剩余 ${r4.batches} 条`)

  console.log('\n⑤ 批量导入两个包（C3）')
  const pack2 = { ...pack, exams: [{ ...pack.exams[0], id: 'probe-2024-yi', paper: '乙级' }] }
  pack2.checksum = packChecksum(pack2)
  const r5 = await evaluate(`(async function(){
    const P1 = ${JSON.stringify(packJson)};
    const P2 = ${JSON.stringify(JSON.stringify(pack2))};
    const dt = new DataTransfer();
    dt.items.add(new File([P1], 'batch-a.bpq', { type: 'application/json' }));
    dt.items.add(new File([P2], 'batch-b.bpq', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(function(r){ setTimeout(r, 4500); });
    const panel = Array.prototype.find.call(document.querySelectorAll('div'), function(d){
      return d.textContent.indexOf('批量导入结果') >= 0;
    });
    const btn = document.getElementById('btn-my-lib');
    return {
      panel: panel ? panel.innerText.replace(/\\n+/g, ' | ') : 'MISSING',
      libBtn: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : 'MISSING',
    };
  })()`)
  ok('批量回显按文件分组', /batch-a\.bpq/.test(r5.panel) && /batch-b\.bpq/.test(r5.panel))
  ok('批量结果如实汇报成功数', /成功 2 个/.test(r5.panel), r5.panel.slice(0, 120))
  // 按钮文案会随面板开合在「我的题库 N」/「收起 N」之间变，只断言末尾的计数
  ok('两个包各记一个批次（我的题库计数 2）', /2\s*$/.test(r5.libBtn.trim()), r5.libBtn)

  const real = errors.filter((l) => !/\[vite\]|websocket|Uncaught \(in promise\)|Failed to load resource/i.test(l))
  console.log(`\n页面报错：${real.length ? real.slice(0, 5).join(' | ') : '（无）'}`)
  console.log(`\n导入 UI 探针：${pass} passed, ${fail} failed`)
  cleanup(fail ? 1 : 0)
} catch (err) {
  console.log('探针异常：', String(err).slice(0, 300))
  cleanup(1)
}
