// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 申论错误的**统一口径**：一份固定的类型表 + 一个把自由文本归一化的函数。
//
// 为什么必须有这张表：
//   模型给的 type 是自由文本（早期 prompt 只要求"4 个字以内的短语"）。单看一次批改没问题，
//   但 V3 要做的事全都要求**跨记录聚合**：错题本按类型归类、能力画像按短板排序、
//   复盘卡统计"几位老师都提到了同一件事"。自由文本聚不起来 ——
//   「采分词缺失」「漏点」「要点不全」是同一种毛病，却被算成三类；
//   反过来「分类混乱」和「分类清晰」都会被"分类"两个字命中。所以口径必须先定死。
//
// 为什么仍然保留自由文本：
//   已经跑过的记录不会重跑。归一化函数是**给历史数据用的**，不是给新数据用的。
//   新数据在 prompt 里已经限定从这张表里选（见 agents/skills.js），
//   归一化只是兜底（模型偶尔不听话、或者老记录）。
//
// ⚠️ 加分类时只**追加**，不要改动已有 id —— 错题本与画像里已经存了这些 id，
//    改 id 等于把历史数据全变成孤儿。

/**
 * 错误类型表。`id` 是稳定的机器标识，`label` 是给人看的短名。
 * `selfCheck` 是"下次动笔前该检查什么"—— 复盘卡直接用它生成清单，
 * 所以它必须是**动作**（能照着做），不是**现象**（"要点遗漏"没法照做）。
 */
export const ERROR_TYPES = [
  {
    id: 'point-missing',
    label: '要点遗漏',
    desc: '材料里有、答卷里没有的采分点',
    selfCheck: '写完对着材料逐段圈一遍，确认每个"总结句"都被收进了答案',
  },
  {
    id: 'point-split',
    label: '拆点',
    desc: '同一逻辑层次的要点被打乱后与其他段落随意合并（国考大忌）',
    selfCheck: '按材料的先后顺序排要点；同一段的要点不拆散到别处',
  },
  {
    id: 'point-merge',
    label: '分类混乱',
    desc: '归类不清、层次交叉、同类并到一处却不同类',
    selfCheck: '落笔前先给要点分成 2~4 组，每组一个并列的判断标准',
  },
  {
    id: 'copy-raw',
    label: '整句照抄',
    desc: '抄了完整句子、虚词副词没删，抄词变成抄句',
    selfCheck: '长句拆成短语，删掉"的、了、在、通过、为了"这类虚词，只留实词',
  },
  {
    id: 'over-generalize',
    label: '概括失真',
    desc: '该抄的时候自己编，用生活经验替代材料原词，抽掉关键词变成空话',
    selfCheck: '能抄原词的绝不自己造词；概括后回头核对关键词还在不在',
  },
  {
    id: 'empty-talk',
    label: '空话套话',
    desc: '背景铺垫、堆砌虚词，占用字数还遮住关键词',
    selfCheck: '删掉所有不承载要点的句子——背景、口号、意义，一个不留',
  },
  {
    id: 'off-question',
    label: '形式不应题',
    desc: '没回应问法、文体不符、答非所问',
    selfCheck: '把题干问法抄在草稿上，写完逐句问"这句在回答它吗"',
  },
  {
    id: 'structure',
    label: '结构失当',
    desc: '层次不清、缺总起句、段落失衡、逻辑跳跃',
    selfCheck: '首句给总起，之后每段一个要点，段与段并列不嵌套',
  },
  {
    id: 'word-count',
    label: '字数失当',
    desc: '明显超出或不足限定字数',
    selfCheck: '动笔前按字数要求估算每点写几行；写完数一遍',
  },
  {
    id: 'format',
    label: '格式体例',
    desc: '公文格式、标题、落款、称谓不合规范',
    selfCheck: '公文先摆格式骨架：标题 / 称谓 / 正文 / 落款，缺一不可',
  },
  {
    id: 'expression',
    label: '表述不规范',
    desc: '口语化、语病、术语误用、搭配不当',
    selfCheck: '读一遍，把口语词换成规范表述，把「做好」类空动词换成具体动作',
  },
  {
    id: 'other',
    label: '其他问题',
    desc: '不便归入以上类型的个别问题',
    selfCheck: '',
  },
]

export const ERROR_TYPE_IDS = ERROR_TYPES.map((t) => t.id)
const BY_ID = new Map(ERROR_TYPES.map((t) => [t.id, t]))

export function errorTypeById(id) {
  return BY_ID.get(id) || BY_ID.get('other')
}

export function errorTypeLabel(id) {
  return errorTypeById(id).label
}

/**
 * 归一化规则：**按顺序**匹配，先命中先算。
 *
 * 顺序是这里唯一容易出错的地方，两条原则：
 *   ① 具体压过笼统 —— 「分类混乱」要在「混乱」之前，「形式不应题」要在「结构」之前；
 *   ② 反例要挡住 —— 「概括不清」该进 over-generalize（概括类），
 *      而「层次不清」该进 structure。都用"不清"结尾，靠前面的词区分，顺序就是判据。
 *
 * 每条规则是 [类型 id, 命中关键词数组]，命中任一关键词即归入该类。
 */
