/**
 * M1 学习中心数据层护栏 —— .tools/test-workbench.mjs（纯 Node，无浏览器）。
 * 钉的是规划文档 M1 的验收要点：任务卡状态与真实数据一致——
 * 做完不假装没做、没做不假装做完、没设置不显示倒计时、非法输入返回 null 不抛错。
 * 特别钉 calcStreak 的断签语义：今天没做 ≠ 断签（昨天连击仍活着，今天补上继续涨）。
 */
import {
  dayKey, daysUntil, practiceDays, loadReadResults, loadFavTimes,
  activityDays, calcStreak, lastNDays, taskStatus,
  EXAM_DATE_KEY, FAV_AT_KEY, READ_RESULT_PREFIX,
} from '../frontend/src/utils/workbench.js'

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 固定"今天"：2026-10-09（本地时区正午，避免边界抖动）
const NOW = new Date(2026, 9, 9, 12, 0, 0)
const dayTs = (y, m, d) => new Date(y, m, d).getTime() // 本地零点

console.log('\n① dayKey：本地日期键')
t('Date → YYYY-MM-DD', dayKey(NOW) === '2026-10-09', dayKey(NOW))
t('毫秒时间戳', dayKey(dayTs(2026, 9, 9) + 3600000) === '2026-10-09')
t('ISO 字符串', dayKey('2026-10-09T08:00:00') === '2026-10-09')
t('纯数字字符串当毫秒', dayKey(String(dayTs(2026, 9, 9))) === '2026-10-09')
t('空串 → null（不抛错）', dayKey('') === null)
t('垃圾串 → null', dayKey('not-a-date') === null)
t('null → null', dayKey(null) === null)

console.log('\n② daysUntil：倒计时（本地零点差）')
t('未来 7 天 → 7', daysUntil('2026-10-16', NOW) === 7, daysUntil('2026-10-16', NOW))
t('当天 → 0', daysUntil('2026-10-09', NOW) === 0)
t('已过 3 天 → -3', daysUntil('2026-10-06', NOW) === -3)
t('月份跨月', daysUntil('2026-11-01', NOW) === 23, daysUntil('2026-11-01', NOW))
t('非法格式（无连字符）→ null', daysUntil('20261016', NOW) === null)
t('非法月份 13 → null', daysUntil('2026-13-01', NOW) === null)
t('非字符串（数字）→ null', daysUntil(20261016, NOW) === null)
t('空串 → null', daysUntil('', NOW) === null)

console.log('\n③ practiceDays：只认 createdAt，缺了跳过')
t('毫秒与 ISO 混合都能取日', (() => {
  const s = practiceDays([{ createdAt: dayTs(2026, 9, 8) }, { createdAt: '2026-10-08T21:00:00' }])
  return s.size === 1 && s.has('2026-10-08')
})())
t('无 createdAt 的记录跳过', practiceDays([{ id: 'x' }, null, {}]).size === 0)
t('非数组入参 → 空集', practiceDays(null).size === 0)

console.log('\n④ calcStreak：连击与断签语义')
t('空集 → 0', calcStreak(new Set(), NOW) === 0)
t('只有今天 → 1', calcStreak(new Set(['2026-10-09']), NOW) === 1)
t('今天 + 昨天 → 2', calcStreak(new Set(['2026-10-09', '2026-10-08']), NOW) === 2)
t('中间断一天就停（今天+昨天+3天前 → 2）',
  calcStreak(new Set(['2026-10-09', '2026-10-08', '2026-10-06']), NOW) === 2)
t('★ 今天没做不断签：昨天+前天 → 2（连击从昨天起算）',
  calcStreak(new Set(['2026-10-08', '2026-10-07']), NOW) === 2,
  calcStreak(new Set(['2026-10-08', '2026-10-07']), NOW))
t('★ 今天昨天都没做 → 0（真断签）',
  calcStreak(new Set(['2026-10-07', '2026-10-06']), NOW) === 0)
t('只有未来的日期 → 0（未来不算连击）',
  calcStreak(new Set(['2026-10-10', '2026-10-11']), NOW) === 0)

console.log('\n⑤ lastNDays：点阵（旧→新）')
{
  const grid = lastNDays(new Set(['2026-10-09', '2026-10-02']), 14, NOW)
  t('长度 = 14', grid.length === 14)
  t('首格是 13 天前', grid[0].key === '2026-09-26', grid[0].key)
  t('末格是今天且 isToday', grid[13].key === '2026-10-09' && grid[13].isToday)
  t('今天 active', grid[13].active === true)
  t('10-02 active', grid.some((g) => g.key === '2026-10-02' && g.active))
  t('其余格不 active', grid.filter((g) => g.active).length === 2)
}

