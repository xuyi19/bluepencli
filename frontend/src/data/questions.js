// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库统一入口：**仿真题 + 公开真题 + 私有真题**
//
// 为什么要这一层：
//   仿真题（builtin-questions.js，15 道）材料短、随包走，直接全量在内存里；
//   真题（24 套公开 + 9 套私有）光材料就 23 万字，全量进主包会拖慢首屏。
//   所以真题在这里被拆成「摘要」和「正文」两段：
//     · 摘要（id/题干/题型/分值/字数/卷别）常驻，题库页列表、每日一练选题都用它；
//     · 正文（整卷材料 + 参考答案）按套懒加载，练习时 loadFullQuestion() 才 await。
//
// 公开 / 私有的分界线在 2021 年（见 data/real-exams/index.js 的头注释）：
//   公开卷随包分发；私有卷**不进仓库、不进分发产物**，由作者定向分发后导入。
//   本机存在 real-exams-private/ 时，别名 '@private-exams' 指向真身；
//   别人 clone 或构建分发包时它不存在，别名落到 private-stub，私有卷自然为空。
//
// 单文件版注意：vite 单文件构建开了 inlineDynamicImports，这些 chunk 会被内联，
// 双击 HTML 离线也能用 —— 代价是体积会涨（公开卷约 1MB，本机全量再多 0.4MB）。

import { BUILTIN_QUESTIONS, withPrefix } from './builtin-questions'
import {
  EXAM_INDEX as PUBLIC_INDEX,
  EXAM_LOADERS as PUBLIC_LOADERS,
} from './real-exams/index'
import {
  EXAM_INDEX as PRIVATE_INDEX,
  EXAM_LOADERS as PRIVATE_LOADERS,
} from '@private-exams'

/** 真题题目的 id：与仿真题的 `builtin-` 前缀不冲突 */
export function realQuestionId(examId, no) {
  return `real-${examId}-${no}`
}

/**
 * 卷序按年份**从新到旧** —— 备考优先练近年真题，2010 年的排在最前面没有意义。
 * 私有卷（近三年）在同一年里排在公开卷之前，因为那才是最该练的。
 */
const ALL_EXAMS = [...PUBLIC_INDEX, ...PRIVATE_INDEX].sort(
  (a, b) => b.year - a.year || String(a.id).localeCompare(String(b.id))
)

const ALL_LOADERS = { ...PUBLIC_LOADERS, ...PRIVATE_LOADERS }

/**
 * 真题摘要（无材料、无答案）。material 留空串是刻意的：
 * 列表页用 materialChars 显示篇幅，不需要正文。
 */
export const REAL_QUESTIONS = ALL_EXAMS.flatMap((e) =>
  e.questions.map((q) => ({
    id: realQuestionId(e.id, q.no),
    builtin: true,
    kind: '真题',
    tier: e.tier,             // 'public' | 'private'，题库页据此标「公开 / 私有」
    needLoad: true,
    examId: e.id,
    no: q.no,
    year: e.year,
    paper: e.paper,
    // 「2024 年国考 · 行政执法卷」比单写卷名更能认出来是哪套
    exam: `${e.year} 年国考 · ${e.paper}`,
    title: q.stem,
    type: q.type,
    requirement: q.requirement,
    maxScore: q.score,
    wordLimit: q.wordLimit,
    materialChars: e.materialChars,
    material: '',
    reference: '',
    topics: [],
  }))
)

/** 仿真题：材料与答案都已在包内，标记 needLoad=false 让调用方直接可用 */
export const SIM_QUESTIONS = BUILTIN_QUESTIONS.map(withPrefix)

/**
 * 内置题库池 = 真题 + 仿真。
 * 真题排在前面：它是这个项目最有价值的部分，也是用户最该练的；
 * 仿真题材料短、适合热身，放后面。自建题与导入题由各页自行拼在最前。
 */
export const BUILTIN_POOL = [...REAL_QUESTIONS, ...SIM_QUESTIONS]

/** 真题卷列表（题库页按年份/卷别分组用），同样从新到旧 */
export const REAL_EXAMS = ALL_EXAMS

/** 私有卷套数。分发版恒为 0 —— 题库页据此决定要不要提示"导入私有题库"。 */
export const PRIVATE_EXAM_COUNT = PRIVATE_INDEX.length

/** 公开区间的年份上界，题库页文案用（与 to_frontend.py 的 PUBLIC_MAX_YEAR 对齐） */
export const PUBLIC_MAX_YEAR = 2021

/**
 * 取完整题目。仿真题直接命中内存；真题 await 对应卷的 chunk。
 * 调用方（练习页）必须 await —— 否则拿到的是 material 为空的摘要。
 */
export async function loadFullQuestion(id) {
  const sim = SIM_QUESTIONS.find((q) => q.id === id)
  if (sim) return sim

  const summary = REAL_QUESTIONS.find((q) => q.id === id)
  if (!summary) return null

  const loader = ALL_LOADERS[summary.examId]
  if (!loader) return null
  const exam = (await loader()).default
  const q = exam.questions.find((x) => x.no === summary.no)
  if (!q) return null

  return {
    ...summary,
    needLoad: false,
    material: exam.material,
    // 以卷内正文为准，摘要只用于列表展示
    requirement: q.requirement || summary.requirement,
    maxScore: q.score,
    wordLimit: q.wordLimit,
    type: q.type || summary.type,
    reference: q.reference,
  }
}

/**
 * 池子里的条目可能是摘要（真题）也可能是完整对象（仿真）。
 * 统一用它取一次，避免调用方到处写分支。
 */
export async function resolveQuestion(q) {
  if (!q) return null
  return q.needLoad ? loadFullQuestion(q.id) : q
}
