// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版会话登记：页面全关了就通知后端结束进程。
//
// 只对桌面版生效（后端 health 里报 desktop=true 才挂）。网站版/单文件版
// 绝不能有这个行为——那会把别人的服务器在某个访客关页时杀掉。
//
// 为什么用 bye 事件而不是只靠心跳：
//   心跳会被浏览器节流。切到别的标签页后，setInterval 最长能被压到 1 分钟以上，
//   拿它当「页面还活着」的证据会误杀正在后台开着的页面。
//   而 pagehide / beforeunload 只在页面**真的卸载**时触发，这才是"关闭"的准确信号。
//
// 刷新页面会不会误退：
//   不会。刷新是「先 bye 后 hello」——bye 让后端会话表变空并开始倒计时，
//   新页面在 grace（后端默认 6 秒）内 hello 回来就把倒计时取消掉。
//   所以后端那个 grace 必须留够页面重载的时间，改小要慎重。

import { apiBase, backendInfo } from '../api/backend'

const HEARTBEAT_MS = 20000

let attached = false

function newSessionId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 挂上「关页即退」。幂等：重复调用不会注册第二套监听。
 * @param {object|null} info 后端 health 的返回体
 * @returns {boolean} 是否真的挂上了（非桌面版返回 false）
 */
export function attachDesktopSession(info = backendInfo()) {
  if (attached) return false
  if (!info?.desktop) return false
  attached = true

  const sid = newSessionId()
  const base = apiBase()

  const post = (path, keepalive = false) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid }),
      keepalive,
    }).catch(() => {})

  // 首次注册。若后端刚起来还没就绪，2.5 秒后再补一次——
  // 注册不上就永远不会触发退出，会静默退回"关窗口才退"，所以值得补这一次
  let helloOk = false
  const hello = () =>
    fetch(`${base}/session/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid }),
      keepalive: true,
    })
      .then((res) => {
        if (res && res.ok) helloOk = true
        return res
      })
      .catch(() => null)

  hello()
  setTimeout(() => {
    if (!helloOk) hello()
  }, 2500)

  // 心跳：只为让后端能回收"浏览器崩了"留下的僵尸会话，不参与退出判定
  setInterval(() => post('/session/ping'), HEARTBEAT_MS)

  const bye = () => {
    const url = `${base}/session/bye`
    const data = JSON.stringify({ sid })
    // sendBeacon 是卸载阶段唯一还发得出去的通道（普通 fetch 会被浏览器掐掉）
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }))
        return
      }
    } catch {}
    post('/session/bye', true)
  }

  window.addEventListener('pagehide', bye)
  window.addEventListener('beforeunload', bye)

  // 返回页（后退/前进命中 bfcache）时页面没真关，但 pagehide 已经发过 bye 了，
  // 得补一次 hello 把会话登记回来
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) post('/session/hello')
  })

  return true
}
