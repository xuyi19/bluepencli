// 把 release/ 根目录里**非最新版**的产物移进 release/历史版本/。
//
// 为什么需要它：根目录只该留最新一版 —— 多个版本平铺在一起时，文件名只差一处版本号，
// 随手解压一个就是旧版（2026-09-14 真发生过：解压出来是旧界面）。
//
// 而 build_desktop.py 里的 _archive_report() 只**清点**历史版本、不移动文件，
// publish-single.mjs 的消息里写着"历史版本已归档"、实际也没挪 ——
// 两边都以为自己归档了，于是每次发版后根目录都会多留一版。
// 归档这件事必须有人真的做，所以独立成一个脚本，两条产物通道都用它。
//
// 只挪不删；已是历史版本里的同名文件则跳过（不会覆盖回溯证据）。
//
// 用法：node .tools/archive-release.mjs [--dry]

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const REL = path.join(ROOT, 'release')
const HIST = path.join(REL, '历史版本')
const DRY = process.argv.includes('--dry')

// 只认带 `-vX.Y.Z` 的产物（zip / 目录 / html / exe 都适用），
// 其他东西（私有题库/、版本说明.md…）一律不碰。
const VER_RE = /-v(\d+)\.(\d+)\.(\d+)/
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

if (!existsSync(REL)) {
  console.error('找不到 release/ 目录')
  process.exit(1)
}

const entries = readdirSync(REL).filter((n) => VER_RE.test(n) && existsSync(path.join(REL, n)))
if (!entries.length) {
  console.log('release/ 根目录里没有带版本号的产物，无需归档')
  process.exit(0)
}

const parsed = entries.map((n) => ({ n, v: VER_RE.exec(n).slice(1, 4).map(Number) }))
const latest = parsed.reduce((m, x) => (cmp(x.v, m.v) > 0 ? x : m)).v
console.log(`最新版：v${latest.join('.')}`)

if (!existsSync(HIST) && !DRY) mkdirSync(HIST)

let moved = 0
let skipped = 0
for (const { n, v } of parsed.sort((a, b) => cmp(a.v, b.v))) {
  if (cmp(v, latest) === 0) continue
  const to = path.join(HIST, n)
  if (existsSync(to)) {
    console.log(`· 历史版本里已有，跳过：${n}`)
    skipped++
    continue
  }
  console.log(`→ 归档 ${n}`)
  if (!DRY) renameSync(path.join(REL, n), to)
  moved++
}

console.log(`\n${DRY ? '[dry-run] ' : ''}归档 ${moved} 项，跳过 ${skipped} 项`)
console.log('release/ 根目录保留：')
for (const n of readdirSync(REL).filter((x) => VER_RE.test(x))) console.log(`  · ${n}`)
