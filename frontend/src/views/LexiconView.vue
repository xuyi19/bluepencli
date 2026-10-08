<template>
  <div class="max-w-4xl mx-auto lex-root">
    <!-- 打印题头（只在打印时出现；必须在最前 —— 打印第一页第一行） -->
    <div class="print-head hidden">
      <h1>蓝笔申论 · 规范词库{{ favOnly ? '（我的收藏）' : '' }}</h1>
      <p class="print-meta">共 {{ totalShown }} 条 · 主题与文章库九大主题对齐 · 背一组规范词，顶刷十篇时评</p>
    </div>

    <!-- 屏幕态页头（打印时隐藏，打印有自己的题头） -->
    <div class="no-print flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 class="text-lg font-semibold text-c-bark">素材本 · 规范词库</h1>
        <p class="text-xs text-c-muted mt-0.5 leading-5">
          阅卷看关键词 —— 同样的意思，大白话不得分，规范表述是得分词。
          共 {{ LEXICON_COUNT }} 条，与文章库 9 大主题对齐。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="printNow"
          class="px-4 py-2 rounded-xl text-xs font-medium neu-sm text-c-bark hover:translate-y-px transition-transform">
          🖨 打印{{ favOnly ? '收藏' : '当前筛选' }}
        </button>
      </div>
    </div>

    <!-- 筛选行：全部/收藏 tab + 主题 chips + 搜索 -->
    <div class="no-print flex flex-wrap items-center gap-2 mb-4">
      <div class="flex rounded-xl neu-inset p-0.5 mr-1">
        <button @click="favOnly = false"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          :class="!favOnly ? 'bg-c-paper text-c-bark shadow-sm' : 'text-c-muted'">
          全部
        </button>
        <button @click="favOnly = true"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          :class="favOnly ? 'bg-c-paper text-c-bark shadow-sm' : 'text-c-muted'">
          我的收藏{{ favCount ? `（${favCount}）` : '' }}
        </button>
      </div>
      <button v-for="t in themes" :key="t.key" @click="toggleTheme(t.key)"
        class="px-2.5 py-1.5 rounded-lg text-xs transition-colors"
        :class="pick.has(t.key) ? 'neu-inset text-c-bark font-medium' : 'text-c-muted hover:text-c-bark'">
        {{ t.name }}<span class="tnum text-c-muted/70 ml-0.5">{{ t.items.length }}</span>
      </button>
      <input v-model="query" placeholder="搜索表述或白话…"
        class="ml-auto px-3 py-1.5 rounded-xl text-xs neu-inset outline-none text-c-body placeholder:text-c-muted w-40" />
    </div>

    <!-- 收藏空态 -->
    <section v-if="favOnly && !favCount" class="rounded-2xl p-8 neu text-center no-print">
      <div class="text-sm text-c-body mb-1.5">还没有收藏</div>
      <div class="text-xs text-c-muted leading-6">
        在词条右侧点亮 ⭐ 收进素材本；打印时选「我的收藏」就是你的随身小册子。
      </div>
    </section>

    <!-- 词条正文（屏幕是卡片流，打印自动切排版） -->
    <div v-else class="lex-body">
      <div v-for="g in groups" :key="g.key" class="lex-theme mb-6">
        <div class="flex items-baseline gap-2 mb-2.5">
          <h2 class="text-sm font-semibold text-c-bark">{{ g.name }}</h2>
          <span class="no-print text-[11px] text-c-muted tnum">{{ g.items.length }} 条</span>
        </div>
        <div class="space-y-2">
          <div v-for="it in g.items" :key="it.id"
            class="lex-item rounded-xl px-4 py-3 neu flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-c-body leading-6">{{ it.formal }}</div>
              <div class="text-xs text-c-muted leading-5 mt-0.5">
                <span class="text-c-muted/70 mr-1">白话</span>{{ it.plain }}
              </div>
            </div>
            <button @click="toggleFav(it.id)" :title="fav.has(it.id) ? '取消收藏' : '收进素材本'"
              class="no-print shrink-0 w-8 h-8 rounded-lg text-base leading-8 text-center transition-colors"
              :class="fav.has(it.id) ? 'text-amber-500' : 'text-c-muted/40 hover:text-c-muted'">
              {{ fav.has(it.id) ? '★' : '☆' }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="!groups.length" class="text-xs text-c-muted text-center py-8 no-print">
        没有匹配的词条 —— 换个词试试
      </div>
    </div>
  </div>
</template>

<script setup>
// M2 素材本 / 规范词库（2026-10-08）。
// 需求来源：作者本人 —— "解决大白话问题，且要能导出打印、排版美观"。
// 设计取舍：
//   · 内容是唯一的新增资产（72 条，按文章库 9 大主题口径）；交互刻意薄 ——
//     素材本的本质是"背"，页面越素越好背；
//   · 打印走 window.print() + @media print 专用排版（A4、衬线、题头、条目防断页），
//     不生成文件 —— 打印对话框里"另存为 PDF"就是导出，一份样式两种产物；
//   · 收藏存 localStorage（bp-fav-lexicon），与"按题"的标注不同，
//     素材收藏是跨题的长期资产。
import { computed, ref, reactive } from 'vue'
import { LEXICON_THEMES, LEXICON_ITEMS, LEXICON_COUNT } from '../data/lexicon'

const themes = LEXICON_THEMES
const favOnly = ref(false)
const query = ref('')
const pick = reactive(new Set())
const fav = reactive(new Set(loadFavs()))

function loadFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem('bp-fav-lexicon') || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
function persistFavs() {
  try {
    localStorage.setItem('bp-fav-lexicon', JSON.stringify([...fav]))
  } catch { /* 存储满：收藏属增强数据，静默可接受 */ }
}
function toggleFav(id) {
  fav.has(id) ? fav.delete(id) : fav.add(id)
  persistFavs()
}
function toggleTheme(key) {
  pick.has(key) ? pick.delete(key) : pick.add(key)
}

const favCount = computed(() => fav.size)

const filtered = computed(() => {
  const q = query.value.trim()
  return LEXICON_ITEMS.filter((it) => {
    if (favOnly.value && !fav.has(it.id)) return false
    if (pick.size && !pick.has(it.themeKey)) return false
    if (q && !it.formal.includes(q) && !it.plain.includes(q) && !it.theme.includes(q)) return false
    return true
  })
})

const groups = computed(() => {
  const list = filtered.value
  return LEXICON_THEMES
    .map((t) => ({ key: t.key, name: t.name, items: list.filter((it) => it.themeKey === t.key) }))
    .filter((g) => g.items.length)
})
const totalShown = computed(() => filtered.value.length)

function printNow() {
  window.print()
}
</script>

<style scoped>
/* ── 打印排版：A4、衬线、题头、条目防断页 ──
   同一份 DOM，打印态换装 —— "另存为 PDF"就是导出，一份样式两种产物。 */
.print-head {
  display: none;
}
</style>

<style>
/* 打印全局样式（不能 scoped：要盖住 App 布局的侧边栏与 main 边距） */
@media print {
  body {
    background: #fff !important;
  }
  aside,
  .no-print {
    display: none !important;
  }
  main {
    margin: 0 !important;
    padding: 0 !important;
    min-height: auto !important;
  }
  /* 题头：打印态才显示 */
  .lex-root .print-head {
    display: block !important;
    margin-bottom: 14pt;
    border-bottom: 2pt solid #333;
    padding-bottom: 8pt;
  }
  .lex-root .print-head h1 {
    font-family: 'Source Han Serif SC', 'Noto Serif SC', SimSun, serif;
    font-size: 18pt;
    font-weight: 700;
    color: #111;
  }
  .lex-root .print-head .print-meta {
    font-size: 9pt;
    color: #555;
    margin-top: 4pt;
  }
  /* 正文：衬线、紧凑、组内条目防断页 */
  .lex-root .lex-body {
    font-family: 'Source Han Serif SC', 'Noto Serif SC', SimSun, serif;
  }
  .lex-root .lex-theme {
    break-inside: avoid-page;
  }
  .lex-root .lex-theme h2 {
    font-size: 13pt;
    color: #111;
    border-left: 4pt solid #333;
    padding-left: 8pt;
    margin-bottom: 8pt;
  }
  .lex-root .lex-item {
    box-shadow: none !important;
    background: none !important;
    border-radius: 0 !important;
    border-bottom: 0.5pt solid #ccc;
    padding: 5pt 0 5pt 0 !important;
    break-inside: avoid;
    display: block !important;
  }
  .lex-root .lex-item > div:first-child {
    display: inline !important;
  }
  .lex-root .lex-item .text-sm {
    font-size: 11pt !important;
    color: #111 !important;
  }
  .lex-root .lex-item .text-xs {
    font-size: 9.5pt !important;
    color: #444 !important;
    margin-top: 1pt !important;
  }
  .lex-root .text-c-muted\/70 {
    color: #888 !important;
  }
  .lex-root .space-y-2 > * + * {
    margin-top: 0 !important;
  }
  .lex-root .mb-6 {
    margin-bottom: 14pt !important;
  }
}
</style>
