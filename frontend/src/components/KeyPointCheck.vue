<!-- ──────────────────────────────────────────────────────────────
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
  ──────────────────────────────────────────────────────────────
  采分点核对

  为什么单独抽成组件：
    练习页（批改完当场看）与记录页（过几天回看）都要这块，两边如果各写一遍，
    迟早一处改了另一处没改 —— 而采分点是**考生判断"分扣在哪"的唯一明细**，
    两处不一致等于同一个分数给出两种说法。所以共用一份，只靠 props 区分。

  数据从哪来（重要，改之前先读）：
    传入的 keyPoints 必须是 **mergeKeyPoints() 归并之后**的那份。
    直接把各老师的 keyPoints 拼起来是不行的 —— 多老师模式下同一个点会出现 N 次，
    「命中 X / Y 项」必然是假数字（详见 utils/grading/keyPoints.js 顶部说明）。
    好在记录里存的就是归并后的（orchestrator 在 finish() 里算完存档），
    记录页因此**不依赖 standard** 也能展示 —— standard 是批改时注入的、没存档。

  两条不能破的展示规矩：
    ① 没有 keyPoints 就整块不渲染。老记录没有这个字段，
       硬凑一个空壳比不显示更糟（会让人以为"这题没有采分点"）。
    ② 分值必须带上口径。老师判断的分与程序粗判的覆盖率是两回事，
       混在一起说等于给分数编了个来历。
-->
<template>
  <section v-if="points.length" class="rounded-2xl p-5 neu mb-6">
    <div class="flex items-center justify-between gap-3 mb-1 flex-wrap">
      <span class="text-sm font-medium text-c-body">采分点核对</span>
      <span class="text-xs text-c-muted tnum">
        命中 {{ summary.hit }} / {{ summary.total }} 项<span v-if="summary.partial">，部分 {{ summary.partial }}</span>
        <template v-if="summary.weightSum"> · 合计 {{ summary.earnedSum }} / {{ summary.weightSum }} 分</template>
      </span>
    </div>

    <div class="text-[11px] text-c-muted leading-5 mb-4">
      这是老师逐点判定的结果（同一点由多位老师判时取<strong class="font-medium">最乐观</strong>的一次）。
      分值仅供参考，最终分数以合议结论为准。
    </div>

    <!-- 覆盖率条：命中按 1、部分按 0.5 折算，与 summarizeKeyPoints 的 earnedSum 同一算法 -->
    <div v-if="summary.weightSum" class="h-1.5 rounded-full mb-4" style="background: #eae2d8">
      <div class="h-1.5 rounded-full" style="background: #8b9d77"
        :style="{ width: coveragePct + '%' }"></div>
    </div>

    <div class="space-y-2.5">
      <div v-for="(p, i) in points" :key="i" class="flex gap-2.5 items-start">
        <span class="text-[11px] mt-0.5 px-1.5 py-0.5 rounded shrink-0" :style="statusStyle(p.status)">
          {{ statusMark(p.status) }} {{ statusLabel(p.status) }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-xs leading-6" :class="p.extra ? 'text-c-muted' : 'text-c-body'">
            {{ p.point }}
            <span v-if="p.extra" class="text-[11px] text-c-muted">（标准之外的补充点）</span>
          </div>
          <div v-if="p.note" class="text-[11px] text-c-muted mt-0.5 leading-5">{{ p.note }}</div>
          <div v-if="p.sources?.length" class="text-[11px] text-c-muted mt-0.5 leading-5">
            {{ p.sources.join('、') }}
          </div>
        </div>
        <span v-if="p.weight && !p.extra" class="text-xs tnum shrink-0 text-c-muted">
          {{ p.earned }} / {{ p.weight }}
        </span>
      </div>
    </div>

    <!-- 程序粗判对照：只在传了 standard 时显示。
         记录页拿不到 standard（没存档），所以那里只有上面的老师判定 —— 这是对的，
         与其拿不到就编一个，不如只给有依据的那部分。 -->
    <div v-if="standard?.rows?.length" class="rounded-xl p-3.5 neu-inset mt-4">
      <div class="text-[11px] font-medium text-c-body mb-1.5">
        程序粗判覆盖率 {{ standard.coverage }}%
        <span class="text-c-muted font-normal">
          （{{ standard.earned }} / {{ standard.total }} 分）
        </span>
      </div>
      <div class="text-[11px] text-c-muted leading-5">
        口径：纯代码按关键词与材料原文匹配，与老师的判断互不干涉，只作参照。
      </div>
    </div>

    <div v-if="summary.extra" class="text-[11px] text-c-muted mt-2.5 leading-5">
      另有 {{ summary.extra }} 条标准之外的补充点，不计入上表分值。
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { POINT_STATUS } from '../agents/grading/standard'
import { summarizeKeyPoints } from '../utils/grading/keyPoints'

const props = defineProps({
  /** mergeKeyPoints() 归并后的采分点；空数组则整块不渲染 */
  keyPoints: { type: Array, default: () => [] },
  /** 程序粗判结果（{coverage, earned, total, rows}）；只有批改当场才有，记录页传 null */
  standard: { type: Object, default: null },
})

const points = computed(() => (Array.isArray(props.keyPoints) ? props.keyPoints : []))
const summary = computed(() => summarizeKeyPoints(points.value))

const coveragePct = computed(() => {
  const s = summary.value
  return s.weightSum ? Math.min(100, Math.round((s.earnedSum / s.weightSum) * 100)) : 0
})

function statusMark(status) {
  return { [POINT_STATUS.HIT]: '✓', [POINT_STATUS.PARTIAL]: '~', [POINT_STATUS.MISS]: '✗' }[status] || '·'
}

function statusLabel(status) {
  return { [POINT_STATUS.HIT]: '命中', [POINT_STATUS.PARTIAL]: '部分', [POINT_STATUS.MISS]: '缺失' }[status] || '—'
}

function statusStyle(status) {
  return {
    [POINT_STATUS.HIT]: { background: '#e8ecdf', color: '#4f7d5e' },
    [POINT_STATUS.PARTIAL]: { background: '#f7eddc', color: '#9c6b2f' },
    [POINT_STATUS.MISS]: { background: '#f7e9e4', color: '#b4552d' },
  }[status] || { background: 'rgba(120, 113, 108, 0.10)', color: '#78716c' }
}
</script>
