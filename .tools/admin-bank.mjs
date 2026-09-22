// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库管理员端 · 统一入口（作者/管理员专用）
//
// 把散在 .tools/exams/ 与 .tools/ 的题库运维动作收到一条命令后面，
// **不重新实现任何加密** —— 打包/验签仍走原有的 export_bpq.py 与 seal-bpq.mjs。
//
//   node .tools/admin-bank.mjs list
//       盘点：公开卷 / 私有卷源 / 采分点标准 / 分发包 / 汇编文档，各有多少。
//
//   node .tools/admin-bank.mjs pack --user "姓名<邮箱>" [--year-from 2022] [--year-to 2024]
//       一条龙：源 JSON → 明文题库包（export_bpq.py）→ 加密签名包（seal-bpq.mjs）→ 自检。
//       口令用 --passphrase 或环境变量 BPQ_PASSPHRASE；**都不给就拒跑**（口令不能留默认值）。
//
//   node .tools/admin-bank.mjs verify 私有题库/xxx.bpq [--passphrase ...]
//       发包前的最后一道检查（验签 + 解密自检）。
//
//   node .tools/admin-bank.mjs docs [--private]
//       重新生成题库汇编文档（材料汇编 + 参考答案汇编），--private 追加私有卷。
//
// 发包口诀（发之前读一遍）：
//   · 包和口令**分开两条路**发（包走微信，口令当面/电话说）；
//   · 发完跑 verify 确认收到的就是能打开的那份；
//   · 明文包（*-明文.bpq）永远不外发，只在本机中转。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const NODE = process.execPath
const PY = path.join(ROOT, 'backend/.venv/Scripts/python.exe')

const argv = process.argv.slice(2)
const cmd = argv[0]
const arg = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}

function run(prog, args, label) {
  console.log(`\n▶ ${label}`)
  console.log(`  $ ${path.basename(prog)} ${args.join(' ').replace(/(--passphrase)\s+\S+/g, '$1 ***')}`)
  const r = spawnSync(prog, args, { stdio: 'inherit', cwd: ROOT })
  if (r.status !== 0) {
    console.error(`\n✗ ${label} 失败（exit ${r.status}）—— 上面的步骤停在半路，别把半成品发出去。`)
    process.exit(r.status || 1)
  }
}

function countExams(dir) {
  if (!existsSync(dir)) return { exams: 0, questions: 0, chars: 0 }
  let exams = 0
  let questions = 0
  let chars = 0
  for (const f of readdirSync(dir).filter((x) => /^exam-\d+.*\.js$/.test(x))) {
    const content = require0(path.join(dir, f))
    exams++
    questions += content.questions.length
    chars += (content.material || '').length
  }
  return { exams, questions, chars }
}

// 读 exam-*.js：只需卷元信息，直接正则抠 JSON（比 import 免去 loader 配置）
function require0(file) {
  const s = readFileSync(file, 'utf8')
  const i = s.indexOf('export default')
  return JSON.parse(s.slice(i + 14).trim())
}

const fmtBytes = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'

