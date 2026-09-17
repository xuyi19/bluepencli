<template>
  <div class="w-full">

    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-c-ink">错题本</h1>
        <p class="text-sm text-c-muted mt-1.5">
          按「栽在几份记录里」排序 —— 同一类毛病在多份记录里反复出现，才算真短板
        </p>
      </div>
      <div v-if="!loading && total" class="flex items-center gap-1.5">
        <span class="text-xs px-2.5 py-1 rounded-full" style="background: #e3e8ef; color: #3d5a7a">
          {{ total }} 份记录
        </span>
        <span class="text-xs px-2.5 py-1 rounded-full" style="background: #f2ebe2; color: #5c4033">
          {{ repeated.length }} 类反复问题
        </span>
      </div>
    </div>

    <div v-if="loading" class="rounded-2xl p-16 neu text-center text-c-muted text-sm">
      正在读取记录…
    </div>

    <div v-else-if="!total" class="rounded-2xl p-12 neu text-center">
      <div class="text-sm text-c-body">还没有批改记录，错题本暂时是空的</div>
      <p class="text-xs text-c-muted mt-2">去练习一题，批改结果会自动汇总到这里</p>
      <RouterLink to="/practice"
        class="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-full text-sm
          bg-c-barkSoft text-c-bark transition-colors duration-300 ease-in-out
          hover:bg-c-bark hover:text-c-cream">
        去练习批改
      </RouterLink>
    </div>

    <template v-else>

      <div v-if="repeated.length" class="space-y-3">
        <div v-for="(it, i) in repeated" :key="it.id" class="rounded-2xl p-5 neu">

          <div class="flex items-start gap-3.5">
            <span class="w-7 h-7 rounded-full flex items-center justify-center shrink-0
              bg-c-barkSoft text-c-bark text-xs font-medium tnum">{{ i + 1 }}</span>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-base font-medium text-c-ink">{{ it.label }}</span>
                <span class="text-xs px-2 py-0.5 rounded-full"
                  style="background: #f7e9e4; color: #9c4a42">
                  栽在 {{ it.recordCount }} 份
                </span>
                <span class="text-xs text-c-muted tnum">被提 {{ it.occurrences }} 次</span>
              </div>

              <p class="text-sm text-c-body mt-2.5 leading-relaxed">{{ it.desc }}</p>

              <div v-if="it.selfCheck"
                class="text-xs text-c-muted mt-2.5 flex items-start gap-1.5">
                <span class="shrink-0" style="color: #8b9d77">动笔前自检</span>
                <span class="min-w-0">{{ it.selfCheck }}</span>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 mt-3.5">
                <RouterLink v-for="(rid, k) in it.recordIds" :key="rid"
                  :to="`/records?id=${rid}`"
                  class="text-xs px-2.5 py-1 rounded-full border border-c-line text-c-muted
                    transition-colors duration-300 ease-in-out
                    hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent">
                  第 {{ k + 1 }} 次
                </RouterLink>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="rounded-2xl p-8 neu">
        <div class="text-sm text-c-body">还没有反复出现的短板</div>
        <p class="text-xs text-c-muted mt-2 leading-relaxed">
          同一类问题要 <b>在至少两份记录里都出现</b> 才算"反复栽的坑"。
          现在只批改过 {{ total }} 份，再多练几题这里就会长出来。
        </p>
      </div>

      <div v-if="single.length" class="mt-8">
        <button @click="showSingle = !showSingle"
          class="flex items-center gap-2 text-sm text-c-muted transition-colors duration-300
            ease-in-out hover:text-c-bark">
          <span class="w-3.5 h-3.5 inline-flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"
              :style="{ transform: showSingle ? 'rotate(90deg)' : 'none', transition: 'transform .3s' }">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </span>
          <span>只出现过一次的问题（{{ single.length }} 类）</span>
        </button>

        <div v-if="showSingle" class="space-y-2 mt-3.5">
          <div v-for="it in single" :key="it.id"
            class="rounded-2xl px-5 py-4 neu-sm flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="text-sm text-c-body">{{ it.label }}</div>
              <div class="text-xs text-c-muted mt-1.5">{{ it.desc }}</div>
            </div>
            <RouterLink :to="`/records?id=${it.recordIds[0]}`"
              class="text-xs px-2.5 py-1 rounded-full border border-c-line text-c-muted shrink-0
                transition-colors duration-300 ease-in-out
                hover:text-c-bark hover:bg-c-barkSoft hover:border-transparent">
              看这次
            </RouterLink>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { listAllRecords } from '../utils/record'
import { buildWeaknessProfile } from '../utils/grading/reviewCard'

const loading = ref(true)
const records = ref([])
const showSingle = ref(false)

// 口径在 reviewCard.js 里，这里只管展示：反复栽的坑排前面，只出现一次的收在折叠里。
// 一次算出全量（minRecords=1）再按份数分层，比调两次省一遍遍历。
const all = computed(() => buildWeaknessProfile(records.value, { minRecords: 1 }))
const total = computed(() => all.value.recordCount)
const repeated = computed(() => all.value.items.filter((x) => x.recordCount >= 2))
const single = computed(() => all.value.items.filter((x) => x.recordCount === 1))

onMounted(async () => {
  records.value = await listAllRecords()
  loading.value = false
})
</script>
