<!-- ──────────────────────────────────────────────────────────────
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
  ──────────────────────────────────────────────────────────────
  评分可信度卡片

  为什么分数旁边要放这么一块：
    一个孤零零的「17.5 分」没法判断能不能信 —— 它是三位老师一致的看法，
    还是某一位老师的随手一判？和程序按采分点标准算出来的覆盖率对得上吗？
    这块卡片把这些**看不见的依据**摊开，让分数变得可质疑、可复核。

  展示上有两条不能破的规矩（对应 utils/grading/credibility.js 的硬原则）：
    ① 「不适用」的信号必须原封不动地显示成「不适用」，
       绝不能图标一勾变成"这项通过" —— 那是最恶劣的假信号；
    ② 每个数字都必须带上**算法口径**（"程序按关键词粗判""按分值加权"），
       否则读者会把参照值当终值 —— 那样的界面等于在骗人。
-->
<template>
  <section v-if="cred" class="rounded-2xl p-5 neu mb-6">
    <div class="flex items-center gap-2 flex-wrap mb-1">
      <span class="text-sm font-medium text-c-body">评分可信度</span>
      <span class="text-xs px-1.5 py-0.5 rounded" :style="{ background: meta.bg, color: meta.color }">
        {{ meta.label }} · {{ cred.score }}
      </span>
      <span class="text-xs text-c-muted">{{ cred.headline }}</span>
    </div>

    <div class="text-[11px] text-c-muted leading-5 mb-4">
      这不是「应该打多少分」，而是<strong class="font-medium">这个分数有多少依据</strong> ——
      各项都由纯代码算出，和给分的那几位模型互不干涉，只做旁证，不改写分数。
    </div>

    <!-- 逐项信号 -->
    <div class="space-y-2.5">
      <div v-for="s in signals" :key="s.id" class="rounded-xl p-3.5 neu-inset">
        <div class="flex items-start gap-2">
          <span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-0.5"
            :style="signalStyle(s.level)">{{ signalMark(s.level) }}</span>
          <div class="min-w-0">
            <div class="text-xs font-medium text-c-body">
              {{ s.label }}<span class="text-c-muted font-normal">：{{ s.valueText }}</span>
            </div>
            <div v-if="s.detail" class="text-[11px] text-c-muted mt-0.5 leading-5">{{ s.detail }}</div>
            <!-- 口径：没有它，上面的数字就是一个来历不明的断言 -->
            <div class="text-[11px] text-c-muted mt-1 leading-5">口径：{{ s.basis }}</div>
            <div v-if="s.note" class="text-[11px] mt-1 leading-5" style="color: #9c6b2f">{{ s.note }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 提醒：这些必须让读到的人知道，藏着等于分数吹了牛 -->
    <div v-if="cred.caveats?.length" class="rounded-xl p-4 mt-3" style="background: #f7eddc">
      <div class="text-xs font-medium mb-1.5" style="color: #9c6b2f">读这个分数前请注意</div>
      <ul class="text-xs leading-6 space-y-1" style="color: #9c6b2f">
        <li v-for="(c, i) in cred.caveats" :key="i" class="flex gap-2">
          <span class="shrink-0">·</span><span>{{ c }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { LEVEL, LEVEL_TEXT, SIGNAL_LEVEL } from '../utils/grading/credibility'

const props = defineProps({
  /** assessCredibility() 的结果；批改结束时已算好存档，这里只负责展示 */
  credibility: { type: Object, default: null },
})

const cred = computed(() => (props.credibility ? props.credibility : null))

const meta = computed(() => LEVEL_TEXT[cred.value?.level] || LEVEL_TEXT[LEVEL.UNKNOWN])

// ⚠️ 为什么要过滤：assess() 会保留那些"这次没得可算"的信号（如单人批改时的一致性），
//    它们是透明度的一部分，应该显示 —— 但必须用「—」而不是「✓」，
//    否则"没参考对象"会被读成"参考结果很好"。这是本模块最可能出现的假信号。
const signals = computed(() => cred.value?.signals || [])

function signalMark(level) {
  return { [SIGNAL_LEVEL.GOOD]: '✓', [SIGNAL_LEVEL.WARN]: '!', [SIGNAL_LEVEL.BAD]: '✗', [SIGNAL_LEVEL.NA]: '—' }[
    level
  ] || '·'
}

function signalStyle(level) {
  const palette = {
    [SIGNAL_LEVEL.GOOD]: { background: '#e8ecdf', color: '#4f7d5e' },
    [SIGNAL_LEVEL.WARN]: { background: '#f7eddc', color: '#9c6b2f' },
    [SIGNAL_LEVEL.BAD]: { background: '#f7e9e4', color: '#b4552d' },
    // 「不适用」刻意做成灰、与"通过"完全不同 —— 一眼要能区分"没事"和"没测"
    [SIGNAL_LEVEL.NA]: { background: 'rgba(120, 113, 108, 0.10)', color: '#78716c' },
  }
  return palette[level] || { background: 'rgba(120, 113, 108, 0.08)', color: '#78716c' }
}
</script>
