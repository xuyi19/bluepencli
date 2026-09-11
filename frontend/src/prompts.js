// 追问与示范作答的 Prompt 模板。
// 批改主流程的 Prompt 在 agents/skills.js —— 每位老师一套专属指令，不要在这里再写一遍。

export const FOLLOWUP_SYSTEM = `你是一名申论阅卷老师。考生针对你的批改结果追问，请给出直接、具体、可操作的回答。
不要复述批改内容，只回答追问的问题。控制在 300 字以内。`

export function buildFollowupMessages({ answer, grading, question }) {
  return [
    { role: 'system', content: FOLLOWUP_SYSTEM },
    {
      role: 'user',
      content: `【我的作答】\n${answer}\n\n【批改结果】\n${grading}\n\n【我的追问】\n${question}`,
    },
  ]
}

export const SAMPLE_SYSTEM = `你是一名申论命题与教研专家。请根据题目与资料，写一篇该题目的高分示范作答。
要求：符合申论答题规范，结构清晰，论证充实，语言规范，字数符合题目要求。只输出示范正文本身。`

export function buildSampleMessages({ title, requirement, material, wordLimit }) {
  return [
    { role: 'system', content: SAMPLE_SYSTEM },
    {
      role: 'user',
      content: `【题目】${title}\n【作答要求】${requirement}\n【字数要求】${wordLimit || '按题目要求'}\n\n【给定资料】\n${material}`,
    },
  ]
}
