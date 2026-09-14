// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 作者信息 —— 全项目**唯一**的来源。
//
// 为什么单独拎一个文件：
//   侧边栏、首页页脚、设置页「关于」、浏览器控制台横幅、构建产物的 meta，
//   展示的都是同一个人。抄五遍就会出现"改了四处漏一处"，所以统一从这里取。
//
// 注意：这里只放**公开信息**（姓名 / 邮箱 / 仓库地址 / 许可证）。
// 密钥、微信号一类的东西不要写进来 —— 前端打包产物是公开的。

export const AUTHOR = {
  name: '许一',
  email: 'xuconghui_03@qq.com',

  // 代码仓库（两个镜像，内容一致）
  github: 'https://github.com/xuyi19/bluepencli',
  gitee: 'https://gitee.com/xuyi_19/bluepencil',

  // 开源地址：对外统一入口。指向 GitHub 仓库首页；
  // 以后若有在线体验站，改这一行即可（全项目跟着变）。
  openSource: 'https://github.com/xuyi19/bluepencli',

  license: 'AGPL-3.0',
  project: '蓝笔申论 BluePencil',
}

/** 一行式水印，用于页脚、控制台、产物注释。改这里，所有展示位一起变。 */
export const AUTHOR_LINE =
  `${AUTHOR.name} · ${AUTHOR.email} · GitHub ${AUTHOR.github} · Gitee ${AUTHOR.gitee}`

/** 短水印：空间紧张的地方（侧边栏底部小字）用这个 */
export const AUTHOR_SHORT = `© ${AUTHOR.name} · ${AUTHOR.license}`
