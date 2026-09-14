# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""流水线第 ⑥ 步：out/*.json → 前端题库数据。

产出（**按公开/私有分两处**）：
  frontend/src/data/real-exams/         公开卷（year <= 2021）→ 进仓库、进分发产物
    index.js        索引 + 懒加载表
    exam-<id>.js    单套完整数据（整卷材料 + 参考答案）
  frontend/src/data/real-exams-private/ 私有卷（year >= 2022）→ **不进仓库**
    index.js / exam-<id>.js   结构同上
  frontend/src/data/real-exams-private-stub/index.js
    私有卷的空实现，进仓库。分发构建走它，结果就是"没有私有卷"。

为什么按年份劈开（2026-09 决定）：
  2021 及以前的国考真题流通极广，作为开源版的演示题库；
  2022 起是备考价值最高的近三年真题，属私有资产，只由作者定向分发、
  由使用者自行导入（见 .tools/exams/export_bpq.py），不进软件本体。

为什么索引与正文拆两半：
  真题合计约 1MB 文本，全塞进主包会拖慢首屏。索引只有几 KB，常驻；
  完整数据按套懒加载。

为什么用手写 EXAM_LOADERS 而不是 import.meta.glob：
  glob 的匹配在构建期展开，没法用别名把"私有目录"换成"空实现"。
  显式 loader 表可以被 Vite 的 alias 整体替换掉，这是分层能成立的关键。

数据一律以 **JSON 字面量** 输出（JSON 是合法 JS），中文不转义、不作模板字符串拼接 ——
避免材料里出现反引号/`${}` 时把生成的 JS 打坏。
再把 `<` 转成 \\u003c，防止单文件版内联进 <script> 时出现 </script> 提前闭合。
"""

import os
import sys
import json
import glob

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'out')
DATA = os.path.abspath(os.path.join(HERE, '..', '..', 'frontend', 'src', 'data'))
DEST_PUBLIC = os.path.join(DATA, 'real-exams')
DEST_PRIVATE = os.path.join(DATA, 'real-exams-private')
DEST_STUB = os.path.join(DATA, 'real-exams-private-stub')

# 公开区间上界（含）。改这一行就改分层，别在别处再写一遍年份判断。
PUBLIC_MAX_YEAR = 2021

WM = """// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
"""

HEADER_INDEX = WM + """// ⚠️ 自动生成，请勿手改。
// 生成器：.tools/exams/to_frontend.py    源数据：.tools/exams/out/*.json
// （out/ 由 extract.py 从 37 份国考真题 PDF 提取，并已过 6 道质量闸门）
//
// 这一份是**{zh}**卷（{desc}）。
//
// EXAM_INDEX    索引（卷名 / 题数 / 题干 / 分值 / 字数），静态打包，题库页列表用
// EXAM_LOADERS  id → 懒加载函数，练习时按需 import 整卷材料与参考答案
//
// 材料说明：真题的「给定资料」是**整卷共用**的，所以按套存一份，
// 而不是像仿真题那样每题各带一份（那样数据量会翻五倍）。
"""

HEADER_EXAM = WM + """// ⚠️ 自动生成，请勿手改。源：.tools/exams/out/{eid}.json
// 整卷材料 + 参考答案；由 data/questions.js 在练习时按需 import。
"""

STUB = WM + """// 私有题库的**空实现**：分发构建走这里，结果就是"没有私有卷"。
//
// 为什么需要它：Vite 别名必须指向一个真实存在的文件，否则构建直接报错。
// 本机存在 real-exams-private/ 时别名指向真身（33 套全可用）；
// 别人 clone 或构建分发包时该目录不存在，别名落到这里，私有卷自然为空。
//
// 2022 年起的国考真题属私有资产，由作者定向分发后经「导入题库包」入库。

export const EXAM_TIER = 'public'

export const EXAM_INDEX = []

