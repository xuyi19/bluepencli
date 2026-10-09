// ──────────────────────────────────────────────────────────────
// 导出排版选项（2026-10-09 用户要求：让用户自己排版、选字体、多种选择）
//
// 选项存 localStorage `bp-export-style`，Word / PDF / 预览三处共用：
//   font    — 中文字体。Word 直接用字体名（宋体/仿宋/楷体 Windows 全有）；
//             PDF 只嵌了思源宋体一套，字体选项对 PDF 不生效（UI 里注明）。
//   size    — 'small' = 9pt 小五（省纸），'normal' = 10.5pt 五号（老人打印友好）
//   spacing — 行距档位：紧凑/标准/宽松
//   color   — 'bw' 黑白（省墨，荧光转下划线）| 'color' 彩色（屏幕阅读，荧光是底色）
//
// 尺寸全用「半点」（half-point，docx 的单位）：BODY 18 = 9pt。
// ──────────────────────────────────────────────────────────────

export const STYLE_KEY = 'bp-export-style'

export const DEFAULT_STYLE = { font: 'song', size: 'small', spacing: 'normal', color: 'bw' }

export const FONT_OPTIONS = [
  { value: 'song', label: '宋体', css: "'SimSun','宋体',serif", docx: '宋体' },
  { value: 'fang', label: '仿宋', css: "'FangSong','仿宋','STFangsong',serif", docx: '仿宋' },
  { value: 'kai', label: '楷体', css: "'KaiTi','楷体','STKaiti',serif", docx: '楷体' },
]

export const SIZE_OPTIONS = [
  { value: 'small', label: '小五（9pt · 省纸）' },
  { value: 'normal', label: '五号（10.5pt · 更醒目）' },
]

export const SPACING_OPTIONS = [
  { value: 'tight', label: '紧凑' },
  { value: 'normal', label: '标准' },
  { value: 'loose', label: '宽松' },
]

// 行距档位：docx 的 line（240=单倍）与 PDF 的 lineHeight（倍数）
const SPACING_TABLE = {
  tight: { line: 240, pdf: 1.25 },
  normal: { line: 260, pdf: 1.35 },
  loose: { line: 310, pdf: 1.55 },
}

// 五号比小五整体大 1.5pt（半点 +3），标题层级跟着走不拍平
const SIZE_DELTA = { small: 0, normal: 3 }

export function loadExportStyle() {
  try {
    const raw = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STYLE }
    return {
      font: FONT_OPTIONS.some((f) => f.value === raw.font) ? raw.font : DEFAULT_STYLE.font,
      size: SIZE_OPTIONS.some((s) => s.value === raw.size) ? raw.size : DEFAULT_STYLE.size,
      spacing: SPACING_TABLE[raw.spacing] ? raw.spacing : DEFAULT_STYLE.spacing,
      color: raw.color === 'color' || raw.color === 'bw' ? raw.color : DEFAULT_STYLE.color,
    }
  } catch {
    return { ...DEFAULT_STYLE }
  }
}

export function saveExportStyle(style) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style))
  } catch { /* 隐私模式等存不进就算了，本次会话内仍可用 */ }
}

/** 渲染器用的解析结果：字体对象、行距、字号增量、是否彩色 */
export function resolveStyle(style) {
  const s = { ...DEFAULT_STYLE, ...(style || {}) }
  return {
    font: FONT_OPTIONS.find((f) => f.value === s.font) || FONT_OPTIONS[0],
    line: SPACING_TABLE[s.spacing]?.line ?? 260,
    pdfLine: SPACING_TABLE[s.spacing]?.pdf ?? 1.35,
    sizeDelta: SIZE_DELTA[s.size] ?? 0,
    colorMode: s.color === 'color',
  }
}
