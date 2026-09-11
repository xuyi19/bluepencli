/**
 * 文章导入解析工具
 * 支持：纯文本(.txt) / Markdown(.md) / 文章包(.json, 单篇或数组)
 */

const TEXT_EXT = /\.(txt|md|markdown|text)$/i

function isTextFile(name) {
  return TEXT_EXT.test(name)
}

function stripExt(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/[/\\]/g, '/').split('/').pop()
}

/** 从 Markdown / 纯文本里猜标题：优先首个 # 标题行，其次首行短句，最后用文件名 */
function guessTitle(text, filename) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean)
  for (const l of lines.slice(0, 5)) {
    const m = l.match(/^#{1,3}\s+(.+)$/)
    if (m) return m[1].trim().slice(0, 80)
  }
  for (const l of lines.slice(0, 3)) {
    if (l.length >= 6 && l.length <= 40 && !/[。！？；]/.test(l)) return l
  }
  return stripExt(filename) || '未命名文章'
}

/** 从正文里猜来源，例如「来源：人民日报」或「来源: 新华社」 */
function guessSource(text) {
  const m = String(text).match(/来\s*源[：:]\s*([^\n，,。]{2,20})/)
  return m ? m[1].trim() : ''
}

function countWords(s) {
  return String(s || '').replace(/\s/g, '').length
}

/** 解析单个文本文件 → 文章草稿 */
function parseTextFile(filename, text) {
  const content = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!content) return null
  return {
    title: guessTitle(content, filename),
    source: guessSource(content),
    url: '',
    topics: [],
    content,
    wordCount: countWords(content),
    _from: filename,
  }
}

/** 解析 JSON 文章包。接受：数组 / {articles:[...]} / 单篇对象 */
export function parseJsonPack(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSON 格式错误，请检查文件内容')
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.articles) ? raw.articles : [raw]
  return list
    .map((a) => {
      if (typeof a === 'string') {
        const content = a.trim()
        if (!content) return null
        return { title: guessTitle(content, ''), source: '', url: '', topics: [], content, wordCount: countWords(content) }
      }
      if (!a || typeof a !== 'object') return null
      const content = String(a.content || a.text || a.body || '').trim()
      if (!content) return null
      return {
        title: String(a.title || guessTitle(content, '')).slice(0, 120),
        source: String(a.source || a.from || ''),
        url: String(a.url || a.link || ''),
        topics: Array.isArray(a.topics) ? a.topics.map(String) : String(a.topics || '').split(/[,，\s]+/).filter(Boolean),
        date: a.date || '',
        content,
        wordCount: a.wordCount || countWords(content),
        _from: '',
      }
    })
    .filter(Boolean)
}

/** 读取 FileList → 文章草稿数组 */
export async function readFilesAsArticles(fileList) {
  const files = Array.from(fileList || [])
  const out = []
  const skipped = []
  for (const f of files) {
    const path = f.webkitRelativePath || f.name
    try {
      const text = await f.text()
      if (/\.json$/i.test(f.name) && !f.webkitRelativePath) {
        out.push(...parseJsonPack(text))
      } else if (isTextFile(f.name) || f.type.startsWith('text/')) {
        const a = parseTextFile(path, text)
        if (a) out.push(a)
        else skipped.push(path)
      } else {
        skipped.push(path)
      }
    } catch (e) {
      skipped.push(`${path}（读取失败）`)
    }
  }
  return { articles: out, skipped }
}

/** 导出为文章包 JSON 字符串 */
export function toPackJson(articles) {
  return JSON.stringify(
    {
      format: 'bluepencil-articles',
      version: 1,
      exportedAt: new Date().toISOString(),
      articles: (articles || []).map((a) => ({
        title: a.title,
        source: a.source || '',
        url: a.url || '',
        topics: a.topics || [],
        date: a.date || '',
        content: a.content,
        wordCount: a.wordCount || countWords(a.content),
      })),
    },
    null,
    2
  )
}

/** 触发浏览器下载 */
export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
