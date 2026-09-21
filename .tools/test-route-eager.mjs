// 护栏：路由页面必须是**静态导入**，构建产物里不许再出现"页面分片"。
//
// 起因值得写下来：路由原本是懒加载的（`() => import('../views/XxxView.vue')`），
// 每个页面被单独打成一个按内容 hash 命名的文件，点导航时再去取。
// 升级后旧文件被删掉，而**已经打开的页面**手里还攥着旧地址：
//
//     GET /assets/ChangelogView-Cd9uacJ9.js  →  404
//     TypeError: Failed to fetch dynamically imported module
//
// vue-router 中止这次跳转 —— 用户看到的是「点了没反应」，不白屏、不报红字。
// 桌面版叠加了第二个因素：每次启动都开同一个地址，浏览器复用那个早就打开的
// 标签页（实测是 v0.8.1 留下的），于是那个页面**永远收不到修复**，
// 换多少版都"还是点不动"。查了三轮才把这两件事串起来。
//
// 改成静态导入后，导航只是渲染一个已在内存里的组件，不产生任何网络请求。
// 这个测试就是防止它被顺手改回去 —— 懒加载是个太顺手的好习惯，
// 而这里的代价（首屏包大一点）远小于"点了一定能跳"的价值。
//
// 用法：node .tools/test-route-eager.mjs
//   （构建产物那几项需要先 npm run build；没有 dist 时会跳过并提示）

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ROUTER = path.join(ROOT, 'frontend/src/router/index.js')
const DIST_ASSETS = path.join(ROOT, 'frontend/dist/assets')
const INDEX_HTML = path.join(ROOT, 'frontend/index.html')

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}

// ---------- 1. 源码层面 ----------
const src = readFileSync(ROUTER, 'utf8')

const lazy = [...src.matchAll(/component:\s*\(\s*\)\s*=>\s*import\(/g)]
check('路由里没有懒加载写法（没有 `() => import(...)`）',
  lazy.length === 0,
  lazy.length ? `发现 ${lazy.length} 处，页面分片会随着升级失效` : '全部静态导入')

// 路由里出现的组件必须真的有对应的 import 语句，别只删了懒加载忘了引入
const used = [...src.matchAll(/component:\s*([A-Z]\w+)/g)].map((m) => m[1])
const imported = new Set([...src.matchAll(/^import\s+([A-Z]\w+)\s+from/gm)].map((m) => m[1]))
const missing = used.filter((n) => !imported.has(n))
check('每个路由组件都有对应的静态 import',
  used.length > 0 && missing.length === 0,
  missing.length ? `缺 ${missing.join(',')}` : `${used.length} 个组件全部已导入`)

// ---------- 2. 构建产物层面 ----------
if (!existsSync(DIST_ASSETS)) {
  console.log('· 没有 frontend/dist（先 npm run build）—— 产物层面的检查已跳过')
} else {
  // 页面分片的文件名形态是 `XxxView-<hash>.js`。顺序路由不再产生这种文件。
  const files = readdirSync(DIST_ASSETS)
  const viewChunks = files.filter((f) => /(?:View|View)-[A-Za-z0-9_-]{6,}\.js$/.test(f))
  check('构建产物里没有页面分片（懒加载的残留）',
    viewChunks.length === 0,
    viewChunks.length ? viewChunks.join(', ') : `${files.length} 个资源，无 *View-*.js`)

  // 主包必须真的把页面收进去了，否则"没有分片"可能只是构建没跑
  const entry = files.filter((f) => /^index-.*\.js$/.test(f)).sort().pop()
  let entrySize = 0
  if (entry) entrySize = readFileSync(path.join(DIST_ASSETS, entry)).length
  check('主包已包含页面代码（不是空壳）',
    entrySize > 400_000,
    entry ? `${entry} ${(entrySize / 1024).toFixed(0)} KB` : '找不到 index-*.js')
}

// ---------- 3. 页面能自己发现"我是旧版本" ----------
// 只解决"分片取不到"还不够：一个一直没关的标签页仍然会停在旧代码上，
// 于是需要页面自己问一次服务端版本，不一致就刷新一次。
const html = readFileSync(INDEX_HTML, 'utf8')
check('入口 HTML 里有版本自检（页面落后时会自己刷新）',
  html.includes('bp:version-reloaded') && html.includes('api/v1/health'),
  html.includes('bp:version-reloaded') ? '已就位' : '缺失 —— 老标签页将永远停在旧代码上')

console.log(failed ? `\n✗ ${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
