<template>
  <div class="relative shrink-0" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle :cx="c" :cy="c" :r="r" fill="none" stroke="#d3d1c7" :stroke-width="stroke" />
      <circle :cx="c" :cy="c" :r="r" fill="none" :stroke="color" :stroke-width="stroke"
        stroke-linecap="round" :stroke-dasharray="circ" :stroke-dashoffset="offset"
        :transform="`rotate(-90 ${c} ${c})`"
        style="transition: stroke-dashoffset 1s ease-out, stroke 0.4s" />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <span class="font-semibold tnum" :style="{ fontSize: size * 0.28 + 'px', color }">{{ shown }}</span>
      <span class="text-gray-400 tnum" :style="{ fontSize: size * 0.12 + 'px' }">/ {{ max }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'

const props = defineProps({
  score: { type: Number, default: 0 },
  max: { type: Number, default: 40 },
  size: { type: Number, default: 96 },
  stroke: { type: Number, default: 8 },
})

const shown = ref(0)
const c = computed(() => props.size / 2)
const r = computed(() => props.size / 2 - props.stroke / 2 - 2)
const circ = computed(() => 2 * Math.PI * r.value)

const ratio = computed(() => (props.max ? Math.max(0, Math.min(1, props.score / props.max)) : 0))
const offset = computed(() => circ.value * (1 - ratio.value))

const color = computed(() => {
  const p = ratio.value
  if (p >= 0.8) return '#0f6e56'
  if (p >= 0.6) return '#6d5dfc'
  if (p >= 0.4) return '#ba7517'
  return '#a32d2d'
})

watch(() => props.score, (v) => { shown.value = v })

onMounted(() => {
  shown.value = 0
  setTimeout(() => { shown.value = props.score }, 60)
})
</script>
