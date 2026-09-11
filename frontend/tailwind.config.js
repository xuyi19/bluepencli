/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        serif: ['Georgia', 'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'serif'],
      },
      colors: {
        /* ── Natural Organic 语义 token ──
         * 用 c- 前缀避免与 Tailwind 内置名（stone/amber）冲突。
         * 新代码一律用这些名字；不要再用十六进制字面量。 */
        c: {
          cream: '#faf6f1',        // 页面底：暖米
          paper: '#fffdfb',        // 纸面：比底色更白一档，用于输入/方格纸
          bark: '#5c4033',         // 主色：胡桃棕（原 #6d5dfc 紫）
          barkDeep: '#493329',     // 主色按下
          barkSoft: '#f2ebe2',     // 主色极浅底（选中态）
          sage: '#8b9d77',         // 鼠尾草绿：成功 / 建议
          sageSoft: '#dce2cf',     // 鼠尾草极浅
          tan: '#d4a373',          // 暖褐：次强调
          clay: '#b4552d',         // 陶土：警示 / 超限
          ink: '#1c1917',          // 标题黑（不是纯黑）
          body: '#44403c',         // 正文
          muted: '#78716c',        // 次要文字 / 占位
          line: '#e7e5e4',         // 极浅描边
          lineDeep: '#d6d3d1',     // 常态描边
        },
        /* ── 兼容旧名（原新拟态遗留）。一律指向新值，以防还有遗漏引用 ── */
        soft: '#faf6f1',
        softLight: '#fffdfb',
        shadowDark: '#d6d3d1',
        shadowLight: '#ffffff',
        accent: '#5c4033',
      },
      borderRadius: {
        organic: '1.5rem',   // 24px 卡片
        soft: '1rem',        // 16px 输入
      },
      transitionDuration: {
        organic: '500ms',
      },
    },
  },
  plugins: [],
}
