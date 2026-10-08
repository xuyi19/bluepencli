// 荧光标注功能的演示 + 冒烟探针。
//
// ⚠️ 不走"往 localStorage 塞假数据"的捷径 —— 那验不到 readSelection/色板/paint
// 这条真实链路。这里用 Range API 在页面里**真实构造选区**，再触发 mouseup
// 让 Highlightable 弹色板、点色块落标记 —— 与用户手划是同一套代码。
// 断言落在用户看得见的结果上（localStorage 里存了几条什么颜色的标记、
// 页面渲染出几个 <mark>），不是内部变量写法。
//
// 用法：NODE_PATH=<workspace>/node_modules node .tools/tmp-demo-hl.mjs
// 前置：dev server 127.0.0.1:5279（显式独立端口，避免撞别人的 5273）+ 后端 8100。

import { mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
// NODE_PATH 对 ESM 无效：用 createRequire 从受管 workspace 取 puppeteer-core
const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')

const URL = 'http://127.0.0.1:5279/#/practice'
const OUT = 'E:/code/bluepencil/.shots'
mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1500,1000'],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
// Vue 告警零容忍：paletteStyle 漏定义那次，页面不崩、功能"看起来正常"，
// 唯一线索就是一条 console 告警——不收集它，探针永远绿
const pageWarns = []
page.on('console', (m) => {
  const t = m.text()
  if (/vite|WebSocket|HMR/i.test(t)) return
  if (m.type() === 'warning' || m.type() === 'error' || /was accessed during render|not defined/i.test(t)) {
    pageWarns.push(t.slice(0, 140))
  }
})
page.on('pageerror', (e) => {
  const t = String(e)
  if (/WebSocket|vite/i.test(t)) return // dev server 的 HMR 噪声（headless 连不上是常态）
  pageWarns.push('pageerror: ' + t.slice(0, 140))
})
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

// ── 1. 确保页面里有题 + 弹窗真正关掉 ──
// ⚠️ v0.25.0 起进页自动弹选题窗，**同时**自动载入今日一练 —— 有材料 ≠ 弹窗关了。
//    探针曾在这里被骗过：材料在弹窗后面渲染好了，"有材料就跳过选题"导致弹窗
//    整场开着，程序化步骤穿透遮罩全绿，真鼠标步骤全被遮罩吃掉（选区恒 0）。
async function hasMaterial() {
  return page.evaluate(() => document.querySelectorAll('[data-hl-block] p').length)
}
if (!(await hasMaterial())) {
  console.log('页面无题，走选题器…')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('从题库选题'))
    btn?.click()
  })
  await new Promise((r) => setTimeout(r, 800))
  await page.evaluate(() => {
    // 选题面板：v-if="showPicker" 的容器里，.space-y-2 直属的 button 就是题卡
    const panel = [...document.querySelectorAll('div')].find((d) =>
      d.querySelector(':scope > input[placeholder*="搜索"]'))
    const card = panel?.querySelector('.space-y-2 > button')
    card?.click()
  })
}
// 弹窗还开着就真正关掉：优先点一张题卡（走真实选择路径，applyQuestion 收尾关窗），
// 没有卡就点右上角 ✕
const modalOpen0 = await page.evaluate(() => !!document.querySelector('.fixed.inset-0.z-50'))
if (modalOpen0) {
  await page.evaluate(() => {
    const overlay = document.querySelector('.fixed.inset-0.z-50')
    const card = overlay?.querySelector('.space-y-2 > button')
    if (card) card.click()
    else overlay?.querySelector('button')?.click()
  })
  await new Promise((r) => setTimeout(r, 1200))
}
const modalGone = await page.evaluate(() => !document.querySelector('.fixed.inset-0.z-50'))
check('选题弹窗已关闭（真鼠标步骤的前提）', modalGone)
// applyQuestion 是 async（材料要异步载入正文），轮询等材料真的出现
let blockCount = 0
for (let i = 0; i < 20; i++) {
  blockCount = await hasMaterial()
  if (blockCount > 0) break
  await new Promise((r) => setTimeout(r, 500))
}
check('页面里有可划荧光的材料块', blockCount > 0, `实际 ${blockCount} 块`)

