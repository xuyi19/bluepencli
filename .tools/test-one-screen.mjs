// 一屏布局的「耦合常数」护栏
//
// 答题态一屏布局：App.vue 的 main 在 compact 路由把上下 padding 收到 lg:pt-4/lg:pb-4
// （各 16px），PracticeView 答题态 root 的高度是 lg:h-[calc(100vh-32px)]。
// 这个 32 = 16 + 16，只跟 main 的 compact padding 挂钩——谁改 padding 忘了改 calc，
// 布局就会悄悄溢出视口 2n px（页面出滚动条，材料区白白少一截），探针不一定红。
// 这里从两份源码里各抽出真实数字互相咬合，改一边不改另一边立刻红。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'frontend/src/App.vue'), 'utf8')
const practice = readFileSync(join(root, 'frontend/src/views/PracticeView.vue'), 'utf8')
const router = readFileSync(join(root, 'frontend/src/router/index.js'), 'utf8')

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

// ① main 的 compact padding：pt-4 和 pb-4 必须成对出现在同一表达式里
const padPair = app.match(/route\.meta\.compact \? '(lg:pt-(\d+)[^']*lg:pb-(\d+)[^']*)'/)
check('App.vue main 有 compact padding 表达式（lg:pt-N lg:pb-N）', !!padPair, padPair?.[1])
const pt = padPair ? Number(padPair[2]) : NaN
const pb = padPair ? Number(padPair[3]) : NaN

// ② 每个单位 = 4px（tailwind 间距刻度）；总常数 = (pt+pb)*4
const total = (pt + pb) * 4

// ③ PracticeView 答题态 root 的 calc 常数必须等于 total
const calc = practice.match(/lg:h-\[calc\(100vh-(\d+)px\)\]/)
check('PracticeView 答题 root 用 calc(100vh-Npx) 锁一屏', !!calc, calc?.[0])
check(
  `calc 常数 == compact padding 总和（${calc?.[1]} == ${total}）`,
  calc && Number(calc[1]) === total,
  calc ? `padding ${pt}/${pb} → 应为 ${(pt + pb) * 4}` : '没找到 calc'
)

// ④ 三条答题路由都必须带 compact meta（少了哪条，哪个页面就退回 py-10 大留白）
for (const path of ['/practice', '/real', '/exam']) {
  const line = router.split('\n').find((l) => l.includes(`path: '${path}'`))
  check(`${path} 带 meta: { compact: true }`, !!line && /compact:\s*true/.test(line), line?.trim().slice(0, 60))
}

// ⑤ root 与答题壳的 min-h-0 链：少了它内容自然高反向撑爆布局（实测材料段撑到 1106px）
check('答题 root 有 lg:min-h-0（flex 收缩链的关键一环）', /lg:h-\[calc\(100vh-\d+px\)\] lg:flex lg:flex-col lg:min-h-0/.test(practice))

process.exit(failed ? 1 : 0)
