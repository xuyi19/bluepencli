// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 发布桌面版：把 Tauri 构建产物搬进 `release/桌面版/`，文件名带版本号。
//
// 与前端那条通道同一套约定：
//   1. 版本号从仓库根 `CHANGELOG.md` 解析（唯一真源），解析不到就报错停下；
//   2. 产物名带版本号；通道目录的根只放**最新一版**；
//   3. 旧产物一律保留，归档交给 `.tools/archive-release.mjs`（不在这里做）。
//
// ── 为什么发布前要跑一次探针（默认就会跑）──
//   这条通道有一个非常隐蔽的失败模式：`cargo build --release` 直接编出来的 exe
//   **不内嵌前端**，而是去连 `tauri.conf.json` 里的 `devUrl`（5273）。
//   它照样能启动、窗口照样开、进程照样活着 —— 只有屏幕上是一片"无法访问"。
//   体积上也分辨不出来（两条路编出来的 exe 差不多大），
//   所以只能用探针问页面自己"你加载的是哪份文档"。
//   发出去之前拦住它，比被收包的人问"为什么白屏"强得多。
//
// 用法：
//   cd desktop && npm run publish             # 先构建再发布
//   node scripts/publish.mjs --no-verify      # 跳过探针（不推荐）

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SRC = join(ROOT, 'desktop', 'src-tauri', 'target', 'release', 'bluepencil.exe')
const RELEASE = join(ROOT, 'release', '桌面版')
const PROBE = join(ROOT, '.tools', 'probe-tauri-render.mjs')
const PREFIX = '蓝笔申论-桌面版'
const NO_VERIFY = process.argv.includes('--no-verify')

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** 取 CHANGELOG.md 最上面那一版的版本号，如 'v0.4.0' */
function readVersion() {
  const file = join(ROOT, 'CHANGELOG.md')
  if (!existsSync(file)) fail(`找不到更新日志：${file}`)
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^##\s+v[\d.]/.test(l))
  const m = line && line.match(/^##\s+(v[\d.]+)/)
  if (!m) {
    fail(
      'CHANGELOG.md 里找不到 `## vX.Y.Z · 日期 · 标题` 开头的版本行，' +
        '改完格式后请同步更新 publish-single.mjs / build_desktop.py / 本脚本'
    )
  }
  return m[1]
}

if (!existsSync(SRC)) {
  fail(`找不到构建产物：${SRC}\n  先在 desktop/ 跑一次 npm run build`)
}

const version = readVersion()
const outName = `${PREFIX}-${version}.exe`
const outPath = join(RELEASE, outName)

// ① 先验产物再发布 —— 顺序不能反：
//    先复制过去再验的话，验证失败时那份坏产物已经躺在发布目录里了，
//    而"发布目录里躺着一份坏包"正是最容易误发的情况。
if (!NO_VERIFY) {
  if (!existsSync(PROBE)) {
    console.log('· 找不到探针，跳过验证（.tools/probe-tauri-render.mjs）')
  } else {
    console.log('发布前验证：它加载的必须是内嵌前端，而不是 devUrl …')
    const r = spawnSync(process.execPath, [PROBE], { stdio: 'inherit' })
    if (r.status !== 0) {
      fail(
        '探针没通过 —— 这份产物很可能是不内嵌前端的那一版（用 cargo build 编的）。\n' +
          '  请改用 desktop/ 下的 `npm run build`（= tauri build --no-bundle）重新构建。'
      )
    }
  }
}

mkdirSync(RELEASE, { recursive: true })
copyFileSync(SRC, outPath)
const mb = (statSync(outPath).size / 1048576).toFixed(1)
console.log(`\n✓ 已发布 ${outName}  (${mb} MB)`)

// ② 归档提醒：本脚本**不做归档**，理由与前端那条通道一致 ——
//    "谁发布谁归档"会让两处逻辑各自实现一遍，进而各自以为自己做了。
console.log(`\n下一步：node .tools/archive-release.mjs   # 把往期收进 历史版本/`)
console.log(`另：release/桌面版/ 里现在应该只有最新一版 + 历史版本/`)
