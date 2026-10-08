// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 材料分块：把给定资料按「材料1 / 材料2」拆成块，供 Highlightable 渲染。
// 真题材料就是这种分则结构，拆开渲染比一整块好读得多。
// 不在行首出现的「材料」二字（正文里提到）不会被误切——只认整行匹配。
// （2026-10-08 从 PracticeView 抽出：M4 精读训练页共用同一实现，防两份漂移。）

export function materialBlocks(text) {
  const src = String(text || '')
  if (!src.trim()) return []
  const blocks = []
  let cur = null
  for (const line of src.split('\n')) {
    const m = line.match(/^材料\s*([0-9一二三四五六七八九十]+)\s*$/)
    if (m) {
      cur = { label: `材料${m[1]}`, body: [] }
      blocks.push(cur)
      continue
    }
    if (!cur) {
      cur = { label: '', body: [] }
      blocks.push(cur)
    }
    cur.body.push(line)
  }
  return blocks
    .map((b) => ({ label: b.label, body: b.body.join('\n').trim() }))
    .filter((b) => b.label || b.body)
}
