// 站点元信息：仓库地址与更新日志
//
// 仓库地址取自本仓库的两个 remote（github / gitee），改地址只改这里，
// 首页入口与更新日志页都从这里读。

export const REPO = {
  github: 'https://github.com/xuyi19/bluepencli',
  gitee: 'https://gitee.com/xuyi_19/bluepencil',
}

export const APP_NAME = '蓝笔申论'
export const APP_SLOGAN = '公考申论 AI 批改工具'

// 更新日志：新的版本写在最前面
export const CHANGELOG = [
  {
    version: 'v0.3.0',
    date: '2026-09-14',
    title: '首页入口 + 更新日志',
    items: [
      { type: '新增', text: '更新日志页，按版本记录每轮改动' },
      { type: '新增', text: '首页顶部 GitHub / Gitee 仓库入口' },
      { type: '优化', text: '关于信息统一走站点元数据，版本号不再散落各处' },
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-09-11',
    title: '界面重构 + 题库扩充 + 每日一练',
    items: [
      { type: '新增', text: '每日一练：按当天日期散列选卷，同一天恒定、相邻日期不连号' },
      { type: '新增', text: '题库扩充至 15 道完整题，五种题型各 3 道，含完整材料与参考答案' },
      { type: '新增', text: '练习页自动载入今日一练，支持「换一题」从池中重抽' },
      { type: '新增', text: '方格纸作答区，格宽随容器实测宽度自适应，折行严丝合缝' },
      { type: '新增', text: '设置页状态总览：通道 / 模型 / Key 来源三栏一眼看清' },
      { type: '新增', text: '阅读态材料：给定资料按「材料N」分则折叠，长材料不再刷屏' },
      { type: '变更', text: '界面风格换肤：新拟态 → 自然有机风，颜色收敛为语义 token' },
      { type: '优化', text: '导航改为左侧分组侧边栏（学习 / 内容 / 实战 / 复盘）' },
      { type: '优化', text: '练习页左栏空态改为可搜索的选题面板，不再是大片留白' },
      { type: '删除', text: '移除 Arco Design 依赖，改自实现轻量提示框（CSS 405KB → 24KB）' },
      { type: '修复', text: '修复从题库进入练习会丢失作答要求、分值、字数限制' },
      { type: '修复', text: '修复桌面版被误判为「未配置 API」，导致批改按钮点不动' },
    ],
  },
  {
    version: 'v0.1.0',
    date: '2026-09-08',
    title: '首个可用版本',
    items: [
      { type: '新增', text: '五位老师独立阅卷，可按 1~5 位自由组合' },
      { type: '新增', text: '圆桌分歧复核与加权合议，分歧超阈值才触发复核' },
      { type: '新增', text: '逐句批注：按老师颜色在作答原文上标出问题句' },
      { type: '新增', text: '双通道：后端转发与浏览器直连自动降级' },
      { type: '新增', text: '练习记录本地归档，可跨浏览器复盘' },
      { type: '新增', text: '单文件 HTML 与 Windows 桌面版两种分发形态' },
      { type: '新增', text: '老师讲义库与官媒时评文章库' },
    ],
  },
]

/** 类型 → 展示用配色（自然有机风的大地色系） */
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
