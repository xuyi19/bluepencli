// 每日一练：按本地日期确定性选题
//
// 设计要点：
//   1. 同一天无论刷新多少次，拿到的都是同一道题（确定性），否则"今日一练"名不副实。
//   2. 相邻日期不能连号——直接用 天数 % 题数 会导致连续几天按顺序出题，
//      所以先用 FNV-1a 把年月日打散成 32 位散列再取模。
//   3. 不依赖 Date.now() 的时分秒，否则同一天不同时刻会换题。

/** 本地日期键，如 2026-09-11 */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** FNV-1a 32 位散列：把日期字符串打散成分布均匀的整数 */
function hash(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/**
 * 从题库里挑出今日题目。
 * @param {Array} pool 题库（内置 + 用户自建都行）
 * @param {Date}  date 默认今天
 */
export function pickDaily(pool = [], date = new Date()) {
  if (!pool.length) return null
  return pool[hash(dateKey(date)) % pool.length]
}

/**
 * 随机换一题，尽量不与 excludeId 重复（题库只有 1 道时直接返回它）。
 * 注意别写成 `arr[Math.floor(Math.random()*n) || seed]`——下标 0 是 falsy，
 * 会被 || 顶掉，导致第 0 道题永远选不到。
 */
export function pickRandom(pool = [], excludeId = '') {
  if (!pool.length) return null
  const rest = pool.filter((q) => q.id !== excludeId)
  const list = rest.length ? rest : pool
  return list[Math.floor(Math.random() * list.length)]
}

/** 今天是否已经练过（按记录的 createdAt 判断） */
export function practicedToday(records = [], date = new Date()) {
  const key = dateKey(date)
  return records.some((r) => r.createdAt && dateKey(new Date(r.createdAt)) === key)
}
