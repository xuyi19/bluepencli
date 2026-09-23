// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 采分点标准注册表（公开 + 私有）
//
// 与题库（data/questions.js）同构的分层做法：
//   公开卷/仿真题的标准在 standards/public.js（进仓库）；
//   私有卷的标准在 standards-private/（不进仓库，走 @private-standards 别名）。
//
// 为什么标准也要分层：**写出采分点等于泄题**。私有卷正文藏起来了，
// 但采分点标准同样能反推出材料要点，必须一起隔离。
//
// 取标准永远是**同步**的：标准体量很小（每题几百字），不需要懒加载，
// 而批改流程需要在发请求前就把它塞进提示词。

import { PUBLIC_STANDARDS } from './public'
import { GENERATED_STANDARDS } from './generated'
import { PRIVATE_STANDARDS } from '@private-standards'
// 校准工作台产出的人工精校（.tools/standards/calibrate.mjs 写这里，不动手写文件）
import MANUAL_STANDARDS from './manual.json'

/**
 * 全量标准表：questionId -> standard
 *
 * 覆盖优先级（后者覆盖前者）：
 *   generated（工具批量产出）< public（仓库内人工精校）< manual（校准工作台产出）
 *   < private（私有卷）
 * 人工精校永远压过机器生成——质量判断上，人的判断更靠得住。
 */
export const ALL_STANDARDS = {
  ...GENERATED_STANDARDS,
  ...PUBLIC_STANDARDS,
  ...MANUAL_STANDARDS,
  ...PRIVATE_STANDARDS,
}

/**
 * 取某题的标准；没有则返回 null（调用方据此走"无标准裸判"分支，不能报错）。
 * 私有导入题（bpq-*）目前没有标准 —— 见文件末尾的说明。
 */
export function getStandard(questionId) {
  if (!questionId) return null
  return ALL_STANDARDS[questionId] || null
}

/** 有标准的题目数（设置页/统计页显示"标准覆盖率"用） */
export function standardCount() {
  return Object.keys(ALL_STANDARDS).length
}

// TODO(后续)：.bpq 私有包可携带采分点标准（作者侧导出时一并打包），
// 用户导入后写入 IndexedDB（store: standards），再由 resolver 合并。
// 现在私有标准只服务于本机 --mode full 构建，分发出去的题没有标准，属已知缺口。
