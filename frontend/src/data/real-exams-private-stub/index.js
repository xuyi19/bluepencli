// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 私有题库的**空实现**：分发构建走这里，结果就是"没有私有卷"。
//
// 为什么需要它：Vite 别名必须指向一个真实存在的文件，否则构建直接报错。
// 本机存在 real-exams-private/ 时别名指向真身（33 套全可用）；
// 别人 clone 或构建分发包时该目录不存在，别名落到这里，私有卷自然为空。
//
// 2022 年起的国考真题属私有资产，由作者定向分发后经「导入题库包」入库。

export const EXAM_TIER = 'public'

export const EXAM_INDEX = []

export const EXAM_LOADERS = {}
