// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 采分点归并（多老师 → 一份）
//
// 为什么必须有这一层：
//   多老师模式下，每位老师各自吐一份 keyPoints，它们**说的是同一批采分点**，
//   只是措辞和判定不同。早期代码用 `results.flatMap(r => r.keyPoints)` 直接拼，
//   于是「同一个采分点出现 N 次」，前端「命中 X / Y 项」直接数数组长度 ——
//   **数字必定是假的**（实测：三师批改 6 条里有 2 条文字完全相同，weight 合计 21
//   而标准只有 20）。这不是显示问题，是数据结构从源头就没对齐。
//
// 两条归并路径（按有没有标准自动选）：
//   ① 有标准 → **按标准点 id 对齐**（首选）。匹配优先级：
//      ①-a 老师回了 pointId 且能对上标准 → 精确匹配，最可靠；
//      ①-b 没回 pointId（模型不听话 / 老记录）→ 退到「关键词 + 相似度」双判，
//           且阈值必须**宽松**：实测同一个采分点，老师措辞与标准 label 的 bigram
//           相似度只有 0.24（"加大资金投入…" vs "省财政每年安排专项资金…"），
//           按常规阈值 0.55 判会**全部漏配** —— 这是本模块第一版写错的根因。
//           中文申论里"同一个点"的表述差异是无界的，**纯字面相似度天生不适用**。
//   ② 无标准 → **按语义近似聚类**：老师自己生成的要点没有 id，只能用关键词+相似度。
//      不追求精确，但绝不能重复 —— 宁可归并得粗一点，也不要同一句话说两遍。
//
// 归并规则（两条路径共用）：
//   · status 取**最好**的一次（hit > partial > miss）——「有老师认为答到了」就该体现出来，
//     否则归并会把最乐观的判断吃掉，考生看到的漏点比实际多。
//   · weight 取众数（多数老师认同的分值），没有则取最大值。
//   · 记录 sources（哪几位老师给了这条），供结果页展示「3 位老师都提到」。

// ⚠️ 写全 `.js` 后缀：本模块要保持**能被 Node 直接 import**（.tools/test-key-points.mjs
//    要跑它），省掉后缀在 Vite 里没问题，但 Node 的 ESM 解析器不补全，会 ERR_MODULE_NOT_FOUND。
import { POINT_STATUS } from '../../agents/grading/standard.js'


/** status 优先序：数值越小越好 */
const STATUS_RANK = { [POINT_STATUS.HIT]: 0, [POINT_STATUS.PARTIAL]: 1, [POINT_STATUS.MISS]: 2 }

function betterStatus(a, b) {
  const ra = STATUS_RANK[a] ?? 3
  const rb = STATUS_RANK[b] ?? 3
  return ra <= rb ? a : b
}

/** 取众数；票数相同取较大的值 */
function modeWeight(list) {
  const nums = list.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
  if (!nums.length) return 0
  const count = new Map()
  for (const n of nums) count.set(n, (count.get(n) || 0) + 1)
  let best = nums[0]
  let bestN = 0
  for (const [n, c] of count) {
    if (c > bestN || (c === bestN && n > best)) {
      best = n
      bestN = c
    }
  }
  return best
}

/** 归一化文本用于相似度比较：去空白、去标点、去常见虚词 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？"""''（）《》【】,.;:!?"'()<>\[\]]/g, '')
    .replace(/[的是了在和与及等一个这那]/g, '')
}

/** 字符二元组集合（中文没有空格，bigram 比按词切更稳） */
function bigrams(s) {
  const set = new Set()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  if (s.length === 1) set.add(s)
  return set
}

