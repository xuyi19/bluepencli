# -*- coding: utf-8 -*-
# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""流水线 ①→③：真题 PDF → 结构化 JSON。

设计要点（都是对着真实排版定的，别轻易改）：
- 段落按「行首缩进」还原：段首 x0 明显大于左边距，续行贴着左边距。
  实测 2024 行政执法卷：续行 x0=54、段首 x0=78、页码居中 x0=261。
- 分题用「（N 分）」做锚点，而不是题号 —— 每道题必然以分值结尾，
  而题号写法有「第一题：」「1.」「（一）」「一、」甚至**根本没有编号**（2023 行政执法卷）。
- 答案块按行级锚点切（一、参考答案：/ 【参考答案】/ 参考答案：），
  并在块内截掉「参考答案说明 / 第一步——审题」这类解析尾巴。
"""

import re
import os
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from exams_config import EXAMS, PDF_DIR  # noqa: E402

OUT_DIR = os.path.join(HERE, 'out')
CJK = r'\u4e00-\u9fff'
DASHES = r'~～—－−-'   # 连字符放在末尾，避免在字符类里被当作范围

# ---------------- 文本清洗 ----------------

def clean(s: str) -> str:
    s = s.replace('\u3000', ' ').replace('\xa0', ' ')
    s = re.sub(r'[ \t]+', ' ', s).strip()
    s = re.sub(rf'(?<=[{CJK}])\s+(?=[0-9A-Za-z])', '', s)
    s = re.sub(rf'(?<=[0-9A-Za-z])\s+(?=[{CJK}])', '', s)
    s = re.sub(rf'(?<=[{CJK}])\s+(?=[{CJK}])', '', s)
    return s


def is_noise(t: str) -> bool:
    t = t.strip()
    if not t:
        return True
    if re.match(r'^第\s*\d+\s*页(\s*共\s*\d+\s*页)?$', t):
        return True
    if re.match(r'^\d{1,3}$', t):
        return True
    if re.match(r'^\d+\s*/\s*\d+$', t):        # 河北联考卷页码「1 / 8」
        return True
    if re.match(r'^\d{4}\s*年.*《申论》.*$', t):  # 河北联考卷页眉/答案标题行（含卷名）
        return True
    if re.match(rf'^[-—–\s]*\d+[-—–\s]*$', t):
        return True
    return False


# ---------------- 读取 PDF ----------------

def read_rows(pdf_path: str):
    """返回 [{p,x0,x1,y,w,t}]，已剔除页码类噪声。"""
    doc = pymupdf.open(pdf_path)
    rows = []
    for pi, page in enumerate(doc):
        w = page.rect.width
        d = page.get_text('dict')
        for blk in d['blocks']:
            if blk.get('type') != 0:
                continue
            for ln in blk['lines']:
                txt = ''.join(sp['text'] for sp in ln['spans'])
                if is_noise(txt):
                    continue
                x0, y0, x1, y1 = ln['bbox']
                rows.append({'p': pi, 'x0': x0, 'x1': x1, 'y': y0, 'w': w, 't': txt})
    doc.close()

    # 说明：这里**不做**「跨页重复行」过滤。试过，它会把答案文件里的
    # 「【参考答案】」（一页内出现多次、总次数超过页数）当成页眉删掉，
    # 导致答案块从 5 个掉到 1 个。页码已由 is_noise 的文本模式处理。
    return split_glued(rows)


RE_GLUED = re.compile(
    rf'^([一二三四五六七八九十]+\s*[、.]\s*)?(给定材料|给定资料)(材料\s*[0-9一二三四五六七八九十]+\s*[:：]?.*)$'
)


def split_glued(rows):
    """PDF 会把区段标题和第一则材料挤在一行：实测 2022 副省级是「二、给定材料材料1」。"""
    out = []
    for r in rows:
        t = clean(r['t'])
        m = RE_GLUED.match(t)
        if m:
            a = dict(r)
            a['t'] = (m.group(1) or '') + m.group(2)
            b = dict(r)
            b['t'] = m.group(3)
            b['x0'] = r['x0'] + 24      # 当作段首缩进
            out += [a, b]
        else:
            out.append(r)
    return out


# ---------------- 区段锚点 ----------------

RE_SEC_MAT = re.compile(
    rf'^([一二三四五六七八九十]+\s*[、.]\s*)?(给定材料|给定资料|材料部分)(\s*[（(].*[）)])?$'
    rf'|^【?\s*材料\s*[一二三四五六七八九十\d]+\s*】?\s*[:：]?$'   # 河北卷无总标题，首个【材料一】即起点
)
RE_SEC_REQ = re.compile(
    rf'^([一二三四五六七八九十]+\s*[、.]\s*)?(作答要求|申论要求|作答要求部分)(\s*[（(].*[）)])?$'
    rf'|^【?\s*问题\s*[一二三四五六七八九十\d]+\s*】?\s*[:：]?$'   # 河北卷首个【问题一】即起点
)
RE_SEC_ANS = re.compile(
    rf'^([一二三四五六七八九十]+\s*[、.]\s*)?(参考答案与?解析|参考答案|答案要点|答案|解析|评分标准)$'
    rf'|^.*[（(]解析[）)].*$'
)
RE_MATN = re.compile(r'^[【\[]?\s*材料\s*([0-9一二三四五六七八九十]+)\s*[】\]]?\s*[:：]?$')  # 河北卷【材料一】
RE_ANS_ANCHOR = re.compile(
    r'^【?\s*(参考)?答案\s*】?\s*[:：]?$'
    r'|^参考答案\s*[（(]\s*[A-Za-z0-9]{1,2}\s*[）)]\s*[:：]?$'
    r'|^(\d+|[一二三四五六七八九十]+)\s*[、.]\s*【?\s*(参考)?答案\s*】?\s*[:：]?$'
    r'|^[（(]\s*(\d+|[一二三四五六七八九十]+)\s*[）)]\s*参考答案\s*[:：]?$'
    r'|^第[一二三四五六七八九十]+问\s*参考答案\s*[:：]?$'
    r'|^【试题\s*(\d+|[一二三四五六七八九十]+)\s*】\s*(参考)?答案\s*[:：]?$'
    r'|^【?\s*问题\s*([一二三四五六七八九十\d]+)\s*参考答案\s*】?\s*[:：]?$'   # 河北联考新卷
    r'|^第\s*([一二三四五六七八九十\d]+)\s*题\s*[:：]\s*参考答案\s*[:：]?$'   # 2013 河北：题号+参考答案同行
    r'|^题目\s*([一二三四五六七八九十\d]+)\s*[:：]?$'                        # 2021 河北乡镇：题目1：
)
# 同一道题的多套答案（如【参考答案一】【参考答案二】）→ 不开新块
RE_ANS_SUB = re.compile(r'^【\s*参考答案\s*[一二三四五六七八九十\d\-—~～]+\s*】$')
RE_ANS_CUT = re.compile(r'^(参考答案说明|答案说明|赋分说明|评分说明|第[一二三四五六七八九十]+步[—\-–]+|通过勾画题干关键词|审题\s*$)')

RE_SCORE = re.compile(rf'[（(]\s*(\d+)\s*分\s*[）)]')
# 字数要求是每道题的最后一条 → 用它当题目的真正终点
RE_WL = re.compile(
    rf'不超过\s*\d+\s*字'
    rf'|不少于\s*\d+\s*字'
    rf'|(?:总)?字数\s*\d+\s*[{DASHES}]{{1,3}}\s*\d+\s*字'   # 有的是 400～500，有的是 800——1000
    rf'|\d+\s*[{DASHES}]{{1,3}}\s*\d+\s*字'                 # 裸区间：2013 副省级「800～1000字」
    rf'|\d+\s*字左右'
)
RE_WL_RANGE = re.compile(rf'(?:总)?字数\s*(\d+)\s*[{DASHES}]{{1,3}}\s*(\d+)\s*字')
RE_WL_RANGE2 = re.compile(rf'(\d+)\s*[{DASHES}]{{1,3}}\s*(\d+)\s*字')   # 无「字数」前缀
RE_WL_MAX = re.compile(r'不超过\s*(\d+)\s*字')
RE_WL_ONLY = re.compile(r'(\d+)\s*字左右')
RE_WL_MIN = re.compile(r'不少于\s*(\d+)\s*字')   # 河北卷大作文「不少于1000字」


RE_NEXT_Q = re.compile(rf'[一二三四五六七八九十]+\s*[、.][^）)]{{0,220}}?[（(]\s*\d+\s*分\s*[）)]')


# ---------------- OCR 校订 ----------------
# 源 PDF 多为**考生回忆/OCR 版**，含错字丢字。这里只收「能确证」的修正：
# ① 汉字中夹孤立的单个拉丁字母（明显 OCR 误识）；② 重复标点。
# 键 = 卷 id，值 = [(错误串, 正确串)]，错误串必须独特、全文替换安全。
# 引号/括号数量不符的不在此处猜改（无法定位），统一留进 out/qc-report.txt 待人工校对。
FIXUPS = {
    # —— 错字（OCR 误识）——
    '2018-dishi':     [('关于s市', '关于S市')],
    '2021-fusheng':   [('不超过400字。。', '不超过400字。')],
    '2024-xingzheng': [('行政i款', '行政罚款'),
                       ('能成兴市场中的主角', '能成为市场中的主角'),
                       ('认定“由政策依据', '认定有政策依据'),     # 「有」被误识成「“由」
                       ('全国前二。2011年', '全国前二。”2011年')],  # 汪董事长引语丢右引号
    # —— 引号（前后颠倒 / 全角直引号 / 开合错位 / 成段引语丢右引号）——
    # 每条均经全文唯一性校验，可安全替换。
    '2010-dishi':     [('的典型。请结合资料内容', '的典型。”请结合资料内容')],
    '2016-dishi':     [('＂', '”')],                  # 市长信箱＂ → 市长信箱”
    '2016-fusheng':   [('＂', '”'),                   # 孝文化＂ → 孝文化”
                       ('把”中国元素“和”中国符号“', '把“中国元素”和“中国符号”'),
                       ('温柔对待。网友', '温柔对待。”网友')],
    '2017-dishi':     [('“水城“名片', '“水城”名片')],
    '2021-dishi':     [('破坏很大。“', '破坏很大。”“')],   # 连续两个左引号 → 前一补右引号（插入而非替换）
    '2022-xingzheng': [('撤销”眼中的柜台”', '撤销“眼中的柜台”')],
    # 注意：apply_fixups 是**按材料逐块**应用的，替换串不能跨材料边界
    #（2024 副省级「不能给果树施。一场」恰好骑在材料 3/4 交界，改用块内片段）
    '2024-fusheng':   [('按人口发。调研组', '按人口发。”调研组'),
                       ('不能给果树施。', '不能给果树施。”'),
                       ('正式上图入库。高标准农田', '正式上图入库。”高标准农田')],
}


def apply_fixups(eid, text):
    for bad, good in FIXUPS.get(eid, []):
        text = text.replace(bad, good)
    return text


def fix_split_marks(rows):
    """修复被 PDF 拆到两行的标记（实测 2024 答案里「【参考答案】」被拆成「【」+「参考答案】」）。"""
    out = []
    i = 0
    frags = {'【', '【参考', '【参考答案', '参考答案】', '参考答', '答案】'}
    while i < len(rows):
        t = clean(rows[i]['t'])
        if t in frags and i + 1 < len(rows):
            m = dict(rows[i])
            m['t'] = t + clean(rows[i + 1]['t'])
            out.append(m)
            i += 2
            continue
        out.append(rows[i])
        i += 1
    return out


def section_bounds(rows):
    """找 (材料起点, 作答要求起点, 答案起点)，索引为行号，找不到给 -1。"""
    mat = req = ans = -1
    for i, r in enumerate(rows):
        t = clean(r['t'])
        if mat < 0 and RE_SEC_MAT.match(t):
            mat = i
        elif req < 0 and RE_SEC_REQ.match(t):
            req = i
        elif RE_SEC_ANS.match(t):
            ans = i
            break
    return mat, req, ans


# ---------------- 材料区 ----------------

def build_materials(rows, base_x):
    """按缩进还原段落，再按「材料N」切分。"""
    paras = []
    cur = ''
    cur_label = None
    for r in rows:
        t = clean(r['t'])
        if not t:
            continue
        m = RE_MATN.match(t)
        if m:
            if cur:
                paras.append((cur_label, cur))
            cur_label = '材料' + m.group(1)
            cur = ''
            continue
        if r['x0'] > base_x + 12:      # 段首缩进
            if cur:
                paras.append((cur_label, cur))
            cur = t
        else:
            cur += t
    if cur:
        paras.append((cur_label, cur))

    # 归并
    out = []
    for label, text in paras:
        if label is None:
            continue
        if out and out[-1]['label'] == label:
            out[-1]['paras'].append(text)
        else:
            out.append({'label': label, 'paras': [text]})
    for o in out:
        o['text'] = '\n'.join(p for p in o['paras'] if p)
        o.pop('paras', None)
    return out


# ---------------- 题目区 ----------------

def guess_type(stem: str) -> str:
    """按申论五种题型归档。标签与前端 `QUESTION_TYPES` 完全一致
    （归纳概括 / 综合分析 / 提出对策 / 贯彻执行 / 大作文），题库筛选才可用。

    判定顺序即优先级：**先排他性强的（大作文、公文），再「综合分析」，
    最后才是宽泛的「归纳概括」**。早期版本把「归纳概括」放太前，
    「谈谈…启示」「阐述…含义」全被吞掉，42 道题落进「其他」。
    """
    s = stem
    if re.search(r'自拟题目|自选角度|写一篇文章|一篇议论文|写一篇.*(文章|短文)|联系实际.*写', s):
        return '大作文'
    if re.search(r'写一份|草拟|拟写|撰写|拟制|编写|公开信|倡议书|发言提纲|讲话稿|编者按'
                 r'|简报|短评|导言|讲解稿|讲座|问卷|报道|填入|填.*横线|横线|拟.*标题|工作要点', s):
        return '贯彻执行'
    if re.search(r'提出.*(建议|对策|措施|意见|办法)|建议|对策|措施', s):
        return '提出对策'
    if re.search(r'谈谈.*(理解|看法|认识|见解|启示|分析|表现)|对.{1,20}的(理解|看法|认识|见解)'
                 r'|如何理解|含义|意思|阐释|解释|分析.{0,10}(原因|理由|表现)|为什么'
                 r'|评价|评析|反驳|见解|启示|划线句子', s):
        return '综合分析'
    if re.search(r'概括|概述|简述|归纳|梳理|整理|提炼|总结|列出|指出|说明|有哪些|哪些地方'
                 r'|变化|亮点|怎样|如何|体现在|经验|做法', s):
        return '归纳概括'
    return '其他'


def _paras(rows, base_x):
    """按行首缩进还原段落。"""
    paras, cur = [], ''
    for r in rows:
        t = clean(r['t'])
        if not t:
            continue
        if r['x0'] > base_x + 12:
            if cur:
                paras.append(cur)
            cur = t
        else:
            cur += t
    if cur:
        paras.append(cur)
    return paras


RE_QHEAD = re.compile(
    rf'^(【\s*问题\s*[一二三四五六七八九十\d]+\s*】'
    rf'|第\s*[一二三四五六七八九十\d]+\s*题\s*[:：]?'
    rf'|[（(]\s*[一二三四五六七八九十\d]+\s*[）)]'
    rf'|\d+\s*[.．、]'
    rf'|[一二三四五六七八九十]+\s*[、.])'
)
RE_QTOP = re.compile(r'^[一二三四五六七八九十]+\s*[、.]')


def _is_qstart(p, mode):
    pat = RE_QTOP if mode == 'top' else RE_QHEAD
    if not pat.match(p):
        return False
    if mode == 'top':
        return True
    # 「（1）内容具体、符合实际；」这类要求条目不算题首：要带分值，或者足够长
    return bool(RE_SCORE.search(p)) or len(p) > 30


# 块首的题号。必须**循环**清理：有的卷把「第四题：」单列一行、下一行又写「第四题:…」，
# 一次替换清不净（最多清 4 轮）。
RE_QLABEL = re.compile(
    r'^(【\s*问题\s*[一二三四五六七八九十\d]+\s*】\s*'
    r'|第\s*[一二三四五六七八九十\d]+\s*题\s*[:：、.．]?\s*'
    r'|问题\s*[一二三四五六七八九十\d]+\s*[:：、.．]?\s*'      # 2022 行政执法卷：问题一：…
    r'|[（(]\s*[一二三四五六七八九十\d]+\s*[）)]\s*'
    r'|\d+\s*[.．、]\s*'
    r'|[一二三四五六七八九十]+\s*[、.]\s*)'
)


def _clean_label(stem):
    stem = stem.strip()
    for _ in range(4):
        nxt = RE_QLABEL.sub('', stem).strip()
        if nxt == stem:
            break
        stem = nxt
    return stem


def _split_subreqs(b):
    """拆「题干（N分）\\n要求：R」× N 的结构 → [(题干, 要求, 分值)]；不满足返回 None。

    2016 地市级第三题就是这样：两个小问各带自己的分值与字数要求。
    返回 None 时交给通用逻辑，避免影响绝大多数单问单要求的题。
    """
    marks = list(re.finditer(r'要求\s*[:：]', b))
    scores = list(RE_SCORE.finditer(b))
    if len(marks) < 2 or len(scores) != len(marks):
        return None
    out, prev = [], 0
    for i, mk in enumerate(marks):
        stem_i = b[prev:scores[i].start()].strip()
        end = len(b)
        if i + 1 < len(scores):
            raw = b[mk.end():scores[i + 1].start()]
            cut = None
            for mm in re.finditer(rf'[（(]\s*{i + 2}\s*[）)]', raw):
                cut = mm                 # 下一小问的编号即本小问要求的终点
            end = mk.end() + (cut.start() if cut else len(raw))
        out.append((stem_i, b[mk.end():end].strip(), int(scores[i].group(1))))
        prev = end
    return out


def _wl_of(text):
    """从一段要求文字里取字数（区间取上限）。"""
    m = RE_WL_RANGE.search(text) or RE_WL_RANGE2.search(text)
    if m:
        return int(m.group(2))
    m = RE_WL_MAX.search(text) or RE_WL_ONLY.search(text) or RE_WL_MIN.search(text)
    return int(m.group(1)) if m else None


# 卷末会紧跟「2016年国家公务员考试《申论》地市级卷（解析）」这类答案页眉，
# 段落拼接后会黏在最后一道题的要求尾巴上，必须截掉。
RE_TRAILER = re.compile(r'\d{4}\s*年.{0,40}?(?:解析|参考答案)')


def _strip_trailer(t):
    m = RE_TRAILER.search(t)
    return t[:m.start()].rstrip() if m else t


def parse_qblock(b):
    """从一块文本里拆出 题干 / 要求 / 分值 / 字数。"""
    subs = _split_subreqs(b)
    if subs:
        # 一题多小问：小问题干全并进 stem，各小问要求编号后合并，字数取和。
        stem = '\n'.join(s for s, _, _ in subs if s)
        req = '\n'.join(f'（{i + 1}）{r}' for i, (_, r, _) in enumerate(subs) if r)
        wls = [_wl_of(r) for _, r, _ in subs]
        return {
            'stem': _strip_trailer(_clean_label(stem)),
            'requirement': _strip_trailer(req),
            'score': sum(sc for _, _, sc in subs),
            'wordLimit': sum(w for w in wls if w) or None,
            'type': guess_type(stem),
        }
    m_sc = RE_SCORE.search(b)
    if m_sc:
        # 一块里出现多个「（N 分）」时取和：2016 地市级「三、回答下列问题」下辖
        # 两小问各 10 分，大题合计 20 分。
        score = sum(int(x) for x in RE_SCORE.findall(b))
        head, tail_req = b[:m_sc.start()], b[m_sc.end():]
    else:
        mr0 = re.search(r'要求\s*[:：]', b)
        score = None
        head, tail_req = (b[:mr0.start()], b[mr0.end():]) if mr0 else (b, '')

    # 「（N分）」与「要求：」之间的正文要并回题干 —— 一题多小问时那正是子问题，
    # 丢掉考生就不知道要答什么（2021 副省级第 3 题曾整段丢失）。
    _mr = re.search(r'要求\s*[:：]', tail_req)
    if _mr:
        _between = RE_SCORE.sub('', tail_req[:_mr.start()]).strip()
        if _between:
            head = head.rstrip() + '\n' + _between

    stem = _clean_label(head)
    mr = re.search(r'要求\s*[:：]', tail_req)
    req = (tail_req[mr.end():] if mr else tail_req).strip()
    stem, req = _strip_trailer(stem), _strip_trailer(req)

    # 无「要求」且很短 → 总起句（2010 副省级「认真阅读给定资料，简要回答下面两题。（20 分）」）
    if not mr and len(stem) < 40 and len(req) < 10:
        return None

    return {
        'stem': stem,
        'requirement': req,
        'score': score,
        'wordLimit': _wl_of(req),
        'type': guess_type(stem),
    }


def split_questions(rows, base_x, mode='score'):
    """作答要求区 → 题目列表。

    mode='score'（默认）：以「（N 分）」+「字数要求」为锚点。覆盖绝大多数卷，
        连「第一题：」「1.」「（一）」和**完全无编号**（2023 行政执法卷）都能切。
    mode='number'：按段落首的题号切。用于一题多问、有小问没有分值的卷（2011 地市级）。
    mode='top'：只认「一、」级大题号。用于题目按小问给分、答案按大题给的卷（2016 地市级）。
    """
    paras = _paras(rows, base_x)
    flat = '\n'.join(paras)

    if mode == 'score':
        scores = list(RE_SCORE.finditer(flat))
        if not scores:
            return [], '未找到「（N 分）」锚点'
        wls = list(RE_WL.finditer(flat))
        blocks, prev = [], 0
        for i, sc in enumerate(scores):
            nxt = scores[i + 1].start() if i + 1 < len(scores) else len(flat)
            wl = next((w for w in wls if sc.end() <= w.start() < nxt), None)
            if wl:
                e = wl.end()
            elif i == len(scores) - 1:
                e = len(flat)     # 末题没写字数要求（2013 副省级作文），整段收进本题
            else:
                e = sc.end()
            while e < len(flat) and flat[e] in '。；;，,、':
                e += 1
            blocks.append(flat[prev:e])
            prev = e
        tail = flat[prev:].strip()
    else:
        blocks, cur = [], ''
        for p in paras:
            if _is_qstart(p, mode) and cur:
                blocks.append(cur)
                cur = p
            else:
                cur += p
        if cur:
            blocks.append(cur)
        tail = ''

    qs = [q for q in (parse_qblock(b) for b in blocks) if q]
    return qs, ('尾部残留：' + tail[:40] if tail else None)


# ---------------- 答案区 ----------------

def build_answers(rows, base_x, stems=None):
    """答案区 → 答案块列表。

    行级锚点切块；块尾用「下一题题干」截断（分离卷的答案文件会把题目重抄一遍）。
    """
    rows = fix_split_marks(rows)
    blocks = []
    cur = None
    for r in rows:
        t = clean(r['t'])
        if not t:
            continue
        if RE_ANS_SUB.match(t):
            continue                      # 同题多套答案，并入当前块
        if RE_ANS_ANCHOR.match(t):
            if cur:
                blocks.append(cur)
            cur = []
            continue
        if cur is None:
            continue
        if RE_ANS_CUT.match(t):
            blocks.append(cur)          # 解析尾巴，结束当前块
            cur = None
            continue
        cur.append(r)
    if cur:
        blocks.append(cur)

    heads = [s[:16] for s in (stems or []) if len(s) >= 16]

    out = []
    for blk in blocks:
        paras = []
        c = ''
        for r in blk:
            t = clean(r['t'])
            if r['x0'] > base_x + 12:
                if c:
                    paras.append(c)
                c = t
            else:
                c += t
        if c:
            paras.append(c)
        txt = '\n'.join(paras).strip()
        if not txt:
            continue
        # 块尾抄了下一题的题干 → 截掉
        cut = len(txt)
        for h in heads:
            idx = txt.find(h)
            if idx > 20:
                cut = min(cut, idx)
        # 分离卷的答案文件会把下一题的「题号+题干（N 分）」重抄一遍
        m = RE_NEXT_Q.search(txt)
        if m and m.start() > 20:
            cut = min(cut, m.start())
        txt = txt[:cut].strip()
        if txt:
            out.append(txt)
    return out


# ---------------- 主流程 ----------------

def find_ans_start(rows):
    """在行序列里找第一个答案锚点位置（用于把题目区从答案区切出来）。"""
    for i, r in enumerate(rows):
        if RE_ANS_ANCHOR.match(clean(r['t'])):
            return i
    return -1


def parse_exam(spec):
    warnings = []
    qs_all, ans_all, mats_all = [], [], []

    for f in spec['q']:
        # spec 可带 dir 覆盖 PDF 目录（省考卷在 D:\考公\真题\申论\ 各省目录下，与国考不同库）
        path = os.path.join(spec.get('dir', PDF_DIR), f)
        rows = read_rows(path)
        if not rows:
            warnings.append(f'无文本层：{f}')
            continue
        base_x = min(r['x0'] for r in rows)
        m, rq, _ = section_bounds(rows)
        # 有些卷没有「给定材料」这一行（2022 行政执法卷直接从「材料一」开始），
        # 此时把作答要求之前的部分整体当材料区，build_materials 会丢掉首个材料标记前的内容。
        # 河北卷等【材料N】直开式：m 行本身就是首个材料锚点（RE_MATN 命中），
        # **不能跳过** —— 跳了它，材料一正文落在锚点之前、label=None 被归并逻辑丢弃。
        m_is_anchor = m >= 0 and RE_MATN.match(clean(rows[m]['t']))
        if m >= 0 and rq > m:
            mat_rows = rows[m:rq] if m_is_anchor else rows[m + 1:rq]
        elif rq > 0:
            mat_rows = rows[:rq]
        else:
            mat_rows = rows[m:] if (m >= 0 and m_is_anchor) else (rows[m + 1:] if m >= 0 else rows)
        body = rows[rq + 1:] if rq >= 0 else rows
        cut_at = find_ans_start(body)
        q_rows = body[:cut_at] if cut_at >= 0 else body

        mats = build_materials(mat_rows, base_x)
        qs, note = split_questions(q_rows, base_x, spec.get('split', 'score'))
        if note:
            warnings.append(f'{f}: {note}')
        if not qs:
            warnings.append(f'{f}: 未切出题目（req行={rq}）')
        mats_all += mats
        qs_all += qs
        # 答案区不依赖「答案标题」，直接从作答要求之后扫锚点
        ans_all += build_answers(body, base_x, [q['stem'] for q in qs])

    for f in spec['a']:
        path = os.path.join(spec.get('dir', PDF_DIR), f)
        rows = read_rows(path)
        if not rows:
            warnings.append(f'无文本层（需 OCR）：{f}')
            continue
        base_x = min(r['x0'] for r in rows)
        ans_all += build_answers(rows, base_x, [q['stem'] for q in qs_all])

    # 配对
    fix = spec.get('scores') or {}
    slots = spec.get('answer_slots')
    for i, q in enumerate(qs_all):
        no = i + 1
        q['no'] = no
        if q['score'] is None and no in fix:
            q['score'] = fix[no]      # 题干里没写分值的，按 config 补
        if slots is not None:
            idx = slots.get(no)
            q['reference'] = ans_all[idx] if (idx is not None and idx < len(ans_all)) else ''
        else:
            q['reference'] = ans_all[i] if i < len(ans_all) else ''

    # 人工补录：PDF 无文本层（扫描件），或文件名与内容不符时用
    mp = os.path.join(HERE, 'manual', spec['id'] + '.json')
    if os.path.exists(mp):
        with open(mp, encoding='utf-8') as fh:
            manual = json.load(fh)
        for k, v in manual.items():
            if not str(k).isdigit():
                continue
            i = int(k) - 1
            if 0 <= i < len(qs_all):
                qs_all[i]['reference'] = v
                qs_all[i]['referenceSource'] = 'manual'

    if slots is None and len(ans_all) != len(qs_all):
        warnings.append(f'题数 {len(qs_all)} vs 答案块 {len(ans_all)}，不匹配')

    # OCR 校订（源 PDF 缺陷，见 FIXUPS）
    for m in mats_all:
        m['text'] = apply_fixups(spec['id'], m['text'])
    for q in qs_all:
        q['stem'] = apply_fixups(spec['id'], q['stem'])
        q['requirement'] = apply_fixups(spec['id'], q['requirement'])
        q['reference'] = apply_fixups(spec['id'], q['reference'])

    return {
        'id': spec['id'],
        'title': spec['title'],
        'year': spec['year'],
        'paper': spec['paper'],
        # 省考卷强制私有（开源演示库只放国考卷，且发布检查锁公开 24 套）
        'force_private': spec.get('force_private', False),
        'system': spec.get('system', ''),
        'materials': mats_all,
        'questions': qs_all,
        'warnings': warnings,
    }


def main():
    ids = sys.argv[1:] or None
    os.makedirs(OUT_DIR, exist_ok=True)
    specs = [s for s in EXAMS if (not ids or s['id'] in ids) and not s.get('skip')]
    if not specs:
        print('没有匹配的卷 id：', ids)
        return

    for spec in specs:
        try:
            res = parse_exam(spec)
        except Exception as e:
            print(f'[FAIL] {spec["id"]}: {e.__class__.__name__}: {e}')
            continue
        score_sum = sum(q['score'] for q in res['questions'])
        n_mat = len(res['materials'])
        mchars = sum(len(m['text']) for m in res['materials'])
        with_ref = sum(1 for q in res['questions'] if q['reference'])
        print(f"\n===== {res['id']}  {res['title']}")
        print(f"  材料 {n_mat} 则 / {mchars} 字 ｜ 题 {len(res['questions'])} 道 ｜ 分值合计 {score_sum} ｜ 有答案 {with_ref}")
        for q in res['questions']:
            wl = q['wordLimit'] or '-'
            print(f"    {q['no']}. [{q['type']}] {q['score']}分/{wl}字 ｜ 答案 {len(q['reference'])} 字 ｜ {q['stem'][:40]}")
        for w in res['warnings']:
            print(f"    ⚠ {w}")
        with open(os.path.join(OUT_DIR, spec['id'] + '.json'), 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(res, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
