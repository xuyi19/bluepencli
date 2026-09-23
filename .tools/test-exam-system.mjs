// ──────────────────────────────────────────────────────────────
// 蓝笔申论 · 考试体系识别护栏测试
//   node .tools/test-exam-system.mjs
//
// examSystem.js 是「国考还是省考、哪个省」的单一真源——题库 UI、
// 汇编导出、将来省考推荐逻辑都吃这一张表。表错了全链路错，先锁住。
// 同时把真实题库全量过一遍识别（公开 24 套必须全判国考——它们就是国考）。
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { examSystemOf, paperRank, isProvincePaper, QUESTION_TYPES } = await import(
  pathToFileURL(path.join(ROOT, 'frontend/src/data/examSystem.js')).href
)

let pass = 0
let fail = 0
const t = (name, cond) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}`)
  }
}

console.log('\n① 体系识别')
t('国考 title → 国考', examSystemOf({ title: '2020年国家公务员考试《申论》（地市级）' }) === '国考')
t('国考简写 → 国考', examSystemOf({ title: '2021国考申论卷' }) === '国考')
t('广东 title → 省考-广东', examSystemOf({ title: '2023年广东省公务员考试《申论》（县级）' }) === '省考-广东')
t('别名「台湾」归一化', examSystemOf({ title: '台湾省考卷' }) === '省考-中国台湾')
t('内蒙古/广西等自治区可识别', examSystemOf({ title: '内蒙古公务员考试申论' }) === '省考-内蒙古')
t('显式 system 字段优先于 title', examSystemOf({ system: '省考-浙江', title: '国家公务员考试' }) === '省考-浙江')
t('无国无省 → 其他', examSystemOf({ title: '某模拟卷' }) === '其他')
t('null → 其他（不抛异常）', examSystemOf(null) === '其他')

console.log('\n② 卷别排序')
t('国考口径不变：地市级(0) < 省部级(1) < 行政执法(2)', paperRank('地市级') === 0 && paperRank('省部级') === 1 && paperRank('行政执法') === 2)
t('省考口径：县级(0) < 乡镇(1)', paperRank('县级') === 0 && paperRank('乡镇') === 1)
t('历史漂移卷别「省级」与「省部级」同级', paperRank('省级') === paperRank('省部级'))
t('未知卷别垫底', paperRank('随便') === 9)
t('省考卷别白名单：乡镇级 ✓ / 副省级 ✗', isProvincePaper('乡镇级') && !isProvincePaper('副省级'))

console.log('\n③ 真实题库全量过识别（国考卷判国考、河北卷判省考-河北）')
const dir = path.join(ROOT, 'frontend/src/data/real-exams')
const files = readdirSync(dir).filter((f) => /^exam-\d+.*\.js$/.test(f))
let bad = 0
let hebei = 0
for (const f of files) {
  const s = readFileSync(path.join(dir, f), 'utf8')
  const i = s.indexOf('export default')
  const exam = JSON.parse(s.slice(i + 14).trim())
  const sys = examSystemOf(exam)
  if (String(exam.id).includes('hebei')) {
    hebei++
    if (sys !== '省考-河北') { bad++; console.log(`  ✗ ${f} 河北卷被判成 ${sys}`); break }
  } else if (sys !== '国考') {
    bad++
    console.log(`  ✗ ${f} 被判成 ${sys} —— title 应含「国家」`)
    break
  }
}
if (!bad) t(`${files.length} 套公开卷识别正确（含河北 ${hebei} 套 → 省考-河北）`, true)

console.log('\n④ 题型白名单（五大类）')
t('五大类齐全', JSON.stringify(QUESTION_TYPES) === JSON.stringify(['归纳概括', '综合分析', '提出对策', '贯彻执行', '大作文']))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
