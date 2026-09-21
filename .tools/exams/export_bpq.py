# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""私有题库包（.bpq）导出 —— **作者专用**。

把 2022 年起的国考真题打成一份带使用者水印的题库包，定向发给某个同学，
对方在「题库 → 导入题库包」里导入即可；这些卷**不进公开仓库、不进分发产物**。

用法（仓库根目录）：
    backend/.venv/Scripts/python.exe .tools/exams/export_bpq.py --user "张三/zhangsan@qq.com"
    backend/.venv/Scripts/python.exe .tools/exams/export_bpq.py            # 不带水印（自用）

产出：
    私有题库/蓝笔申论-私有题库-<年份区间>.bpq

⚠️ 校验和必须与前端 frontend/src/bpq/importer.js::packChecksum 算出同一个值，
   否则导入端一律报"校验和不匹配"。改动其中任何一边都要同时改另一边。
   两个关键点：① 对象键**按字典序排序**后序列化；② 逐 **UTF-16 码元** 做 FNV-1a
   （JS 的 charCodeAt 是 UTF-16 码元，Python 的 ord 是码点，非 BMP 字符会不一致）。
"""

import os
import sys
import json
import glob
import argparse
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'out')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
# 2026-09-21：私有题库从 `release/私有题库/` 挪到**项目根 `私有题库/`**。
# 理由：它原先只是顺带被 `release/` 整目录规则忽略的 —— 私密数据靠别人的规则顺带挡住
# 是一条随时会断的防线（有人为提交某个说明文件把 `release/` 改成逐个列，它就漏了）。
# 挪出来后 .gitignore 里有**显式**规则 `私有题库/`，与目录绑在一起。
DEST_DIR = os.path.join(ROOT, '私有题库')

PUBLIC_MAX_YEAR = 2021          # 与 to_frontend.py 保持一致：这段以上才是私有
FORMAT = 'bluepencil-bpq'
MAGIC = 'BPQ00001'
VERSION = 1
LICENSE = '仅供个人备考学习使用。请勿二次分发；每个包带有使用者水印，泄露可溯源。'


def utf16_units(s: str):
    b = s.encode('utf-16-le')
    return [b[i] | (b[i + 1] << 8) for i in range(0, len(b), 2)]


def fnv1a32(s: str) -> str:
    h = 0x811c9dc5
    for u in utf16_units(s):
        h ^= u
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, '08x')


def stable_stringify(v) -> str:
    """与 JS 端 importer.js::stableStringify 逐字对齐"""
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return json.dumps(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(stable_stringify(x) for x in v) + ']'
    items = ','.join(
        json.dumps(k, ensure_ascii=False) + ':' + stable_stringify(v[k])
        for k in sorted(v.keys()))
    return '{' + items + '}'


def main() -> int:
    ap = argparse.ArgumentParser(description='导出私有题库包（.bpq）')
    ap.add_argument('--user', default='',
                    help='使用者标识（姓名/邮箱），写进包内水印；不填则记为未署名')
    ap.add_argument('--year-from', type=int, default=PUBLIC_MAX_YEAR + 1)
    ap.add_argument('--year-to', type=int, default=9999)
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(SRC, '*.json')))
    if not files:
        print('out/ 里没有 JSON，先跑 extract.py')
        return 1

    exams = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        if not (args.year_from <= d['year'] <= args.year_to):
            continue
        material = '\n\n'.join(f"{m['label']}\n{m['text']}" for m in d['materials'])
        exams.append({
            'id': d['id'],
            'year': d['year'],
            'paper': d['paper'],
            'title': d['title'],
            'material': material,
            'questions': [
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
            ],
        })

    if not exams:
        print(f'没有 {args.year_from}–{args.year_to} 的卷可导出')
        return 1

    years = sorted({e['year'] for e in exams})
    pack = {
        'format': FORMAT,
        'magic': MAGIC,
        'version': VERSION,
        'issuer': '许一 <xuconghui_03@qq.com>',
        'issuedAt': datetime.now().astimezone().isoformat(timespec='seconds'),
        'license': LICENSE,
        'userFingerprint': args.user or '未署名',
        'tier': 'private',
        'yearRange': [years[0], years[-1]],
        'exams': exams,
        'checksumAlgo': 'fnv1a32',
    }
    pack['checksum'] = fnv1a32(stable_stringify(pack))

    os.makedirs(DEST_DIR, exist_ok=True)
    span = f'{years[0]}-{years[-1]}' if years[0] != years[-1] else str(years[0])
    safe_user = ''.join(c for c in args.user.split('/')[0] if c.isalnum() or '\u4e00' <= c <= '\u9fff')
    suffix = f'-{safe_user}' if safe_user else ''
    out = os.path.join(DEST_DIR, f'蓝笔申论-私有题库-{span}{suffix}.bpq')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(pack, fh, ensure_ascii=False, indent=1)

    n_q = sum(len(e['questions']) for e in exams)
    kb = os.path.getsize(out) / 1024
    print(f'✓ 已导出 {os.path.relpath(out, ROOT)}  ({kb:.0f} KB)')
    print(f'  卷 {len(exams)} 套 / 题 {n_q} 道 ｜ 年份 {span}')
    print(f'  使用者水印：{pack["userFingerprint"]}')
    print(f'  校验和：{pack["checksum"]}')
    print('  发给对方后，TA 在「题库 → 导入题库包」里导入即可（材料与答案都在包里）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
