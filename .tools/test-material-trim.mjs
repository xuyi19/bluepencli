// materialTrim.js 的护栏。
//
// 这个模块一旦接进批改流程，**裁错比不裁糟得多**（老师看不到依据 → 分数变虚）。
// 所以这里盯的全是「该裁 / 不该裁」的边界，尤其是"看不出就别动手"那几条。
//
// 跑法：node .tools/test-material-trim.mjs

const { registerViteAlias } = await import('file:///E:/code/bluepencil/.tools/vite-alias.mjs')
registerViteAlias()

const { trimMaterial, parseMaterialRefs, splitMaterialBlocks, isFullPaperQuestion } =
  await import('file:///E:/code/bluepencil/frontend/src/utils/grading/materialTrim.js')

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`)
  }
}

const SIX = [
  '材料1\n一甲甲甲甲甲甲甲甲',
  '材料2\n乙乙乙乙乙乙乙乙乙',
  '材料3\n丙丙丙丙丙丙丙丙丙',
  '材料4\n丁丁丁丁丁丁丁丁丁',
  '材料5\n戊戊戊戊戊戊戊戊戊',
  '材料6\n己己己己己己己己己',
].join('\n')

console.log('\n── 解析题干引用 ──')
{
  ok('「给定资料4」→ [4]', JSON.stringify(parseMaterialRefs('谈谈“预先失败”在“给定资料4”中的含义')) === '[4]')
  ok('「资料2、3」→ [2,3]', JSON.stringify(parseMaterialRefs('根据“资料2、3”概括')) === '[2,3]')
  ok('「资料4和5」→ [4,5]', JSON.stringify(parseMaterialRefs('就“资料4和5”谈谈看法')) === '[4,5]')
  ok('中文数字「资料四」→ [4]', JSON.stringify(parseMaterialRefs('给定资料四提到')) === '[4]')
  ok('没有引用 → []', parseMaterialRefs('请概括主要做法').length === 0)
  ok('空串不炸', parseMaterialRefs('').length === 0)
  ok('null 不炸', parseMaterialRefs(null).length === 0)
}

console.log('\n── 不该裁的一律不裁 ──')
{
  const a = trimMaterial(SIX, '请结合给定资料，自选角度，写一篇文章')
  ok('大作文（自选角度+写一篇文章）不裁', a.trimmed === false, a.reason)

  const b = trimMaterial(SIX, '参考给定资料，但不拘泥于给定资料')
  ok('「不拘泥于给定资料」不裁', b.trimmed === false, b.reason)

  const c = trimMaterial(SIX, '请概括主要做法')
  ok('题干没指明资料 → 不裁', c.trimmed === false, c.reason)

  const d = trimMaterial(SIX, '根据资料9作答')
  ok('引用的资料号材料里没有 → 不裁（别赌）', d.trimmed === false, d.reason)

  const e = trimMaterial('一整段没有分则的材料'.repeat(20), '根据资料2作答')
  ok('材料没有分则结构 → 不裁', e.trimmed === false, e.reason)

  const f = trimMaterial('', '根据资料2作答')
  ok('空材料不裁也不炸', f.trimmed === false)
}

console.log('\n── 该裁的要裁对 ──')
{
  const r = trimMaterial(SIX, '谈谈“预先失败”这一概念在“给定资料4”中的含义')
  ok('裁了', r.trimmed === true, r.reason)
  ok('只留第 4 则', r.used.join() === '4')
  ok('去掉了 5 则', r.dropped === 5, `dropped=${r.dropped}`)
  ok('文本里只剩丁（第 4 则的内容）', r.text.includes('丁') && !r.text.includes('乙') && !r.text.includes('己'),
    JSON.stringify(r.text.slice(0, 40)))
  ok('省下的比例在 70~90% 之间', r.savedPct >= 70 && r.savedPct <= 90, `savedPct=${r.savedPct}`)
  ok('before/after 如实', r.before === SIX.length && r.after < r.before)

  const r2 = trimMaterial(SIX, '根据“资料2、3”概括')
  ok('多则引用只留那几则', r2.text.includes('乙') && r2.text.includes('丙') && !r2.text.includes('丁'),
    JSON.stringify(r2.text.slice(0, 60)))
}

console.log('\n── 分块 ──')
{
  const blocks = splitMaterialBlocks(SIX)
  ok('拆出 6 则', blocks.length === 6, `n=${blocks.length}`)
  ok('序号解析正确', blocks.map((b) => b.no).join() === '1,2,3,4,5,6')
  ok('正文里提到「材料」不会被切块', splitMaterialBlocks('这段话提到了材料的重要性\n还有第二行').length === 1)
  ok('空输入 → []', splitMaterialBlocks('').length === 0)
}

console.log('\n── 大作文判定 ──')
{
  ok('自拟题目 → 是', isFullPaperQuestion('围绕xx自拟题目，写一篇文章'))
  ok('普通小题 → 否', isFullPaperQuestion('请概括主要做法') === false)
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
