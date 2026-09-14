# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""流水线 ④→⑥：质量闸门 + 文本体检。

闸门（计划 14.5 的六道，其中「采分点证据命中」需要 LLM 预解析，本阶段未做）：
  ② 分题    每题题干/要求/分值/字数非空
  ③ 结构化  字段齐全
  ⑤ 校准    单卷分值合计 == 100
  ⑥ 入库    schema 校验

文本体检针对的是**源 PDF 自身的 OCR 缺陷**（这批真题多为考生回忆版）：
  括号/引号不配对、夹在汉字中的孤立的单个小写字母、重复标点、疑似丢字。
"""

import re
import os
import sys
import json
import glob
import io

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

CJK = r'\u4e00-\u9fff'
RE_LONE_LATIN = re.compile(rf'[{CJK}]([a-z])[{CJK}]')          # 罚款 → 罚i款
RE_DUP_PUNCT = re.compile(r'[，。、；：]{2,}')
RE_NO_L = re.compile(r'（')
RE_NO_R = re.compile(r'）')
RE_Q_L = re.compile(r'“')
RE_Q_R = re.compile(r'”')


def check_pair(text, name, lid, rid, bag):
    a, b = len(lid.findall(text)), len(rid.findall(text))
    if a != b:
        bag.append(f'{name} 数量不等（{a}/{b}）')


def scan_text(text, ref, bag):
    for m in RE_LONE_LATIN.finditer(text):
        s = max(0, m.start() - 6)
        bag.append(f'{ref} 汉字中夹单个小写字母「{m.group(1)}」：…{text[s:m.end() + 6]}…')
    for m in RE_DUP_PUNCT.finditer(text):
        s = max(0, m.start() - 8)
        bag.append(f'{ref} 连续标点「{m.group(0)}」：…{text[s:m.end() + 8]}…')
    check_pair(text, f'{ref} 圆括号', RE_NO_L, RE_NO_R, bag)
    check_pair(text, f'{ref} 中文引号', RE_Q_L, RE_Q_R, bag)


def main():
    files = sorted(glob.glob(os.path.join(OUT, '*.json')))
    if not files:
        print('out/ 里没有 JSON，先跑 extract.py')
        return 1

    total_q = 0
    gate_fail = []
    text_issues = []
    rows = []

    for f in files:
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        eid = d['id']
        qs = d['questions']
        total_q += len(qs)
        probs = []

        # ② 分题 / ③ 结构化 / ⑥ schema
        if not d.get('materials'):
            probs.append('材料为空')
        for q in qs:
            n = q.get('no')
            if not q.get('stem'):
                probs.append(f'题{n} 题干空')
            if not q.get('requirement'):
                probs.append(f'题{n} 要求空')
            if not isinstance(q.get('score'), int) or q['score'] <= 0:
                probs.append(f'题{n} 分值异常({q.get("score")})')
            if not isinstance(q.get('wordLimit'), int) or q['wordLimit'] <= 0:
                probs.append(f'题{n} 字数异常({q.get("wordLimit")})')
            if not q.get('reference'):
                probs.append(f'题{n} 无参考答案')

        # ⑤ 分值合计
        s = sum(q['score'] for q in qs if isinstance(q.get('score'), int))
        if s != 100:
            probs.append(f'分值合计 {s} ≠ 100')

        # 题干引用的资料编号是否真实存在
        labels = {m['label'].replace('材料', '').strip() for m in d['materials']}
        norm = lambda x: {'一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
                          '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'}.get(x, x)
        labels = {norm(x) for x in labels}
        for q in qs:
            for m in re.finditer(r'给定[材料资料]\s*([0-9一二三四五六七八九十]+)', q['stem'] + q['requirement']):
                if norm(m.group(1)) not in labels:
                    probs.append(f'题{q["no"]} 引用了不存在的资料{m.group(1)}')
                    break

        rows.append((eid, len(d['materials']), len(qs), s, len(probs)))
        if probs:
            gate_fail.append((eid, probs))

        # 文本体检
        bag = []
        scan_text(''.join(m['text'] for m in d['materials']), f'{eid}/材料', bag)
        for q in qs:
            scan_text(q['stem'] + q['requirement'], f'{eid}/题{q["no"]}', bag)
            scan_text(q['reference'], f'{eid}/题{q["no"]}/答案', bag)
        text_issues += bag

    print(f'{"卷":<16}{"材料":>4}{"题":>4}{"总分":>6}{"问题":>5}')
    print('-' * 40)
    for eid, nm, nq, s, np_ in rows:
        flag = '' if np_ == 0 else f'  <<< {np_} 项'
        print(f'{eid:<16}{nm:>4}{nq:>4}{s:>6}{np_:>5}{flag}')

    print(f'\n共 {len(files)} 套 / {total_q} 道题')
    print(f'闸门通过：{len(files) - len(gate_fail)}/{len(files)}')
    if gate_fail:
        print('\n--- 闸门未过明细 ---')
        for eid, probs in gate_fail:
            print(f'  {eid}: ' + '; '.join(probs))

    print(f'\n文本体检可疑点：{len(text_issues)} 处')
    for t in text_issues[:40]:
        print('  ', t)
    if len(text_issues) > 40:
        print(f'   …还有 {len(text_issues) - 40} 处')

    with open(os.path.join(OUT, 'qc-report.txt'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(text_issues))
    return 0 if not gate_fail else 1


if __name__ == '__main__':
    sys.exit(main())
