// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 私有题库包的**发放**工具：管口令批次 + 记发放台账。**作者专用。**
//
// 它解决两个手工做不好的事：
//
//   ① **口令批次**。同一批人应当共用一个口令，换一批人必须换口令。
//      手工做的结果是"图省事一直用同一个口令"—— 一个人泄露，全批人的包都成了
//      公开资源。所以口令不能手输：新批次一律**随机生成**，并且显式想复用
//      别的批次的口令时会**直接拒绝**（除非 --allow-reuse 明确认账）。
//
//   ② **发放台账**。记下发给了谁、哪一批口令、哪个文件、**文件的 sha256**。
//      哈希是这里的关键：事后对方手上那份包流转出去，能靠哈希确认
//      "流转的就是我发给他的那一份"，再配合包内的使用者水印追到人。
//      没有哈希的台账只是记事本，证明不了任何事。
//
// 用法（仓库根目录）：
//   node .tools/exams/issue.mjs --new-batch "2026秋-1班" --note "第一批试发"
//   node .tools/exams/issue.mjs --list
//   node .tools/exams/issue.mjs --user "张三/zhangsan@example.com" --batch "2026秋-1班"
//   node .tools/exams/issue.mjs --ledger
//   node .tools/exams/issue.mjs --verify-ledger
//   node .tools/exams/issue.mjs --show-passphrase "2026秋-1班"    # 要发口令时才打印
//
// 口令的传递：**绝不跟包走同一条路**。包用微信发，口令当面说或另发一条消息。
// 这里打印的口令只会出现在你自己的终端里，不写进任何会外发的文件。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

import {
  PRIVATE_DEST,
  PRIVATE_FILE,
  ROOT,
  readPubKeys,
  safeName,
  sealPack,
  selfCheck,
} from './seal-core.mjs'

const EXAMS_DIR = import.meta.dirname
// 路径可用环境变量改写：测试要在临时目录里跑，绝不能把假数据写进真台账。
// 顺带也方便作者另开一套"试验批次"而不污染正式台账。
const BATCH_FILE = process.env.BPQ_BATCH_FILE || path.join(EXAMS_DIR, 'batches.json')
// 发放台账跟着私有题库走（都在 `私有题库/` 里）：台账记着"发给谁、哪批口令、
// 文件 sha256"，与它服务的 .bpq 放在一起最不容易散。
const LEDGER_JSON = process.env.BPQ_LEDGER
  || path.join(ROOT, '私有题库', '发放台账.json')
const LEDGER_MD = LEDGER_JSON.replace(/\.json$/i, '.md')
const PRIVATE_KEY_FILE = process.env.BPQ_PRIVATE_KEY || PRIVATE_FILE
const PUBKEYS = process.env.BPQ_PUBKEY ? [process.env.BPQ_PUBKEY] : readPubKeys()
// 产出目录：测试写临时目录，免得往 私有题库/ 里丢测试包
const OUT_DIR = process.env.BPQ_OUT_DIR || PRIVATE_DEST

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name) => argv.includes('--' + name)

