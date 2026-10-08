// 临时：统计公开卷题数 vs 已生成标准数
import { readFileSync, readdirSync, existsSync } from 'node:fs'
const dir = 'frontend/src/data/real-exams'
let total = 0
const ids = []
for (const f of readdirSync(dir)) {
  if (!/^exam-.*\.js$/.test(f)) continue
  const s = readFileSync(`${dir}/${f}`, 'utf8')
  const examId = f.replace(/^exam-/, '').replace(/\.js$/, '')
  // 题对象以 no: 计数（与生成器的 id 规则 real-<卷>-<题号> 对应）
  const nos = [...s.matchAll(/"no":\s*(\d+)/g)].map((m) => m[1])
  total += nos.length
  for (const n of nos) ids.push(`real-${examId}-${n}`)
}
const done = readdirSync('.tools/standards/out').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
const doneSet = new Set(done)
const missing = ids.filter((id) => !doneSet.has(id))
console.log(`总题数: ${total}`)
console.log(`已生成: ${done.length}`)
console.log(`剩余: ${missing.length}`)
console.log('样例缺失:', missing.slice(0, 8).join(', '))
