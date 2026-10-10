<!-- ──────────────────────────────────────────────────────────────
     蓝笔申论 BluePencil · 升格对照面板
     批改完成后按需生成「这份答案 → 高分答案」的完整升格路径：
     诊断 → 逐句升格桥（原句/问题/升格句/理由）→ 升格要点 → 升格全文。
     纯展示组件：生成走 agents/elevate.js，持久化由父组件监听 @save 落记录
     （面板自己不碰存储，同一组件才能在结果页与复盘页共用）。
────────────────────────────────────────────────────────────── -->
<script setup>
import { ref, watch } from 'vue'
import { runElevation } from '../agents/elevate'
import { annotationTypeLabel } from '../data/error-taxonomy'

const props = defineProps({
  /** 规范化记录（canonical record）。含 answer/material/题目信息与批改结论 */
  rec: { type: Object, required: true },
})
const emit = defineEmits(['save'])

const elev = ref(props.rec?.elevation || null)

// 复盘页切换记录时 rec 是同一个组件实例换内容——跟着换状态，别显示上一份记录的升格
watch(
  () => props.rec?.id,
  () => {
    elev.value = props.rec?.elevation || null
    err.value = ''
    live.value = ''
  }
)
const loading = ref(false)
const err = ref('')
const live = ref('')
const copied = ref(false)

async function generate() {
  loading.value = true
  err.value = ''
  live.value = ''
  try {
    const { elevation, problems, version } = await runElevation(props.rec, {
      onDelta: (full) => {
        live.value = full
      },
    })
    if (!elevation) throw new Error(problems[0] || '升格结果解析失败')
    elev.value = {
      ...elevation,
      version,
      // 自动校验备注（如某条 quote 定位不到）：不假装没问题，展示给用户
      notes: problems,
      generatedAt: new Date().toISOString(),
    }
    emit('save', elev.value)
  } catch (e) {
    if (e.name !== 'AbortError') err.value = e.message
  } finally {
    loading.value = false
  }
}

async function copyUpgraded() {
  try {
    await navigator.clipboard.writeText(elev.value.upgraded)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用（非 https/权限）就算了：文本本来就全量展示着 */
  }
}
</script>

<template>
  <section class="rounded-2xl p-5 neu mb-6">
    <div class="flex items-center justify-between mb-1">
      <div class="text-xs text-c-muted">升格对照</div>
      <span v-if="elev?.version" class="text-[10px] text-c-muted tnum">{{ elev.version }}</span>
    </div>

    <!-- 未生成：说明 + 按钮 -->
    <template v-if="!elev">
      <div class="text-sm text-c-body leading-7 mb-4">
        不止告诉你哪里差——把<span class="font-medium">你写的每一句</span>变成<span class="font-medium">高分那一句</span>：
        逐句给出问题定性、可直接替换的升格句和理由，最后合成一篇可对照背诵的升格全文。
      </div>
      <button @click="generate" :disabled="loading"
        class="w-full px-4 py-2.5 rounded-xl text-xs font-medium neu-sm text-c-body
          hover:text-c-bark transition-colors disabled:opacity-40">
        {{ loading ? '生成中…（约十几秒）' : '⬆ 生成升格对照' }}
      </button>
      <div v-if="loading && live" class="mt-3 rounded-xl p-3 neu-inset text-[11px] leading-5 text-c-muted
        whitespace-pre-wrap max-h-28 overflow-y-auto">{{ live.slice(-300) }}</div>
    </template>

    <!-- 已生成 -->
    <template v-else>
      <!-- ① 本质差距 -->
      <div v-if="elev.diagnosis" class="rounded-xl p-3.5 mb-4" style="background: #faf6f1">
        <div class="text-[11px] text-c-muted mb-1">本质差距</div>
        <div class="text-sm text-c-body leading-7">{{ elev.diagnosis }}</div>
      </div>

      <!-- ② 逐句升格桥 -->
      <div v-if="elev.rows?.length" class="space-y-3 mb-4">
        <div v-for="(row, i) in elev.rows" :key="i" class="rounded-xl p-3.5 neu-inset">
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            <span class="text-[10px] tnum text-c-muted">第 {{ i + 1 }} 处</span>
            <span class="px-1.5 py-0.5 rounded text-[10px]"
              style="background: #f0ddd2; color: #a05a3c">{{ annotationTypeLabel(row.type) }}</span>
            <span v-if="!row.located" class="text-[10px] text-c-muted">（原句定位失败，仅展示）</span>
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <div class="rounded-lg p-2.5 text-xs leading-6" style="background: #fdf3f0; color: #8c4a35">
              <div class="text-[10px] text-c-muted mb-0.5">你的原句</div>
              {{ row.quote }}
            </div>
            <div class="rounded-lg p-2.5 text-xs leading-6" style="background: #eef3ea; color: #4f7d5e">
              <div class="text-[10px] text-c-muted mb-0.5">升格句</div>
              {{ row.rewrite }}
            </div>
          </div>
          <div class="text-[11px] text-c-muted leading-5 mt-2">
            <template v-if="row.problem"><span class="text-c-body">{{ row.problem }}</span> —— </template>{{ row.why }}
          </div>
        </div>
      </div>

      <!-- ③ 升格要点 -->
      <div v-if="elev.strategy?.length" class="mb-4">
        <div class="text-[11px] text-c-muted mb-1.5">升格要点（按优先级）</div>
        <ul class="space-y-1.5">
          <li v-for="(s, i) in elev.strategy" :key="i" class="text-xs text-c-body flex gap-2 leading-6">
            <span class="text-c-bark shrink-0 tnum">{{ i + 1 }}.</span><span>{{ s }}</span>
          </li>
        </ul>
      </div>

      <!-- ④ 升格全文 -->
      <div v-if="elev.upgraded" class="rounded-xl p-3.5 neu-inset">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-c-muted">升格全文（融合以上全部改写，可对照背诵）</div>
          <button @click="copyUpgraded"
            class="text-[11px] text-c-muted hover:text-c-bark transition-colors shrink-0">
            {{ copied ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <div class="text-xs text-c-body leading-6 whitespace-pre-wrap max-h-72 overflow-y-auto">{{ elev.upgraded }}</div>
      </div>

      <!-- 自动校验备注：不假装没问题 -->
      <details v-if="elev.notes?.length" class="mt-3">
        <summary class="text-[11px] text-c-muted cursor-pointer hover:text-c-bark">
          生成时的自动校验备注（{{ elev.notes.length }} 条）
        </summary>
        <ul class="mt-1.5 space-y-1">
          <li v-for="(n, i) in elev.notes" :key="i" class="text-[11px] text-c-muted leading-5">· {{ n }}</li>
        </ul>
      </details>

      <!-- 重新生成 -->
      <button @click="generate" :disabled="loading"
        class="mt-4 text-[11px] text-c-muted hover:text-c-bark transition-colors disabled:opacity-40">
        {{ loading ? '重新生成中…' : '↻ 不满意？重新生成' }}
      </button>
      <div v-if="loading && live" class="mt-2 rounded-xl p-3 neu-inset text-[11px] leading-5 text-c-muted
        whitespace-pre-wrap max-h-28 overflow-y-auto">{{ live.slice(-300) }}</div>
    </template>

    <div v-if="err" class="mt-3 text-xs leading-6" style="color: #a05a3c">{{ err }}</div>
  </section>
</template>
