// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 一键回归：把散着的测试收成一个入口，发版前跑这一条就够。
//
//   node .tools/test-all.mjs            # 全量（前端测试套件 + pytest）
//   node .tools/test-all.mjs --fast     # 只跑前端测试套件（不起 Python）
//
// 约定：每个测试脚本自己负责 process.exit(非0表示失败)，
// 这里只做编排与汇总 —— 谁红了在总表里一目了然，别再凭记忆逐个跑。

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fast = process.argv.includes('--fast')

// 前端测试套件：.tools/test-*.mjs 全量收集（新加测试自动进队列，不用登记）。
// ⚠️ 必须排除本脚本自己 —— 收集规则会匹配到 test-all.mjs，spawn 自己
// 就是无限递归：递归层还会并发跑同一批测试、抢同一批端口
// （实测 md-parity 的 CDP 端口就是这么被抢红的，单跑明明是绿的）。
const suites = readdirSync(path.join(ROOT, '.tools'))
  .filter((f) => /^test-.*\.mjs$/.test(f) && f !== 'test-all.mjs')
  .sort()
  .map((f) => ({ name: f, cmd: 'node', args: [`.tools/${f}`] }))

if (!fast) {
  // 后端 pytest（backend/.venv，pytest.ini 在仓库根）
  suites.push({
    name: 'pytest (backend)',
    cmd: 'backend/.venv/Scripts/python.exe',
    args: ['-m', 'pytest', '-q'],
  })
}

const results = []
for (const s of suites) {
  const t0 = Date.now()
  const r = spawnSync(s.cmd, s.args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
  const ms = Date.now() - t0
  const out = (r.stdout || '') + (r.stderr || '')
  const status = r.status === 0 ? '✓' : '✗'
  // 摘要行：优先找含统计关键词的行（pytest 的最后一行是 "...." 点行，没信息量）
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
  const summary =
    lines.findLast((l) => /passed|failed|通过|失败/.test(l) && !l.startsWith('.'))?.slice(0, 52) ||
    (lines.at(-1) || '').slice(0, 52)
  results.push({ name: s.name, status, summary, failed: r.status !== 0, ms })
  // 耗时守卫：起桌面版 exe 的重型测试（md-parity 实测热启动约 1.7s）如果
  // 秒过（<1.2s），大概率连上了残留实例或者根本没真跑 —— 结果可信度存疑，必须喊出来。
  if (ms < 1200 && /parity|e2e|probe/.test(s.name)) {
    console.log(`⚠ ${s.name} 只用了 ${ms}ms —— 起桌面版 exe 的测试不该这么快，先查有没有残留实例，这条结果别直接信。`)
  }
  if (r.status !== 0) {
    console.log(`\n----- ${s.name} 失败详情（尾 30 行）-----`)
    console.log(out.split('\n').slice(-30).join('\n'))
  }
}

console.log('\n' + '═'.repeat(60))
for (const r of results) console.log(`${r.status} ${r.name.padEnd(32)} ${String((r.ms / 1000).toFixed(1) + 's').padStart(6)}  ${r.summary}`)
const failed = results.filter((r) => r.failed)
console.log('═'.repeat(60))
console.log(`${results.length - failed.length}/${results.length} 套通过${failed.length ? ' —— 有红的，别发版' : '，可以发版'}`)
process.exit(failed.length ? 1 : 0)