export const EXAM_LOADERS = {}
"""


def dump(obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    return s.replace('<', '\\u003c')


def write_set(dest, exams, tier, desc):
    """写一个分层目录：exam-*.js + index.js，并清掉本次没写到的陈旧卷文件。"""
    os.makedirs(dest, exist_ok=True)
    index = []
    written = set()

    for d in exams:
        eid = d['id']
        name = f'exam-{eid}.js'
        written.add(name)

        material = '\n\n'.join(f"{m['label']}\n{m['text']}" for m in d['materials'])
        questions = [
            {
                'no': q['no'],
                'type': q['type'],
                'stem': q['stem'],
                'requirement': q['requirement'],
                'score': q['score'],
                'wordLimit': q['wordLimit'],
                'reference': q['reference'],
            }
            for q in d['questions']
        ]

        with open(os.path.join(dest, name), 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(HEADER_EXAM.format(eid=eid))
            fh.write('export default ' + dump({
                'id': eid,
                'year': d['year'],
                'paper': d['paper'],
                'title': d['title'],
                'tier': tier,
                'material': material,
                'questions': questions,
            }) + '\n')

        # 索引里的题干截到 120 字：列表页只用来辨认是哪道题，全文由懒加载拿
        index.append({
            'id': eid,
            'year': d['year'],
            'paper': d['paper'],
            'title': d['title'],
            'tier': tier,
            'materialChars': len(material),
            'questions': [
                {
                    'no': q['no'],
                    'type': q['type'],
                    'stem': q['stem'],
                    'requirement': q['requirement'],
                    'score': q['score'],
                    'wordLimit': q['wordLimit'],
                }
                for q in questions
            ],
        })

    # 陈旧卷：比如某年从私有划到公开后，老文件还留在原目录里。
    # 不清理会让它继续被打进产物 —— 分层就白做了。
    stale = [n for n in os.listdir(dest)
             if n.startswith('exam-') and n.endswith('.js') and n not in written]
    for n in stale:
        os.remove(os.path.join(dest, n))

    loaders = ',\n'.join(
        f"  {json.dumps(e['id'])}: () => import('./exam-{e['id']}.js')" for e in index
    )
    with open(os.path.join(dest, 'index.js'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(HEADER_INDEX.format(zh='公开' if tier == 'public' else '私有', desc=desc))
        fh.write(f"export const EXAM_TIER = {json.dumps(tier)}\n\n")
        fh.write('export const EXAM_INDEX = ' + dump(index) + '\n\n')
        fh.write('export const EXAM_LOADERS = {\n' + loaders + '\n}\n')

    return index, stale


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.json')))
    if not files:
        print('out/ 里没有 JSON，先跑 extract.py')
        return 1

    exams = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            exams.append(json.load(fh))

    public = [d for d in exams if d['year'] <= PUBLIC_MAX_YEAR]
    private = [d for d in exams if d['year'] > PUBLIC_MAX_YEAR]

    pub_index, pub_stale = write_set(
        DEST_PUBLIC, public, 'public',
        f'2010–{PUBLIC_MAX_YEAR}，开源版内置，随产物分发')
    pri_index, pri_stale = write_set(
        DEST_PRIVATE, private, 'private',
        f'{PUBLIC_MAX_YEAR + 1} 起，私有资产，不进仓库与分发产物，由作者定向分发后导入')

    # 空实现：进仓库，供别人 clone 后构建
    os.makedirs(DEST_STUB, exist_ok=True)
    with open(os.path.join(DEST_STUB, 'index.js'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(STUB)

    def brief(tag, idx):
        q = sum(len(e['questions']) for e in idx)
        c = sum(e['materialChars'] for e in idx)
        print(f'  {tag}：{len(idx)} 套 / {q} 题 ｜ 材料 {c} 字')
        for e in idx:
            print(f"    {e['id']:<16} {e['year']} {e['paper']:<6} 题 {len(e['questions'])}")

    print(f'✓ 公开卷 → {DEST_PUBLIC}')
    brief('公开', pub_index)
    print(f'✓ 私有卷 → {DEST_PRIVATE}（不进版本库）')
    brief('私有', pri_index)
    if pub_stale or pri_stale:
        print(f'  清掉陈旧卷文件：{pub_stale + pri_stale}')
    print(f'✓ 空实现 → {DEST_STUB}/index.js')
    return 0


if __name__ == '__main__':
    sys.exit(main())