// ── 2. 材料区划三处荧光（黄/绿/蓝，真实选区路径） ──
async function paintIn(containerSel, swatchIdx) {
  await page.evaluate((sel, idx) => {
    const root = document.querySelector(sel)
    // 挑文本最长的那段正文：第一个块可能是纯 label 或空节点
    const ps = [...root.querySelectorAll('[data-hl-block] p')]
    const p = ps.sort((a, b) => b.textContent.length - a.textContent.length)[0]
    // 收集 p 里所有文本节点，取最长的一个（有的段被 <mark> 等切成小节点）
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let textNode = null, best = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent.trim().length > best) { best = n.textContent.trim().length; textNode = n }
    }
    const from = 6
    const to = Math.min(from + 18, (textNode || p).textContent.length)
    if (!textNode) { p.normalize(); textNode = p.firstChild }
    const range = document.createRange()
    range.setStart(textNode, from)
    range.setEnd(textNode, to)
    const sel2 = window.getSelection()
    sel2.removeAllRanges()
    sel2.addRange(range)
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, containerSel, swatchIdx)
  await new Promise((r) => setTimeout(r, 300))
  // 色板必须出现在**选区旁边**：paletteStyle 漏定义时色板会失去坐标糊在容器左上角，
  // querySelector 照样找得到——位置才是用户"划了没反应"的真判据
  const near = await page.evaluate(() => {
    const sel = window.getSelection()
    if (!sel?.rangeCount) return { ok: false, why: '选区已不在' }
    const r = sel.getRangeAt(0).getBoundingClientRect()
    const el = document.querySelector('.hl-palette')
    if (!el) return { ok: false, why: '色板没弹出来' }
    const p = el.getBoundingClientRect()
    const dist = Math.hypot(p.x - r.x, p.y - r.bottom)
    return { ok: dist < 300, why: `色板距选区 ${Math.round(dist)}px` }
  })
  check('色板出现在选区旁边', near.ok, near.why)
  await page.evaluate((idx) => {
    const btn = document.querySelectorAll('.hl-palette .hl-swatch')[idx]
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, swatchIdx)
  await new Promise((r) => setTimeout(r, 300))
}
const modalState = async (tag) => {
  if (!process.env.PROBE_DEBUG) return
  const s = await page.evaluate(() => ({
    modal: !!document.querySelector('.fixed.inset-0.z-50'),
    hasMat: document.querySelectorAll('[data-hl-block] p').length,
    active: document.activeElement?.tagName + '.' + String(document.activeElement?.className || '').slice(0, 30),
  }))
  console.log(`  [debug@${tag}]`, JSON.stringify(s))
}
await modalState('选题后')

await paintIn('.max-h-\\[32rem\\] .hl-root, [data-hl-block]', 0) // 黄
await paintIn('.max-h-\\[32rem\\] .hl-root, [data-hl-block]', 1) // 绿
await paintIn('.max-h-\\[32rem\\] .hl-root, [data-hl-block]', 2) // 蓝
await modalState('材料划完后')

const saved = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('bp-marks:'))
  if (!key) return null
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
})
const matCount = saved?.material?.length || 0
check('材料区 3 处荧光已落库', matCount === 3, `实际 ${matCount} 条`)
const matColors = new Set((saved?.material || []).map((m) => m.color))
check('三种颜色都存下来了', matColors.size === 3, `实际 ${[...matColors].join(',')}`)
const markEls = await page.evaluate(() => document.querySelectorAll('mark.hl-mark').length)
check('页面上渲染出 3 个 <mark>', markEls === 3, `实际 ${markEls} 个`)

