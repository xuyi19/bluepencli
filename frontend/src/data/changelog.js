// 更新日志：唯一数据源是仓库根的 CHANGELOG.md
//
// 直接用 `?raw` 把那份 Markdown 引进来再解析，所以「改文档 = 改页面」，
// 不存在第二份要同步的数据。写法约定见该文件顶部注释，这里只做最简解析：
//
//   ## vX.Y.Z · YYYY-MM-DD · 标题      → 一个版本
//   ### 新增 / 优化 / 变更 / 修复 / 删除 → 分组
//   - 条目

import raw from '../../../CHANGELOG.md?raw'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parse(markdown) {
  const versions = []
  let cur = null
  let group = null

  for (const line of markdown.split(/\r?\n/)) {
    // 版本标题。分隔符容忍 · — – |，日期与标题顺序不限
    const head = line.match(/^##\s+(v[\d.]+)\s*(.*)$/)
    if (head) {
      const parts = head[2].split(/[·—–|]/).map((s) => s.trim()).filter(Boolean)
      const date = parts.find((p) => DATE_RE.test(p)) || ''
      cur = {
        version: head[1],
        date,
        title: parts.filter((p) => p !== date).join(' · '),
        items: [],
      }
      versions.push(cur)
      group = null
      continue
    }

    const sub = line.match(/^###\s+(.+?)\s*$/)
    if (sub && cur) {
      group = sub[1]
      continue
    }

    const item = line.match(/^[-*]\s+(.+?)\s*$/)
    if (item && cur && group) {
      cur.items.push({ type: group, text: item[1] })
    }
  }

  // 没有任何条目的版本不渲染（比如文档里的说明性小节被误当成版本）
  return versions.filter((v) => v.items.length > 0)
}

export const CHANGELOG = parse(raw)

/** 当前版本号（不带 v），供侧边栏、设置页等展示用 */
export const CURRENT_VERSION = (CHANGELOG[0]?.version || '').replace(/^v/, '')

/** 改动类型 → 展示配色（自然有机风的大地色系） */
export const TAG_STYLE = {
  新增: { bg: '#e8ecdf', fg: '#4f7d5e' },
  优化: { bg: '#e3e8ef', fg: '#3d5a7a' },
  变更: { bg: '#f2ebe2', fg: '#5c4033' },
  修复: { bg: '#f7e9e4', fg: '#9c4a42' },
  删除: { bg: '#f1eceb', fg: '#8a7268' },
}

export function tagStyle(type) {
  return TAG_STYLE[type] || { bg: '#f2ebe2', fg: '#78716c' }
}
