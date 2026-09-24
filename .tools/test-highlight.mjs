// 荧光标记纯函数层的护栏。
//
// 起因：荧光标记的存储形态是「文本片段 + 第几次出现」而不是字符下标 ——
// 因为材料会在「按题裁剪 / 整卷」之间来回切换，下标一切换就全错位。
// 这套锚点定位是全项目的老思路（与批注 quote 同源），但**锚点算错的表现
// 是"标错位置"而不是报错** —— 页面照常渲染，颜色落在别的字上，走马观花看不出来。
//
// 所以这里的断言盯三类会"看起来正常"的失败：
//   ① 重叠标记谁赢 —— 必须先到先得，不能叠色（两层半透明叠起来颜色谁也认不出）
//   ② 切片完整性 —— splitByMarks 拼回去必须一字不差（少字 = 渲染时丢材料）
//   ③ 失效标记 —— 找不到就归入 stale，绝不静默丢弃（用户会以为"我没划上"）
//
// readSelection 依赖浏览器 DOM，Node 里测不了，由 UI 探针覆盖。
//
// 用法：node .tools/test-highlight.mjs

import {
  HIGHLIGHT_COLORS,
  colorById,
  countOccurrences,
  findRange,
  normalizeHighlight,
  resolveMarks,
  splitByMarks,
} from '../frontend/src/utils/highlight.js'

let failed = 0
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    console.error(`  ❌ ${label}${extra ? ' — ' + extra : ''}`)
    failed++
  }
}
const joined = (segs) => segs.map((s) => s.text).join('')

console.log('normalizeHighlight：入参清洗')
check('空白文本拒绝', normalizeHighlight({ text: '   \n ' }) === null)
check('非法颜色退回默认', normalizeHighlight({ text: '基层减负', color: 'neon' }).color === 'yellow')
check('nth 负数钳到 0', normalizeHighlight({ text: '基层减负', nth: -3 }).nth === 0)
check('同输入同 id（可复算）', normalizeHighlight({ text: '基层减负', nth: 1 }).id === normalizeHighlight({ text: '基层减负', nth: 1 }).id)

console.log('findRange：锚点定位')
const T = '一放就乱，一管就死，基层减负要先减形式主义。基层减负贵在坚持。'
check('首次出现', findRange(T, { text: '基层减负', nth: 0 }).start === T.indexOf('基层减负'))
check('第二次出现（nth=1）', findRange(T, { text: '基层减负', nth: 1 }).start === T.lastIndexOf('基层减负'))
check('找不到返回 null', findRange(T, { text: '不存在的句子', nth: 0 }) === null)
check('nth 超出出现次数返回 null', findRange(T, { text: '基层减负', nth: 2 }) === null)

console.log('splitByMarks：切片与重叠')
{
  const segs = splitByMarks('abcdef', [
    { text: 'bc', color: 'yellow', nth: 0 },
    { text: 'de', color: 'blue', nth: 0 },
  ])
  check('相邻不重叠各归各', segs.filter((s) => s.mark).length === 2)
  check('拼回去一字不差', joined(segs) === 'abcdef')
}
{
  // 重叠：先到先得。cd 同时落在 bc 和 de 附近 —— 按「先到先得」规则，
  // 后到的重叠段跳过。这里两条标记互不重叠，再构造一条真重叠的：
  const segs = splitByMarks('abcdefgh', [
    { text: 'bcde', color: 'yellow', nth: 0 },
    { text: 'defg', color: 'blue', nth: 0 },
  ])
  const marks2 = segs.filter((s) => s.mark)
  check('重叠只有先到的中标', marks2.length === 1 && marks2[0].mark.color === 'yellow')
  check('重叠也不丢字', joined(segs) === 'abcdefgh')
}
{
  const segs = splitByMarks('一二三', [{ text: '四', color: 'yellow', nth: 0 }])
  check('失效标记不渲染也不吞字', joined(segs) === '一二三' && segs.every((s) => !s.mark))
}

console.log('resolveMarks：失效必须看得见')
{
  const { ok, stale } = resolveMarks(T, [
    { text: '基层减负', color: 'yellow', nth: 0 },
    { text: '已经被删掉的句子', color: 'blue', nth: 0 },
  ])
  check('能定位的归 ok', ok.length === 1)
  check('找不到的归 stale，不静默丢', stale.length === 1 && stale[0].text === '已经被删掉的句子')
}

console.log('色板与计数')
check('色板 8 色', HIGHLIGHT_COLORS.length === 8)
check('色板透明度足够突出（≥0.45）', HIGHLIGHT_COLORS.every((c) => {
  const a = Number(c.bg.slice(c.bg.lastIndexOf(' '), -1))
  return a >= 0.45
}))
check('countOccurrences 数对出现次数', countOccurrences(T, '基层减负') === 2)
check('countOccurrences 空入参为 0', countOccurrences(T, '') === 0)

process.exit(failed ? 1 : 0)
