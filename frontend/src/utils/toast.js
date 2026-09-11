/**
 * 轻量提示 / 确认框 —— 替代 Arco 的 Message 与 Modal。
 *
 * 为什么不用 UI 库：全项目只用到 Message 和 Modal 两个 API，却为此完整引入了
 * 460KB 的 arco.css（打包产物 gzip 52KB 几乎全是它）。换肤后风格也不再匹配。
 *
 * 用法：
 *   import { toast } from '../utils/toast'
 *   toast.success('已保存')
 *   const ok = await toast.confirm('会删除全部数据，且无法恢复。', { okText: '确认清空' })
 *
 * 渲染由 <ToastHost /> 负责（挂在 App.vue，全局唯一）。
 */
import { reactive } from 'vue'

export const toastState = reactive({
  items: [],     // { id, type, text }
  confirm: null, // { id, text, title, okText, cancelText }
})

let seq = 0
const timers = new Map()

function push(type, text, duration = 2600) {
  const id = ++seq
  toastState.items.push({ id, type, text })
  timers.set(id, setTimeout(() => dismiss(id), duration))
  return id
}

function dismiss(id) {
  const i = toastState.items.findIndex((t) => t.id === id)
  if (i >= 0) toastState.items.splice(i, 1)
  const t = timers.get(id)
  if (t) { clearTimeout(t); timers.delete(id) }
}

/** 确认框的按钮回调由 ToastHost 调用这两个函数 */
export function resolveConfirm(ok) {
  const c = toastState.confirm
  if (!c) return
  toastState.confirm = null
  c.resolve(ok)
}

export const toast = {
  success: (t) => push('success', t),
  info: (t) => push('info', t),
  warning: (t) => push('warning', t, 3400),
  error: (t) => push('error', t, 4000),
  dismiss,

  /**
   * 确认框。返回 Promise<boolean>。
   * 原 Arco 写法是 onOk 回调；改成 await 后调用点更好读。
   */
  confirm(text, { title = '请确认', okText = '确定', cancelText = '取消' } = {}) {
    // 前一个还没关就先当作取消，避免 resolve 悬空
    if (toastState.confirm) resolveConfirm(false)
    return new Promise((resolve) => {
      toastState.confirm = { id: ++seq, text, title, okText, cancelText, resolve }
    })
  },
}
