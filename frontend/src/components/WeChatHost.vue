<!--
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
-->
<template>
  <Teleport to="body">
    <div v-if="wechatPanel.open" class="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <div class="absolute inset-0 bg-c-ink/30" @click="closeWeChat" />
      <div ref="boxRef" role="dialog" aria-modal="true" aria-label="加作者微信"
        class="relative w-full max-w-xl max-h-[88vh] overflow-y-auto
          rounded-2xl bg-c-cream border border-c-line p-5 md:p-6
          shadow-[0_12px_44px_rgba(92,64,51,0.20)]">

        <button @click="closeWeChat" aria-label="关闭"
          class="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center
            text-c-muted transition-colors duration-300 hover:text-c-bark hover:bg-c-barkSoft">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <WeChatPanel compact show-actions />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import WeChatPanel from './WeChatPanel.vue'
import { wechatPanel, closeWeChat } from '../utils/wechatPanel'

const boxRef = ref(null)

// ESC 关闭：弹层是模态的，没有键盘出口会让人烦躁
function onKeydown(e) {
  if (e.key === 'Escape') closeWeChat()
}

watch(() => wechatPanel.open, (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    // 打开后把焦点移进弹层，Esc 才有作用（焦点还在侧边栏按钮上时 keydown 也冒泡到 window，
    // 所以这里主要是为了无障碍语义，不是必须）
    requestAnimationFrame(() => boxRef.value?.focus?.())
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
