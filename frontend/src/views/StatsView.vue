<template>
  <div class="w-full">

    <h1 class="text-xl font-semibold text-c-ink mb-1">统计</h1>
    <p class="text-sm text-c-muted mb-8">看得见的进步，才撑得住坚持</p>

    <div v-if="!records.length" class="rounded-2xl p-16 neu text-center text-c-muted">
      <div class="text-sm">还没有练习记录，批改一次就有了</div>
      <RouterLink to="/practice"
        class="inline-block mt-4 px-4 py-2 rounded-xl text-xs font-medium neu text-c-bark">
        去练习 →
      </RouterLink>
    </div>

    <template v-else>
      <!-- 概览 -->
      <section class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div v-for="s in overview" :key="s.label" class="rounded-2xl p-5 neu">
          <div class="text-xs text-c-muted mb-2">{{ s.label }}</div>
          <div class="text-2xl font-semibold tnum text-c-ink">{{ s.value }}</div>
          <div class="text-xs text-c-muted mt-1">{{ s.hint }}</div>
        </div>
      </section>

      <!-- 得分趋势 -->
      <section class="rounded-2xl p-6 neu mb-6">
        <div class="text-sm font-medium text-c-body mb-5">得分率趋势</div>
        <div ref="trendEl" style="height: 240px" />
      </section>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- 维度雷达 -->
        <section class="rounded-2xl p-6 neu">
          <div class="text-sm font-medium text-c-body mb-5">能力维度</div>
          <div ref="radarEl" style="height: 260px" />
        </section>

        <!-- 练习频次 -->
        <section class="rounded-2xl p-6 neu">
          <div class="text-sm font-medium text-c-body mb-5">近 30 天练习</div>
          <div ref="heatEl" style="height: 260px" />
        </section>
      </div>

      <!-- 高频失分点 -->
      <section v-if="topDeductions.length" class="rounded-2xl p-6 neu">
        <div class="text-sm font-medium text-c-body mb-5">最该改的毛病</div>
        <div class="space-y-3">
          <div v-for="(d, i) in topDeductions" :key="i" class="flex items-center gap-3">
            <span class="text-xs text-c-muted tnum w-5 shrink-0">{{ i + 1 }}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-c-body truncate">{{ d.point }}</div>
              <div class="h-1.5 rounded-full neu-inset overflow-hidden mt-1.5">
                <div class="h-full rounded-full bg-[#b4552d]"
                  :style="{ width: (d.count / topDeductions[0].count) * 100 + '%' }" />
              </div>
            </div>
            <span class="text-xs text-c-muted tnum shrink-0">{{ d.count }} 次</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import * as echarts from 'echarts'
import { listAllRecords } from '../utils/record'

const records = ref([])
const trendEl = ref(null)
const radarEl = ref(null)
const heatEl = ref(null)
let charts = []

