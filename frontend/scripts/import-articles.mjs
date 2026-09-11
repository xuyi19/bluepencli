// 把晟安申论目录下已抓取的官媒文章，转换成蓝笔申论的内置文章库格式。
// 用法：node scripts/import-articles.mjs
//
// 产出：src/data/builtin-articles.json
// 用于打包进程序，实现「开箱即用、离线可读」的内置文章库。

import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = process.env.SRC_DIR || 'C:/Users/许/Documents/晟安申论/articles'
const OUT_FILE = path.resolve('src/data/builtin-articles.json')

function cleanBody(raw, title) {
  let text = String(raw || '')
  // 去掉 markdown 一级标题（与索引里的 title 重复）
  text = text.replace(/^#\s+.*\r?\n/, '')
  // 去掉人民网等站点的页脚导航
  text = text.split(/人民日报社概况\|/)[0]
  text = text.split(/责任编辑[：:]/)[0]
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function main() {
  const indexPath = path.join(SRC_DIR, 'index.json')
  if (!fs.existsSync(indexPath)) {
    console.error(`找不到索引文件：${indexPath}`)
    process.exit(1)
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  const list = index.articles || []
  const out = []
  let missing = 0
  let totalChars = 0

  for (const a of list) {
    const fullPath = path.join(SRC_DIR, 'full', `${a.id}.md`)
    if (!fs.existsSync(fullPath)) {
      missing++
      continue
    }
    const body = cleanBody(fs.readFileSync(fullPath, 'utf-8'), a.title)
    if (body.length < 200) continue
    totalChars += body.length
    out.push({
      id: a.id,
      title: a.title,
      source: a.source || '',
      url: a.url || '',
      date: a.pub_date || a.fetch_date || '',
      topics: Array.isArray(a.topics) ? a.topics : [],
      summary: (a.summary || '').replace(/…$/, '').slice(0, 120),
      content: body,
      wordCount: body.replace(/\s/g, '').length,
    })
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), count: out.length, articles: out }, null, 0),
    'utf-8'
  )

  const sizeKB = (fs.statSync(OUT_FILE).size / 1024).toFixed(0)
  console.log(`✅ 已生成 ${OUT_FILE}`)
  console.log(`   文章 ${out.length} 篇（跳过缺失 ${missing} 篇）`)
  console.log(`   正文合计 ${totalChars} 字，文件 ${sizeKB} KB`)
}

main()