// ── 3. 作答区：输入答案 → 进标注态 → 划荧光 ──
// 页面有 3 个 textarea（评分标准/考场说明等），直选 GridPaper 那个
const ta = await page.$('textarea.grid-paper')
if (!ta) { check('找到作答输入框', false, '页面上没有 textarea.grid-paper'); process.exit(1) }
// ⚠️ 别用 ta.click()：一屏布局下 textarea 定高内滚，几何中心在折叠线之下，
//    puppeteer 为够到它先滚页面，那一击会落在别的元素上（实测把「换题」点了，
//    选题弹窗弹出来盖住全屏，后面真鼠标拖拽全部落在遮罩上 → 选区恒 0）。
//    聚焦用 focus，打字仍是真实键盘事件。
await page.evaluate(() => document.querySelector('textarea.grid-paper').focus())
await ta.type(
  '基层减负首先要减掉形式主义、官僚主义这个"包袱"。材料中反映的"指尖上的形式主义"' +
  '正是典型表现：政务APP过多、打卡留痕泛滥，基层干部把大量时间耗在截图转发上，' +
  '反而没时间走访群众。对此，应当从三方面着手：一是清理整合政务应用，能合并的合并；' +
  '二是改革考核方式，以实绩和群众满意度为导向，不以留痕论英雄；三是为基层赋权减责，' +
  '让干部把精力用在办实事上。唯有如此，减负才能减到实处，治理才有温度。',
  { delay: 0 }
)
const typedLen = await page.evaluate(() => document.querySelector('textarea.grid-paper')?.value.length || 0)
check('答案已输入（>120 字）', typedLen > 120, `实际 ${typedLen} 字`)
const btnState = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('荧光标注'))
  return { found: !!btn, disabled: btn?.disabled ?? null }
})
check('「荧光标注」按钮存在且可用', btnState.found && !btnState.disabled, JSON.stringify(btnState))
await modalState('进标注态后')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('荧光标注'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 500))
const markModeOn = await page.evaluate(() => document.body.textContent.includes('返回编辑'))
check('作答区进入标注态', markModeOn)

// 作答标注态的 .hl-root 在「我的作答」那节里，别赌 section 序号
const ansRoot = await page.evaluateHandle(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.textContent.includes('返回编辑'))
  return sec?.querySelector('.hl-root')
})
if (ansRoot.asElement()) {
  await page.evaluate((root) => {
    const ps = [...root.querySelectorAll('[data-hl-block] p')]
    const p = ps.sort((a, b) => b.textContent.length - a.textContent.length)[0]
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let textNode = null, best = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent.trim().length > best) { best = n.textContent.trim().length; textNode = n }
    }
    const from = 6
    const to = Math.min(from + 18, textNode.textContent.length)
    const range = document.createRange()
    range.setStart(textNode, from)
    range.setEnd(textNode, to)
    const sel2 = window.getSelection()
    sel2.removeAllRanges()
    sel2.addRange(range)
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, ansRoot.asElement())
  await new Promise((r) => setTimeout(r, 300))
  await page.evaluate(() => {
    document.querySelectorAll('.hl-palette .hl-swatch')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 300))
} else {
  check('作答标注态渲染出可划区域', false, '没找到 .hl-root')
}
const saved2 = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('bp-marks:'))
  return JSON.parse(localStorage.getItem(key) || '{}')
})
const ansCount = saved2?.answer?.length || 0
check('作答区 1 处荧光已落库', ansCount === 1, `实际 ${ansCount} 条`)
await new Promise((r) => setTimeout(r, 400))

