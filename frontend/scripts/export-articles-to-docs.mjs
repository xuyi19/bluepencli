// 把内置文章库导出为可读的 Markdown，放进 docs/ 方便查阅与维护。
//
// 用法：node scripts/export-articles-to-docs.mjs
//
//   输入：src/data/builtin-articles.json   ← 程序实际加载的数据
//   输出：../../docs/articles/*.md          ← 人读的镜像
//         ../../docs/articles/README.md     ← 按主题分组的索引
//
// 为什么要多这一层：JSON 是给程序读的，人要翻阅、校对、增补都不方便；
// 但文章又必须存在于 src/data/ 下才能被打包进单文件版。
// 所以保留 JSON 作为"程序用"的唯一数据源，另出一份 Markdown 镜像给人看。
// 改文章时改 Markdown 后重新导入 JSON，或直接改 JSON 后重跑本脚本。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_FILE = path.resolve(__dirname, '../src/data/builtin-articles.json')
const OUT_DIR = path.resolve(__dirname, '../../docs/articles')

// Windows 文件名不允许的字符
const ILLEGAL = /[\\/:*?"<>|]/g

function safeName(s, max = 60) {
  return String(s || '')
    .replace(ILLEGAL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0')
}

function main() {
  if (!fs.existsSync(SRC_FILE)) {
    console.error(`找不到源文件：${SRC_FILE}`)
    console.error('请先运行 node scripts/import-articles.mjs 生成文章库')
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(SRC_FILE, 'utf-8'))
  const list = data.articles || []

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const topicMap = new Map()
  let totalChars = 0

  list.forEach((a, i) => {
    const no = pad(i + 1)
    const fileName = `${no}-${safeName(a.title)}.md`
    const topics = a.topics || []

    topics.forEach((t) => {
      if (!topicMap.has(t)) topicMap.set(t, [])
      topicMap.get(t).push({ no, title: a.title, fileName })
    })

    totalChars += (a.content || '').length

    const body = [
      '---',
      `title: "${String(a.title || '').replace(/"/g, '')}"`,
      `source: ${a.source || ''}`,
      `date: ${a.date || ''}`,
      `topics: [${topics.join(', ')}]`,
      `wordCount: ${a.wordCount || 0}`,
      a.url ? `url: ${a.url}` : null,
      '---',
      '',
      `# ${a.title || '（无标题）'}`,
      '',
      `> 来源：${a.source || '未标注'}${a.date ? ' · ' + a.date : ''} · 正文约 ${a.wordCount || 0} 字`,
      topics.length ? `> 主题：${topics.join(' / ')}` : null,
      a.url ? `> 原文：${a.url}` : null,
      '',
      '---',
      '',
      (a.content || '').trim(),
      '',
    ]
      .filter((x) => x !== null)
      .join('\n')

    fs.writeFileSync(path.join(OUT_DIR, fileName), body, 'utf-8')
  })

  // 生成索引
  const sortedTopics = [...topicMap.entries()].sort((a, b) => b[1].length - a[1].length)
  const index = [
    '# 内置文章库',
    '',
    `共 **${list.length} 篇**，约 ${(totalChars / 10000).toFixed(1)} 万字，覆盖 ${topicMap.size} 个主题。`,
    '',
    '> 这些文章随程序打包，开箱即用、离线可读。',
    '> 程序实际加载的是 `frontend/src/data/builtin-articles.json`，本目录是它的可读镜像，由 `frontend/scripts/export-articles-to-docs.mjs` 生成。',
    '',
    '## 按主题浏览',
    '',
  ]

  for (const [topic, items] of sortedTopics) {
    index.push(`### ${topic}（${items.length} 篇）`, '')
    items.forEach((it) => index.push(`- [${it.no} ${it.title}](./${encodeURI(it.fileName)})`))
    index.push('')
  }

  index.push('## 全部文章', '')
  list.forEach((a, i) => {
    const no = pad(i + 1)
    index.push(
      `| ${no} | [${a.title}](./${encodeURI(`${no}-${safeName(a.title)}.md`)}) | ${a.source || ''} | ${(a.topics || []).join('/')} | ${a.wordCount || 0} |`
    )
    if (i === 0) {
      index.splice(index.length - 1, 0, '| 序号 | 标题 | 来源 | 主题 | 字数 |', '|---|---|---|---|---|')
    }
  })
  index.push('')

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), index.join('\n'), 'utf-8')

  console.log(`✅ 已导出 ${list.length} 篇文章到 ${OUT_DIR}`)
  console.log(`   主题 ${topicMap.size} 个，正文合计 ${(totalChars / 10000).toFixed(1)} 万字`)
  console.log(`   索引：${path.join(OUT_DIR, 'README.md')}`)
}

main()
