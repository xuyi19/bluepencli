// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 标准更新包（M13 落地的用户侧交付物）
//
// 作者侧（管理员端）跑完「大模型校准 + 审签」后 export 出一个标准包
// （magic: bluepencil-standard-pack），用户在设置页导入 → 整包替换 → 生效。
// 这就是"对评分/精读标准做一次专项优化"的升级通道：不用发新版本软件，
// 标准质量可以独立迭代。
//
// 存储选 localStorage（bp-std-pack）而不是 IndexedDB：
//   getStandard() 是**同步**接口（批改流程发请求前就要用它），
//   IndexedDB 只有异步 API 喂不了同步读；标准包几百 KB 远在 5MB 限额内；
//   且 M10 备份方案本就覆盖 localStorage 键值。
//
// 替换语义（用户要的"把之前的替换下来，删掉"）：
//   applyPack 是**整包替换**——旧包整体删除、新包整体写入，不留两代混合；
//   仓库内 manual.json 等内置标准不动（包是内置之上的"最新校准层"）。
//
// Node 直跑注意：本模块会被 .tools 护栏 import，读存储必须判
// `typeof localStorage`，并支持注入假存储（护栏用它测替换/删除语义）。

export const PACK_MAGIC = 'bluepencil-standard-pack'
const LS_KEY = 'bp-std-pack'

/**
 * 校验标准包。宁可拒收：坏包宁可导入失败报清楚，不能污染标准表。
 * @returns {{ ok: boolean, problems: string[], count: number }}
 */
export function validatePack(json) {
  const problems = []
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, problems: ['不是 JSON 对象'], count: 0 }
  if (json.magic !== PACK_MAGIC) problems.push('不是蓝笔标准包（magic 不对）')
  if (json.version !== 1) problems.push(`版本不支持（${json.version}）`)
  const stds = json.standards
  if (!stds || typeof stds !== 'object' || Array.isArray(stds)) {
    problems.push('缺 standards 表')
    return { ok: false, problems, count: 0 }
  }
  const count = Object.keys(stds).filter((k) => !k.startsWith('_')).length
  if (!count) problems.push('包里没有任何标准')
  for (const [id, st] of Object.entries(stds)) {
    if (id.startsWith('_')) continue // 空占位（私有未导入）跳过
    if (!Array.isArray(st?.points) || !st.points.length) { problems.push(`${id}: 没有采分点`); continue }
    const wsum = st.points.reduce((n, p) => n + (Number(p.weight) || 0), 0)
    if (st.totalScore && wsum !== st.totalScore) problems.push(`${id}: 权重合计 ${wsum} ≠ 满分 ${st.totalScore}`)
    for (const p of st.points) {
      if (!p.label) problems.push(`${id}/${p.id}: 缺 label`)
      if (Array.isArray(p.synonyms) && Array.isArray(p.forbidden_point)) {
        const both = p.synonyms.filter((s) => p.forbidden_point.includes(s))
        if (both.length) problems.push(`${id}/${p.id}: 同义表述与反向要点重复`)
      }
    }
  }
  return { ok: problems.length === 0, problems, count }
}

/** 当前已导入包的摘要（设置页展示）；没导过返回 null */
export function getPackInfo(storage = defaultStorage()) {
  if (!storage) return null
  const raw = storage.getItem(LS_KEY)
  if (!raw) return null
  try {
    const j = JSON.parse(raw)
    return { exportedAt: j.exportedAt, count: Object.keys(j.standards || {}).filter((k) => !k.startsWith('_')).length }
  } catch {
    return { exportedAt: '(损坏)', count: 0 }
  }
}

/**
 * 导入（整包替换）：校验通过才落盘，旧包随写入天然被替换。
 * @returns {{ ok, problems, count, replaced: number }} replaced = 旧包题数（0=首次导入）
 */
export function applyPack(json, storage = defaultStorage()) {
  const v = validatePack(json)
  if (!v.ok) return { ...v, replaced: 0 }
  if (!storage) throw new Error('没有可用的 localStorage，标准包写不进去')
  const old = getPackInfo(storage)
  storage.setItem(LS_KEY, JSON.stringify(json))
  return { ...v, replaced: old?.count || 0 }
}

/** 移除标准包：回到内置标准 */
export function removePack(storage = defaultStorage()) {
  storage?.removeItem(LS_KEY)
}

/**
 * 读已导入的标准表（同步）。data/standards/index.js 以最高优先级合并它。
 * 损坏的包按空表处理 —— 宁可回到内置标准，不能让坏数据进评分链路。
 * Node 直跑（.tools 工具链 import index.js）没有 localStorage → 空表，不炸加载期。
 */
export function loadImportedStandards(storage = defaultStorage()) {
  if (!storage) return {}
  const raw = storage.getItem(LS_KEY)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw)
    // Array 也是 object —— 数组没有「题目 id -> 标准」的映射语义，按损坏降级
    return j.standards && typeof j.standards === 'object' && !Array.isArray(j.standards) ? j.standards : {}
  } catch {
    return {}
  }
}

function defaultStorage() {
  // Node 直跑没有 localStorage —— 返回 null，各函数自行降级；护栏注入假存储
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}