const overview = computed(() => {
  const rs = records.value
  const totalWords = rs.reduce((s, r) => s + (r.wordCount || 0), 0)
  const rate = (r) => ((r.finalScore || 0) / (r.maxScore || 40)) * 100
  const avg = rs.length ? (rs.reduce((s, r) => s + rate(r), 0) / rs.length) : 0
  // 后半段 vs 前半段，看进步
  const n = rs.slice().reverse()
  const half = Math.floor(n.length / 2)
  const early = n.slice(0, half)
  const late = n.slice(half)
  const avgOf = (arr) => (arr.length ? arr.reduce((s, r) => s + rate(r), 0) / arr.length : 0)
  const delta = half ? avgOf(late) - avgOf(early) : 0

  return [
    { label: '累计练习', value: rs.length, hint: '篇' },
    { label: '平均得分率', value: avg.toFixed(0) + '%', hint: '越高越好' },
    { label: '累计字数', value: totalWords, hint: '字' },
    {
      label: '进步幅度',
      value: (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%',
      hint: '后半段 vs 前半段',
    },
  ]
})

const topDeductions = computed(() => {
  const map = new Map()
  for (const r of records.value) {
    for (const tr of r.results || []) {
      for (const d of tr.deductions || []) {
        const key = String(d.point || '').trim()
        if (!key) continue
        map.set(key, (map.get(key) || 0) + 1)
      }
    }
  }
  return [...map.entries()]
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
})

function initCharts() {
  charts.forEach((c) => c.dispose())
  charts = []
  const rs = records.value.slice().reverse()
  if (!rs.length) return

  const AXIS = { color: '#78716c', fontSize: 11 }
  const SPLIT = { lineStyle: { color: '#e7e5e4', type: 'dashed' } }

  // 趋势
  if (trendEl.value) {
    const c = echarts.init(trendEl.value)
    c.setOption({
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis', valueFormatter: (v) => v + '%' },
      xAxis: {
        type: 'category',
        data: rs.map((r, i) => `#${i + 1}`),
        axisLabel: AXIS,
        axisLine: { lineStyle: { color: '#a8a29e' } },
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLabel: { ...AXIS, formatter: '{value}%' },
        splitLine: SPLIT,
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: rs.map((r) => +(((r.finalScore || 0) / (r.maxScore || 40)) * 100).toFixed(1)),
          itemStyle: { color: '#5c4033' },
          lineStyle: { width: 2, color: '#5c4033' },
          areaStyle: { color: 'rgba(92,64,51,0.12)' },
        },
      ],
    })
    charts.push(c)
  }

  // 维度雷达
  if (radarEl.value) {
    const dims = new Map()
    for (const r of records.value) {
      for (const tr of r.results || []) {
        for (const d of tr.dimensions || []) {
          if (!d.name) continue
          const cur = dims.get(d.name) || { got: 0, max: 0 }
          cur.got += d.score || 0
          cur.max += d.max || 0
          dims.set(d.name, cur)
        }
      }
    }
    const entries = [...dims.entries()].slice(0, 6)
    const c = echarts.init(radarEl.value)
    if (!entries.length) {
      c.setOption({
        title: {
          text: '还没有分项评分数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#a8a29e', fontSize: 12, fontWeight: 400 },
        },
      })
    } else {
      c.setOption({
        radar: {
          indicator: entries.map(([name]) => ({ name, max: 100 })),
          axisName: { color: '#78716c', fontSize: 11 },
          splitLine: { lineStyle: { color: '#e7e5e4' } },
          splitArea: { areaStyle: { color: ['rgba(250,246,241,0.3)', 'rgba(250,246,241,0.6)'] } },
          axisLine: { lineStyle: { color: '#e7e5e4' } },
        },
        series: [
          {
            type: 'radar',
            data: [
              {
                value: entries.map(([, v]) => (v.max ? +((v.got / v.max) * 100).toFixed(1) : 0)),
                name: '平均得分率',
                itemStyle: { color: '#5c4033' },
                lineStyle: { color: '#5c4033', width: 2 },
                areaStyle: { color: 'rgba(92,64,51,0.2)' },
              },
            ],
          },
        ],
      })
    }
    charts.push(c)
  }

  // 近 30 天热力
  if (heatEl.value) {
    const days = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      days.push(d)
    }
    const counts = days.map((d) => {
      const start = d.getTime()
      const end = start + 24 * 3600 * 1000
      return records.value.filter((r) => r.createdAt >= start && r.createdAt < end).length
    })
    const max = Math.max(1, ...counts)
    const c = echarts.init(heatEl.value)
    c.setOption({
      grid: { left: 8, right: 8, top: 16, bottom: 8 },
      tooltip: {
        formatter: (p) => {
          const d = days[p.dataIndex]
          return `${d.getMonth() + 1}月${d.getDate()}日：${counts[p.dataIndex]} 篇`
        },
      },
      xAxis: { type: 'category', show: false, data: days.map((_, i) => i) },
      yAxis: { type: 'category', show: false, data: ['练习'] },
      visualMap: {
        show: false,
        min: 0,
        max,
        inRange: { color: ['#f2ebe2', '#7a6a9b', '#5c4033'] },
      },
      series: [
        {
          type: 'heatmap',
          data: counts.map((v, i) => [i, 0, v]),
          itemStyle: { borderRadius: 4, borderColor: '#faf6f1', borderWidth: 3 },
        },
      ],
    })
    charts.push(c)
  }
}

function resize() {
  charts.forEach((c) => c.resize())
}

onMounted(async () => {
  records.value = await listAllRecords()
  await nextTick()
  initCharts()
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  window.removeEventListener('resize', resize)
  charts.forEach((c) => c.dispose())
})
</script>
