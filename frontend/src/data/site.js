// 站点元信息：仓库地址与产品名
//
// 仓库地址**不在这里定义** —— 它是作者信息的一部分，见 ./author.js。
// 这里只是给老调用方留个同名的转发口，避免一次改遍所有引用点。

import { AUTHOR } from './author'

export const REPO = {
  github: AUTHOR.github,
  gitee: AUTHOR.gitee,
  openSource: AUTHOR.openSource,
}

export const APP_NAME = '蓝笔申论'
export const APP_SLOGAN = '公考申论 AI 批改工具'