const RULES = [
  // —— 抄写类：必须先于"概括类"，因为"摘抄"里也有"概"以外的词，容易互相误伤 ——
  ['copy-raw', ['照抄', '整句抄', '抄了', '抄写', '摘抄', '原文照搬', '未删', '没删', '虚词', '抄句', '抄原文']],
  // —— 概括类：自己编、抽掉关键词 ——
  // '关键词' 放在这里是有意的：说"关键词丢了/没提炼出来"就是概括类问题。
  // 它也可能出现在抄写类的句子里（"关键词照抄原句"），那种情况靠**规则顺序**判主类
  // （copy-raw 在前，先命中先算），而 matchErrorTypes 会把两类都算上 —— 本来也确实两类都是。
  ['over-generalize', ['概括失真', '过度概括', '高度概括', '提炼错', '提炼不当', '自己编', '生活经验', '失真', '空泛', '抽掉', '丢失关键词', '关键词', '概括不清', '概括不准', '词不达意']],
  // —— 拆点：国考大忌，优先级高 ——
  ['point-split', ['拆点', '拆散', '打乱', '随意合并', '逻辑层次混']],
  // —— 分类：要在 generic 的"混乱/层次"之前 ——
  ['point-merge', ['分类混乱', '归类', '分类不', '层次交叉', '同类', '并列不当', '分类']],
  // —— 应题：要在"结构"之前，「形式不应题」不能被"结构"抢走 ——
  ['off-question', ['不应题', '应题', '问法', '答非所问', '跑题', '偏题', '文体不符', '没有回应']],
  // —— 格式体例：要在"结构/层次"之前 ——
  ['format', ['格式', '体例', '标题', '落款', '称谓', '公文格式', '行文规范']],
  // —— 要点遗漏 ——
  // 「未点明 / 未展开 / 没接住」这几种说法在批改意见里很常见，说的都是"材料里有、答卷里没有"，
  // 归到要点遗漏比归「其他」有用得多（「其他」给不出可照做的改法）。
  // ⚠️ 这条规则必须排在 word-count 之前：'展开不足' 里含 '不足'，
  //    顺序反了就会把"分论点展开不足"误判成字数问题。
  ['point-missing', ['遗漏', '漏点', '缺失', '缺漏', '没写到', '未覆盖', '不全', '缺要点', '要点缺', '未涉及',
    '未点明', '没点明', '未展开', '没展开', '展开不足', '接住', '未提到', '没提到', '未写', '没写']],
  // —— 空话 ——
  ['empty-talk', ['空话', '套话', '铺垫', '背景', '凑字', '废话', '万金油', '口号', '意义论述']],
  // —— 结构 ——
  ['structure', ['结构', '层次', '逻辑', '总起', '段落', '条理', '跳跃', '嵌套']],
  // —— 字数 ——
  ['word-count', ['字数', '超限', '不足', '太短', '太长', '超出限定', '字数不够']],
  // —— 表述 ——
  ['expression', ['口语', '表述不', '不规范', '语病', '搭配', '术语', '用词', '语句不通']],
]

/** 复合写法切分：prompt 允许模型用逗号把两个 id 连起来（`copy-raw,over-generalize`） */
function splitParts(s) {
  return String(s).split(/[,，、|]+/).map((x) => x.trim()).filter(Boolean)
}

/**
 * 把模型给的自由文本类型归一化成表里的 id。
 *
 * 传进来已经是合法 id 时原样返回（新数据走的就是这条），
 * 认不出来的一律归 `other` —— **宁可漏归一类，也不要硬塞**：
 * 错塞会让"错题本"给出错误的复习重点，比不分类更误导。
 *
 * @param {string} raw 模型给的 type / point 文本，或已是 id
 * @returns {string} ERROR_TYPES 里的 id
 */
export function normalizeErrorType(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'other'
  const parts = splitParts(s)
  // 复合 id：取第一个当主类（一笔批注能算两类，但"主类"只能有一个）
  if (parts.length > 1 && parts.every((p) => BY_ID.has(p))) return parts[0]
  if (BY_ID.has(s)) return s

  const lower = s.toLowerCase()
  for (const [id, keys] of RULES) {
    if (keys.some((k) => lower.includes(k.toLowerCase()))) return id
  }
  return 'other'
}

/**
 * 一段文本可能命中多个类型（一条批注既在漏点又在抄句）。
 * 返回**全部**命中，按表里的顺序，去重。用于"这条批注算哪几类错误"。
 */
export function matchErrorTypes(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return []
  const parts = splitParts(s)
  // 模型按 prompt 写的复合 id 形式：直接就是答案，不必再猜关键词
  if (parts.length > 1 && parts.every((p) => BY_ID.has(p))) return [...new Set(parts)]
  if (BY_ID.has(s)) return [s]
  const lower = s.toLowerCase()
  const hit = RULES.filter(([, keys]) => keys.some((k) => lower.includes(k.toLowerCase())))
    .map(([id]) => id)
  return hit.length ? [...new Set(hit)] : ['other']
}

/** 供 prompt 使用：让模型从固定表里挑，而不是自由发挥 */
export function errorTypePromptList() {
  return ERROR_TYPES.map((t) => `${t.id}（${t.label}）`).join(' / ')
}
