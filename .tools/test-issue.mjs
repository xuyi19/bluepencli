// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 发放工具（issue.mjs）的测试。
//
// 这里要验的不是"代码能跑"，而是**几条约束真的拦得住人**：
//   · 换一批人必须换口令 —— 手滑复用别的批次的口令要被拒
//   · 同批次的人共用一个口令，但每份包的水印必须各自不同（泄露才溯得到人）
//   · 台账里的 sha256 事后能用来确认"流转的就是我发的那份"
// 这三条都是"平时看不出问题、出事时后悔没做"的东西，所以必须有断言兜着。
//
// 全程在临时目录里跑（环境变量改写路径），**不碰真正的批次表与台账**。
//
// 用法：node .tools/test-issue.mjs

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { decryptPayload, signText, signingText, toB64, verifyText } from '../frontend/src/bpq/crypto.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const ISSUE = path.join(ROOT, '.tools', 'exams', 'issue.mjs')
const SANDBOX = path.join(ROOT, '.smoke', 'issue-test')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })

// ── 临时密钥 + 一份明文包（都不碰本机真私钥） ────────────────
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const privateB64 = toB64(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
const publicB64 = toB64(await crypto.subtle.exportKey('spki', kp.publicKey))
const PRIV_FILE = path.join(SANDBOX, 'test-private.b64')
writeFileSync(PRIV_FILE, privateB64, 'utf8')

const STEM = '请概括数字乡村建设的主要做法。'
const plainPack = {
  format: 'bluepencil-bpq', magic: 'BPQ00001', version: 1,
  issuer: '许一 <xuconghui_03@qq.com>', issuedAt: '2026-09-17T10:00:00+08:00',
  license: '仅供个人学习', userFingerprint: '原始水印', tier: 'private',
  yearRange: [2022, 2024],
  exams: [{
    id: 'demo-1', year: 2024, paper: '副省级', title: '演示卷',
    material: '材料1\n某市推进数字乡村建设……',
    questions: [{ no: 1, type: '归纳概括', stem: STEM, requirement: '全面准确', score: 15, wordLimit: 250, reference: '一是……' }],
  }],
}
// 校验和不是这里要测的东西，但格式检查会看，所以照 v1 规则算一个
const PLAIN_FILE = path.join(SANDBOX, 'demo-明文.bpq')
{
  const { checksum, ...rest } = plainPack
  void checksum
  const sorted = JSON.stringify(rest, Object.keys(rest).sort())
  let h = 0x811c9dc5
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  plainPack.checksum = h.toString(16).padStart(8, '0')
  plainPack.checksumAlgo = 'fnv1a32'
}
writeFileSync(PLAIN_FILE, JSON.stringify(plainPack, null, 1), 'utf8')

const BATCH_FILE = path.join(SANDBOX, 'batches.json')
const LEDGER = path.join(SANDBOX, 'ledger', '发放台账.json')
const OUT_DIR = path.join(SANDBOX, 'out')

const env = {
  ...process.env,
  BPQ_BATCH_FILE: BATCH_FILE,
  BPQ_LEDGER: LEDGER,
  BPQ_PRIVATE_KEY: PRIV_FILE,
  BPQ_PUBKEY: publicB64,
  BPQ_OUT_DIR: OUT_DIR,
}

/** 跑一次 CLI，返回 { code, out, err }（不抛异常，失败也是数据） */
function run(args) {
  const r = spawnSync(process.execPath, [ISSUE, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' }
}

const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex')
const readBatches = () => JSON.parse(readFileSync(BATCH_FILE, 'utf8')).batches
const readLedger = () => JSON.parse(readFileSync(LEDGER, 'utf8')).records

// ── 1. 建批次 ─────────────────────────────────────────────
const b1 = run(['--new-batch', '2026秋-1班', '--note', '第一批试发'])
check('新建批次成功并打印口令', /口令：(?=\S)[A-Z0-9-]+/.test(b1.out.replace(/\s/g, '')), b1.out.split('\n').find((l) => l.includes('口令：')) || '')
const batchA = readBatches()[0]
check('批次落盘（含口令与口令指纹）',
  !!batchA && batchA.name === '2026秋-1班' && !!batchA.passphrase && !!batchA.passphraseHash)
check('口令是生成的、不是空的', (batchA?.passphrase || '').length >= 20, batchA?.passphrase)

// 生成的口令不该出现易混字符（要口头传，0/O、1/l 会传错）
check('口令不含易混字符（0/O/1/I/l）', !/[0O1Il]/.test(batchA.passphrase), batchA.passphrase)

// ── 2. 同名批次不许重开 ────────────────────────────────────
const dup = run(['--new-batch', '2026秋-1班'])
check('同名批次重复创建被拒', dup.code !== 0 && readBatches().length === 1)

// ── 3. 发第一份 ───────────────────────────────────────────
const i1 = run(['--user', '张三/zhangsan@example.com', '--batch', '2026秋-1班', '--in', PLAIN_FILE])
check('发放成功', i1.code === 0, i1.out.split('\n')[0])
const rec1 = readLedger()[0]
check('台账记录了收件人 / 批次 / 文件 / 哈希',
  rec1 && rec1.user === '张三/zhangsan@example.com' && rec1.batch === '2026秋-1班'
  && !!rec1.file && !!rec1.sha256)

const pack1File = path.join(ROOT, rec1.file)
const pack1Text = readFileSync(pack1File, 'utf8')
check('台账哈希与磁盘文件一致（事后可用来证明"流转的就是这份"）',
  sha256(pack1Text) === rec1.sha256)

// 台账是给人看的，"哪天发的"必须跟本人当天对得上。
// toISOString() 是 UTC，本机 +8，凌晨发的包会被记成前一天 —— 这里钉住。
const localToday = (() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
check('台账记的是本地日期（跨零点不会记成前一天）', rec1.at.slice(0, 10) === localToday,
  `记录 ${rec1.at} / 今天 ${localToday}`)
check('发放时间带本地时区偏移（不是 Z）', /[+-]\d{2}:\d{2}$/.test(rec1.at), rec1.at)

// ── 4. 同批次第二人：同口令、不同水印、不同密文 ──────────────
const i2 = run(['--user', '李四/lisi@example.com', '--batch', '2026秋-1班', '--in', PLAIN_FILE])
check('同批次发第二份成功', i2.code === 0)
const rec2 = readLedger()[1]
const pack2File = path.join(ROOT, rec2.file)
const pack2 = JSON.parse(readFileSync(pack2File, 'utf8'))
const pack1 = JSON.parse(pack1Text)

check('两份包的水印各自不同（泄露才溯得到人）',
  pack1.userFingerprint === '张三/zhangsan@example.com'
  && pack2.userFingerprint === '李四/lisi@example.com',
  `${pack1.userFingerprint} / ${pack2.userFingerprint}`)
check('同一个明文包，两份密文不同（每次加密都换 IV）',
  pack1.crypto.ciphertext !== pack2.crypto.ciphertext)

const d1 = await decryptPayload(pack1.crypto, batchA.passphrase)
const d2 = await decryptPayload(pack2.crypto, batchA.passphrase)
check('同批次的口令能开这两份包，且内容一致',
  d1.exams[0].questions[0].stem === STEM && d2.exams[0].questions[0].stem === STEM)

// ── 5. 换批必须换口令 ─────────────────────────────────────
const b2 = run(['--new-batch', '2026秋-2班'])
const batchB = readBatches().find((b) => b.name === '2026秋-2班')
check('新批次的口令与上一批不同', !!batchB && batchB.passphrase !== batchA.passphrase,
  `${batchA.passphrase} vs ${batchB?.passphrase}`)

const reuse = run(['--new-batch', '2026秋-3班', '--passphrase', batchA.passphrase])
check('显式复用别的批次的口令 → 被拒（这就是"换批换口令"的约束）',
  reuse.code !== 0 && !readBatches().some((b) => b.name === '2026秋-3班'),
  reuse.err.split('\n')[0])

const reuseOk = run(['--new-batch', '2026秋-3班', '--passphrase', batchA.passphrase, '--allow-reuse'])
check('明确认账（--allow-reuse）时才放行', reuseOk.code === 0
  && readBatches().some((b) => b.name === '2026秋-3班'))

// ── 6. 口令批次不夸功能：--list 不打印口令 ─────────────────
const listed = run(['--list'])
check('--list 只列批次、不打印口令',
  !listed.out.includes(batchA.passphrase) && listed.out.includes('2026秋-1班'))

const shown = run(['--show-passphrase', '2026秋-1班'])
check('--show-passphrase 才把口令打出来', shown.out.includes(batchA.passphrase))

// ── 7. 签名与水印不可改 ───────────────────────────────────
const sig1 = await verifyText(signingText(pack1), pack1.sig.value, publicB64)
check('发出去的包能用公钥验签', sig1.ok === true)

const tampered = { ...pack1, userFingerprint: '王五/wangwu@example.com' }
const sig2 = await verifyText(signingText(tampered), tampered.sig.value, publicB64)
check('改水印（想甩锅给别人）→ 验签失败', sig2.ok === false)

// ── 8. 台账核对 ───────────────────────────────────────────
const vOk = run(['--verify-ledger'])
check('--verify-ledger 对未改动的包报一致', vOk.code === 0, vOk.out.trim().split('\n').pop())

const mdText = readFileSync(LEDGER.replace(/\.json$/, '.md'), 'utf8')
check('生成人可读的台账 md（含收件人与批次）',
  mdText.includes('张三/zhangsan@example.com') && mdText.includes('2026秋-1班'))

// 篡改一份包，核对必须发现
{
  const t = JSON.parse(readFileSync(pack2File, 'utf8'))
  t.license = '随便改改'
  writeFileSync(pack2File, JSON.stringify(t, null, 1), 'utf8')
}
const vBad = run(['--verify-ledger'])
check('包被改动后 --verify-ledger 报哈希不一致', vBad.code !== 0
  && vBad.out.includes('哈希不一致'))

// ── 收尾 ─────────────────────────────────────────────────
console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`发放工具测试：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))

if (failed.length) {
  console.log(`\n现场保留在 ${path.relative(ROOT, SANDBOX)}（含批次表与台账），便于排查。`)
} else {
  rmSync(SANDBOX, { recursive: true, force: true })
}
process.exit(failed.length ? 1 : 0)
