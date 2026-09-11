"""换肤脚本：新拟态 → Natural Organic（2026-09-11 执行，保留作参考）。

用法：python .tools/retheme.py
它做的是「旧值 → 新 token 值」的表格化替换，顺序敏感：
长表达式必须在短色值之前替换，否则 shadow-[...] 会被色值替换拆散、匹配不上。

本次执行结果：498 处 / 11 个文件。之后又分两轮补了 rgb() 形式与图表色，
以及手工处理 JS 对象里的内联 boxShadow（脚本覆盖不到那类）。
"""
import pathlib

SRC = pathlib.Path('E:/code/bluepencil/frontend/src')

# 老师色标单独手工处理，脚本跳过
SKIP = {'teachers.js'}

RULES = [
    # ── 1. 输入框组合：.neu-inset 自带白底，删掉冗余的拟态底色 ──
    ('bg-[#e0e5ec] neu-inset', 'neu-inset'),
    ('bg-[#e0e5ec] neu-press', 'neu-press'),
    ('bg-[#e0e5ec] neu', 'neu'),

    # ── 2. 新拟态双向阴影表达式（长 → 短） ──
    ('shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]',
     'shadow-[0_1px_2px_rgba(120,113,108,0.06),0_4px_14px_rgba(120,113,108,0.05)]'),
    ('active:shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff]', 'active:translate-y-px'),
    ('hover:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]', 'hover:translate-y-px'),
    ('hover:shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff]', 'hover:translate-y-px'),
    ('shadow-[inset_3px_3px_6px_#b8bcc2,inset_-3px_-3px_6px_#ffffff]', ''),
    ('shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]', ''),
    ('shadow-[inset_2px_2px_6px_#c8ccd2]', 'shadow-[inset_0_1px_3px_rgba(120,113,108,0.08)]'),
    # 内联 style 里的阴影
    ('box-shadow: 6px 6px 12px #b8bcc2, -6px -6px 12px #ffffff',
     'box-shadow: 0 4px 14px rgba(92,64,51,0.18)'),
    ('box-shadow: inset 3px 3px 6px #b8bcc2, inset -3px -3px 6px #ffffff', 'box-shadow: none'),
    ('box-shadow: inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff', 'box-shadow: none'),

    # ── 3. 语义标签色板（底 / 字） ──
    ('#eeedfe', '#f2ebe2'),   # 主色标签底
    ('#534ab7', '#5c4033'),   # 主色标签字
    ('#e6f1fb', '#e8ecdf'),   # 题型标签底 → sage 浅
    ('#e1f5ee', '#e8ecdf'),   # docs 标签底 → sage 浅
    ('#f1efe8', '#f5f1ea'),   # 中性标签底
    ('#5f5e5a', '#78716c'),   # 中性标签字
    ('#fcebeb', '#f7e9e4'),   # 错误底 → 暖红
    ('#faeeda', '#f7eddc'),   # 提示底 → 暖黄
    ('#9ca3af', '#a8a29e'),   # 禁用字
    ('#6b7280', '#78716c'),   # 未选中

    # ── 4. 功能色（老师色标 / 建议色 / 题型色） ──
    ('#185fa5', '#3d5a7a'),
    ('#0f6e56', '#4f7d5e'),
    ('#993556', '#9c4a42'),
    ('#854f0b', '#9c6b2f'),

    # ── 5. 基础十六进制 ──
    ('#6d5dfc', '#5c4033'),
    ('#e0e5ec', '#faf6f1'),
    ('#a32d2d', '#b4552d'),
    ('#b8bcc2', '#d6d3d1'),
    ('#c8ccd2', '#d6d3d1'),
    ('#d0d4da', '#e7e5e4'),

    # ── 6. Tailwind 内置灰/白 → 暖色 token ──
    ('text-gray-800', 'text-c-ink'),
    ('text-gray-700', 'text-c-body'),
    ('text-gray-600', 'text-c-body'),
    ('text-gray-500', 'text-c-muted'),
    ('text-gray-400', 'text-c-muted'),
    ('text-gray-300', 'text-c-muted'),
    ('border-gray-300', 'border-c-lineDeep'),
    ('border-gray-200', 'border-c-line'),
    ('divide-gray-200', 'divide-c-line'),
    ('bg-gray-100', 'bg-c-barkSoft'),
    ('bg-gray-50', 'bg-c-barkSoft'),
    ('bg-gray-200', 'bg-c-line'),
    ('bg-white', 'bg-c-paper'),
    ('text-white', 'text-c-cream'),
]

targets = [p for p in list(SRC.rglob('*.vue')) + list(SRC.rglob('*.js'))
           if 'node_modules' not in p.parts and p.name not in SKIP]

total = 0
for p in targets:
    s = orig = p.read_text(encoding='utf-8')
    hits = 0
    for a, b in RULES:
        c = s.count(a)
        if c:
            s = s.replace(a, b)
            hits += c
    if s != orig:
        p.write_text(s, encoding='utf-8')
        total += hits
        print(f'{hits:4d}  {p.relative_to(SRC)}')

print(f'\n合计替换 {total} 处，涉及 {len(targets)} 个文件中的若干')
