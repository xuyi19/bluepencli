// ──────────────────────────────────────────────────────────────
// 护栏：结果冻结（provenance）与硬规则前置
//
// 这两件事都属于「看不见但重要」的那类：
//   · 结果冻结 —— 记录里存下"这份分用哪版标准、哪版提示词、哪个模型、什么温度"。
//     被删了不会报错、界面照样能用，只是半年后再也说不清分数怎么来的。
//   · 硬规则前置 —— 纯代码算出的客观事实必须进**每位老师**的 prompt，
//     退回"只当合议旁证"也不会报错，只是单人阅卷时那层约束悄悄消失了。
// 所以用源码级断言把它们钉住（纯 node 跑不了 orchestrator，它依赖浏览器环境）。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const orch = read('frontend/src/agents/orchestrator.js')
const skills = read('frontend/src/agents/skills.js')
const record = read('frontend/src/utils/record.js')
const pv = read('frontend/src/views/PracticeView.vue')
const schemas = read('backend/app/models/schemas.py')
const recsvc = read('backend/app/services/record_service.py')

console.log('\n① Prompt 版本号（改了提示词必须递增，否则冻结无意义）')
t('skills.js 导出 PROMPT_VERSION', /export const PROMPT_VERSION\s*=\s*'[^']+'/.test(skills))
t('orchestrator 引用了它', /PROMPT_VERSION/.test(orch))
const m = skills.match(/export const PROMPT_VERSION\s*=\s*'([^']+)'/)
t('版本号形如 grading-vN', !!m && /^grading-v\d+$/.test(m[1]), m?.[1])

console.log('\n② 结果冻结：字段齐全 + 在出口赋值')
const provBlock = orch.slice(orch.indexOf('function buildProvenance'), orch.indexOf('function buildProvenance') + 1400)
for (const f of [
  'standardSource',
  'standardVersion',
  'standardPoints',
  'promptVersion',
  'model',
  'temperatures',
  'scoreSource',
  'frozenAt',
]) {
  t(`provenance 含 ${f}`, new RegExp(`${f}[,:]`).test(provBlock))
}
t('finish() 里赋值 output.provenance', /output\.provenance\s*=\s*buildProvenance\(/.test(orch))
// 三个取值出现在**调用处**（finish 里的三目），不在函数体内 —— 所以查全文
t(
  'scoreSource 区分单人/加权/合议',
  /'fusion'/.test(orch) && /'single'/.test(orch) && /'weighted'/.test(orch)
)
t('温度取的是老师真实温度表（不是硬编码 0.3）', /TEMPERATURE\[t\.id\]/.test(provBlock))

console.log('\n③ 硬规则前置给每一位老师（A2）')
t('graderExtra 同时含标准与硬规则事实', /const graderExtra\s*=\s*\[stdPrompt,\s*facts\]/.test(orch))
t('老师阅卷用的是 graderExtra', /gradeByTeacher\(t,\s*paper,\s*\{[^}]*extra:\s*graderExtra/.test(orch))
{
  const iFacts = orch.indexOf('const facts = formatRulesForPrompt')
  const iExtra = orch.indexOf('const graderExtra')
  t('顺序正确：facts 先定义、graderExtra 后引用', iFacts > 0 && iExtra > iFacts, `facts@${iFacts} < extra@${iExtra}`)
}
t('不再只把 stdPrompt 传给老师（旧的单参写法已消失）', !/extra:\s*stdPrompt\s*\}/.test(orch))

console.log('\n④ 记录链路：四个读档入口都要带 provenance')
{
  const hits = (record.match(/provenance:/g) || []).length
  t('record.js 有 4 处 provenance（写入 + 三个读回）', hits >= 4, `${hits} 处`)
  for (const v of ['report.provenance', 'rec.provenance', 'data.provenance', 'r.provenance']) {
    t(`含 ${v}`, record.includes(v))
  }
}

console.log('\n⑤ 后端不会静默丢字段 + 归档可读')
t('schemas.py 声明了 provenance', /provenance:\s*dict\s*\|\s*None/.test(schemas))
t('归档 markdown 写了「来路」', /来路：/.test(recsvc))
t('归档里标准来源有中文标签', /人工校准/.test(recsvc) && /无标准（裸判）/.test(recsvc))

console.log('\n⑥ 结果页看得见（可复算才不是口号）')
t('PracticeView 有 provenanceText', /const provenanceText = computed/.test(pv))
t('模板显示「批改依据」', /批改依据：/.test(pv))
t('空 provenance 时不显示（老记录不炸）', /v-if="provenanceText"/.test(pv))

console.log('\n⑦ 行为级：PROMPT_VERSION 能真的被读到')
// skills.js 顺着依赖链会碰到省略后缀的 import（'./teachers'）与别名，
// 必须先注册 vite 解析器才能被 Node 加载（见 .tools/vite-alias.mjs 的说明）。
try {
  const { registerViteAlias } = await import(pathToFileURL(path.join(ROOT, '.tools/vite-alias.mjs')).href)
  registerViteAlias()
  const mod = await import(pathToFileURL(path.join(ROOT, 'frontend/src/agents/skills.js')).href)
  t('import skills.js 成功且版本号非空', typeof mod.PROMPT_VERSION === 'string' && mod.PROMPT_VERSION.length > 0, mod.PROMPT_VERSION)
} catch (err) {
  t('import skills.js（含 teacher 依赖）', false, String(err).slice(0, 90))
}

console.log(`\n结果冻结与硬规则前置护栏：${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
