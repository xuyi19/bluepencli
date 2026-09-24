// ──────────────────────────────────────────────────────────────
// 蓝笔申论 · 「批改时才选老师」护栏
//   node .tools/test-teacher-picker.mjs
//
// 起因：选老师从页面顶部的常驻卡挪进了「开始批改」的弹窗。这类"把入口
// 挪进弹窗"的改动有三种**看着完全正常**的失败方式，必须钉死：
//
//   ① 死锁 —— 若「开始批改」按钮仍因"没选老师"而 disabled，用户就再也
//      点不开那个唯一能选人的弹窗。表现是按钮灰着、底下写着"先选至少
//      一位阅卷老师"，而选人的入口已经不在页面上了。（canGrade 里残留
//      selected 条件即触发 —— 本次改动中真实发生过。）
//   ② 点了没反应 —— 考场交卷 / 超时交卷若仍走"只弹窗"的 start()，用户
//      点完交卷：计时停了、弹窗没出现、批改也没开始。考场里这是硬伤。
//   ③ 0 位老师跑完一轮 —— 弹窗里可以全部取消，任何发起批改的路径都可
//      能拿到空数组：结果页会显示"0 位老师"。必须显式兜底，而且**要告知
//      用户换成谁了** —— 静默换人等于结果页撒谎。
//
// 断言盯的是"用户看得见的结果"（按钮能不能点、交卷有没有发起批改），
// 不是内部变量的写法。
//
// 用法：node .tools/test-teacher-picker.mjs

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(path.join(ROOT, 'frontend/src/views/PracticeView.vue'), 'utf8')

// 模板段：取 <script> 之前的所有内容。
// ⚠️ 不能用 /<template>[\s\S]*?<\/template>/ —— 组件内部到处是 <template v-if>，
// 非贪婪会第一个就截断，提取出来的"模板"短得离谱，断言会假绿。
const cut = src.indexOf('<script')
const tpl = cut > 0 ? src.slice(0, cut) : src

let failed = 0
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    console.error(`  ❌ ${label}${extra ? ' — ' + extra : ''}`)
    failed++
  }
}

/** 从 `(` 起做括号平衡，取完整调用表达式（箭头函数的括号会截断非贪婪正则，这里不会） */
const callExpr = (s, idx) => {
  if (idx < 0) return ''
  let d = 0
  for (let i = idx; i < s.length; i++) {
    if (s[i] === '(') d++
    else if (s[i] === ')' && --d === 0) return s.slice(idx, i + 1)
  }
  return ''
}

/** 抓函数体：到「行首 } 」为止（本项目缩进一致，够用；抓不到返回空串=断言自然变红） */
const fnBody = (name) =>
  src.match(new RegExp(`(?:async )?function ${name}\\(\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || ''

console.log('\n① 死锁防护：选人的入口不能被自己锁死')
const iCG = src.indexOf('const canGrade')
const canGradeDef = iCG < 0 ? '' : callExpr(src, src.indexOf('(', iCG))
check('canGrade 定义抓得到', canGradeDef.length > 0)
check(
  'canGrade 不再依赖 selected（否则按钮禁用 → 永远打不开选人弹窗）',
  canGradeDef.length > 0 && !canGradeDef.includes('selected')
)
check(
  'canGrade 仍要求 Key 与作答字数（该禁的还得禁）',
  canGradeDef.includes('hasKey') && canGradeDef.includes('answer')
)
check(
  '提示条不再把用户指向已不存在的入口（"先选至少一位阅卷老师"）',
  !tpl.includes('先选至少一位阅卷老师')
)

console.log('\n② 交卷必须真的发起批改（不能只弹窗）')
const startBody = fnBody('start')
const startExamBody = fnBody('startExam')
const startGradeBody = fnBody('startGrade')
check('start() 函数体抓得到', startBody.length > 0)
check(
  'start() 只开弹窗，不发起批改',
  startBody.includes('showTeacherPicker') &&
    !startBody.includes('runGrading') &&
    !startBody.includes("step.value = 'grading'")
)
check('startExam() 函数体抓得到', startExamBody.length > 0)
check(
  '考场交卷直接调 startGrade()（倒计时都停了，不该再弹选人）',
  startExamBody.includes('startGrade()')
)
check(
  'startExam() 不再调 start()（否则点了交卷只弹窗、批改没发起）',
  !/\bstart\(\)/.test(startExamBody)
)
check(
  '超时自动交卷也走 startGrade()',
  /examRemain\.value <= 0[\s\S]{0,300}startGrade\(\)/.test(src)
)
check(
  '停表不依赖调用方：startGrade 自己会 stopExamTimer()',
  startGradeBody.includes('stopExamTimer()')
)

console.log('\n③ 0 位老师的兜底：不能静默换人')
check('startGrade 有 0 位老师兜底', startGradeBody.includes('!selected.value.length'))
check(
  '兜底是显式常量 + toast 告知（不能静默换人）',
  src.includes('DEFAULT_TEACHERS') && startGradeBody.includes('toast.warning')
)
check(
  '默认三人组 = 袁东 / 周泰然 / 白鹭',
  /DEFAULT_TEACHERS\s*=\s*\[[^\]]*yuandong[^\]]*zhoutairan[^\]]*bailu/.test(src)
)

console.log('\n④ 老师列表只在弹窗里（顶部不再有常驻卡）')
check('模板里老师列表只渲染一处', (tpl.match(/TEACHER_LIST/g) || []).length === 1)
check(
  '这一处在 showTeacherPicker 弹窗内',
  /v-if="showTeacherPicker"[\s\S]*?TEACHER_LIST/.test(tpl)
)

console.log('\n⑤ 弹窗确认按钮：点了要有反馈')
check(
  '确认按钮文案以「开始批改」开头（e2e / 探针按此定位）',
  /开始批改\{\{ selected\.length/.test(tpl)
)
check(
  '确认按钮不 disabled（禁用了就点不出提示，用户只看到"点了没反应"）',
  !/开始批改[\s\S]{0,400}:disabled="!selected\.length"/.test(tpl)
)

console.log(failed ? `\n❌ ${failed} 项未通过\n` : '\n✅ 全部通过\n')
process.exit(failed ? 1 : 0)
