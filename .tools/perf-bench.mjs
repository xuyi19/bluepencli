// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// E3 性能实测 · 硬规则基准（规划文档验收线：硬规则校验耗时 ≤ 100ms）
//
// 为什么用 node 直跑：rules.js 零依赖、纯函数，V8 引擎与浏览器一致；
// 计时结果可直接代表桌面版/网页版里的表现。
//
// 用法：node .tools/perf-bench.mjs

import { registerViteAlias } from './vite-alias.mjs'
registerViteAlias()

const { runHardRules } = await import('../frontend/src/utils/grading/rules.js')

// ---- 造三个有代表性的作答场景（长度 / 结构 / 重复照抄各覆盖一个）----
const FILLER = '基层治理既要靠制度也要靠人，社区工作者应当把居民的事当成自己的事来办。'
const MATERIAL = ('城市治理 fine 化需要多方参与。' + FILLER).repeat(150) // ≈ 6900 字，接近整卷单则材料规模

// 场景 A：结构良好、字数达标（最常见形态，也是"零扣分"路径）
const answerA = Array.from({ length: 6 }, (_, i) => `一是第${i + 1}项做法。${FILLER}`).join('') // ≈ 280 字

// 场景 B：超字数 + 无序号（触发字数与结构两类规则）
const answerB = (FILLER.repeat(12)).slice(0, 520)

// 场景 C：大段照抄材料（触发重复照抄规则）
const answerC = MATERIAL.slice(0, 400) + '综上所述。' + MATERIAL.slice(500, 800)

const CASES = [
  { name: 'A 达标作答', answer: answerA, wordLimit: 300, type: '归纳概括' },
  { name: 'B 超字数', answer: answerB, wordLimit: 300, type: '归纳概括' },
  { name: 'C 照抄材料', answer: answerC, wordLimit: 300, type: '归纳概括' },
]

const N = 2000
const fmt = (us) => (us >= 1000 ? `${(us / 1000).toFixed(2)}ms` : `${us.toFixed(0)}µs`)

let worstAll = 0
console.log(`硬规则基准：每场景 ${N} 次，材料 ${MATERIAL.length} 字\n`)
for (const c of CASES) {
  // 预热（JIT 编译不算用户耗时）
  for (let i = 0; i < 50; i++) {
    runHardRules({ answer: c.answer, material: MATERIAL, requirement: '全面准确，条理清晰，不超过300字。', wordLimit: c.wordLimit, maxScore: 20, type: c.type })
  }
  const times = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    runHardRules({ answer: c.answer, material: MATERIAL, requirement: '全面准确，条理清晰，不超过300字。', wordLimit: c.wordLimit, maxScore: 20, type: c.type })
    times.push((performance.now() - t0) * 1000) // µs
  }
  times.sort((x, y) => x - y)
  const avg = times.reduce((s, v) => s + v, 0) / N
  const p95 = times[Math.floor(N * 0.95)]
  const max = times[N - 1]
  worstAll = Math.max(worstAll, max)
  const findings = runHardRules({ answer: c.answer, material: MATERIAL, requirement: '全面准确，条理清晰，不超过300字。', wordLimit: c.wordLimit, maxScore: 20, type: c.type }).findings.length
  console.log(`场景${c.name}：平均 ${fmt(avg)} ｜ p95 ${fmt(p95)} ｜ 最差 ${fmt(max)} ｜ 命中 ${findings} 条`)
}

console.log(`\n全场景最差单次：${fmt(worstAll)}（验收线 ≤ 100ms → ${worstAll / 1000 <= 100 ? '✅ 达标' : '❌ 超标'}）`)