// ── 口令：随机生成，且字符集避开容易看错的一对 ────────────────
// 口令是要**口头/手打**传过去的，所以不用 0/O、1/l/I 这些分不清的字符。
// 分 4 组、每组 5 位，方便念："K7RM2-9XPT4-…"
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newPassphrase(groups = 4, size = 5) {
  const out = []
  for (let g = 0; g < groups; g++) {
    let s = ''
    // 逐字节取模有偏（256 % 32 == 0 才无偏），这里 32 整除 256，正好无偏
    for (const b of randomBytes(size)) s += ALPHABET[b % ALPHABET.length]
    out.push(s)
  }
  return out.join('-')
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// ── 本地状态（含口令，绝不进版本库） ─────────────────────────
function readBatches() {
  if (!existsSync(BATCH_FILE)) return { batches: [] }
  try {
    const j = JSON.parse(readFileSync(BATCH_FILE, 'utf8'))
    return { batches: Array.isArray(j.batches) ? j.batches : [] }
  } catch {
    console.error(`× ${path.relative(ROOT, BATCH_FILE)} 读不动（不是合法 JSON）`)
    process.exit(1)
  }
}
function writeBatches(state) {
  writeFileSync(BATCH_FILE, JSON.stringify(state, null, 1), 'utf8')
}
function readLedger() {
  if (!existsSync(LEDGER_JSON)) return { records: [] }
  try {
    const j = JSON.parse(readFileSync(LEDGER_JSON, 'utf8'))
    return { records: Array.isArray(j.records) ? j.records : [] }
  } catch {
    return { records: [] }
  }
}
function writeLedger(state) {
  mkdirSync(path.dirname(LEDGER_JSON), { recursive: true })
  writeFileSync(LEDGER_JSON, JSON.stringify(state, null, 1), 'utf8')
  writeFileSync(LEDGER_MD, renderLedgerMd(state), 'utf8')
}

// 本地时间，不用 toISOString()：那是 UTC，本机 +8，
// 凌晨发的包（本地 07:00 = UTC 前一天 23:00）会被记成前一天。
// 台账是要拿给人看的，"哪天发的"必须跟本人当天对得上。
const pad2 = (n) => String(n).padStart(2, '0')
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function localISO(d = new Date()) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const hh = pad2(Math.floor(Math.abs(off) / 60))
  const mm = pad2(Math.abs(off) % 60)
  return `${localStamp(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${hh}:${mm}`
}

const fmtDate = (s) => String(s || '').slice(0, 10)

function renderLedgerMd(state) {
  const rows = state.records
  const lines = []
  lines.push('# 蓝笔申论 · 私有题库包发放台账')
  lines.push('')
  lines.push('> 本文件由 `.tools/exams/issue.mjs` 自动生成，**不进版本库**。')
  lines.push('> `sha256` 是发放当时那份包文件的哈希 —— 事后可用来确认「流转的那份就是我发的那份」。')
  lines.push('')
  lines.push(`共 ${rows.length} 条记录。`)
  lines.push('')
  if (rows.length) {
    lines.push('| 发放时间 | 收件人 | 口令批次 | 包文件 | 卷/题 | sha256 |')
    lines.push('|---|---|---|---|---|---|')
    for (const r of rows) {
      lines.push(`| ${fmtDate(r.at)} | ${r.user} | ${r.batch} | ${r.file}`
        + ` | ${r.exams}/${r.questions} | \`${r.sha256.slice(0, 16)}…\` |`)
    }
  }
  lines.push('')
  lines.push('## 口令批次（只列批次，不列口令）')
  lines.push('')
  const byBatch = {}
  for (const r of rows) byBatch[r.batch] = (byBatch[r.batch] || 0) + 1
  for (const [name, n] of Object.entries(byBatch)) {
    lines.push(`- **${name}**：已发 ${n} 份`)
  }
  lines.push('')
  return lines.join('\n')
}

// ── 子命令 ─────────────────────────────────────────────────

function listBatches() {
  const { batches } = readBatches()
  if (!batches.length) {
    console.log('（还没有口令批次。用 --new-batch "批次名" 建一个）')
    return 0
  }
  const ledger = readLedger()
  console.log('口令批次（口令不在这里显示；要发口令用 --show-passphrase <批次>）：')
  for (const b of batches) {
    const n = ledger.records.filter((r) => r.batch === b.name).length
    console.log(`  · ${b.name}  建 ${fmtDate(b.createdAt)}  已发 ${n} 份`
      + `  口令指纹 ${b.passphraseHash.slice(0, 8)}${b.note ? `  （${b.note}）` : ''}`)
  }
  return 0
}

function showPassphrase(name) {
  const { batches } = readBatches()
  const b = batches.find((x) => x.name === name)
  if (!b) {
    console.error(`没有这个批次：${name}`)
    return 1
  }
  console.log(`批次「${b.name}」的口令：`)
  console.log('')
  console.log(`  ${b.passphrase}`)
  console.log('')
  console.log('  提醒：跟包分开说 —— 包用微信发，口令当面说或另发一条消息。')
  return 0
}

