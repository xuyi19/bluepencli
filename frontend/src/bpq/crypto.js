// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包（.bpq）的加密与签名 —— 纯算法，不碰 IndexedDB，作者侧脚本也会 import 它。
//
// **为什么放在前端源码里**：前端要解密，实现就必须在前端。作者侧的封装脚本
// import 同一个文件，两边用**同一份实现** —— 加解密一旦有两份，迟早出现
// "作者打得开、用户打不开"。这跟 LLM 地址拼接那件事是同一个道理。
//
// 两个算法，各管一件事：
//   · **AES-256-GCM** 管"读不到"。密钥由分发口令经 PBKDF2 派生，口令与包分开给
//     （微信单独说），所以包本身外流也读不出内容。GCM 自带 auth tag，密文被改一位就解不开。
//   · **ECDSA P-256** 管"是不是作者发的"。**GCM 的完整性不等于身份认证**——
//     知道口令的人都能造出合法的 GCM 密文。签名覆盖水印字段，改水印也验不过，
//     所以"泄露可溯源"这句话才有依据。
//
// ⚠️ 跨语言最大的坑：WebCrypto 的 ECDSA 签名是 **raw 格式（r‖s，64 字节）**，
// 不是 OpenSSL / Python cryptography 默认的 **DER**。拿 Python 签、浏览器验，
// 会 100% 失败且看不出原因（都是"验签不通过"）。所以作者侧也走 Node 的 WebCrypto ——
// 与浏览器同一套 API，格式天然一致。
//
// 另一半的坑在 checksum：它与 `packChecksum` 一样依赖 stableStringify，
// 键序必须两端一致（见下面的注释）。

const enc = new TextEncoder()
const dec = new TextDecoder()

/** 口令派生的迭代次数：够慢到让暴力破解不划算，又不至于让用户等太久（浏览器实测约 0.2s） */
export const KDF_ITERATIONS = 200000
export const SEAL_ALGO = 'AES-256-GCM'
export const SIG_ALGO = 'ECDSA-P256-SHA256'

// ── base64 ────────────────────────────────────────────────

export function toB64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let bin = ''
  // 分块拼接：一次拼几十万字符在某些引擎上会爆栈
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function fromB64(str) {
  const bin = atob(String(str || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── 稳定序列化（与 v1 的校验和共用同一份实现） ─────────────
//
// 键**按字典序排序**再序列化。两端（作者脚本 / 前端）必须算出同一个串，
// 否则签名永远验不过，而且报错信息只会说"验签失败"，查起来很费劲。

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
    .join(',') + '}'
}

// ── 密钥派生 ──────────────────────────────────────────────

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 用口令把任意对象加密；返回可直接放进包头的 crypto 段 */
export async function encryptPayload(obj, passphrase, { iterations = KDF_ITERATIONS } = {}) {
  if (!passphrase) throw new Error('必须提供分发口令')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, iterations)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)),
  )
  return {
    algo: SEAL_ALGO,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    iv: toB64(iv),
    ciphertext: toB64(ct),
  }
}

/**
 * 解密。口令错、密文被改、字段被挪动，都会抛错 —— 调用方统一按"打不开"处理，
 * 不要把底层异常直接抛给用户看（GCM 的报错信息对用户毫无意义）。
 */
export async function decryptPayload(cryptoSection, passphrase) {
  const { kdf, iv, ciphertext, algo } = cryptoSection || {}
  if (algo !== SEAL_ALGO) throw new Error(`不支持的加密算法：${algo}`)
  if (!passphrase) throw new Error('必须提供分发口令')
  const key = await deriveKey(passphrase, fromB64(kdf.salt), kdf.iterations)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext),
  )
  return JSON.parse(dec.decode(plain))
}

// ── 签名 ─────────────────────────────────────────────────

/** 待签内容 = 包里除 sig 外的**全部字段**（含水印与密文） */
export function signingText(pack) {
  const { sig, ...rest } = pack
  void sig
  return stableStringify(rest)
}

/** 作者侧：用私钥（PKCS#8 base64）签名 */
export async function signText(text, privateKeyB64) {
  const key = await crypto.subtle.importKey(
    'pkcs8', fromB64(privateKeyB64),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(text),
  )
  return toB64(sig)
}

/** 校验侧：用公钥（SPKI base64）验签。缺公钥时报 no-key，由调用方决定怎么处理 */
export async function verifyText(text, sigB64, publicKeyB64) {
  if (!publicKeyB64) return { ok: false, reason: 'no-key' }
  try {
    const key = await crypto.subtle.importKey(
      'spki', fromB64(publicKeyB64),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, fromB64(sigB64), enc.encode(text),
    )
    return { ok, reason: ok ? '' : 'bad-signature' }
  } catch {
    return { ok: false, reason: 'bad-key' }
  }
}

/** 公钥指纹：只取前 16 位，用来在一屏输出里区分不同密钥，不必泄露完整公钥 */
export async function keyIdOf(publicKeyB64) {
  const digest = await crypto.subtle.digest('SHA-256', fromB64(publicKeyB64))
  return toB64(digest).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)
}
