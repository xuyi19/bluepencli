// 内置真题题库
//
// ⚠️ 这里放的是真实公考申论真题（题干+给定资料+参考答案）。
//    当前为少量示例结构，需要持续补充。
//    补充方式：按同样结构追加对象即可，程序会自动读取。

export const BUILTIN_QUESTIONS = [
  {
    id: 'q-2024-guoji-1',
    title: '请根据给定资料，概括我国在推动高质量发展过程中采取的主要举措',
    year: 2024,
    exam: '国家公务员考试（副省级）',
    type: '归纳概括',
    requirement: '准确、全面、有条理。不超过 250 字。',
    maxScore: 20,
    wordLimit: 250,
    difficulty: 3,
    topics: ['高质量发展', '科技创新'],
    material: `【示例结构说明】
此处应粘贴该题的完整给定资料原文。

真题资料的补充是本项目重要的内容建设工作，建议：
1. 优先补充近 5 年国考、联考、目标省份省考真题
2. 每道题保留完整的题干、材料、作答要求、参考答案
3. 标注题型（归纳概括/综合分析/提出对策/贯彻执行/大作文），便于按题型专项训练

—— 待补充 ——`,
    reference: '（待补充参考答案）',
  },
  {
    id: 'q-2024-guoji-2',
    title: '请结合给定资料，就如何进一步优化营商环境提出对策建议',
    year: 2024,
    exam: '国家公务员考试（市地级）',
    type: '提出对策',
    requirement: '措施具体可行，针对性强。不超过 400 字。',
    maxScore: 25,
    wordLimit: 400,
    difficulty: 4,
    topics: ['营商环境', '社会治理'],
    material: `【示例结构说明】
此处应粘贴该题的完整给定资料原文。

—— 待补充 ——`,
    reference: '（待补充参考答案）',
  },
  {
    id: 'q-2024-guoji-essay',
    title: '以「守正创新」为主题，自拟题目，写一篇文章',
    year: 2024,
    exam: '国家公务员考试（副省级）',
    type: '大作文',
    requirement: '观点明确，见解深刻；参考给定资料，但不拘泥于给定资料；思路清晰，语言流畅。1000-1200 字。',
    maxScore: 40,
    wordLimit: 1200,
    difficulty: 5,
    topics: ['守正创新', '党的建设'],
    material: `【示例结构说明】
此处应粘贴该题的完整给定资料原文。

—— 待补充 ——`,
    reference: '（待补充高分范文）',
  },
]

export const QUESTION_TYPES = [
  '归纳概括',
  '综合分析',
  '提出对策',
  '贯彻执行',
  '大作文',
]

/** 兼容统一 ID 前缀，避免与用户自建题目冲突 */
export function withPrefix(q) {
  return { ...q, id: `builtin-${q.id}`, builtin: true }
}
