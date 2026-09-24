<!-- ──────────────────────────────────────────────────────────────
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
  ──────────────────────────────────────────────────────────────
  复盘卡：把一份批改压成「下次动笔前先改这三处」。

  放在分数下面第一个位置是有意的 —— 考生看完分数最想知道的就是"那我改哪儿"，
  而不是往下翻三位老师的逐条意见（几十条，看完就忘了）。
  排序规则在 utils/grading/reviewCard.js 里，这里只负责说清楚"为什么它排第一"。
-->
<template>
  <section v-if="card" class="rounded-2xl p-5 neu mb-6">
    <div class="flex items-center gap-2 flex-wrap mb-1">
      <span class="text-sm font-medium text-c-body">复盘卡</span>
      <span class="text-xs text-c-muted">
        {{ card.ok ? `下次动笔前先改这 ${card.topFixes.length} 处` : '这次没批出可归类的具体问题' }}
      </span>
    </div>

    <!-- 口径说明：多人模式才谈得上"共识"。单人模式必须如实说，不能拿"老师都提到"唬人 -->
    <div class="text-[11px] text-c-muted leading-5 mb-4">
      <template v-if="card.stats.consensusMeaningful">
        排序按「几位老师<strong class="font-medium">各自独立</strong>提到」优先 ——
        多位都说到的是硬伤，只有一位说到可能只是他的侧重点；共识相同时看扣分多少。
      </template>
      <template v-else-if="card.stats.teacherCount === 1">
        这次只有 1 位老师批改，排序按扣分高低。想要"哪些是共识"的看法，
        换多人或圆桌模式再批一次。
      </template>
    </div>

    <!-- 做得好：复盘卡的另一半。只列老师**明确写出来**的肯定——
         空数组时如实说"没有单独肯定"，不拿"没被批评"当"做得好"。 -->
    <div v-if="card.strengths && card.strengths.length" class="rounded-xl p-3.5 mb-4"
      style="background: #eef3e8">
      <div class="text-[11px] mb-2" style="color: #4f7d5e">
        ✓ 这次做得好的 {{ card.strengths.length }} 处（老师明确肯定的）
      </div>
      <div class="space-y-1.5">
        <div v-for="(s, i) in card.strengths" :key="i" class="text-xs leading-5" style="color: #3f6349">
          <span class="font-medium">{{ s.text }}</span>
          <span v-if="s.why" class="opacity-80"> —— {{ s.why }}</span>
          <span v-if="s.consensus" class="ml-1 text-[10px] px-1.5 py-0.5 rounded align-middle"
            style="background: #dfe9d5; color: #4f7d5e">多位老师都提到</span>
        </div>
      </div>
    </div>
    <div v-else-if="card.strengths" class="text-[11px] text-c-muted leading-5 mb-4">
      这次批改没有单独肯定的亮点 —— 老师没写，代表没有突出到需要单独点出，不代表写得差。
    </div>

    <div v-if="!card.ok" class="text-xs text-c-muted">{{ card.reason }}</div>

    <div v-else class="space-y-3">
      <div v-for="f in card.topFixes" :key="f.categoryId" class="rounded-xl p-4 neu-inset">
        <div class="flex items-start gap-2.5 flex-wrap">
          <span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 mt-0.5"
            :style="rankStyle(f.rank)">{{ f.rank }}</span>
          <span class="text-sm font-medium text-c-ink">{{ f.label }}</span>
          <span v-if="f.consensus"
            class="text-[11px] px-1.5 py-0.5 rounded shrink-0"
            style="background: #dce2cf; color: #4f7d5e">
            {{ f.teacherCount }} 位老师都提到
          </span>
          <span v-else-if="!card.stats.consensusMeaningful && f.teacherCount === 1"
            class="text-[11px] px-1.5 py-0.5 rounded shrink-0 neu-inset text-c-muted">
            1 位老师提到
          </span>
          <span v-if="f.scoreLost > 0" class="text-[11px] text-c-muted ml-auto shrink-0 tnum">
            共扣 {{ f.scoreLost }} 分
          </span>
        </div>

        <div class="text-[11px] text-c-muted mt-1.5 leading-5">{{ f.desc }}</div>

        <!-- 原文：让考生一眼认出说的是哪句 -->
        <div v-if="f.quotes.length" class="mt-2.5 space-y-1">
          <div v-for="(q, i) in f.quotes" :key="i" class="text-xs text-c-body leading-6">
            <span class="text-c-muted">「{{ truncate(q.text, 36) }}」</span>
            <span class="text-[11px] text-c-muted">— {{ teacherName(q.teacher) }}</span>
          </div>
        </div>

        <!-- 改法：能直接照做的那种 -->
        <div v-if="f.fixes.length" class="mt-2.5 pt-2.5 border-t border-c-line space-y-1">
          <div v-for="(x, i) in f.fixes" :key="i" class="text-xs leading-6" style="color: #4f7d5e">
            改：{{ stripPrefix(x.text) }}
          </div>
        </div>

        <div v-if="f.detailTypes.length" class="text-[11px] text-c-muted mt-2 leading-5">
          老师原话：{{ f.detailTypes.slice(0, 4).join(' / ') }}
        </div>
      </div>

      <!-- 动笔前自检：复盘卡真正的用法是下次写之前拿出来看一眼 -->
      <div v-if="card.checklist.length" class="rounded-xl p-4" style="background: #f7eddc">
        <div class="text-xs font-medium mb-2" style="color: #9c6b2f">
          下次动笔前，先按这 {{ card.checklist.length }} 条自检
        </div>
        <ol class="text-xs leading-6 space-y-1.5" style="color: #9c6b2f">
          <li v-for="(c, i) in card.checklist" :key="c.categoryId" class="flex gap-2">
            <span class="shrink-0 tnum">{{ i + 1 }}.</span>
            <span>{{ c.hint }}</span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { buildReviewCard } from '../utils/grading/reviewCard'
import { TEACHERS } from '../agents/teachers'

const props = defineProps({
  /** 批改记录（含 results 即可）：PracticeView 传 report，记录页传整条记录 */
  record: { type: Object, default: null },
  topN: { type: Number, default: 3 },
})

const card = computed(() => (props.record ? buildReviewCard(props.record, { topN: props.topN }) : null))

// 老师显示名：与批改结果页同一套来源（agents/teachers.js）
const teacherName = (id) => TEACHERS[id]?.name || id || '老师'

function rankStyle(rank) {
  // 第一名给强调色，其余保持克制 —— 三点都标红等于三点都不重要
  // （与结果页其它提示块用同一组色：sageSoft 底 + sage 深字）
  if (rank === 1) return { background: '#dce2cf', color: '#4f7d5e' }
  return { background: 'rgba(120, 113, 108, 0.08)', color: '#78716c' }
}

function truncate(s, n) {
  const t = String(s || '')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// 模型给的 fix 常常自带"改成：""应改为："这类前缀，模板里还会再加一个"改："，
// 直接拼出来就是"改：改成：…"。这里把重复的前缀削掉。
function stripPrefix(s) {
  return String(s || '').replace(/^\s*(改成|改为|应改为|应当改为|建议改为|可改为|建议)\s*[:：]?\s*/, '')
}
</script>
