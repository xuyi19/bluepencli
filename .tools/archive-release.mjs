// 把每个**产物通道**目录里非最新版的产物移进它自己的 `历史版本/`。
//
// ── 为什么需要它 ──
//   产物目录只该留最新一版 —— 多个版本平铺在一起时，文件名只差一处版本号，
//   随手解压一个就是旧版（2026-09-14 真发生过：解压出来是旧界面）。
//
//   而发布脚本只会**清点**历史版本、不移动文件，消息里却写着"已归档" ——
//   于是每次发版后目录里都会多留一版，谁都没真的挪。
//   归档这件事必须有人真的做，所以独立成一个脚本，两条产物通道都用它。
//
// ── 2026-09-21 布局调整 ──
//   release/ 从「平铺 + 单一 历史版本/」改成**按通道分目录**：
//
//     release/
//       ├── 桌面版/      蓝笔申论-桌面版-vX.Y.Z{,.zip} + 历史版本/
//       └── 单文件版/    蓝笔申论-单文件版-vX.Y.Z.html  + 历史版本/
//
//   旧版是把两类产物混在 release/ 根、往期都塞进同一个 `历史版本/`，
//   回溯时要在几十个文件里分辨"这是哪条通道的哪一版"。
//   现在每个通道自带历史版本，语义自洽 —— 本脚本按同一套规则逐个通道处理。
//
// 只挪不删；历史版本里已有同名则跳过（不覆盖回溯证据）。
//
// 用法：node .tools/archive-release.mjs [--dry]

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const REL = path.join(ROOT, 'release')
const DRY = process.argv.includes('--dry')

/**
 * 产物通道 = release/ 下的一级子目录。
 * ⚠️ 加新的分发通道时**必须登记到这里**，否则它的往期产物永远不会被归档，
 *    而"没归档"这件事本身不会有任何报错 —— 正是本项目最怕的静默失败。
 */
const CHANNELS = ['桌面版', '单文件版']

/** 只认带 `-vX.Y.Z` 的产物（zip / 目录 / html / exe 都适用） */
const VER_RE = /-v(\d+)\.(\d+)\.(\d+)/
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

if (!existsSync(REL)) {
  console.error('找不到 release/ 目录')
  process.exit(1)
}

let totalMoved = 0
let totalSkipped = 0

for (const channel of CHANNELS) {
  const dir = path.join(REL, channel)
  if (!existsSync(dir)) {
    console.log(`\n【${channel}】目录不存在，跳过`)
    continue
  }
  console.log(`\n【${channel}】`)

  const entries = readdirSync(dir).filter((n) => VER_RE.test(n) && existsSync(path.join(dir, n)))
  if (!entries.length) {
    console.log('  根目录里没有带版本号的产物，无需归档')
    continue
  }

  const parsed = entries.map((n) => ({ n, v: VER_RE.exec(n).slice(1, 4).map(Number) }))
  const latest = parsed.reduce((m, x) => (cmp(x.v, m.v) > 0 ? x : m)).v
  console.log(`  最新版：v${latest.join('.')}`)

  const hist = path.join(dir, '历史版本')
  if (!existsSync(hist) && !DRY) mkdirSync(hist, { recursive: true })

  for (const { n, v } of parsed.sort((a, b) => cmp(a.v, b.v))) {
    if (cmp(v, latest) === 0) continue
    const to = path.join(hist, n)
    if (existsSync(to)) {
      console.log(`  · 历史版本里已有，跳过：${n}`)
      totalSkipped++
      continue
    }
    console.log(`  → 归档 ${n}`)
    if (!DRY) renameSync(path.join(dir, n), to)
    totalMoved++
  }

  console.log('  保留：')
  for (const n of readdirSync(dir).filter((x) => VER_RE.test(x))) console.log(`    · ${n}`)
}

console.log(`\n${DRY ? '[dry-run] ' : ''}归档 ${totalMoved} 项，跳过 ${totalSkipped} 项`)
