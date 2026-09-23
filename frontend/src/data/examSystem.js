// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 考试体系识别 —— 「这套卷是国考还是省考、哪个省」的**单一真源**。
//
// 为什么独立成模块：题库 UI（题库页标识）、汇编导出（.tools/export-bank-docs.mjs
// 的体系目录）、将来的省考推荐逻辑，都要回答同一个问题。过去这个判断
// 散在导出脚本里，将来会漂 —— 跨记录聚合口径必须先有固定表（教训见能力画像）。
//
// 现有 24 套公开卷都是国考且 exam JSON 里没有 system 字段，所以识别走 title；
// 新省考卷在源 JSON 里可以直接写 system 字段（生成器会写），优先级最高。

/** 31 个省级行政区的简称与全名（识别用，含常见别称） */
const PROVINCE_NAMES = [
  '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西',
  '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西',
  '甘肃', '青海', '中国台湾', '内蒙古', '广西', '中国西藏', '宁夏', '新疆',
  '北京', '天津', '上海', '重庆',
]
// title 里可能出现的别称 → 归一化名
const PROVINCE_ALIAS = { 台湾: '中国台湾', 西藏: '中国西藏' }

/** 省考卷别 → 排序权重（与国考的 PAPER_ORDER 同一套口径） */
const PROVINCE_PAPER_ORDER = { 县级: 0, 县级以上: 0, 乡镇: 1, 乡镇级: 1, 行政执法: 2 }

/** 国考卷别 → 排序权重（历史口径，勿改：地市级在前） */
const EXAM_PAPER_ORDER = { 地市级: 0, 省部级: 1, 省级: 1, 行政执法: 2 }

/**
 * 识别一套卷的考试体系。
 * @param {{system?: string, title?: string}} exam 卷元数据
 * @returns {string} '国考' | '省考-XX' | '其他'
 */
export function examSystemOf(exam) {
  if (!exam) return '其他'
  // 源数据显式声明优先（省考卷由生成器写入，不靠猜）
  if (exam.system) return exam.system
  const t = String(exam.title || '')
  if (/国家|国考/.test(t)) return '国考'
  for (const name of PROVINCE_NAMES) {
    if (t.includes(name)) return `省考-${name}`
  }
  for (const [alias, name] of Object.entries(PROVINCE_ALIAS)) {
    if (t.includes(alias)) return `省考-${name}`
  }
  return '其他'
}

/** 卷别排序权重：国考卷别 + 省考卷别统一口径，未知卷别垫底 */
export function paperRank(paper) {
  const p = String(paper || '')
  return EXAM_PAPER_ORDER[p] ?? PROVINCE_PAPER_ORDER[p] ?? 9
}

/** 省考卷别合法值（生成器与校验用） */
export function isProvincePaper(paper) {
  return String(paper || '') in PROVINCE_PAPER_ORDER
}

/** 申论五大题型（国省考通用；type 字段是自由文本，白名单只作提示不作硬卡） */
export const QUESTION_TYPES = ['归纳概括', '综合分析', '提出对策', '贯彻执行', '大作文']
