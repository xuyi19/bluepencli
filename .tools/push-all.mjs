// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 一次提交推送到两个仓库（github + gitee）。
//
// 为什么要它：本项目有两个 remote，手打两遍 push 迟早会漏一个 ——
// 漏了之后两个仓库的内容就不一致，而"以哪个为准"是最费时间的一类问题。
//
// 用法（仓库根目录）：
//   node .tools/push-all.mjs                    # 推送当前分支到两个 remote
//   node .tools/push-all.mjs -m "提交说明"       # 先提交全部改动再推
//   node .tools/push-all.mjs --dry              # 只看会推什么，不真推

import { execFileSync } from 'node:child_process'

const REMOTES = ['github', 'gitee']
const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const msgIdx = argv.findIndex((a) => a === '-m' || a === '--message')
const message = msgIdx >= 0 ? argv[msgIdx + 1] : null

function git(args, { quiet = false } = {}) {
  const out = execFileSync('git', args, { encoding: 'utf8', stdio: quiet ? 'pipe' : ['pipe', 'pipe', 'pipe'] })
  return out.trim()
}

function run(args) {
  const out = execFileSync('git', args, { encoding: 'utf8', stdio: 'inherit' })
  return out
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
console.log(`分支：${branch}`)

if (message) {
  const dirty = git(['status', '--porcelain'])
  if (!dirty) {
    console.log('工作区干净，跳过提交')
  } else {
    console.log('暂存全部改动…')
    run(['add', '-A'])
    // 推之前先看一眼"到底提交了什么"——把 .gitignore 漏掉私有数据这种事在推送前拦下来
    console.log(git(['status', '--short']))
    run(['commit', '-m', message])
  }
}

const ahead = git(['log', '--oneline', `origin/${branch}..${branch}`])
  || git(['log', '--oneline', `${REMOTES[0]}/${branch}..${branch}`])
console.log(`\n待推送提交：\n${ahead || '（无）'}`)

if (dry) {
  console.log('\n--dry：没有真的推送')
  process.exit(0)
}

let failed = 0
for (const r of REMOTES) {
  const has = (() => {
    try { git(['remote', 'get-url', r], { quiet: true }); return true } catch { return false }
  })()
  if (!has) {
    console.log(`  ⚠ 没有配置 remote「${r}」，跳过`)
    continue
  }
  try {
    console.log(`\n→ 推送到 ${r} …`)
    run(['push', r, branch])
    console.log(`  ✓ ${r} 完成`)
  } catch {
    failed++
    console.log(`  ✗ ${r} 推送失败（网络/鉴权问题，另一个仓库不受影响，可单独重试）`)
  }
}

console.log(failed ? `\n${failed} 个仓库推送失败` : '\n✓ 两个仓库都已更新')
process.exit(failed ? 1 : 0)
