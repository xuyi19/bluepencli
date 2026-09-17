// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包加密 + 签名的端到端测试（作者侧封装 → 前端解析，走真实代码路径）。
//
// 为什么必须端到端：加密和验签**跨了两个进程**（作者用 Node 封装，用户用浏览器打开）。
// 两边只要有一处序列化顺序、编码格式或公钥对不上，用户那边就是"打开失败"，
// 而作者这边自测一切正常 —— 这类问题只有真跑一遍才拦得住。
//
// 覆盖的失败分支（比 happy path 更重要）：
//   · 口令错了            → 必须报"口令不对"，不能说"文件损坏"
//   · 密文被改一个字符    → 签名就该先把它拦下来
//   · **水印被改**         → 也要拦下来（否则"泄露可溯源"就是空话）
//   · 换成别人的公钥      → 验签必须失败（证明签名真的绑定了作者身份）
//   · v1 明文包           → 老流程不能坏（用户手上还有旧包）
//
// 测试自己生成临时密钥，不依赖本机 .tools/exams/keys/ 是否存在。
//
// 用法：node .tools/test-bpq-crypto.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { openSealedPack, packChecksum, parsePack, readPackFile } from '../frontend/src/bpq/importer.js'
import { encryptPayload, keyIdOf, signText, signingText, toB64 } from '../frontend/src/bpq/crypto.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

// ── 临时密钥对（每次跑都不一样，互不干扰） ──────────────────
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign', 'verify',
])
const privateB64 = toB64(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
const publicB64 = toB64(await crypto.subtle.exportKey('spki', kp.publicKey))
const strangerKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign', 'verify',
])
const strangerPub = toB64(await crypto.subtle.exportKey('spki', strangerKp.publicKey))

const PASSPHRASE = '测试口令-2026'
const FINGERPRINT = '张三/zhangsan@example.com'

function makePlainPack() {
  const exams = [{
    id: 'exam-2024-fusheng',
    year: 2024,
    paper: '副省级',
    title: '2024 年国考申论（副省级）',
    material: '材料1\n某市推进数字乡村建设……',
    questions: [{
      no: 1,
      type: '归纳概括',
      stem: '请概括该市数字乡村建设的主要做法。',
      requirement: '全面、准确、条理清晰',
      score: 15,
      wordLimit: 250,
      reference: '一是完善基础设施……',
    }],
  }]
  const pack = {
    format: 'bluepencil-bpq',
    magic: 'BPQ00001',
    version: 1,
    issuer: '许一 <xuconghui_03@qq.com>',
    issuedAt: '2026-09-17T10:00:00+08:00',
    license: '仅供个人备考学习使用。',
    userFingerprint: FINGERPRINT,
    tier: 'private',
    yearRange: [2024, 2024],
    exams,
    checksumAlgo: 'fnv1a32',
  }
  pack.checksum = packChecksum(pack)
  return pack
}

/** 作者侧封装：与 .tools/exams/seal-bpq.mjs 同一条路径 */
async function sealPack(plain, passphrase = PASSPHRASE, privateKey = privateB64) {
  const cryptoSection = await encryptPayload({ exams: plain.exams }, passphrase)
  const out = {
    format: 'bluepencil-bpq',
    magic: 'BPQ00002',
    version: 2,
    issuer: plain.issuer,
    issuedAt: plain.issuedAt,
    license: plain.license,
    userFingerprint: plain.userFingerprint,
    tier: plain.tier,
    yearRange: plain.yearRange,
    examCount: plain.exams.length,
    questionCount: plain.exams.reduce((n, e) => n + e.questions.length, 0),
    crypto: cryptoSection,
  }
  out.sig = {
    algo: 'ECDSA-P256-SHA256',
    keyId: await keyIdOf(publicB64),
    value: await signText(signingText(out), privateKey),
  }
  return JSON.stringify(out, null, 1)
}

const plain = makePlainPack()
const sealedText = await sealPack(plain)
const open = (text, pass = PASSPHRASE, keys = [publicB64]) => openSealedPack(text, pass, { publicKeys: keys })

// ── 正常路径 ─────────────────────────────────────────────

const okRes = await open(sealedText)
check('正确口令 + 正确公钥 → 能打开', okRes.ok, okRes.ok ? '' : okRes.errors.join('；'))
check(
  '解密后题目内容与原文一致',
  okRes.pack?.exams?.[0]?.questions?.[0]?.stem === plain.exams[0].questions[0].stem
    && okRes.pack?.exams?.[0]?.material === plain.exams[0].material,
)
check('水印（使用者指纹）在包内可见', okRes.pack?.userFingerprint === FINGERPRINT, okRes.pack?.userFingerprint)
check('包体里不含明文题目（真的加密了）', !sealedText.includes('数字乡村建设'))

const sniff = parsePack(sealedText)
check('parsePack 认出加密包并要口令（不误报"格式错误"）', sniff.sealed === true && sniff.pack === null)

// ── 失败路径 ─────────────────────────────────────────────

const wrongPass = await open(sealedText, '口令不对-随便写的')
check(
  '口令错误 → 明确提示口令问题（不是"文件损坏"）',
  !wrongPass.ok && wrongPass.errors.join('').includes('口令'),
  wrongPass.errors.join('；'),
)

const tampered = JSON.parse(sealedText)
tampered.crypto.ciphertext = tampered.crypto.ciphertext.slice(0, -4) + 'AAAA'
const tamperRes = await open(JSON.stringify(tampered))
check('密文被改动 → 签名拦截，不进入解密', !tamperRes.ok && tamperRes.errors.join('').includes('签名'), tamperRes.errors.join('；'))

