/**
 * M1 学习中心（首页工作台）数据层 —— 纯函数、零依赖，Node 可直测。
 *
 * 2026-10-09。验收铁律（规划文档 M1）：任务卡状态与真实数据一致——
 * 做完的任务不假装没做，没数据的任务明说没做；不设目标日期就不显示倒计时。
 *
 * 三类活动各有一个"带时间戳"的数据源：
 *   · 练习   → 批改记录 records[].createdAt（IndexedDB / docs 双写，已有）
 *   · 精读   → localStorage `bp-read-result:<qid>` {at}（ReadView M4 时埋好）
 *   · 收藏   → localStorage `bp-fav-at` {id: ts}（旁路表，收藏动作时写入；
 *              老收藏没有时间戳就不算"今天"——不编造）
 */

/** 首页倒计时的目标日期存这里（'YYYY-MM-DD'） */
export const EXAM_DATE_KEY = 'bp-exam-date'

/** 收藏时间戳旁路表键（{id: 毫秒时间戳}） */
export const FAV_AT_KEY = 'bp-fav-at'

/** 精读成绩的 localStorage 键前缀 */
export const READ_RESULT_PREFIX = 'bp-read-result:'

const DAY_MS = 86400000

/**
 * 本地日期键 'YYYY-MM-DD'（按本地时区，不走 UTC——倒计时差一天最伤人）。
 * @param {Date|number|string} input Date / 毫秒时间戳 / 可解析字符串
 * @returns {string|null} 非法输入返回 null，不抛错
 */
export function dayKey(input) {
  let d
  if (input instanceof Date) d = input
  else if (typeof input === 'number' && Number.isFinite(input)) d = new Date(input)
  else if (typeof input === 'string' && input.trim() !== '') {
    d = /^\d+$/.test(input.trim()) ? new Date(Number(input)) : new Date(input)
  } else return null
  if (!d || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 本地零点的 Date */
function midnight(key) {
  return new Date(`${key}T00:00:00`)
}

/**
 * 距目标日期还有几天（按本地零点算）。
 * @returns {number|null} 未来为正、当天为 0、已过为负；格式非法返回 null
 */
export function daysUntil(dateStr, now = new Date()) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const target = midnight(dateStr)
  if (Number.isNaN(target.getTime())) return null
  const base = midnight(dayKey(now))
  return Math.round((target.getTime() - base.getTime()) / DAY_MS)
}

/**
 * 从批改记录里取「有练习活动」的日期集合。
 * 只认 createdAt（缺了就跳过——没有的日期不猜）。
 */
export function practiceDays(records) {
  const days = new Set()
  for (const r of Array.isArray(records) ? records : []) {
    const t = r && r.createdAt
    const k = t ? dayKey(t) : null
    if (k) days.add(k)
  }
  return days
}

/**
 * 读精读成绩：扫 localStorage 前缀 `bp-read-result:` → [{key, at}]。
 * @param {Storage} storage 可注入假 storage 测试
 */
export function loadReadResults(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const out = []
  if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return out
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (!k || !k.startsWith(READ_RESULT_PREFIX)) continue
    try {
      const v = JSON.parse(storage.getItem(k) || '')
      const at = v && Number(v.at)
      if (Number.isFinite(at)) out.push({ key: k.slice(READ_RESULT_PREFIX.length), at })
    } catch { /* 坏数据跳过，不炸首页 */ }
  }
  return out
}

/**
 * 读收藏时间戳旁路表 `bp-fav-at`（{id: 毫秒}）。
 * 只保留有限的数字值；解析失败返回空对象（老用户无此键 = 没有今天的收藏）。
 */
export function loadFavTimes(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage || typeof storage.getItem !== 'function') return {}
  try {
    const raw = JSON.parse(storage.getItem(FAV_AT_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out = {}
    for (const [id, at] of Object.entries(raw)) {
      const n = Number(at)
      if (id && Number.isFinite(n)) out[id] = n
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 活动日全集 = 练习日 ∪ 精读日 ∪ 收藏日。
 * @returns {Set<string>} 'YYYY-MM-DD' 集合
 */
export function activityDays({ records = [], readResults = [], favTimes = {} } = {}) {
  const days = practiceDays(records)
  for (const r of readResults) {
    const k = dayKey(r.at)
    if (k) days.add(k)
  }
  for (const at of Object.values(favTimes)) {
    const k = dayKey(at)
    if (k) days.add(k)
  }
  return days
}

/**
 * 打卡连击：从今天往回数连续有活动的天数。
 * 今天还没做不算断签——连击从昨天起算，今天补上继续涨（常见打卡语义）。
 * 遇到第一个空洞就停；未来的日期不参与。
 * @returns {number} 0 = 今天昨天都没动
 */
export function calcStreak(daysSet, now = new Date()) {
  const days = daysSet instanceof Set ? daysSet : new Set(daysSet || [])
  const today = dayKey(now)
  let cursor = midnight(today)
  if (!days.has(today)) cursor = new Date(cursor.getTime() - DAY_MS)
  let n = 0
  while (days.has(dayKey(cursor))) {
    n++
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return n
}

/**
 * 近 n 天点阵（旧 → 新），每格 {key, active, isToday}。
 * 打卡卡的视觉数据；active 取自活动日集合。
 */
export function lastNDays(daysSet, n = 14, now = new Date()) {
  const days = daysSet instanceof Set ? daysSet : new Set(daysSet || [])
  const today = dayKey(now)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const key = dayKey(new Date(midnight(today).getTime() - i * DAY_MS))
    out.push({ key, active: days.has(key), isToday: key === today })
  }
  return out
}

/**
 * 今日三任务卡状态（纯派生，不改任何存储）。
 * @returns {{
 *   practice: {done: boolean, count: number},
 *   read:     {done: boolean, count: number},
 *   lexicon:  {done: boolean, count: number},
 * }}
 */
export function taskStatus({ records = [], readResults = [], favTimes = {}, now = new Date() } = {}) {
  const today = dayKey(now)
  const countBy = (times) => times.filter((t) => dayKey(t) === today).length
  const practiceCount = (Array.isArray(records) ? records : []).filter((r) => {
    const k = r && r.createdAt ? dayKey(r.createdAt) : null
    return k === today
  }).length
  const readCount = countBy(readResults.map((r) => r.at).filter(Number.isFinite))
  const favCount = countBy(Object.values(favTimes).filter((v) => Number.isFinite(v)))
  return {
    practice: { done: practiceCount > 0, count: practiceCount },
    read: { done: readCount > 0, count: readCount },
    lexicon: { done: favCount > 0, count: favCount },
  }
}