function newBatch(name, note) {
  if (!name) {
    console.error('用法：--new-batch "批次名" [--note "备注"]')
    return 1
  }
  const state = readBatches()
  if (state.batches.some((b) => b.name === name)) {
    console.error(`批次「${name}」已存在。换一批人请用**新的批次名** —— 这正是"换批换口令"的意思。`)
    return 1
  }

  const explicit = arg('passphrase')
  let passphrase = explicit || newPassphrase()

  // 「换批要换口令」的约束落在这里：显式给的口令撞上别的批次就拒绝。
  // 随机生成的口令不会撞上（210 位熵），所以只有手输才会触发。
  const clash = state.batches.find((b) => b.passphrase === passphrase)
  if (clash) {
    if (!has('allow-reuse')) {
      console.error(`× 这个口令已经是批次「${clash.name}」在用。`)
      console.error('  同一口令跨批，等于一批泄露牵连所有人。换个口令，')
      console.error('  或者确认这是有意为之再加 --allow-reuse。')
      return 1
    }
    console.warn(`⚠ 口令与批次「${clash.name}」相同（--allow-reuse 已确认）。`)
  }

  const entry = {
    name,
    note: note || '',
    createdAt: localISO(),
    passphrase,
    // 存哈希是为了能列出批次而不用把口令显示出来
    passphraseHash: sha256(passphrase),
  }
  state.batches.push(entry)
  writeBatches(state)

  console.log(`✓ 已建批次「${name}」`)
  console.log('')
  console.log(`  口令：${passphrase}`)
  console.log('')
  console.log(`  记下来 —— 这个口令只在建批次时完整显示这一次，`)
  console.log(`  以后要用 --show-passphrase "${name}" 查。`)
  console.log(`  批次台账：${path.relative(ROOT, BATCH_FILE)}（含口令，已 gitignore）`)
  return 0
}

async function issue(user, batchName) {
  if (!user) {
    console.error('用法：--user "姓名/邮箱" --batch "批次名"')
    return 1
  }
  const { batches } = readBatches()
  const batch = batches.find((b) => b.name === batchName)
  if (!batch) {
    console.error(`没有批次「${batchName}」。先 --new-batch 建一个，或 --list 看现有的。`)
    return 1
  }
  if (!existsSync(PRIVATE_KEY_FILE)) {
    console.error('没有签名私钥。先跑：node .tools/exams/bpq-keygen.mjs --force')
    return 1
  }

  const inFile = arg('in') || pickLatestPlain()
  if (!inFile || !existsSync(inFile)) {
    console.error('找不到明文包。先用 export_bpq.py 生成，或显式 --in <文件>')
    return 1
  }

  const plain = JSON.parse(readFileSync(inFile, 'utf8'))
  const privateKey = readFileSync(PRIVATE_KEY_FILE, 'utf8').trim()
  const passphrase = batch.passphrase

  let out
  try {
    // 水印逐人改写：同一个批次口令，但每份包的水印不同 —— 泄露才能溯到具体的人。
    // 同时重新加密（新 IV），所以同一个明文包发给两个人，密文也不一样。
    out = await sealPack(plain, passphrase, privateKey, PUBKEYS, {
      userFingerprint: user,
      issuedAt: localISO(),
    })
  } catch (err) {
    console.error(`× 封装失败：${err?.message || err}`)
    return 1
  }

  const sc = await selfCheck(out, passphrase, PUBKEYS)
  if (!sc.signature || !sc.reopened) {
    console.error(`× 自检没过（签名 ${sc.signature} / 回读 ${sc.reopened}），这份不要发出去。`)
    return 1
  }

  const stamp = localStamp().replace(/-/g, '')
  const outName = arg('out-name')
    || `私有题库-${safeName(batchName)}-${safeName(user)}-${stamp}.bpq`
  const outFile = path.join(OUT_DIR, outName)
  mkdirSync(OUT_DIR, { recursive: true })
  const text = JSON.stringify(out, null, 1)
  writeFileSync(outFile, text, 'utf8')

  const record = {
    at: localISO(),
    user,
    batch: batchName,
    file: path.relative(ROOT, outFile).replace(/\\/g, '/'),
    sha256: sha256(text),
    exams: out.examCount,
    questions: out.questionCount,
    yearRange: out.yearRange,
    keyId: out.sig.keyId,
    from: path.relative(ROOT, inFile).replace(/\\/g, '/'),
  }
  const ledger = readLedger()
  ledger.records.push(record)
  writeLedger(ledger)

  console.log(`✓ 已发放：${record.file}`)
  console.log(`  收件人水印：${out.userFingerprint}`)
  console.log(`  卷 ${out.examCount} 套 / 题 ${out.questionCount} 道｜年份 ${out.yearRange.join('–')}`)
  console.log(`  口令批次：${batchName}（口令另外单独告诉对方）`)
  console.log(`  签名 ${sc.keyId}｜自检：验签✓ 回读✓`)
  console.log(`  sha256：${record.sha256}`)
  console.log('')
  console.log(`  台账已记：${path.relative(ROOT, LEDGER_MD).replace(/\\/g, '/')}`)
  console.log(`  要口令：node .tools/exams/issue.mjs --show-passphrase "${batchName}"`)
  return 0
}

