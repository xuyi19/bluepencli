/** 从模型输出中稳健地提取 JSON 对象 */
export function parseJson(text) {
  if (!text) return null
  let s = String(text).trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  // 优先整段解析
  try {
    return JSON.parse(s)
  } catch {}

  // 退化到第一个 { 到最后一个 }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1))
    } catch {}
  }

  // 括号配平扫描（应对 JSON 后跟解释文字、或前面有寒暄的情况）
  const firstBrace = s.indexOf('{')
  if (firstBrace !== -1) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = firstBrace; i < s.length; i++) {
      const ch = s[i]
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(firstBrace, i + 1))
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}
