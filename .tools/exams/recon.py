# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""侦察：统计 37 个 PDF 里结构标记的真实写法，为分题正则提供依据。"""
import sys, os, re, glob, json
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

DIR = r'D:\考公\真题\2010-2024国考申论PDF'
OUT = r'C:\Windows\Temp\bp-dump'
os.makedirs(OUT, exist_ok=True)

PAGE_RE = re.compile(r'^<<<<< PAGE (\d+) >>>>>$')

def load(name):
    """提取全文，去掉页脚页码与分页标记的干扰。"""
    d = pymupdf.open(os.path.join(DIR, name))
    lines = []
    for i, pg in enumerate(d):
        for ln in pg.get_text().split('\n'):
            s = ln.strip()
            if not s:
                continue
            # 页码噪声：第5 页共13 页 / 单独数字
            if re.match(r'^第\s*\d+\s*页\s*共\s*\d+\s*页$', s):
                continue
            if re.match(r'^\d{1,3}$', s):
                continue
            lines.append(s)
    d.close()
    return lines

files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(DIR, '*.pdf')))
summary = {}
for f in files:
    lines = load(f)
    with open(os.path.join(OUT, f[:-4] + '.txt'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(lines))
    info = {'lines': len(lines), 'markers': []}
    for ln in lines:
        if len(ln) > 26:
            continue
        if re.match(r'^(给定)?(材料|资料|给定资料)\s*[一二三四五六七八九十\d]+\s*[:：]?$', ln):
            info['markers'].append(('MAT', ln))
        elif re.match(r'^第[一二三四五六七八九十]+\s*题', ln):
            info['markers'].append(('Q', ln))
        elif re.match(r'^[（(]\s*[一二三四五六七八九十\d]+\s*[）)]', ln):
            info['markers'].append(('Q2', ln))
        elif re.match(r'^[一二三四五六七八九十]+\s*[、.]', ln) and len(ln) <= 14:
            info['markers'].append(('Q3', ln))
        elif re.search(r'作答要求|^\s*要求\s*[:：]?$|^三\s*、\s*作答', ln):
            info['markers'].append(('REQ', ln))
        elif re.search(r'参考答案|答案要点|评分标准|解析|赋分', ln):
            info['markers'].append(('ANS', ln))
    summary[f] = info

# 输出
for f, info in summary.items():
    kinds = {}
    for k, _ in info['markers']:
        kinds[k] = kinds.get(k, 0) + 1
    print(f"\n=== {f[:-4]}  ({info['lines']} 行)  {kinds}")
    shown = {}
    for k, ln in info['markers']:
        if shown.get(k, 0) >= 12:
            continue
        shown[k] = shown.get(k, 0) + 1
        print(f"   [{k}] {ln}")
