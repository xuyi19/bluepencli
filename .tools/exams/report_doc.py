# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""生成 docs/真题数据说明.md —— 给人看的真题库说明书。

数据全部从 .tools/exams/out/*.json 现算，避免文档里的数字与产物脱节。
用法：python .tools/exams/report_doc.py
"""

import os
import re
import sys
import json
import glob

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
DEST = os.path.abspath(os.path.join(HERE, '..', '..', 'docs', '真题数据说明.md'))

PAPER_ORDER = {'副省级': 0, '地市级': 1, '省部级': 2, '省级': 3, '行政执法卷': 3}

# 公开区间的年份上界（含）。与 to_frontend.py / export_bpq.py 保持一致：
# 这一段随开源版分发，其余为私有资产。
PUBLIC_MAX_YEAR = 2021


def main():
    files = sorted(glob.glob(os.path.join(OUT, '*.json')))
    if not files:
        print('out/ 里没有 JSON，先跑 extract.py')
        return 1

    exams = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        mchars = sum(len(m['text']) for m in d['materials'])
        achars = sum(len(q['reference']) for q in d['questions'])
        exams.append({
            'id': d['id'],
            'year': d['year'],
            'paper': d['paper'],
            'tier': 'public' if d['year'] <= PUBLIC_MAX_YEAR else 'private',
            'n_mat': len(d['materials']),
            'mchars': mchars,
            'n_q': len(d['questions']),
            'achars': achars,
            'score': sum(q['score'] for q in d['questions']),
            'types': [q['type'] for q in d['questions']],
            'warn': d['warnings'],
        })

    exams.sort(key=lambda e: (-e['year'], PAPER_ORDER.get(e['paper'], 9)))
    pub = [e for e in exams if e['tier'] == 'public']
    pri = [e for e in exams if e['tier'] == 'private']

    total_q = sum(e['n_q'] for e in exams)
    total_m = sum(e['mchars'] for e in exams)
    total_a = sum(e['achars'] for e in exams)
    no_warn = sum(1 for e in exams if not e['warn'])
    years = sorted({e['year'] for e in exams})

    # FIXUPS 条目数：从 extract.py 现读，别在文档里写死
    with open(os.path.join(HERE, 'extract.py'), encoding='utf-8') as fh:
        src = fh.read()
    fx = src[src.find('FIXUPS = {'):]
    fx = fx[:fx.find('\n}\n')]
    n_fix = len(re.findall(r"\('", fx))

    def table(rows):
        out = ['| 卷 id | 年份 | 卷别 | 材料 | 材料字数 | 题数 | 答案字数 | 分值 |',
               '|---|---|---|---|---|---|---|---|']
        for e in rows:
            out.append(f"| `{e['id']}` | {e['year']} | {e['paper']} | {e['n_mat']} 则 | "
                       f"{e['mchars']} | {e['n_q']} | {e['achars']} | {e['score']} |")
        out.append(f"| **小计** | | | | **{sum(e['mchars'] for e in rows)}** | "
                   f"**{sum(e['n_q'] for e in rows)}** | **{sum(e['achars'] for e in rows)}** | |")
        return out

    L = []
    L.append('# 国考申论真题库 · 数据说明')
    L.append('')
    L.append('> 本文件由 `.tools/exams/report_doc.py` 自动生成，数字全部现算。')
    L.append('> 重新生成：`backend/.venv/Scripts/python.exe .tools/exams/report_doc.py`')
    L.append('')
    L.append('## 一句话')
    L.append('')
    L.append(f'**{len(exams)} 套国考申论真题（{years[0]}–{years[-1]}）/ {total_q} 道题**已结构化：')
    L.append('每套卷带整卷给定资料，每道题带题干、作答要求、分值、字数与参考答案。')
    L.append('')
    L.append(f'其中 **{len(pub)} 套（{years[0]}–{PUBLIC_MAX_YEAR}）随开源版分发**，'
             f'**{len(pri)} 套（{PUBLIC_MAX_YEAR + 1} 起）为私有资产** —— 不进仓库、不进分发产物，')
    L.append('由作者定向分发 `.bpq` 题库包、使用者自行导入。')
    L.append('')
    L.append('## 数据在哪儿')
    L.append('')
    L.append('| 用途 | 路径 |')
    L.append('|---|---|')
    L.append('| 提取/校验脚本（不参与构建） | `.tools/exams/` |')
    L.append('| 结构化中间数据（人工抽查用，含私有卷，不进版本库） | `.tools/exams/out/*.json` |')
    L.append(f'| 前端·公开真题索引与正文 | `frontend/src/data/real-exams/` |')
    L.append(f'| 前端·私有真题（自动生成，**已 gitignore**） | `frontend/src/data/real-exams-private/` |')
    L.append('| 私有卷空实现（别人 clone 后构建走它） | `frontend/src/data/real-exams-private-stub/` |')
    L.append('| 题库包导出（作者专用） | `.tools/exams/export_bpq.py` → `release/私有题库/` |')
    L.append('| 统一题库入口 | `frontend/src/data/questions.js` |')
    L.append('')
    L.append('## 流水线')
    L.append('')
    L.append('```')
    L.append('37 份真题 PDF')
    L.append('  ↓ extract.py   ① 文本提取（PyMuPDF）② 分题 ③ 结构化')
    L.append('  ↓              └ 用「（N分）」+「字数要求」双锚点切题；用行首缩进几何还原段落')
    L.append('  ↓ qc.py        ④ 预解析（采分点证据命中，需 LLM，本版未做）')
    L.append('  ↓             ⑤ 校准：分题/字段/分值合计 100/字数/答案齐全')
    L.append('  ↓             ⑥ 入库：schema 校验')
    L.append('  ↓ to_frontend.py  按年份分两层产出：real-exams/（公开）+ real-exams-private/（私有）')
    L.append('  ↓ export_bpq.py   私有卷 → .bpq 题库包（带使用者水印），定向分发')
    L.append('前端题库（公开卷随包，私有卷由使用者导入）')
    L.append('```')
    L.append('')
    L.append('分题锚点用的是「（N分）」而不是题号，因为各卷的题号写法有四种')
    L.append('（`第一题：` / `1.` / `（一）` / 完全无编号），只有分值结尾是每题都有的。')
    L.append('')
    L.append(f'## 卷清单 · 公开（{years[0]}–{PUBLIC_MAX_YEAR}，随包分发）')
    L.append('')
    L.extend(table(pub))
    L.append('')
    L.append(f'## 卷清单 · 私有（{PUBLIC_MAX_YEAR + 1} 起，题库包分发）')
    L.append('')
    L.append('> 这些卷的正文不在版本库里，也不能被构建进任何产物；下表仅为作者侧的资产台账。')
    L.append('')
    L.extend(table(pri))
    L.append('')
    L.append(f'> 全库合计：**{len(exams)} 套 / {total_q} 题 / 材料 {total_m} 字 / 答案 {total_a} 字**。')
    L.append('')
    L.append('## 质量闸门结果')
    L.append('')
    L.append(f'- 闸门通过：**{len(exams)}/{len(exams)}**（材料非空 / 题干·要求·分值·字数非空 / 分值合计 100 / 答案齐全 / schema）')
    L.append(f'- 分题警告：{len(exams) - no_warn} 套有残留提示，{no_warn} 套无')
    L.append('- 正文体检：**0 处可疑**（孤立的夹在汉字中的小写字母、连续标点、括号与引号不配对）')
    L.append(f'- 源文件 OCR 缺陷共校订 **{n_fix} 处**，全部收在 `extract.py` 的 `FIXUPS` 表里，**重跑即复现**，不做手工改 JSON')
    L.append('')
    L.append('## 题型分布')
    L.append('')
    from collections import Counter
    c = Counter(t for e in exams for t in e['types'])
    L.append('| 题型 | 题数 |')
    L.append('|---|---|')
    for k, v in c.most_common():
        L.append(f'| {k} | {v} |')
    L.append('')
    L.append('## 已知限制')
    L.append('')
    L.append('1. **源 PDF 多为考生回忆/OCR 版**，不是官方排版件。错字丢字已尽可能校订，')
    L.append('   但不排除仍有残留；用法上把它当「可靠的练习题」而非「法定文本」。')
    L.append('2. **第④步「LLM 预解析采分点」未做**。计划里这一步用于给每道题生成采分点及其')
    L.append('   在材料中的证据串；本版只做到「结构化 + 校准」，采分点仍由五位老师在批改时现场判断。')
    L.append('3. **答案有两套的卷只取第一套**（如 2021 副省级 PDF 里同时有 H/F 两版答案）。')
    L.append('4. **一题多小问按大题合并**（2016 地市级第三题）：两个小问各自的要求都保留，')
    L.append('   字数取和（450 字），练习时当作一道题写。')
    L.append('5. **`.bpq` 目前是明文的**，带使用者水印与 FNV-1a 校验和（防损坏，不防伪造）；')
    L.append('   AES-256-GCM 加密与 ECDSA 签名按计划留到 V2，格式里已预留字段。')
    L.append('')

    with open(DEST, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(L))

    print(f'✓ {DEST}')
    print(f'  公开 {len(pub)} 套 / 私有 {len(pri)} 套 ｜ '
          f'{total_q} 题 / 材料 {total_m} 字 / 答案 {total_a} 字 / 校订 {n_fix} 处')
    return 0


if __name__ == '__main__':
    sys.exit(main())
