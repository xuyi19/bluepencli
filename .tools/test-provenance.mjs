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
// v0.25.0 起：那行压缩文本升级成可展开的溯源卡，判空条件随之改为 report.provenance
t('空 provenance 时不显示（老记录不炸）', /<details v-if="report\.provenance"/.test(pv))
t('可展开到字段级（provenanceRows）', /const provenanceRows = computed/.test(pv))
t('模板逐条渲染字段', /v-for="row in provenanceRows"/.test(pv))
// 压缩文本只说"根据某标准"，用户复算要对的是具体值，这四行必须真的露出来
for (const k of ['评分标准', '阅卷老师（温度）', '评分来源', '冻结时间']) {
  t(`溯源卡含「${k}」行`, pv.includes(`k: '${k}'`))
}
// 诚实边界：温度为 0.1~0.4，重跑必然有浮动。不写这句等于承诺了做不到的确定性。
t('写明分数会小幅浮动（不许暗示逐位可复现）', /温度采样会有小幅浮动/.test(pv))

console.log('\n⑦ 使用文档与溯源手册（写给人看的那一半）')
{
  const guide = read('frontend/src/views/GuideView.vue')
  t('使用文档页有「这个分是怎么来的」一节', guide.includes('这个分是怎么来的'))
  t('使用文档指向溯源手册', guide.includes('可复算与溯源手册'))
  const mpath = 'docs/项目文档/可复算与溯源手册.md'
  let m = ''
  try {
    m = read(mpath)
  } catch {
    /* 不存在时下面三条各自变红 */
  }
  t('溯源手册存在', !!m, mpath)
  t('手册含五层流水线', m.includes('纯代码校验层'))
  t('手册含复算边界（会浮动的部分）', /会小幅浮动/.test(m))
  t('手册写明当前缺口（标准覆盖率）', /覆盖率/.test(m))
}

console.log('\n⑧ 标准覆盖率统计不许虚高')
{
  const idx = read('frontend/src/data/standards/index.js')
  // 私有卷未导入时 @private-standards 会给出一个 `_` 键的空占位对象，
  // 数键会把它算成一条标准 —— 数字看着正常，覆盖率却虚高一格。
  t(
    'standardCount 按「有采分点」过滤而非数键',
    /Object\.values\(ALL_STANDARDS\)\.filter\(\(s\)\s*=>\s*s\s*&&\s*\(s\.points \|\| \[\]\)\.length > 0\)/.test(idx)
  )
}

console.log('\n⑨ 行为级：PROMPT_VERSION 能真的被读到')
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
