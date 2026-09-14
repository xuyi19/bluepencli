// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 硬规则引擎（五层评分架构 · 第③层「校验层」）
//
// 为什么不把字数、格式、重复这些交给大模型：
//   它们是**可复算的客观事实**，让 LLM 去"感觉"只会引入随机性——
//   同一篇答案两次批改，字数结论都不一样，这会让整套批改显得不可信。
//   所以这一层用纯代码算：输入原文，输出 findings，任何一条都能被人工复核。
//
// 本模块**零依赖、无副作用**，可被 Node 直接 import 做单测（见 .tools/test-rules.mjs）。
//
// 边界说明（重要）：
//   · 客观扣分有封顶（默认 maxScore 的 20%），且与"采分点缺失"可能重叠，
//     因此默认只作为**证据**交给合议层，不直接改写 AI 给出的分数。
//   · 判据保守：宁可漏报（false negative），不要误报（false positive）——
//     误报会冤枉考生，比漏报伤害大。

export const RULES_VERSION = '1.0'

/** 严重度权重（用于排序与聚合） */
const LEVEL_WEIGHT = { fatal: 3, major: 2, minor: 1 }

const CN = '\u4e00-\u9fa5'
const RE_CN_CHAR = new RegExp(`[${CN}]`)
/** 合法成对出现的标点，不参与"连续标点"判定 */
const LEGAL_REPEAT = new Set(['…', '—', '·'])
/** 中文句末/句中停顿标点 */
const CN_PUNCT = '，。；：、！？'

// ─────────────────────────── 基础统计 ───────────────────────────

/**
 * 申论口径的字数：去掉所有空白后的字符数。
 * 汉字、标点、数字、字母都计入——这与考场按格计数最接近。
 */
export function countChars(text) {
  return [...String(text ?? '').replace(/\s+/g, '')].length
}

/**
 * 方格纸口径的字数：汉字/全角算 1 格，半角算 0.5 格，向上取整。
 * 仅作参考统计（答题卡上数字、字母常两两占一格）。
 */
export function countGrid(text) {
  let n = 0
  for (const ch of String(text ?? '')) {
    if (/\s/.test(ch)) continue
    n += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.5
  }
  return Math.ceil(n)
}

