// 发布单文件版：把 dist-single 的产物搬进 release/，文件名带上版本号。
//
// 三条约定：
//   1. 版本号从仓库根的 CHANGELOG.md 解析（唯一真源），解析不到就报错停下，
//      绝不静默出一个名字不对的产物；
//   2. 产物名固定 `蓝笔申论-单文件版-vX.Y.Z.html`；
//   3. 发布后清掉 release/ 里同类的旧版本 —— release 只留最新一版，不堆历史副本。
//
// 用法（在 frontend/ 目录）：
//   npm run release:single     # = build:single + 本脚本

import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const ROOT = resolve(FRONTEND, '..')

const SRC = join(FRONTEND, 'dist-single', 'index.html')
const RELEASE = join(ROOT, 'release')
const PREFIX = '蓝笔申论-单文件版'

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** 取 CHANGELOG.md 最上面那一版的版本号，如 'v0.4.0' */
function readVersion() {
  const file = join(ROOT, 'CHANGELOG.md')
  if (!existsSync(file)) fail(`找不到更新日志：${file}`)
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => /^##\s+v[\d.]/.test(l))
  const m = line && line.match(/^##\s+(v[\d.]+)/)
  if (!m) {
    fail('CHANGELOG.md 里找不到 `## vX.Y.Z · 日期 · 标题` 开头的版本行，'
      + '改完格式后请同步更新 publish-single.mjs 与 build_desktop.py')
  }
  return m[1]
}

const version = readVersion()
const outName = `${PREFIX}-${version}.html`
const outPath = join(RELEASE, outName)

if (!existsSync(SRC)) {
  fail(`找不到单文件构建产物：${SRC}\n  先在 frontend/ 跑一次 npm run build:single`)
}
mkdirSync(RELEASE, { recursive: true })
copyFileSync(SRC, outPath)
console.log(`✓ 已发布 ${outName}  (${(statSync(outPath).size / 1024).toFixed(0)} KB)`)

// 清掉同类旧版本：旧的不带版本号的命名，以及版本号不是当前的
let removed = 0
for (const name of readdirSync(RELEASE)) {
  if (!name.startsWith(PREFIX) || name === outName) continue
  try {
    unlinkSync(join(RELEASE, name))
    console.log(`  清掉旧版本：${name}`)
    removed++
  } catch (e) {
    // 文件被占用（比如正开着预览）不该算发布失败
    console.log(`  （${name} 没清掉，忽略：${e.code || e.message}）`)
  }
}
console.log(removed ? '✓ release 里只保留最新一版' : '✓ release 无需清理')