// ── 3b. 真鼠标拖拽（与用户操作同路径）──
// 程序化构造选区绕开了真实鼠标路径上的所有环节；paletteStyle 漏定义那次
// 就是这么漏掉的。这里必须用 page.mouse 按下-拖动-松开走一遍。
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
  sec?.scrollIntoView({ block: 'center' })
})
await new Promise((r) => setTimeout(r, 500))
// ⚠️ 两段式定位：材料是内滚容器（v0.25.0 一屏布局），目标文本可能折在滚动折叠线外；
//    scrollIntoView 若遇 smooth 滚动是异步的，边滚边量会拿到旧坐标 —— 鼠标事件全落空。
//    所以：先滚 → 等稳 → 再量。扫描所有文本节点（跳过已划标记的），找第一段
//    「矩形完整落在视口内」的 8 字区间。
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
  const ps = [...(sec?.querySelectorAll('[data-hl-block] p') || [])]
  // 优先挑「已可见」的段；没有就把最长段滚进视野
  const inView = ps.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= innerHeight && el.textContent.trim().length >= 40
  })
  if (inView.length === 0) ps.sort((a, b) => b.textContent.length - a.textContent.length)[0]?.scrollIntoView({ block: 'center' })
})
await new Promise((r) => setTimeout(r, 700))
const dragBox = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
  if (!sec) return null
  const ps = [...sec.querySelectorAll('[data-hl-block] p')]
  const scroller = sec.querySelector('[class*="overflow-y-auto"]') || sec
  // 可视区中部（上下各让 64px）：贴近容器上下边会触发选择拖拽的**自动滚动**，
  // 实测拖拽点距顶 ~60px 时，8 步拖拽把容器从 scrollTop=288 滚到 2，
  // 内容从光标底下滚过、选区跟着涨到 348 字
  const sr = scroller.getBoundingClientRect()
  const topBound = sr.top + 64
  const botBound = sr.bottom - 64
  for (const p of ps) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length < 12) continue
      if (node.parentElement?.tagName === 'MARK') continue // 已划过标记的区间不再拖
      const len = node.textContent.length
      for (let start = 0; start + 8 <= len; start += 6) {
        const r = document.createRange()
        r.setStart(node, start)
        r.setEnd(node, start + 8)
        const rect = r.getBoundingClientRect()
        if (rect.top < topBound || rect.bottom > botBound || rect.width <= 0) continue
        // ⚠️ 视口内 ≠ 可见：内滚容器滚出去的内容布局坐标仍可能落在视口里，
        //    但被 overflow 裁剪着 —— 真鼠标按那里只会拖到别的元素。
        //    用命中测试做最终裁决：落点必须真在这个段落的文字上。
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (hit && (hit === p || p.contains(hit))) {
          // 以 range 中点为锚、±12px 短拖：从矩形左缘起拖会以段首为锚
          // （缩进/字距让左缘落在文字之外），实测一拖选了 351 字
          const mx = rect.left + rect.width / 2
          return { x1: mx - 12, y1: rect.top + rect.height / 2, x2: mx + 12, y2: rect.top + rect.height / 2 }
        }
      }
    }
  }
  return null
})
if (dragBox) {
  if (process.env.PROBE_DEBUG) {
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
      const scroller = sec?.querySelector('[class*="overflow-y-auto"]')
      return {
        tag: el?.tagName, cls: String(el?.className || '').slice(0, 60),
        scrollY: Math.round(scrollY), matScrollTop: Math.round(scroller?.scrollTop || -1),
        rect: null,
      }
    }, { x: dragBox.x1, y: dragBox.y1 })
    console.log('  [debug] 拖拽起点命中:', JSON.stringify(hit), 'dragBox:', JSON.stringify(dragBox))
  }
  await page.mouse.move(dragBox.x1, dragBox.y1)
  await page.mouse.down()
  if (process.env.PROBE_DEBUG) {
    const d = await page.evaluate(() => {
      const s = window.getSelection()
      const sec = [...document.querySelectorAll('section')].find((x) => x.querySelector('[data-hl-block]'))
      const sc = sec?.querySelector('[class*="overflow-y-auto"]')
      return { afterDown: s?.toString().length, off: s?.anchorOffset, top: Math.round(sc?.scrollTop ?? -1) }
    })
    console.log('  [debug] down后:', JSON.stringify(d))
  }
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(dragBox.x1 + ((dragBox.x2 - dragBox.x1) * i) / 8, dragBox.y1)
    await new Promise((r) => setTimeout(r, 30))
  }
  if (process.env.PROBE_DEBUG) {
    const d = await page.evaluate(() => {
      const s = window.getSelection()
      const sec = [...document.querySelectorAll('section')].find((x) => x.querySelector('[data-hl-block]'))
      const sc = sec?.querySelector('[class*="overflow-y-auto"]')
      return { afterMoves: s?.toString().length, off: s?.anchorOffset, focusOff: s?.focusOffset, top: Math.round(sc?.scrollTop ?? -1) }
    })
    console.log('  [debug] moves后:', JSON.stringify(d))
  }
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 500))
  const rm = await page.evaluate(() => ({
    selLen: window.getSelection()?.toString().length || 0,
    selText: (window.getSelection()?.toString() || '').slice(0, 24),
    anchorEl: (() => {
      const s = window.getSelection()
      const el = s?.anchorNode?.parentElement
      return el ? el.tagName + '.' + String(el.className || '').slice(0, 30) : '(无)'
    })(),
    palette: !!document.querySelector('.hl-palette'),
    near: (() => {
      const sel = window.getSelection()
      if (!sel?.rangeCount) return -1
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const el = document.querySelector('.hl-palette')
      if (!el) return -1
      const p = el.getBoundingClientRect()
      return Math.round(Math.hypot(p.x - r.x, p.y - r.bottom))
    })(),
  }))
  check('真鼠标拖拽弹出色板', rm.palette, `选区 ${rm.selLen} 字"${rm.selText}" 锚点=${rm.anchorEl}` + (rm.near >= 0 ? `，距选区 ${rm.near}px` : ''))
  check('真鼠标路径色板也在选区旁', rm.near >= 0 && rm.near < 300, `距选区 ${rm.near}px`)
  if (rm.palette) {
    await page.evaluate(() => document.querySelectorAll('.hl-palette .hl-swatch')[4]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await new Promise((r) => setTimeout(r, 300))
    const cnt = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('bp-marks:'))
      return (JSON.parse(localStorage.getItem(key) || '{}').material || []).length
    })
    check('真鼠标划的标记落库', cnt === 4, `实际 ${cnt} 条`)
  }
} else {
  check('真鼠标拖拽找到可拖文本', false, '没定位到可见的正文段')
}

