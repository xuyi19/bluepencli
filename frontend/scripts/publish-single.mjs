// 发布单文件版：把 dist-single 的产物搬进 release/，文件名带上版本号。
//
// 三条约定：
//   1. 版本号从仓库根的 CHANGELOG.md 解析（唯一真源），解析不到就报错停下，
//      绝不静默出一个名字不对的产物；
//   2. 产物名固定 `蓝笔申论-单文件版-vX.Y.Z.html`；
// 3. 旧产物一律保留：通道目录的根只放**最新一版**，往期由 .tools/archive-release.mjs
//    归入同级的 历史版本/ —— 多个版本的包平铺在一起时，光看文件名分不清哪个是最新，
//    随手解压一个就是旧版（真发生过）。
//
// 用法（在 frontend/ 目录）：
//   npm run release:single         # 公开版：dist-single/，不含 2022 起的私有卷
//   npm run release:single:local   # 本机版：dist-single-local/，含私有卷，文件名带 -本地全量
//
// 公开版与本地版是**两套独立目录**，互不覆盖 —— 本地版只给自己用，
// 发出去的永远是公开版。

import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const ROOT = resolve(FRONTEND, '..')

const LOCAL = process.argv.includes('--local')
const SRC = join(FRONTEND, LOCAL ? 'dist-single-local' : 'dist-single', 'index.html')
// 产物通道目录：release/单文件版/（2026-09-21 起按通道分目录，
// 往期产物在同级的 历史版本/ 下，由一个 / 一条命令不再混在一起）
const RELEASE = join(ROOT, 'release', '单文件版')
const PREFIX = LOCAL ? '蓝笔申论-单文件版-本地全量' : '蓝笔申论-单文件版'

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
      + '改完格式后请同步更新 publish-single.mjs 与 desktop/scripts/publish.mjs')
  }
  return m[1]
}

const version = readVersion()
const outName = `${PREFIX}-${version}.html`
const outPath = join(RELEASE, outName)

if (!existsSync(SRC)) {
  fail(`找不到单文件构建产物：${SRC}\n  先在 frontend/ 跑一次 ${LOCAL ? 'npm run build:single:local' : 'npm run build:single'}`)
}
mkdirSync(RELEASE, { recursive: true })
copyFileSync(SRC, outPath)
console.log(`✓ 已发布 ${outName}  (${(statSync(outPath).size / 1024).toFixed(0)} KB)`)

// 归档约定（2026-09-14 起）：release/ **保留每一个版本的产物，只增不删**。
// 理由：回溯"某个版本当时是什么样"时，历史包本身就是证据，不该逼着人重新构建。
// 同名文件（同一版本重打包）直接覆盖——版本号相同意味着内容应当一致。
//
// 唯一要清的：早期不带版本号的旧命名。它们没有版本信息，留着只制造混淆，
// 而且与带版本号的产物互为前缀，很容易被误认成同一版。
// 注意"本地全量"版与公开版名字互为前缀，必须互不误删：
// 公开版跑的时候跳过带 `-本地全量` 的（那是自己本机的自用产物）。
let removed = 0
for (const name of readdirSync(RELEASE)) {
  if (!name.startsWith(PREFIX) || name === outName) continue
  if (!LOCAL && name.includes('本地全量')) continue
  // 带版本号的：归档保留，不动
  if (/v\d+\.\d+\.\d+/.test(name)) continue
  try {
    unlinkSync(join(RELEASE, name))
    console.log(`  清掉无版本号的旧命名：${name}`)
    removed++
  } catch (e) {
    // 文件被占用（比如正开着预览）不该算发布失败
    console.log(`  （${name} 没清掉，忽略：${e.code || e.message}）`)
  }
}
// 归档计数要递归到 `历史版本/` —— 只数根目录会显示"共 1 个版本"，
// 看着像历史包丢了，实际只是被归了档（提示误导人比没提示更糟）。
function countArchived(dir) {
  let n = 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      n += countArchived(join(dir, ent.name))
      continue
    }
    if (!ent.name.startsWith(PREFIX) || !/v\d+\.\d+\.\d+/.test(ent.name)) continue
    // 公开版统计时跳过"本地全量"（名字互为前缀，会误算进来）
    if (!LOCAL && ent.name.includes('本地全量')) continue
    n++
  }
  return n
}
const kept = countArchived(RELEASE)
console.log(removed ? `✓ 已清掉无版本号的旧命名（归档共 ${kept} 个版本）`
  : `✓ 历史版本已归档（release/单文件版/ 与其 历史版本/ 共 ${kept} 个单文件版）`)

// 发完立刻把"这个包能不能给别人"讲清楚 —— 分层之后这是最容易出错的一步：
// 产物看起来都一样，区别只在构建时有没有把私有卷打进去。
console.log(LOCAL
  ? '⛔ 本地全量版：内含 2022 年起私有卷正文，**只能自己用，不要发给任何人**。'
  : '✅ 公开版：只含 2010–2021 卷，**可以直接发给别人**。')