console.log('\n⑥ taskStatus：三任务卡状态（诚实派生）')
{
  const empty = taskStatus({ now: NOW })
  t('全空 → 三卡都未完成、计数 0（不编造）',
    !empty.practice.done && !empty.read.done && !empty.lexicon.done &&
    empty.practice.count === 0 && empty.read.count === 0 && empty.lexicon.count === 0)

  const mixed = taskStatus({
    records: [{ createdAt: dayTs(2026, 9, 9) + 5000 }, { createdAt: dayTs(2026, 9, 8) + 5000 }],
    readResults: [{ at: dayTs(2026, 9, 9) + 6000 }, { at: dayTs(2026, 9, 8) + 6000 }],
    favTimes: { 'lex-a': dayTs(2026, 9, 9) + 7000 },
    now: NOW,
  })
  t('练一题：今天练过 → done，计数只算今天（2 份记录里 1 份）',
    mixed.practice.done && mixed.practice.count === 1, JSON.stringify(mixed.practice))
  t('精读一则：今天精读过 → done', mixed.read.done && mixed.read.count === 1)
  t('积累一组：今天收藏过 → done', mixed.lexicon.done && mixed.lexicon.count === 1)

  const yesterdayOnly = taskStatus({
    records: [{ createdAt: dayTs(2026, 9, 8) + 5000 }],
    readResults: [{ at: dayTs(2026, 9, 8) + 6000 }],
    favTimes: { 'lex-a': dayTs(2026, 9, 8) + 7000 },
    now: NOW,
  })
  t('★ 全是昨天的活动 → 三卡都未完成（昨天不算今天）',
    !yesterdayOnly.practice.done && !yesterdayOnly.read.done && !yesterdayOnly.lexicon.done)
}

console.log('\n⑦ activityDays：三源并集')
{
  const days = activityDays({
    records: [{ createdAt: dayTs(2026, 9, 7) + 1000 }],
    readResults: [{ at: dayTs(2026, 9, 8) + 1000 }],
    favTimes: { 'lex-b': dayTs(2026, 9, 9) + 1000 },
  })
  t('三个来源各贡献一天', days.size === 3 &&
    days.has('2026-10-07') && days.has('2026-10-08') && days.has('2026-10-09'))
  const streak = calcStreak(days, NOW)
  t('三源拼出的连击 = 3', streak === 3, `streak=${streak}`)
}

console.log('\n⑧ loadFavTimes / loadReadResults：假 storage 注入')
{
  // 极简 Storage 假体：length + key(i) + getItem
  function fakeStore(obj) {
    const keys = Object.keys(obj)
    return {
      length: keys.length,
      key: (i) => keys[i] ?? null,
      getItem: (k) => (k in obj ? obj[k] : null),
    }
  }
  const favs = loadFavTimes(fakeStore({
    [FAV_AT_KEY]: JSON.stringify({ 'lex-a': dayTs(2026, 9, 9), 'lex-b': 'oops' }),
    'unrelated': 'x',
  }))
  t('有效时间戳保留、非数字剔除', favs['lex-a'] === dayTs(2026, 9, 9) && !('lex-b' in favs))
  t('坏 JSON → 空对象（不炸首页）',
    Object.keys(loadFavTimes(fakeStore({ [FAV_AT_KEY]: '{bad json' }))).length === 0)
  t('数组形态 → 空对象', Object.keys(loadFavTimes(fakeStore({ [FAV_AT_KEY]: '[]' }))).length === 0)
  t('无此键 → 空对象（老用户诚实空态）',
    Object.keys(loadFavTimes(fakeStore({}))).length === 0)
  t('null storage → 空对象', Object.keys(loadFavTimes(null)).length === 0)

  const reads = loadReadResults(fakeStore({
    [`${READ_RESULT_PREFIX}real-q-1`]: JSON.stringify({ rate: 80, at: dayTs(2026, 9, 9) + 1000 }),
    [`${READ_RESULT_PREFIX}broken`]: '{oops',
    'bp-other': JSON.stringify({ at: 1 }),
  }))
  t('只收前缀键且取内层 key', reads.length === 1 && reads[0].key === 'real-q-1', JSON.stringify(reads))
  t('坏 JSON 的精读成绩跳过不炸', reads.every((r) => Number.isFinite(r.at)))
}

console.log(`\nworkbench 护栏：${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