const stampEdited = JSON.parse(sealedText)
stampEdited.userFingerprint = '李四/lisi@example.com'
const stampRes = await open(JSON.stringify(stampEdited))
check(
  '水印被改 → 签名拦截（"泄露可溯源"靠的就是这条）',
  !stampRes.ok && stampRes.errors.join('').includes('签名'),
  stampRes.errors.join('；'),
)

const strangerRes = await open(sealedText, PASSPHRASE, [strangerPub])
check('用别人的公钥验签 → 必须失败（签名确实绑定作者身份）', !strangerRes.ok, strangerRes.errors.join('；'))

const noKeyRes = await openSealedPack(sealedText, PASSPHRASE, { publicKeys: [] })
check('程序没有内置公钥 → 拒绝导入并说清原因', !noKeyRes.ok && noKeyRes.errors.join('').includes('验签公钥'), noKeyRes.errors.join('；'))

const strangerSigned = await sealPack(plain, PASSPHRASE, toB64(await crypto.subtle.exportKey('pkcs8', strangerKp.privateKey)))
const forgedRes = await open(strangerSigned)
check('别人用自己私钥签的包 → 冒充不了作者', !forgedRes.ok, forgedRes.errors.join('；'))

const yearEdited = JSON.parse(sealedText)
yearEdited.yearRange = [2010, 2010]
const yearRes = await open(JSON.stringify(yearEdited))
check('外层字段（年份区间）被改 → 签名拦截', !yearRes.ok && yearRes.errors.join('').includes('签名'))

// ── 回归：v1 明文包 ─────────────────────────────────────

const v1 = parsePack(JSON.stringify(plain))
check('v1 明文包仍能正常导入（老包不能失效）', v1.ok && v1.pack.exams.length === 1, v1.errors.join('；'))

const v1Broken = { ...plain, checksum: 'deadbeef' }
check('v1 校验和不匹配 → 仍然报错', parsePack(JSON.stringify(v1Broken)).ok === false)

// ── 作者侧 CLI（seal-bpq.mjs）真的能跑通 ───────────────────
//
// 上面测的是算法，这一段测"作者实际会敲的那条命令"——
// 参数解析、读私钥、写文件、自检回读，任何一环断了都要在这暴露出来。

const tmp = mkdtempSync(path.join(tmpdir(), 'bpq-seal-'))
try {
  const plainFile = path.join(tmp, 'demo.bpq')
  const keyFile = path.join(tmp, 'test-key.b64')
  const sealedFile = path.join(tmp, 'demo-加密.bpq')
  writeFileSync(plainFile, JSON.stringify(plain, null, 1), 'utf8')
  writeFileSync(keyFile, privateB64 + '\n', 'utf8')

  let out = ''
  let cliOk = true
  try {
    out = execFileSync(process.execPath, [
      path.join(ROOT, '.tools', 'exams', 'seal-bpq.mjs'),
      '--in', plainFile,
      '--out', sealedFile,
      '--passphrase', PASSPHRASE,
      '--key', keyFile,
      '--pubkey', publicB64,
    ], { encoding: 'utf8' })
  } catch (e) {
    cliOk = false
    out = String(e.stdout || '') + String(e.message || '')
  }
  check('作者命令行封装脚本能跑通（含自检回读）', cliOk && out.includes('自检 通过'), out.trim().split('\n').slice(-3).join(' / '))

  const fromCli = await open(readFileSync(sealedFile, 'utf8'))
  check('CLI 产出的包，前端能打开且内容一致', fromCli.ok && fromCli.pack.exams[0].questions.length === 1, fromCli.errors.join('；'))

  // --check 只校验已有包（不带 --key，纯验签名+解密）
  let checkOut = ''
  let checkOk = true
  try {
    checkOut = execFileSync(process.execPath, [
      path.join(ROOT, '.tools', 'exams', 'seal-bpq.mjs'),
      '--check', sealedFile,
      '--passphrase', PASSPHRASE,
      '--pubkey', publicB64,
    ], { encoding: 'utf8' })
  } catch (e) {
    checkOk = false
    checkOut = String(e.stdout || '') + String(e.message || '')
  }
  check(
    '--check 能对已有包验签 + 解密（发出前自检这条路）',
    checkOk && checkOut.includes('验签') && checkOut.includes('解密成功'),
    checkOut.trim().split('\n').join(' / '),
  )

  // --check 遇到错口令必须报失败（否则这个自检等于没有）
  let badOut = ''
  let badOk = true
  try {
    badOut = execFileSync(process.execPath, [
      path.join(ROOT, '.tools', 'exams', 'seal-bpq.mjs'),
      '--check', sealedFile,
      '--passphrase', '错的',
      '--pubkey', publicB64,
    ], { encoding: 'utf8' })
  } catch {
    badOk = false
    badOut = '解密失败'
  }
  check('--check 遇到错口令会报失败（不是"看起来通过了"）', !badOk, badOut.trim().split('\n').pop())
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ── readPackFile：UI 入口的分支判断 ───────────────────────

const fakeFile = (text) => ({ size: text.length, text: async () => text })
const gotSealed = await readPackFile(fakeFile(sealedText))
check('readPackFile 对加密包回 sealed:true 并带上原文', gotSealed.sealed === true && !!gotSealed.text)
const gotPlain = await readPackFile(fakeFile(JSON.stringify(plain)))
check('readPackFile 对明文包直接给出 pack', gotPlain.ok === true && gotPlain.sealed === false)

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`题库包加密签名测试：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
