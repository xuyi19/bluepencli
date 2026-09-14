# -*- coding: utf-8 -*-
"""给重要源文件打作者水印（幂等）。

为什么用脚本而不是手改：
  水印会随作者信息变更（换邮箱、加仓库）而变，手改十几处必然漏。
  跑一次这个脚本，所有目标文件的水印一起更新；已有水印的会先被替换掉。

用法：
    backend/.venv/Scripts/python.exe .tools/add_watermark.py            # 检查
    backend/.venv/Scripts/python.exe .tools/add_watermark.py --write    # 写入
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NAME = '许一'
EMAIL = 'xuconghui_03@qq.com'
GITHUB = 'https://github.com/xuyi19/bluepencli'
GITEE = 'https://gitee.com/xuyi_19/bluepencil'
LICENSE = 'AGPL-3.0'

LINES = [
    f'蓝笔申论 BluePencil · 作者 {NAME} <{EMAIL}>',
    f'GitHub: {GITHUB}',
    f'Gitee : {GITEE}',
    f'许可: {LICENSE} · 转发或修改请保留本署名',
]

# 目标文件：入口、核心调度、双通道、数据层、后端入口、打包脚本、数据流水线
TARGETS = [
    'frontend/src/main.js',
    'frontend/src/App.vue',
    'frontend/src/agents/orchestrator.js',
    'frontend/src/agents/teachers.js',
    'frontend/src/agents/skills.js',
    'frontend/src/agents/grading/standard.js',
    'frontend/src/agents/grading/standardResolver.js',
    'frontend/src/utils/grading/rules.js',
    'frontend/src/data/standards/index.js',
    'frontend/src/data/standards/public.js',
    'frontend/src/api/llm.js',
    'frontend/src/api/backend.js',
    'frontend/src/bpq/importer.js',
    'frontend/src/data/author.js',
    'frontend/src/data/questions.js',
    'frontend/src/store/db.js',
    'frontend/src/utils/watermark.js',
    'frontend/src/data/wechat.js',
    'frontend/src/utils/wechatPanel.js',
    'frontend/src/components/WeChatPanel.vue',
    'frontend/src/components/WeChatHost.vue',
    'backend/app/main.py',
    'backend/app/core/config.py',
    'backend/build_desktop.py',
    'frontend/vite.config.js',
    '.tools/exams/extract.py',
    '.tools/exams/qc.py',
    '.tools/exams/recon.py',
    '.tools/exams/report_doc.py',
    '.tools/exams/to_frontend.py',
    '.tools/exams/export_bpq.py',
    '.tools/standards/gen_standards.mjs',
    '.tools/check_release_private.py',
]

RULE = '─' * 62
MARK = f'作者 {NAME}'          # 判断是否已打水印
MARK_END = '─' * 62


def block(style: str) -> str:
    if style == 'py':
        head = f'# {MARK_END}\n'
        body = ''.join(f'# {l}\n' for l in LINES)
        return head + body + f'# {MARK_END}\n'
    if style == 'js':
        head = f'// {MARK_END}\n'
        body = ''.join(f'// {l}\n' for l in LINES)
        return head + body + f'// {MARK_END}\n'
    if style == 'html':
        inner = '\n'.join(f'  {l}' for l in LINES)
        return f'<!--\n{inner}\n-->\n'
    raise ValueError(style)


def style_of(path: Path) -> str:
    if path.suffix == '.py':
        return 'py'
    if path.suffix == '.vue':
        return 'html'
    return 'js'


def strip_existing(text: str, style: str) -> str:
    """去掉**所有**已有的水印块，避免越加越多。

    两个必须注意的点：
      1. 用 `search` 而不是 `match`：Python 文件的水印在 `# -*- coding -*-` 之后，
         从第 0 行做 match 永远匹配不上，于是每次都在文件里叠一层（真踩过）；
      2. 循环删除：万一历史版本已经叠了两层，一次 sub 只去一层，剩下一层还在。
    """
    if style == 'html':
        pat = re.compile(rf'^<!--\n(?:(?!-->).)*?作者 {NAME}(?:(?!-->).)*?-->\n', re.S)
        while pat.search(text):
            text = pat.sub('', text, count=1)
        return text

    c = '#' if style == 'py' else '//'
    # 用「作者 许一」而不是整行精确匹配：水印行前面还有项目名，整行匹配会漏
    pat = re.compile(
        rf'^(?:\{c} ─+\n)(?:\{c}[^\n]*\n)*?\{c}[^\n]*作者 {NAME}[^\n]*\n'
        rf'(?:\{c}[^\n]*\n)*?(?:\{c} ─+\n)',
        re.M,
    )
    while pat.search(text):
        m = pat.search(text)
        text = text[:m.start()] + text[m.end():]
    return text


def insert(text: str, blk: str, style: str) -> str:
    if style == 'html':
        # .vue 的 <template> 必须在最前，注释只能放在它上面
        return blk + text
    lines = text.split('\n')
    # 保留 shebang 与 coding 声明
    cut = 0
    while cut < len(lines) and (
        lines[cut].startswith('#!')
        or re.match(r'^#\s*-\*-.*-\*-', lines[cut])
        or lines[cut].strip() == ''
        and cut == 0
    ):
        cut += 1
    return '\n'.join(lines[:cut]) + ('\n' if cut else '') + blk + '\n'.join(lines[cut:])


def main() -> None:
    write = '--write' in sys.argv
    changed = skipped = missing = 0
    for rel in TARGETS:
        p = ROOT / rel
        if not p.exists():
            print(f'  跳过（不存在）：{rel}')
            missing += 1
            continue
        st = style_of(p)
        text = p.read_text(encoding='utf-8')
        clean = strip_existing(text, st)
        new = insert(clean, block(st), st)
        if new == text:
            skipped += 1
            continue
        changed += 1
        print(f'  {"更新" if write else "待更新"}：{rel}')
        if write:
            p.write_text(new, encoding='utf-8')
    print(f'\n{"已写入" if write else "待处理"} {changed} 个，已是最新 {skipped} 个，不存在 {missing} 个')


if __name__ == '__main__':
    main()