// ────────────────────────────── list
function list() {
  console.log('蓝笔申论 · 题库盘点\n' + '═'.repeat(50))
  const pub = countExams(path.join(ROOT, 'frontend/src/data/real-exams'))
  console.log(`公开卷源  ${pub.exams} 套 / ${pub.questions} 题 · 材料 ${pub.chars} 字（≤2021，随软件内置）`)
  const priv = countExams(path.join(ROOT, 'frontend/src/data/real-exams-private'))
  console.log(`私有卷源  ${priv.exams ? priv.exams + ' 套 / ' + priv.questions + ' 题 · 材料 ' + priv.chars + ' 字（2022+，仅本机）' : '无（本机没有，别人 clone 也没有）'}`)

  const stdDir = path.join(ROOT, 'frontend/src/data/standards')
  const stdFiles = existsSync(stdDir) ? readdirSync(stdDir).filter((f) => f.endsWith('.js')) : []
  const privStd = existsSync(path.join(ROOT, 'frontend/src/data/standards-private'))
  console.log(`采分点标准 ${stdFiles.join(', ') || '无'}${privStd ? ' + 私有标准（standards-private/）' : ''}`)
  console.log('          ⚠️ 标准只在批改时注入，任何导出/汇编都不含它。')

  const bpqDir = path.join(ROOT, '私有题库')
  const packs = existsSync(bpqDir)
    ? readdirSync(bpqDir).filter((f) => f.endsWith('.bpq'))
    : []
  if (packs.length) {
    console.log(`\n分发包（私有题库/）`)
    for (const f of packs) {
      const st = statSync(path.join(bpqDir, f))
      const kind = f.includes('明文') ? '⚠️ 明文（只在本机中转，绝不外发）' : '加密包（外发用这份）'
      console.log(`  ${f}  ${fmtBytes(st.size)}  ${st.mtime.toISOString().slice(0, 10)}  ${kind}`)
    }
  } else {
    console.log('\n分发包：还没有（用 pack 生成）')
  }
  if (existsSync(path.join(bpqDir, '汇编'))) {
    console.log(`私有汇编  私有题库/汇编/（gitignored，仅本机查看）`)
  }
  console.log(`\n下一步：pack 打新包 → verify 验包 → 包与口令分两条路发。`)
}

// ────────────────────────────── pack
function pack() {
  const user = arg('user') || ''
  const passphrase = arg('passphrase') || process.env.BPQ_PASSPHRASE || ''
  if (!passphrase) {
    console.error('✗ 没有给口令。用 --passphrase "…" 或环境变量 BPQ_PASSPHRASE。\n  口令永不写进脚本默认值 —— 留默认值等于没加密。')
    process.exit(1)
  }
  if (!existsSync(PY)) {
    console.error(`✗ 找不到 Python：${PY}\n  export_bpq.py 需要它；先建 backend/.venv 或改用系统 Python。`)
    process.exit(1)
  }
  const pyArgs = ['.tools/exams/export_bpq.py', '--user', user]
  if (arg('year-from')) pyArgs.push('--year-from', arg('year-from'))
  if (arg('year-to')) pyArgs.push('--year-to', arg('year-to'))
  run(PY, pyArgs, '第 1/3 步 · 源 JSON → 明文题库包')
  run(NODE, ['.tools/exams/seal-bpq.mjs', '--passphrase', passphrase], '第 2/3 步 · 明文包 → 加密 + 签名（seal 自带自检）')
  console.log('\n✓ 打包完成。发之前：')
  console.log('  1. node .tools/verify-bpq.mjs <加密包> --passphrase "…"   # 用口令再验一遍')
  console.log('  2. 包与口令分两条路发；口令批次登记走 .tools/exams/issue.mjs')
}

// ────────────────────────────── verify / docs
function verify() {
  const file = argv[1]
  if (!file) {
    console.error('用法：node .tools/admin-bank.mjs verify <file.bpq> [--passphrase "..."]')
    process.exit(1)
  }
  const args = ['.tools/verify-bpq.mjs', file]
  if (arg('passphrase')) args.push('--passphrase', arg('passphrase'))
  run(NODE, args, `验包 · ${file}`)
}

function docs() {
  const args = ['.tools/export-bank-docs.mjs']
  if (argv.includes('--private')) args.push('--private')
  run(NODE, args, '生成题库汇编文档')
}

// ────────────────────────────── main
const usage = `用法：
  node .tools/admin-bank.mjs list
  node .tools/admin-bank.mjs pack --user "姓名<邮箱>" [--year-from N] [--year-to N] [--passphrase "..."]
  node .tools/admin-bank.mjs verify <file.bpq> [--passphrase "..."]
  node .tools/admin-bank.mjs docs [--private]`
switch (cmd) {
  case 'list': list(); break
  case 'pack': pack(); break
  case 'verify': verify(); break
  case 'docs': docs(); break
  default: console.log(usage); process.exit(cmd ? 1 : 0)
}