function pickLatestPlain() {
  if (!existsSync(OUT_DIR)) return null
  const files = readdirSync(OUT_DIR)
    // 只挑 export_bpq.py 出的明文包：加密包 magic 是 BPQ00002，不能拿来做输入
    .filter((f) => f.endsWith('.bpq') && !f.includes('-加密'))
    .map((f) => path.join(OUT_DIR, f))
    .filter((f) => {
      try {
        return JSON.parse(readFileSync(f, 'utf8')).magic === 'BPQ00001'
      } catch {
        return false
      }
    })
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  return files.length ? files[files.length - 1] : null
}

function printLedger() {
  const state = readLedger()
  if (!state.records.length) {
    console.log('（台账还是空的）')
    return 0
  }
  console.log(renderLedgerMd(state))
  return 0
}

/** 核对台账：文件还在不在、哈希还对不对 */
function verifyLedger() {
  const state = readLedger()
  if (!state.records.length) {
    console.log('（台账还是空的）')
    return 0
  }
  let bad = 0
  for (const r of state.records) {
    const f = path.join(ROOT, r.file)
    if (!existsSync(f)) {
      console.log(`· ${r.user}  ${r.file}  —— 文件已不在本机（发出去过就正常）`)
      continue
    }
    const now = sha256(readFileSync(f, 'utf8'))
    if (now === r.sha256) {
      console.log(`✓ ${r.user}  ${path.basename(r.file)}  哈希一致`)
    } else {
      bad += 1
      console.log(`× ${r.user}  ${path.basename(r.file)}  哈希不一致！`
        + `\n    台账 ${r.sha256.slice(0, 16)}… / 实际 ${now.slice(0, 16)}…`)
    }
  }
  console.log('')
  console.log(bad
    ? `× ${bad} 份包的哈希对不上 —— 文件被改过，或者台账被改过。`
    : '✓ 台账与磁盘文件一致。')
  return bad ? 1 : 0
}

// ── 入口 ───────────────────────────────────────────────────
if (has('help') || argv.length === 0) {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n')
    .filter((l) => l.startsWith('//   node ') || l.startsWith('// 用法'))
    .map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}

let code = 0
if (has('list')) code = listBatches()
else if (arg('show-passphrase') !== undefined) code = showPassphrase(arg('show-passphrase'))
else if (arg('new-batch') !== undefined) code = newBatch(arg('new-batch'), arg('note'))
else if (arg('user') !== undefined || arg('batch') !== undefined) {
  code = await issue(arg('user'), arg('batch'))
} else if (has('ledger')) code = printLedger()
else if (has('verify-ledger')) code = verifyLedger()
else {
  console.error('不认识的参数。用 --help 看用法。')
  code = 1
}
process.exit(code)
