<!-- ──────────────────────────────────────────────────────────────
     蓝笔申论 BluePencil · 对标差距面板（M16「写完 ≠ 练完」）
     批改完成后纯代码生成「我的作答 vs 满分答案」的逐点差距：
     逐点对齐（写到/沾边/漏了/答反）→ 冗余分析 → 一句话结论。
     数据层 utils/grading/gap.js，零 LLM 成本、即时渲染；
     无采分点标准（大作文/未导入私有卷）整块不渲染——不假装能对。
     纯展示组件：结果页与复盘页共用（同 ElevationPanel 的复用约定）。
────────────────────────────────────────────────────────────── -->
<script setup>
import { computed } from 'vue'
import { getStandard, standardOrigin } from '../data/standards/index'
import { buildGapReport } from '../utils/grading/gap'

const props = defineProps({
  /** 规范化记录（canonical record）。需要 questionId + answer */
  rec: { type: Object, required: true },
})

const report = computed(() => {
  const std = getStandard(props.rec?.questionId)
  if (!std) return null
  return buildGapReport(std, props.rec?.answer)
})
// 标准来源层：AI 预解析的标准未人工精校，差距判断必须诚实降级
const origin = computed(() => standardOrigin(props.rec?.questionId))

const STATUS_META = {
  hit: { icon: '✓', label: '写到', color: '#4f7d5e', bg: '#eef3ea' },
  partial: { icon: '◐', label: '沾边', color: '#8a6d3b', bg: '#f7efdd' },
  miss: { icon: '✗', label: '漏了', color: '#a05a3c', bg: '#fdf3f0' },
}
const meta = (row) =>
  row.forbidden ? { icon: '⇄', label: '答反', color: '#a05a3c', bg: '#fdf3f0' } : STATUS_META[row.status]

/** 引句截断：太长的命中句只展示前 80 字（数据层引的是完整句） */
const clip = (s, n = 80) => (s && s.length > n ? s.slice(0, n) + '…' : s || '')
</script>

<template>
  <section v-if="report" class="rounded-2xl p-5 neu mb-6">
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <div class="text-xs text-c-muted">对标差距</div>
      <div class="flex gap-1.5 flex-wrap">
        <span class="px-2 py-0.5 rounded-full text-[10px] tnum" style="background: #eef3ea; color: #4f7d5e">
          要点覆盖 {{ report.stats.coverage }}%
        </span>
        <span class="px-2 py-0.5 rounded-full text-[10px] tnum"
          :style="report.stats.redundantRate >= 45 ? 'background:#fdf3f0;color:#a05a3c' : 'background:#f1eee9;color:#8a8578'">
          冗余 {{ report.stats.redundantRate }}%
        </span>
      </div>
    </div>

    <!-- AI 预解析标准：诚实降级，不假装是精校标准 -->
    <div v-if="origin === 'llm'" class="text-[11px] mb-3 rounded-lg px-3 py-2" style="background: #f7efdd; color: #8a6d3b">
      该题标准为 AI 预解析、未人工精校，差距判断仅供参考
    </div>

    <!-- 结论先行：纯代码判定，一到两句 -->
    <div class="rounded-xl p-3.5 mb-4" style="background: #faf6f1">
      <div v-for="(v, i) in report.verdicts" :key="i" class="text-sm text-c-body leading-7">{{ v }}</div>
    </div>

    <!-- 逐点对齐 -->
    <div class="space-y-2.5 mb-3">
      <div v-for="(row, i) in report.rows" :key="row.id" class="rounded-xl p-3.5 neu-inset">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="w-5 h-5 rounded-full grid place-items-center text-[11px] shrink-0"
            :style="{ background: meta(row).bg, color: meta(row).color }">{{ meta(row).icon }}</span>
          <span class="text-xs font-medium text-c-body">{{ row.label }}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px]"
            :style="{ background: meta(row).bg, color: meta(row).color }">{{ meta(row).label }}</span>
          <span class="text-[10px] text-c-muted tnum ml-auto">{{ row.weight }} 分</span>
        </div>

        <!-- 写到：引用户原句 -->
        <div v-if="row.myQuote && !row.forbidden" class="mt-2 rounded-lg p-2.5 text-xs leading-6"
          style="background: #f6f4ef; color: #6b665c">
          <span class="text-[10px] text-c-muted">你写的：</span>{{ clip(row.myQuote) }}
          <span v-if="row.via === 'synonym'" class="text-[10px] text-c-muted">（换了说法，算命中）</span>
        </div>

        <!-- 漏了：给标准表述 + 材料依据，指明去哪找 -->
        <div v-if="row.status === 'miss' && !row.forbidden" class="mt-2 rounded-lg p-2.5 text-xs leading-6"
          style="background: #fdf3f0; color: #8c4a35">
          <div><span class="text-[10px] text-c-muted">标准要点：</span>{{ row.standardHint }}</div>
          <div v-if="row.evidenceHint" class="mt-0.5">
            <span class="text-[10px] text-c-muted">材料依据：</span>{{ clip(row.evidenceHint, 60) }}
          </div>
        </div>

        <!-- 答反：单独说清，这是最伤分的一类 -->
        <div v-if="row.forbidden" class="mt-2 rounded-lg p-2.5 text-xs leading-6"
          style="background: #fdf3f0; color: #8c4a35">
          你写了方向相反的内容（{{ clip(row.myQuote || row.standardHint, 60) }}）——
          这一类不是「少得分」，是「不得分」，先把方向纠正过来。
        </div>
      </div>
    </div>

    <!-- 冗余分析：提醒不是裁决，公文格式语会误入 -->
    <details v-if="report.redundancy.sentences.length">
      <summary class="text-[11px] text-c-muted cursor-pointer hover:text-c-bark">
        疑似冗余 {{ report.redundancy.redundant }} 句（约 {{ report.stats.redundantRate }}% 篇幅，仅供参考）
      </summary>
      <ul class="mt-2 space-y-1.5">
        <li v-for="(s, i) in report.redundancy.sentences" :key="i"
          class="text-[11px] leading-5 text-c-muted rounded-lg px-2.5 py-1.5" style="background: #f6f4ef">
          {{ clip(s, 70) }}
        </li>
      </ul>
      <div class="text-[10px] text-c-muted mt-1.5">判据是「与任何采分点都不沾边」——称谓、落款等格式语被算进来可忽略。</div>
    </details>
  </section>
</template>
