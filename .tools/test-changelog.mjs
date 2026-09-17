// 更新日志页的解析护栏。
//
// 这一组测试是补出来的，起因很具体：页面**没崩**，但已经没法读 ——
// 104 条里有 63 条把 `**加粗**`、`` `代码` `` 原样显示出来，折行的后半句被整段丢掉，
// 缩进的子条目直接消失。而"没崩"这件事让所有走马观花的检查都放行了。
//
// 所以这里的断言不看"渲染了几个版本"，看**内容是否完整**：
// 条目有没有丢、句子有没有被切断、记号有没有漏出去。
//
// 解析器直接从 frontend/src/data/changelog-parse.js import —— 测的就是页面在跑的那份代码，
// 不是复制过来的正则。复制一份过来的测试永远是对的，页面照旧能坏。
//
// 用法：node .tools/test-changelog.mjs

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  TAG_STYLE,
  parseChangelog,
  parseInline,
  plainText,
} from '../frontend/src/data/changelog-parse.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const MD = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
const VERSIONS = parseChangelog(MD)

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}

// ---------- 1. 版本层面：一个都不能少 ----------
const docVersions = [...MD.matchAll(/^##\s+(v[\d.]+)/gm)].map((m) => m[1])
check('文档里每个版本都渲染出来了',
  VERSIONS.length === docVersions.length,
  `页面 ${VERSIONS.length} / 文档 ${docVersions.length}${VERSIONS.length !== docVersions.length ? '：' + docVersions.filter((v) => !VERSIONS.some((x) => x.version === v)).join(',') + ' 丢了' : ''}`)

check('最新一版就是文档最上面那一版',
  VERSIONS[0]?.version === docVersions[0],
  `页面 ${VERSIONS[0]?.version} / 文档 ${docVersions[0]}`)

check('版本号从新到旧（不倒挂）',
  VERSIONS.every((v, i) => i === 0 || cmp(VERSIONS[i - 1].version, v.version) > 0),
  VERSIONS.map((v) => v.version).join(' > '))

function cmp(a, b) {
  const p = (s) => s.replace(/^v/, '').split('.').map(Number)
  const [a1, a2, a3] = p(a)
  const [b1, b2, b3] = p(b)
  return a1 - b1 || a2 - b2 || a3 - b3
}

check('每个版本都有日期与标题',
  VERSIONS.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.date) && v.title.length > 0),
  VERSIONS.filter((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !v.title).map((v) => v.version).join(',') || '全部合格')

// ---------- 2. 条目层面：记号不能漏出去 ----------
const allItems = VERSIONS.flatMap((v) => v.items.map((i) => ({ ...i, version: v.version })))

const withMark = allItems.filter((i) => /\*\*|`/.test(i.text))
check('没有条目把 Markdown 记号原样显示出来',
  withMark.length === 0,
  withMark.length ? `${withMark.length} 条，例如 ${withMark[0].version}「${withMark[0].text.slice(0, 40)}」` : `${allItems.length} 条全干净`)

check('条目文本非空',
  allItems.every((i) => i.text.trim().length > 0))

// ---------- 3. 续行必须真的接上（原来折行后半句被整段丢掉）----------
// 这几个词都出现在源文档的**折行处之后**，只有续行拼接生效才可能出现。
const CONTINUATION_CASES = [
  ['v0.12.0', '整句照抄', '条目折行后剩下的分类名'],
  ['v0.12.0', '其实是同一件事', '折行后半句'],
  ['v0.10.0', '私钥 gitignore', '折行后半句'],
  ['v0.8.1', '而新版其实已经装好了', '折行后半句'],
]
for (const [ver, needle, why] of CONTINUATION_CASES) {
  const v = VERSIONS.find((x) => x.version === ver)
  const ok = !!v && v.items.some((i) => i.text.includes(needle))
  check(`${ver} 的续行接上了（${why}：「${needle}」）`, ok)
}

// ---------- 4. 截断检测：句子不该断在半路 ----------
// 「以连接符收尾、且自己没有子条目」＝ 典型的读到折行就停了。
const DANGLING = /[：:／/、，,（(「]$/
const truncated = allItems.filter((i) => DANGLING.test(i.text) && !hasChild(VERSIONS, i))
check('没有条目断在半句话上',
  truncated.length === 0,
  truncated.length
    ? truncated.map((i) => `${i.version}「${i.text.slice(-24)}」`).join(' | ')
    : '所有条目都是完整句')

function hasChild(versions, target) {
  const v = versions.find((x) => x.version === target.version)
  const idx = v.items.indexOf(v.items.find((x) => x.text === target.text))
  return v.items[idx + 1]?.depth === 1
}

// ---------- 5. 缩进子条目不能被吞掉 ----------
const nested = VERSIONS.find((v) => v.version === 'v0.11.0')?.items.filter((i) => i.depth === 1) || []
check('缩进子条目被识别（v0.11.0 的 issue.mjs 三个子项）',
  nested.length >= 3,
  `depth=1 共 ${nested.length} 条`)
check('子条目挂在它的父条目之后',
  nested.length > 0 && VERSIONS.find((v) => v.version === 'v0.11.0').items.some(
    (i, idx, arr) => i.depth === 1 && arr[idx - 1] && arr[idx - 1].depth === 0))

// ---------- 6. 引用附注单独记下，不糊进正文 ----------
const noted = allItems.filter((i) => i.note)
check('> 引用写成了独立的 note', noted.length > 0, `${noted.length} 条带附注`)
check('附注内容里不带 > 符号',
  noted.every((i) => !/^\s*>/.test(i.note)),
  noted.find((i) => /^\s*>/.test(i.note))?.note?.slice(0, 30) || '干净')

// ---------- 7. 分组名是可识别的类型 ----------
const unknown = allItems.filter((i) => !TAG_STYLE[i.type])
check('分组名都在已知类型里（新增/优化/变更/修复/测试/删除）',
  unknown.length === 0,
  unknown.length ? [...new Set(unknown.map((i) => i.type))].join(',') : [...new Set(allItems.map((i) => i.type))].join(' / '))

// ---------- 8. 行内解析本身 ----------
const segs = parseInline('**加粗** 和 `代码` 与普通文字')
check('行内片段切分正确',
  JSON.stringify(segs.map((s) => s.t)) === JSON.stringify(['bold', 'text', 'code', 'text']),
  JSON.stringify(segs.map((s) => s.t)))
check('片段拼回纯文本不含记号', !/\*\*|`/.test(plainText(segs)), plainText(segs))

// 反例：代码里的 * 是字面量，不能被当成加粗的边界
const starInCode = parseInline('图片走 `public/`——**单文件版是双击打开的本地 HTML**；')
check('代码片段里的 * 不干扰加粗匹配',
  starInCode.some((s) => s.t === 'bold' && s.v === '单文件版是双击打开的本地 HTML'),
  JSON.stringify(starInCode.map((s) => `${s.t}:${s.v.slice(0, 12)}`)))

// 反例：中文之间不补空格
const cjk = parseInline('中文')
void cjk
const joined = parseChangelog('## v9.9.9 · 2026-01-01 · 标题\n\n### 新增\n- 前半句\n  后半句\n- 英文\n  tail\n')
check('中文续行之间不补空格',
  joined[0].items[0].text === '前半句后半句',
  JSON.stringify(joined[0].items[0].text))
check('英文续行之间补空格',
  joined[0].items[1].text === '英文 tail',
  JSON.stringify(joined[0].items[1].text))

// ---------- 9. 空输入不炸 ----------
check('空文档返回空数组', parseChangelog('').length === 0)
check('没有条目的版本不渲染（文档顶部说明段）',
  parseChangelog('## v1.0.0 · 2026-01-01 · 只有标题\n\n### 新增\n\n没有条目\n').length === 0)

console.log(failed ? `\n✗ ${failed} 项未通过` : `\n全部通过（${VERSIONS.length} 版 / ${allItems.length} 条）`)
process.exit(failed ? 1 : 0)
