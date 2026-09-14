<!--
  蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
  GitHub: https://github.com/xuyi19/bluepencli
  Gitee : https://gitee.com/xuyi_19/bluepencil
  许可: AGPL-3.0 · 转发或修改请保留本署名
-->
<template>
  <div :class="compact ? '' : 'rounded-2xl p-5 md:p-6 neu-sm'">
    <div class="text-sm font-medium text-c-body">{{ title }}</div>
    <p class="text-xs text-c-muted mt-1.5 leading-5">
      {{ desc }}
    </p>

    <div class="mt-4 flex flex-wrap items-start gap-4">
      <!-- 作者个人微信：主入口，长期有效。群码可以没有，它不能没有。 -->
      <figure class="m-0">
        <div class="w-36 h-36 rounded-xl bg-white border border-c-line p-1.5">
          <img :src="WECHAT.personalQr" alt="作者微信二维码"
            class="w-full h-full object-contain rounded-lg" />
        </div>
        <figcaption class="mt-2 text-[11px] text-c-muted text-center leading-4">
          {{ WECHAT.personalLabel }} · 长期有效
        </figcaption>
      </figure>

      <!-- 交流群：限时有效。过期就换成一句"加我来拉你进群"，
           不摆一张扫了没用的图 —— 那比不展示更伤信任。 -->
      <figure v-if="groupValid" class="m-0">
        <div class="w-36 h-36 rounded-xl bg-white border border-c-line p-1.5">
          <img :src="WECHAT.groupQr" :alt="`群聊「${WECHAT.groupName}」二维码`"
            class="w-full h-full object-contain rounded-lg" />
        </div>
        <figcaption class="mt-2 text-[11px] text-c-muted text-center leading-4">
          群聊「{{ WECHAT.groupName }}」· {{ expireLabel }}
        </figcaption>
      </figure>

      <div v-else class="w-36 h-36 rounded-xl border border-dashed border-c-line
        flex flex-col items-center justify-center gap-2 px-3 text-center">
        <svg class="w-5 h-5 text-c-muted" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        <div class="text-[11px] text-c-muted leading-4">群二维码已过期</div>
        <div class="text-[11px] text-c-body leading-4">加左侧微信拉你进群</div>
      </div>
    </div>

    <!-- 备用联系通道：二维码扫不了的时候（比如在电脑上）有路可走 -->
    <div v-if="showActions"
      class="mt-4 pt-4 border-t border-c-line flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <span class="text-c-body font-medium">{{ AUTHOR.name }}</span>
      <a :href="`mailto:${AUTHOR.email}`"
        class="text-c-muted hover:text-c-bark transition-colors duration-300">{{ AUTHOR.email }}</a>
      <a :href="AUTHOR.github" target="_blank" rel="noopener"
        class="text-c-muted hover:text-c-bark transition-colors duration-300">GitHub</a>
      <a :href="AUTHOR.gitee" target="_blank" rel="noopener"
        class="text-c-muted hover:text-c-bark transition-colors duration-300">Gitee</a>
      <button @click="onCopy"
        class="text-c-muted hover:text-c-bark transition-colors duration-300">复制联系方式</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { WECHAT, WECHAT_REMARK, isGroupQrValid, groupExpireLabel } from '../data/wechat'
import { AUTHOR } from '../data/author'
import { copyAuthorLine } from '../utils/watermark'
import { toast } from '../utils/toast'

const props = defineProps({
  // 放在弹层里时用 compact：外层的容器已经提供了卡片外观，这里不再套一层
  compact: { type: Boolean, default: false },
  // 是否显示邮箱 / 仓库那一行备用联系方式
  showActions: { type: Boolean, default: false },
  title: { type: String, default: '加作者微信 · 进交流群' },
  desc: {
    type: String,
    default:
      `扫码添加作者微信（备注「${WECHAT_REMARK}」）。2022 年起的私有真题与题库包由作者定向发放，` +
      '不在软件本体里；软件使用中遇到问题也欢迎直接问我。',
  },
})

// 只算一次即可：一次会话里跨过 0 点边界不是需要处理的场景
const groupValid = computed(() => isGroupQrValid())
const expireLabel = computed(() => groupExpireLabel())

async function onCopy() {
  const ok = await copyAuthorLine()
  ok ? toast.success('联系方式已复制') : toast.error('复制失败，请手动选择')
}
</script>
