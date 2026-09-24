// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 整页拖拽接收文件。用于「把 .bpq 题库包拖进窗口就导入」。
//
// 为什么不是给某个框加 drop 监听：
//   用户拖文件时不会瞄准某个按钮——他会往窗口里随便一丢。所以监听挂 window，
//   拖拽期间整页给一个高亮提示，落点在哪都能接住。落点限制靠 accept 过滤来做，
//   而不是靠把监听绑到某个小元素上。
//
// 为什么用计数器而不是布尔值：
//   dragenter 会随着鼠标划过每个子元素反复触发（子元素各自冒泡上来），
//   dragleave 同理。用布尔值会在划过子元素的瞬间闪成「没在拖」，
//   提示层跟着闪烁。进出成对计数，归零才算真的离开。
//
// 为什么要 preventDefault：
//   不阻止 dragover 的默认行为，浏览器就不会把 drop 事件派发给你——
//   页面会直接导航去打开那个文件（表现为"拖进去整页被那个文件顶掉"）。

import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 把「拖文件到窗口」变成回调。返回的 dragging 可直接绑到提示层的显隐上。
 *
 * @param {object} opts
 * @param {(file: File | File[]) => void} opts.onFile 接住文件后的处理（只会在通过过滤时调用；
 *        一次拖入多个时收到数组）
 * @param {string[]} [opts.accept] 允许的扩展名（小写、带点），不传则不限制
 * @param {string} [opts.scope] 监听范围：'window'（默认）或具体元素的 ref
 * @returns {{ dragging: import('vue').Ref<boolean> }}
 */
export function useFileDrop({ onFile, accept = null, scope = null } = {}) {
  const dragging = ref(false)
  let depth = 0

  // 只认「拖着文件」这件事。拖一段选中的文字进来的 DataTransfer.types 里没有 'Files'，
  // 那种情况不该弹出「松手即可导入题库包」——用户会以为拖进内容也会被当成文件。
  function carriesFiles(e) {
    const t = e.dataTransfer?.types
    return !!t && Array.prototype.includes.call(t, 'Files')
  }

  function allowed(file) {
    if (!accept?.length) return true
    const name = (file?.name || '').toLowerCase()
    return accept.some((ext) => name.endsWith(ext.toLowerCase()))
  }

  function onEnter(e) {
    if (!carriesFiles(e)) return
    e.preventDefault()
    depth += 1
    dragging.value = true
  }

  function onOver(e) {
    if (!carriesFiles(e)) return
    e.preventDefault()
    // 光标要给「复制」以外的语义时得显式设置，否则部分浏览器显示禁止符号
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function onLeave(e) {
    if (!carriesFiles(e)) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) dragging.value = false
  }

  function onDrop(e) {
    if (!carriesFiles(e)) return
    e.preventDefault()                 // 阻止浏览器直接打开这个文件
    depth = 0
    dragging.value = false
    const files = Array.from(e.dataTransfer?.files || []).filter(allowed)
    if (!files.length) return
    // 支持一次拖入多个题库包（批量导入）；只接**符合扩展名**的，
    // 混进来的其他文件一律忽略，免得用户以为随便丢个文件就能入库。
    onFile(files.length === 1 ? files[0] : files)
  }

  function target() {
    const el = scope?.value ?? null
    return el || window
  }

  onMounted(() => {
    const el = target()
    el.addEventListener('dragenter', onEnter)
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
  })

  onBeforeUnmount(() => {
    const el = target()
    el.removeEventListener('dragenter', onEnter)
    el.removeEventListener('dragover', onOver)
    el.removeEventListener('dragleave', onLeave)
    el.removeEventListener('drop', onDrop)
  })

  return { dragging }
}
