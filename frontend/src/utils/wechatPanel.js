// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
/**
 * 微信引流弹层的全局开合状态。
 *
 * 为什么用模块级 reactive 而不是 provide/inject 或 Pinia：
 *   触发方在侧边栏（App.vue 的 aside 里），宿主 WeChatHost 挂在 App.vue 顶层，
 *   两者不在同一棵子树、隔着 RouterView —— 用单例最省事，
 *   也和 utils/toast.js 的做法一致（项目已有先例，不为此引入状态库）。
 */
import { reactive } from 'vue'

export const wechatPanel = reactive({ open: false })

export function openWeChat() {
  wechatPanel.open = true
}

export function closeWeChat() {
  wechatPanel.open = false
}

export function toggleWeChat() {
  wechatPanel.open = !wechatPanel.open
}
