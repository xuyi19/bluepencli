// ──────────────────────────────────────────────────────────────
// 护栏：导入过程回显 + 「我的题库」批次管理
//
// 为什么用源码级断言：这两件事都在浏览器环境里跑（IndexedDB + Vue），
// Node 直跑不了。但它们的**关键性质**都能在源码上判：
//   · 批次号是否真的写进了题目与批次表；
//   · 写的顺序对不对（先题后批次 —— 反了会留下"批次说有 45 题、实际只有 10 题"的假账）；
//   · 「自建」计数是否排除了导入题（此前把私有真题算成自建）；
//   · 删批次时先删题还是先删记录（反了会留下查不到来源的孤儿题）。
// 这些都是"删掉不报错、界面照常能用"的那类改动，所以必须钉住。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
const t = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

const db = read('frontend/src/store/db.js')
const imp = read('frontend/src/bpq/importer.js')
const view = read('frontend/src/views/QuestionsView.vue')

console.log('\n① 存储层：导入批次表')
t('STORES 里有 imports 表', /imports:\s*'imports'/.test(db))
const ver = Number((db.match(/const DB_VERSION = (\d+)/) || [])[1])
t('DB_VERSION 已递增到 ≥3（加表不升版本 = 老用户永远没有这张表）', ver >= 3, `DB_VERSION=${ver}`)

console.log('\n② 入库：批次号必须落到题目与批次记录上')
t('importPack 生成 batch', /const batch = uid\(\)/.test(imp))
t('每道题带 _packBatch（否则无法按批次反查）', /_packBatch:\s*batch/.test(imp))
t('每道题带 _examId（按卷反查，比解析题 id 靠得住）', /_examId:\s*e\.id/.test(imp))
t('写 imports 批次记录', /put\(STORES\.imports,\s*\{/.test(imp))
t('批次记录带水印与签发者（「我的题库」要展示来源）',
  /fingerprint:\s*stamp/.test(imp) && /issuer:\s*pack\.issuer/.test(imp))
t('批次记录带卷清单（UI 不必再翻 questions 表）', /examTitles:/.test(imp))
t('导入返回 batch（UI 才能告知"这一批"）', /issuer: pack\.issuer \|\| '',\s*\n\s*batch,/.test(imp))

console.log('\n③ 顺序：先写题、后写批次记录')
{
  // 反了的话，中途失败会留下"批次写着 N 题、库里其实只有几题"的假账
  const iLoop = imp.indexOf('for (const q of list) {')
  const iRec = imp.indexOf('put(STORES.imports, {')
  t('题目先写、批次记录后写', iLoop > 0 && iRec > iLoop, `题=${iLoop} 批次=${iRec}`)
}

console.log('\n④ 整批删除')
t('导出 removeImport', /export async function removeImport/.test(imp))
t('导出 listImports', /export async function listImports/.test(imp))
t('删除要求批次号（不许"删全部"这种误用）', /if \(!batchId\) throw/.test(imp))
{
  const iDel = imp.indexOf('await remove(STORES.questions')
  const iRec = imp.indexOf('await remove(STORES.imports')
  t('先删题目、再删批次记录（反了会留下孤儿题）', iDel > 0 && iRec > iDel, `题=${iDel} 批次=${iRec}`)
}
t('返回删除题数（UI 要如实报数）', /return mine\.length/.test(imp))

console.log('\n⑤ 导入过程回显（onStage）')
t('openSealedPack 支持 onStage 回调', /onStage\s*\}\s*=\s*\{\}/.test(imp) || /\{\s*publicKeys,\s*onStage\s*\}/.test(imp))
t('验签成功/失败都回调', /onStage\?\.\(\{ stage: 'signature', ok: true/.test(imp) && /onStage\?\.\(\{ stage: 'signature', ok: false/.test(imp))
t('解密成功/失败都回调', /onStage\?\.\(\{ stage: 'decrypt', ok: true/.test(imp) && /onStage\?\.\(\{ stage: 'decrypt', ok: false/.test(imp))
t('验签回调带 keyId（"谁签发的"要看得见）', /keyId:\s*pack\.sig\?\.keyId/.test(imp))

console.log('\n⑥ 题库页：计数与展示')
// ⚠️ 这一组的第一版钉错了：当时把 mine 过滤掉了导入题，结果导入的私有卷
//    从题库列表里消失（"按来源·私有"恒为 0）——护栏却全绿。
//    教训：护栏要钉「用户看得见什么」，而不是「变量被过滤了」。
t('mine 保留全部用户侧题（导入题必须在题库里可见、可练）', /mine\.value = all\b/.test(view))
t('「自建」计数单独排除导入题（此前把私有真题算成自建）',
  /ownCount = computed\(\(\) => mine\.value\.filter\(\(q\) => q\._source !== 'bpq'\)\.length\)/.test(view))
t('头部展示用 ownCount（用 mine.length 就又把导入题算进来了）', /\{\{ ownCount \}\}/.test(view))
t('私有卷数按卷 id 去重后取并集（删除后能回落）',
  /new Set\(all\.filter\(\(q\) => q\._source === 'bpq'\)\.map\(\(q\) => q\._examId\)/.test(view))
t('有「我的题库」入口按钮', /btn-my-lib/.test(view))
t('有导入回显面板', /v-if="importSteps\.length"/.test(view))
t('有批次列表与删除按钮', /v-for="it in imports"/.test(view) && /askRemoveImport\(it\)/.test(view))
t('删除前二次确认（不可逆操作）', /toast\.confirm\(/.test(view))
t('导入时把批次列表一起刷新', /loadImports\(\)/.test(view))
t('批次记录展示水印与导入时间', /水印：\{\{ it\.fingerprint \}\}/.test(view) && /fmtTime\(it\.createdAt\)/.test(view))

console.log(`\n导入与我的题库护栏：${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
