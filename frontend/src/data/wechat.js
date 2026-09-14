// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 微信引流配置 —— 二维码图片与有效期的**唯一**来源。
//
// 为什么二维码用 import 而不是放 public/：
//   放 public/ 的文件在「单文件版」里会失效 —— 那是双击打开的本地 HTML，
//   没有服务器托管 /wechat/xxx.jpg。用 import 交给 Vite 处理：
//   网站版输出独立资源、单文件版自动 base64 内联，两条通道都不掉图。
//
// ⚠️ 换二维码只改这里（三步）：
//   1. 新图覆盖 src/assets/wechat/ 下的同名文件（personal.jpg / group.jpg）；
//   2. 群二维码 7 天到期，换图时**必须同步改 groupExpireAt**，
//      否则前端会拿旧日期判断，把新图当成过期的藏起来；
//   3. 改完重新构建产物 —— 已验证过的旧产物里的二维码不会自动更新。
//
// 关于"要不要进版本库"：要。二维码本来就是**给人扫的公开资产**，
// 与 author.js 注释里说的"密钥不要写进来"不是一回事 —— 没有二维码，
// 别人 clone 出来的版本就没有引流入口。

import personalQr from '../assets/wechat/personal.jpg'
import groupQr from '../assets/wechat/group.jpg'

export const WECHAT = {
  /**
   * 作者个人微信。**长期有效，是主引流入口** —— 群码会过期它不会，
   * 所以所有文案都应把用户往这里引，群码只当附加福利。
   */
  personalQr,
  personalLabel: '作者微信',

  /** 交流群。限时有效，过期后前端自动收起。 */
  groupQr,
  groupName: '蓝笔申论2',
  // 微信群二维码 7 天一轮。这个日期由换图的人负责更新。
  groupExpireAt: '2026-09-21T23:59:59+08:00',
}

/** 加微信时的备注语，统一口径方便通过 */
export const WECHAT_REMARK = '蓝笔申论'

/**
 * 群二维码是否仍在有效期内。
 * 过期后前端自动收起，绝不展示一张扫了没用的图 —— 那比不展示更伤信任。
 * 日期没填 / 填错时返回 true（宁可多显示，也不要把图莫名藏掉）。
 */
export function isGroupQrValid(now = Date.now()) {
  const t = Date.parse(WECHAT.groupExpireAt)
  if (!Number.isFinite(t)) return true
  return now <= t
}

/** 「9 月 21 日前有效」这类短标签 */
export function groupExpireLabel() {
  const t = Date.parse(WECHAT.groupExpireAt)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日前有效`
}
