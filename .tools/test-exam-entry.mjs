// ──────────────────────────────────────────────────────────────
// 护栏：考场模式必须保持「实战」分组下的独立入口（与练习批改并存）
//
// 为什么值得一条测试：这两个入口是**同一组件两种形态**，靠路由名区分。
// 以后有人图省事在页面里加回一个"训练/考场"切换 chip，两边就会各有一套模式状态，
// 结果是"我在考场页里切到了训练，交卷按钮没了"这类鬼故事。
// 源码级断言，不依赖 dev server，能进一键回归自动跑。
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

console.log('\n① 路由：/exam 与 /practice 共用组件')
const router = read('frontend/src/router/index.js')
t("有 /exam 路由", /\{\s*path:\s*'\/exam'/.test(router))
t("有 /real 路由（真题模式）", /\{\s*path:\s*'\/real'/.test(router))
t('/exam 与 /practice 指向同一组件', /name:\s*'exam',\s*component:\s*PracticeView/.test(router) && /name:\s*'practice',\s*component:\s*PracticeView/.test(router))
t('/real 也指向同一组件（三种形态一份实现，不搞三份）', /name:\s*'real',\s*component:\s*PracticeView/.test(router))

console.log('\n② 侧边栏：「实战」组下两个入口并存')
const app = read('frontend/src/App.vue')
const navBlock = app.slice(app.indexOf('const NAV'), app.indexOf('const NAV') + 2000)
t("侧边栏有「练习批改」", /group:\s*'实战',\s*path:\s*'\/practice',\s*label:\s*'练习批改'/.test(navBlock))
t("侧边栏有「考场模式」", /group:\s*'实战',\s*path:\s*'\/exam',\s*label:\s*'考场模式'/.test(navBlock))
t("侧边栏有「真题模式」", /group:\s*'实战',\s*path:\s*'\/real',\s*label:\s*'真题模式'/.test(navBlock))
t('三条同属「实战」组', (navBlock.match(/group:\s*'实战'/g) || []).length >= 3)

console.log('\n③ 模式由路由决定（不是页内 chip 状态）')
const pv = read('frontend/src/views/PracticeView.vue')
t('isExamMode 读路由名', /isExamMode\s*=\s*computed\(\(\)\s*=>\s*route\.name\s*===\s*'exam'\)/.test(pv))
t('isRealMode 读路由名', /isRealMode\s*=\s*computed\(\(\)\s*=>\s*route\.name\s*===\s*'real'\)/.test(pv))
// 三种形态的差异点在**材料口径**：真题=按原卷给全材料，训练=按题裁剪。
// 这条是真题模式存在的理由，被改掉就等于这个模式白做了。
t('真题模式默认不裁材料（按原卷给全）',
  /trimState\.active\s*=\s*isRealMode\.value\s*\?\s*false\s*:/.test(pv),
  '这是真题模式与训练模式的唯一实质差异')
t('真题模式如实说明成本更高', /材料更全，批改成本也更高/.test(pv))
// 说明条要跟"当前用哪份"走：说"已省去 N 则"却在显示整卷，用户会看不懂到底用了什么。
t('材料说明条区分当前状态（整卷态说"当前用的是整卷材料"）',
  /当前用的是整卷材料/.test(pv) && /本题只问资料/.test(pv))
t('已无 practice_mode 本地存储状态', !/practice_mode/.test(pv), '旧 chip 切换的遗留')
t('已无 switchMode 函数', !/function switchMode/.test(pv))
t('路由切换时重置计时', /watch\(\s*\(\)\s*=>\s*route\.name/.test(pv))

console.log('\n④ 两个入口的差异必须可见')
t('练习页给出去考场页的路', /to="\/exam"/.test(pv))
t('标题随入口变化（三态由 modeTitle 统一给出）',
  /modeTitle\s*=\s*computed/.test(pv) &&
    /isExamMode\.value\s*\?\s*'考场模式'\s*:\s*isRealMode\.value\s*\?\s*'真题模式'/.test(pv))
t('考场页有时长选择', /examMinutes/.test(pv) && /v-model\.number="examMinutes"/.test(pv))

console.log('\n⑤ 首页有考场模式入口卡')
const home = read('frontend/src/views/HomeView.vue')
t("首页 ACTIONS 含 /exam", /path:\s*'\/exam'/.test(home))
t('首页仍是网格布局（4 张卡不会挤成一行）', /md:grid-cols-2\s+lg:grid-cols-4/.test(home))

console.log(`\n考场模式入口护栏：${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
