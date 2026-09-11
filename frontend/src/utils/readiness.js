// 「能不能直接开批改」的统一判定
//
// 为什么要单独抽出来：
//   批改要用的 Key 有两个来源——
//     ① 用户在设置页填的，存在浏览器 localStorage（api/llm.js 的 getConfig）
//     ② 服务端托管的（桌面版把 Key 预置在后端，部署版也一样），
//        由 GET /api/v1/settings/llm-default 的 server_key_configured 告知
//   早期代码只判断 ①（hasApiKey()），于是桌面版会被误判成「还没配置 API Key」，
//   练习页顶部无故弹提示、提交按钮永远点不动。必须两个来源都算。

import { computed, ref } from 'vue'
import { hasApiKey } from '../api/llm'
import { fetchLLMDefault } from '../api/backend'

const serverKeyReady = ref(false)
const probed = ref(false)
let inflight = null

/** 探测服务端是否托管 Key。整个应用只探一次，结果缓存。 */
export async function probeReadiness(force = false) {
  if (probed.value && !force) return serverKeyReady.value
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const def = await fetchLLMDefault()
      serverKeyReady.value = !!def?.server_key_configured
    } catch {
      serverKeyReady.value = false
    } finally {
      probed.value = true
      inflight = null
    }
    return serverKeyReady.value
  })()
  return inflight
}

export function useReadiness() {
  const ready = computed(() => hasApiKey() || serverKeyReady.value)
  return { ready, serverKeyReady, probed, probeReadiness }
}