/** Jaccard 相似度 */
function similarity(a, b) {
  const A = bigrams(normalize(a))
  const B = bigrams(normalize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

/** 相似度阈值（无标准时的聚类用）：低于此值认为是两个不同的点 */
export const SIMILARITY_THRESHOLD = 0.55

/**
 * 与标准点匹配的宽松阈值。
 *
 * ⚠️ 这两个数字是实测出来的，不是拍脑袋：
 *    同一个采分点（p2 资金投入），老师写"省财政每年安排专项资金20亿元，对成效突出的县
 *    给予每县最高2000万元奖补"，标准 label 是"加大资金投入：设立省级专项资金，对成效
 *    突出的县给予奖补" —— 这是**同一个点**，bigram 相似度只有 0.256。
 *    所以 0.55 会把正确匹配全部拒掉。取 0.2 作门槛，再叠加关键词判据兜底。
 */
export const MATCH_SIM_THRESHOLD = 0.2
/** 关键词命中数达到这个值，即便相似度不够也算匹配 */
export const MATCH_KEYWORD_HITS = 2

/** 判断一条老师写的要点是否匹配某个标准点 */
function matchesStandardPoint(sp, item) {
  // 关键词判据：标准的 keywords 里有 ≥N 个出现在老师文本里
  const kws = sp.keywords || []
  if (kws.length) {
    const hits = kws.filter((k) => item.point.includes(String(k)))
    if (hits.length >= Math.min(MATCH_KEYWORD_HITS, kws.length)) return true
  }
  return similarity(sp.label, item.point) >= MATCH_SIM_THRESHOLD
}

/**
 * 归并一份「同义簇」。
 * @param {Array<{point,status,earned,weight,note,teacherId,teacherName}>} group
 */
function mergeGroup(group) {
  const head = group[0]
  const statuses = group.map((g) => g.status || POINT_STATUS.MISS)
  const status = statuses.reduce((a, b) => betterStatus(a, b), statuses[0])
  const weight = modeWeight(group.map((g) => g.weight))
  // earned 跟着最终 status 与 weight 走，不取各老师的平均值 ——
  // 否则会出现「status=miss 但 earned>0」这种自相矛盾的展示
  const ratio = status === POINT_STATUS.HIT ? 1 : status === POINT_STATUS.PARTIAL ? 0.5 : 0
  const spent = +(weight * ratio).toFixed(1)
  // note 取第一条非空的（同簇里通常只有一两条有实质判断）
  const note = group.map((g) => g.note).find((n) => n && n.trim()) || ''
  return {
    point: head.point,
    status,
    earned: spent,
    weight,
    note,
    // 这条要点是哪几位老师给出的（去重、保持顺序）
    sources: [...new Set(group.map((g) => g.teacherName || g.teacherId).filter(Boolean))],
  }
}

/** 语义聚类（无标准时用）：贪心地把每条并进第一个够相似的簇 */
function clusterBySimilarity(flat) {
  const clusters = []
  for (const item of flat) {
    let placed = false
    for (const c of clusters) {
      // 只要与簇里**任意一条**够像，就并进去
      if (c.some((m) => similarity(m.point, item.point) >= SIMILARITY_THRESHOLD)) {
        c.push(item)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([item])
  }
  return clusters
}

/**
 * 把多份老师 keyPoints 归并成一份。
 *
 * @param {Array<{teacherId:string, keyPoints?:Array}>} results 各老师的批改结果
 * @param {object|null} standard 该题采分点标准（有则按标准对齐）
 * @returns {Array} 归并后的 keyPoints（无标准时按相似度聚类，顺序为首次出现顺序）
 */
export function mergeKeyPoints(results, standard = null) {
  // 摊平，并记住每条出自哪位老师
  const flat = []
  for (const r of results || []) {
    if (r?.error) continue
    for (const kp of r?.keyPoints || []) {
      const point = String(kp?.point || '').trim()
      if (!point) continue
      flat.push({
        point,
        // 模型回填的标准点编号（有标准时提示词强制要求）；没回就是空串，走模糊匹配兜底
        pointId: String(kp?.pointId || kp?.point_id || '').trim(),
        status: kp.status || POINT_STATUS.MISS,
        weight: Number(kp.weight) || 0,
        earned: Number(kp.earned) || 0,
        note: kp.note || '',
        teacherId: r.teacherId || '',
        teacherName: r.teacherName || '',
      })
    }
  }
  // ⚠️ 这里不能提前 return []：
  //    有标准但老师全挂（API 挂了 / 模型全解析失败）时，`flat` 是空的，
  //    但标准点依然要列出来 —— 那种时刻考生**最需要**知道"这道题该答哪几点"。
  //    早期写成早退，等于把最有价值的兜底信息丢了。
  const points = standard?.points || []

  // ── 路径①：有标准 → 按标准点对齐 ──
  if (points.length) {
    /** 归属结果：标准点 id → 老师条目下标数组 */
    const byId = new Map()
    points.forEach((sp) => byId.set(String(sp.id), []))
    /**
     * 条目下标 → 该条目对某标准点是否算「强证据」。
     * 用途：追加归属（①-c）拉进来的条目对那个点是**弱证据** ——
     * 它主要用于回答「这个点有没有人提到」，但**不应该**用自己的分数去拉高该点的 status
     * （否则一句话里顺带提到的词，会把一个明显没答到的点变成 hit，覆盖率虚高）。
     *
     * 但真数据里确实有「一句话说了两个点」的情况（B 老师那句"…；年设专项资金并奖补"
     * 对 p2 是实打实的命中）。所以判据不是"归属方式"而是**该条对该点的匹配强度**：
     * 关键词命中数够（≥全部关键词的 2/3）就认强证据。
     */
    const strong = new Set()

    // ①-a 先按 pointId 精确归位（模型回了 pointId 时最可靠，且优先于模糊匹配）
    const noId = []
    flat.forEach((item, i) => {
      const pid = String(item.pointId || '').trim()
      if (pid && byId.has(pid)) {
        byId.get(pid).push(i)
        strong.add(i)      // 模型自己指认了编号，是强证据
      } else {
        noId.push(i)
      }
    })

    // ①-b 没带 pointId 的，按关键词+相似度找归属。
    //      挑「最像」的那个标准点作**专属归属**（防止一句话被算进所有够得着的点，
    //      那会把覆盖率虚高）。
    const bestOfItem = new Map() // 条目下标 → 标准点
    for (const i of noId) {
      const item = flat[i]
      let best = null
      let bestSim = -1
      for (const sp of points) {
        if (!matchesStandardPoint(sp, item)) continue
        const s = similarity(sp.label, item.point)
        if (s > bestSim) {
          bestSim = s
          best = sp
        }
      }
      if (best) bestOfItem.set(i, best)
    }
    for (const [i, sp] of bestOfItem) {
      byId.get(String(sp.id)).push(i)
      strong.add(i)        // 专属归属（最像的那个），是强证据
    }

    // ①-c 补充归属：一条老师要点可能**同时说了好几个采分点**
    //      （实测真数据：周泰然那句"成立领导小组，16部门参与，建立调度考核机制；
    //       年设专项资金并奖补"里，前半句是 p1 的组织保障、后半句是 p2 的资金投入）。
    //      ①-b 的「最像」匹配会把它独占给 p1，于是 p2 永远等不到人 ——
    //      这正是真数据里 p2 被错判的直接原因。
    //
    // ⚠️ 门槛写错过一次：原来是 `max(MATCH_KEYWORD_HITS, min(3, kws.length))`，
    //    对 3 个关键词的 p2 要求命中 3 个 —— 而周泰然只命中 2 个（专项资金、奖补），
    //    被挡在门外。**门槛不该随关键词总数水涨船高**：
    //    关键词 3 个时命中 2 个已经是很明确的指向了。
    //    改为「命中数 ≥ MATCH_KEYWORD_HITS，或占全部关键词的 2/3 以上」。
    for (const i of noId) {
      const item = flat[i]
      for (const sp of points) {
        const sid = String(sp.id)
        if (byId.get(sid).includes(i)) continue
        const kws = sp.keywords || []
        if (!kws.length) continue
        const hits = kws.filter((k) => item.point.includes(String(k)))
        const enough = hits.length >= MATCH_KEYWORD_HITS || hits.length * 3 >= kws.length * 2
        if (enough) {
          byId.get(sid).push(i)
          // 命中 ≥2/3 关键词 → 认强证据（真说了这个点）；只中 2 个且关键词更多时算「提到过」
          if (hits.length * 3 >= kws.length * 2) strong.add(i)
        }
      }
    }

    const out = []
    for (const sp of points) {
      const idx = byId.get(String(sp.id)) || []
      if (idx.length) {
        // status 只在**强证据**之间竞争：弱证据（那句只是顺带提了半个词）
        // 不该把一个明显没答到的点拉成 hit
        const strongIdx = idx.filter((i) => strong.has(i))
        const merged = mergeGroup((strongIdx.length ? strongIdx : idx).map((i) => flat[i]))
        out.push({
          ...merged,
          // 有标准时，点文本与分值**一律以标准为准**，
          // 让「权重合计 == 标准满分」恒成立（这是可复算的硬判据）
          point: sp.label,
          weight: sp.weight,
          earned: +(
            sp.weight * (merged.status === POINT_STATUS.HIT ? 1 : merged.status === POINT_STATUS.PARTIAL ? 0.5 : 0)
          ).toFixed(1),
          standardId: sp.id,
          // sources 用**全部**来源（含弱证据）——「哪几位老师提过」是事实陈述
          sources: [...new Set(idx.map((i) => flat[i].teacherName || flat[i].teacherId).filter(Boolean))],
        })
      } else {
        // 没有老师提到这个点 —— 依然是 miss，必须列出来（这正是考生最需要的）
        out.push({
          point: sp.label,
          status: POINT_STATUS.MISS,
          earned: 0,
          weight: sp.weight,
          note: sp.note || '',
          sources: [],
          standardId: sp.id,
        })
      }
    }

    // 老师写出、但**没有任何标准点认领**的要点：保留在末尾，不并进标准点
    // （prompt 里明确鼓励肯定标准之外的好点，丢掉等于把老师最有价值的补充吃了）
    const owned = new Set()
    for (const idx of byId.values()) idx.forEach((i) => owned.add(i))
    const leftovers = flat.filter((_, i) => !owned.has(i))
    for (const c of clusterBySimilarity(leftovers)) {
      out.push({ ...mergeGroup(c), extra: true })
    }
    return out
  }

  // ── 路径②：无标准 → 按语义相似度聚类 ──
  return clusterBySimilarity(flat).map(mergeGroup)
}

/**
 * 汇总一行给 UI 用的统计。
 * 注意 hitCount 统计的是**归并后**的点，这才是真数字。
 */
export function summarizeKeyPoints(keyPoints = []) {
  const main = keyPoints.filter((k) => !k.extra)
  return {
    total: main.length,
    hit: main.filter((k) => k.status === POINT_STATUS.HIT).length,
    partial: main.filter((k) => k.status === POINT_STATUS.PARTIAL).length,
    miss: main.filter((k) => k.status === POINT_STATUS.MISS).length,
    extra: keyPoints.length - main.length,
    weightSum: +main.reduce((s, k) => s + (k.weight || 0), 0).toFixed(1),
    earnedSum: +main.reduce((s, k) => s + (k.earned || 0), 0).toFixed(1),
  }
}