/** 按句末标点与换行切句（保留标点） */
function splitSentences(text) {
  return String(text ?? '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？；])/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 有效段落：去掉空行后剩下的 */
function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getStats(answer, wordLimit = 0) {
  const text = String(answer ?? '')
  const paragraphs = splitParagraphs(text)
  const sentences = splitSentences(text)
  const chars = countChars(text)
  return {
    chars,
    grid: countGrid(text),
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    avgSentenceLen: sentences.length ? Math.round(chars / sentences.length) : 0,
    wordLimit: wordLimit || 0,
    overRatio: wordLimit ? +((chars - wordLimit) / wordLimit).toFixed(4) : 0,
  }
}

// ─────────────────────────── 规则 1：字数 ───────────────────────────

export function checkWordCount(answer, wordLimit) {
  const findings = []
  const n = countChars(answer)
  if (!wordLimit || n === 0) return findings

  const diff = n - wordLimit
  const ratio = diff / wordLimit

  if (diff > 0) {
    let level = 'minor'
    let deduction = 0
    let detail = `实际 ${n} 字，超出要求 ${diff} 字（${(ratio * 100).toFixed(1)}%）。`
    if (ratio > 0.1) {
      level = 'fatal'
      deduction = 2
      detail += '超出过多，超出部分在真实阅卷中可能不被读取，形同白写。'
    } else if (ratio > 0.03) {
      level = 'major'
      deduction = 1
      detail += '超出幅度已可能触发扣分。'
    } else {
      detail += '轻微超出，通常不扣分。'
    }
    findings.push({
      id: 'word-over',
      category: '字数',
      level,
      deduction,
      title: '超出字数要求',
      detail,
      evidence: [],
      suggest: '删掉重复表述与可有可无的形容词，保留采分点；宁可少写不要超格。',
    })
  } else if (diff < 0) {
    const short = -diff
    const shortRatio = short / wordLimit
    let level = 'minor'
    let deduction = 0
    if (shortRatio > 0.3) {
      level = 'fatal'
      deduction = 3
    } else if (shortRatio > 0.15) {
      level = 'major'
      deduction = 2
    } else if (shortRatio > 0.05) {
      level = 'major'
      deduction = 1
    }
    findings.push({
      id: 'word-under',
      category: '字数',
      level,
      deduction,
      title: '字数明显不足',
      detail: `实际 ${n} 字，比要求少 ${short} 字（${(shortRatio * 100).toFixed(1)}%）。字数不足通常意味着采分点没写全。`,
      evidence: [],
      suggest: '对照材料逐条补全遗漏要点，不要用空话凑字数。',
      // 提示合议层：不要与「采分点缺失」重复扣分
      overlapWith: '采分点缺失',
    })
  } else {
    findings.push({
      id: 'word-fit',
      category: '字数',
      level: 'minor',
      deduction: 0,
      title: '字数刚好达标',
      detail: `实际 ${n} 字，与要求一致。`,
      evidence: [],
      suggest: '',
    })
  }
  return findings
}

// ─────────────────────────── 规则 2：标点与格式 ───────────────────────────

export function checkPunctuation(answer) {
  const text = String(answer ?? '')
  const findings = []
  if (!text.trim()) return findings

  // 2.1 中文语境里混用半角标点（前后紧邻汉字才算，避开 "3.2%" 这类误伤）
  const halfMix = []
  const reHalf = new RegExp(`([${CN}])[,;:!?]|[,;:!?]([${CN}])`, 'g')
  let m
  while ((m = reHalf.exec(text))) {
    halfMix.push(m[0])
    if (halfMix.length >= 5) break
  }
  if (halfMix.length) {
    findings.push({
      id: 'punct-halfwidth',
      category: '格式',
      level: halfMix.length >= 3 ? 'major' : 'minor',
      deduction: halfMix.length >= 3 ? 1 : 0,
      title: '中文中混用半角标点',
      detail: `发现 ${halfMix.length} 处半角标点夹在汉字之间：${halfMix.join('、')}`,
      evidence: halfMix,
      suggest: '中文句子一律用全角标点（，。；：？！），半角只用于数字与英文。',
    })
  }

  // 2.2 连续重复标点（排除合法的省略号/破折号）
  const rep = []
  for (let i = 1; i < text.length; i++) {
    const a = text[i - 1]
    const b = text[i]
    if (a === b && CN_PUNCT.includes(a) && !LEGAL_REPEAT.has(a)) {
      rep.push(a + b)
    }
  }
  if (rep.length) {
    const uniq = [...new Set(rep)]
    findings.push({
      id: 'punct-repeat',
      category: '格式',
      level: 'minor',
      deduction: rep.length >= 3 ? 1 : 0,
      title: '连续标点',
      detail: `出现 ${rep.length} 处重复标点：${uniq.join('、')}`,
      evidence: uniq,
      suggest: '一个停顿只用一个标点，重复标点属于笔误。',
    })
  }

  // 2.3 末尾无标点
  const last = text.trim().slice(-1)
  if (last && RE_CN_CHAR.test(last)) {
    findings.push({
      id: 'punct-tail',
      category: '格式',
      level: 'minor',
      deduction: 0,
      title: '结尾缺标点',
      detail: `答案以「${last}」结尾，没有句末标点。`,
      evidence: [text.trim().slice(-12)],
      suggest: '结尾补上句号。',
    })
  }

  return findings
}

// ─────────────────────────── 规则 3：结构 ───────────────────────────

/** 需要"分条作答"的题型：题干通常写明"有条理""分条表述""条理清楚" */
const NEEDS_ITEMS = ['归纳概括', '提出对策', '综合分析']
const RE_ITEMS = /(一是|二是|三是|四是|五是|六是|首先|其次|再次|最后|第一|第二|第三|第四|其一|其二|其[三四]|[1-9][.、)）]|[①②③④⑤⑥⑦⑧⑨]|[一二三四五六七八九]、)/

export function checkStructure(answer, { type = '', requirement = '', wordLimit = 0 } = {}) {
  const text = String(answer ?? '')
  const findings = []
  if (!text.trim()) return findings

  const paragraphs = splitParagraphs(text)
  const chars = countChars(text)

  // 3.1 未分段
  if (paragraphs.length <= 1 && chars > 150) {
    findings.push({
      id: 'struct-nopara',
      category: '结构',
      level: 'major',
      deduction: 1,
      title: '通篇未分段',
      detail: `${chars} 字的答案只有 1 段，阅卷时难以捕捉层次，直接影响"条理"评分项。`,
      evidence: [],
      suggest: '按要点分段，一段讲一个层面。',
    })
  }

  // 3.2 该分条却没分条
  const needItems = NEEDS_ITEMS.includes(type) || /有条理|分条|条理|分别|逐条/.test(requirement)
  if (needItems && chars > 100 && !RE_ITEMS.test(text)) {
    findings.push({
      id: 'struct-noitems',
      category: '结构',
      level: 'major',
      deduction: 1,
      title: '该分条却没有序号',
      detail: '题干要求"有条理/分条"，但答案没有任何序号标记（一是／首先／1. 等）。',
      evidence: [],
      suggest: '用「一是……二是……」或「1. 2. 3.」分条，一条一个采分点。',
    })
  }

  // 3.3 首行缩进（软提示，不扣分）
  if (paragraphs.length >= 2) {
    const noIndent = paragraphs.filter((p) => !/^[\u3000 ]/.test(p)).length
    if (noIndent > paragraphs.length / 2) {
      findings.push({
        id: 'struct-indent',
        category: '结构',
        level: 'minor',
        deduction: 0,
        title: '段落未首行缩进',
        detail: `${paragraphs.length} 段中有 ${noIndent} 段没有首行缩进两格。`,
        evidence: [],
        suggest: '每段开头空两格（全角空格），与考场书写一致。',
      })
    }
  }

  return findings
}

// ─────────────────────────── 规则 4：重复与照抄 ───────────────────────────

/** 找出文本中重复出现（≥ minCount 次）的最长短语 */
function repeatedPhrases(text, { minLen = 6, maxLen = 14, minCount = 3, limit = 3 } = {}) {
  const s = String(text ?? '').replace(/\s+/g, '')
  const hits = new Map() // phrase -> count
  for (let len = maxLen; len >= minLen; len--) {
    for (let i = 0; i + len <= s.length; i++) {
      const g = s.slice(i, i + len)
      hits.set(g, (hits.get(g) || 0) + 1)
    }
  }
  const kept = []
  for (const [phrase, count] of [...hits.entries()].sort((a, b) => b[0].length - a[0].length)) {
    if (count < minCount) continue
    // 已被更长的重复短语包含则跳过（取最长）
    if (kept.some((k) => k.phrase.includes(phrase))) continue
    kept.push({ phrase, count })
    if (kept.length >= limit) break
  }
  return kept
}

/** 找 answer 中与 ref 连续重合 ≥ minLen 的片段（用于判定照抄材料/题干） */
function copyRuns(answer, ref, minLen = 15) {
  const a = String(answer ?? '').replace(/\s+/g, '')
  const r = String(ref ?? '').replace(/\s+/g, '')
  if (!a || !r || r.length < minLen) return []
  const grams = new Set()
  for (let i = 0; i + minLen <= r.length; i++) grams.add(r.slice(i, i + minLen))

  const runs = []
  let start = -1
  for (let i = 0; i + minLen <= a.length; i++) {
    const hit = grams.has(a.slice(i, i + minLen))
    if (hit && start < 0) start = i
    if (!hit && start >= 0) {
      const len = i - start + minLen - 1
      if (len >= minLen) runs.push(a.slice(start, start + len))
      start = -1
    }
  }
  if (start >= 0) {
    const len = a.length - start
    if (len >= minLen) runs.push(a.slice(start))
  }
  return runs.sort((x, y) => y.length - x.length).slice(0, 3)
}

export function checkRepetition(answer, { material = '', requirement = '' } = {}) {
  const findings = []
  const text = String(answer ?? '')
  if (!text.trim()) return findings

  // 4.1 整句重复
  const sents = splitSentences(text).filter((s) => countChars(s) >= 10)
  const seen = new Map()
  for (const s of sents) {
    const key = s.replace(/[，。；：、！？\s]/g, '')
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  const dupSent = [...seen.entries()].filter(([, c]) => c >= 2)
  if (dupSent.length) {
    findings.push({
      id: 'dup-sentence',
      category: '重复',
      level: 'major',
      deduction: 1,
      title: '整句重复',
      detail: `有 ${dupSent.length} 句在答案里重复出现，属于明显凑字数。`,
      evidence: dupSent.slice(0, 2).map(([k]) => k.slice(0, 20)),
      suggest: '重复的句子合并成一句，省下的格子用来补漏掉的采分点。',
    })
  }

  // 4.2 高频口头禅式短语
  const phrases = repeatedPhrases(text)
  if (phrases.length) {
    findings.push({
      id: 'dup-phrase',
      category: '重复',
      level: 'minor',
      deduction: 0,
      title: '短语高频重复',
      detail: phrases.map((p) => `「${p.phrase}」出现 ${p.count} 次`).join('；'),
      evidence: phrases.map((p) => p.phrase),
      suggest: '换成同义表达，或用代词承接，避免读起来重复。',
    })
  }

  // 4.3 大段照抄给定资料
  const fromMaterial = copyRuns(text, material, 15)
  if (fromMaterial.length) {
    findings.push({
      id: 'copy-material',
      category: '重复',
      level: 'fatal',
      deduction: 2,
      title: '大段照抄给定资料',
      detail: `有 ${fromMaterial.length} 处连续 ${fromMaterial[0].length} 字以上与材料原文重合。申论阅卷对整段照抄基本不给分。`,
      evidence: fromMaterial.map((r) => r.slice(0, 24) + (r.length > 24 ? '…' : '')),
      suggest: '材料原文要转化为自己的概括，做法是"提取关键词 + 重组句式"，而不是搬运原句。',
    })
  }

  // 4.4 照抄题干/要求（较轻）
  const fromReq = copyRuns(text, requirement, 12)
  if (fromReq.length) {
    findings.push({
      id: 'copy-requirement',
      category: '重复',
      level: 'minor',
      deduction: 0,
      title: '抄写题干表述',
      detail: '答案中出现了与作答要求高度重合的句子（通常是开头复述了一遍题干）。',
      evidence: fromReq.map((r) => r.slice(0, 24) + (r.length > 24 ? '…' : '')),
      suggest: '开头直接进入要点，不要复述题干。',
    })
  }

  return findings
}

// ─────────────────────────── 聚合 ───────────────────────────

/** 客观扣分封顶比例：最多扣满分的 20%，避免规则层一票否决 AI 的判断 */
export const DEDUCTION_CAP_RATIO = 0.2

/**
 * 跑全部硬规则。
 * @returns {{version, stats, findings, rawDeduction, cap, objectiveDeduction, capped}}
 */
export function runHardRules({
  answer = '',
  material = '',
  requirement = '',
  wordLimit = 0,
  maxScore = 0,
  type = '',
} = {}) {
  const text = String(answer ?? '')
  const findings = []

  if (!text.trim()) {
    findings.push({
      id: 'empty',
      category: '结构',
      level: 'fatal',
      deduction: maxScore || 0,
      title: '未作答',
      detail: '作答区为空。',
      evidence: [],
      suggest: '先写，再改；一个字不写不可能得分。',
    })
  } else {
    findings.push(...checkWordCount(text, wordLimit))
    findings.push(...checkPunctuation(text))
    findings.push(...checkStructure(text, { type, requirement, wordLimit }))
    findings.push(...checkRepetition(text, { material, requirement }))
  }

  findings.sort(
    (a, b) => (LEVEL_WEIGHT[b.level] || 0) - (LEVEL_WEIGHT[a.level] || 0) || b.deduction - a.deduction
  )

  const rawDeduction = findings.reduce((s, f) => s + (f.deduction || 0), 0)
  const cap = maxScore ? Math.max(1, Math.round(maxScore * DEDUCTION_CAP_RATIO)) : 4
  const objectiveDeduction = Math.min(rawDeduction, cap)

  return {
    version: RULES_VERSION,
    stats: getStats(text, wordLimit),
    findings,
    rawDeduction,
    cap,
    objectiveDeduction,
    capped: rawDeduction > cap,
  }
}

/** 把硬规则结果压成一段可注入提示词的客观事实（给合议层看） */
export function formatRulesForPrompt(rules) {
  if (!rules || !rules.findings?.length) return ''
  const items = rules.findings.map(
    (f) =>
      `- [${f.category}·${f.level}] ${f.title}：${f.detail}${f.evidence?.length ? `（证据：${f.evidence.join('｜')}）` : ''}`
  )
  const s = rules.stats
  return `【客观校验结果（由程序计算，非模型判断，可直接采信）】
字数：${s.chars}${s.wordLimit ? ` / 要求 ${s.wordLimit}` : ''}；段落 ${s.paragraphs}；句子 ${s.sentences}
${items.join('\n')}
合计客观扣分 ${rules.rawDeduction} 分${rules.capped ? `（已封顶为 ${rules.objectiveDeduction} 分）` : ''}。
注意：字数不足与"采分点缺失"可能指向同一问题，合议时请勿重复扣分。`
}
