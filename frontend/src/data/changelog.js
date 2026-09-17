// 更新日志：唯一数据源是仓库根的 CHANGELOG.md
//
// 直接用 `?raw` 把那份 Markdown 引进来，所以「改文档 = 改页面」，
// 不存在第二份要同步的数据。
//
// 解析逻辑在 ./changelog-parse.js —— 那个文件不依赖 Vite 的 `?raw`，
// 所以 .tools/test-changelog.mjs 能直接 import 它来测。
// 这里只做一件事：把 `?raw` 的内容交给解析器，并把结果转出去。

import raw from '../../../CHANGELOG.md?raw'
import { parseChangelog } from './changelog-parse'

export const CHANGELOG = parseChangelog(raw)

/** 当前版本号（不带 v），供侧边栏、设置页等展示用 */
export const CURRENT_VERSION = (CHANGELOG[0]?.version || '').replace(/^v/, '')

export { TAG_STYLE, tagStyle, parseInline, parseChangelog } from './changelog-parse'
