// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 作者水印：控制台横幅 + 一键复制。
//
// 为什么要有"控制台横幅"这种东西：
//   单文件版 / 桌面版发出去之后，源码和界面都可能被人改了再转发。
//   控制台横幅改起来成本最低、但传播时最容易被看到 —— 它是"这东西是许一写的"
//   最省事的一道标记。仓库地址、邮箱都在里面，看得见就能找回来。

import { AUTHOR, AUTHOR_LINE } from '../data/author'
import { CURRENT_VERSION } from '../data/changelog'

let printed = false

/** 在浏览器控制台打印水印横幅。只在首次调用时输出，重复调用不会刷屏。 */
export function printBanner() {
  if (printed) return
  printed = true
  const title = `${AUTHOR.project} · v${CURRENT_VERSION}`
  // 控制台里用 %c 上色；样式走项目主色（胡桃棕 #5c4033）
  console.log(
    `%c${title}%c\n${AUTHOR_LINE}\n开源许可：${AUTHOR.license}　开源地址：${AUTHOR.openSource}`,
    'background:#5c4033;color:#faf6f1;padding:4px 10px;border-radius:6px;font-weight:600',
    'color:#78716c;line-height:1.7'
  )
}

/** 复制一行式水印（作者 / 邮箱 / 仓库），用于"反馈问题"时一起带上 */
export async function copyAuthorLine() {
  const text = `${AUTHOR.project}\n${AUTHOR_LINE}`
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