// ── 4. 截图：材料荧光 / 作答标注态 / 整页布局 ──
const shotMaterial = `${OUT}/hl-material.png`
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
  sec?.scrollIntoView({ block: 'start' })
})
await new Promise((r) => setTimeout(r, 400))
const matSection = await page.evaluateHandle(() =>
  [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]')))
await matSection.asElement()?.screenshot({ path: shotMaterial })
const shotAnswer = `${OUT}/hl-answer.png`
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.textContent.includes('我的作答'))
  sec?.scrollIntoView({ block: 'start' })
})
await new Promise((r) => setTimeout(r, 400))
const ansSection = await page.evaluateHandle(() =>
  [...document.querySelectorAll('section')].find((s) => s.textContent.includes('我的作答')))
await ansSection.asElement()?.screenshot({ path: shotAnswer })

// 回到页首截整页：看整体布局（左材料/右题干/下方作答）
await page.evaluate(() => window.scrollTo({ top: 0 }))
await new Promise((r) => setTimeout(r, 400))
const shotFull = `${OUT}/hl-full.png`
await page.screenshot({ path: shotFull, fullPage: false })

// ── 5. 结果页（荧光与老师批注叠加）：能批改就真批一次 ──
let resultShot = ''
const canGrade = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /开始批改|批改/.test(b.textContent))
  return btn ? !btn.disabled : false
})
console.log(`  ℹ️ 批改按钮可用：${canGrade}`)
if (canGrade) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /开始批改/.test(b.textContent))
    btn?.click()
  })
  // 选老师挪到「批改时」了：点完上面那个按钮先弹选人弹窗，默认已选 3 位 → 直接确认。
  // ⚠️ 少了这一步，探针会一直等结果页直到超时（假红），或者更糟：等到别的字样误判通过。
  await new Promise((r) => setTimeout(r, 600))
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^开始批改（/.test(b.textContent.trim()))
    btn?.click()
  })
  try {
    await page.waitForFunction(
      () => document.body.textContent.includes('我的标注') || document.body.textContent.includes('批注'),
      { timeout: 180000 }
    )
    await new Promise((r) => setTimeout(r, 1500))
    resultShot = `${OUT}/hl-result.png`
    await page.screenshot({ path: resultShot, fullPage: false })
    const legendOk = await page.evaluate(() => document.body.textContent.includes('我的标注'))
    check('结果页出现「我的标注」图例（与老师批注共存）', legendOk)
  } catch (e) {
    check('结果页批改完成', false, String(e).slice(0, 120))
  }
}

for (const f of [shotMaterial, shotAnswer, shotFull, resultShot].filter(Boolean)) {
  try { check(`截图 ${f.split('/').pop()} 已生成`, statSync(f).size > 30000, `${statSync(f).size}B`) } catch { check(`截图 ${f}`, false, '不存在') }
}

check('无 Vue 告警 / 未定义属性 / 页面报错', pageWarns.length === 0, pageWarns.slice(0, 2).join(' | '))

await browser.close()
console.log(failed ? `有 ${failed} 项失败` : '全部通过')
process.exit(failed ? 1 : 0)
