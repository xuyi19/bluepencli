// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 应用入口。水印块由 .tools/add_watermark.py 统一维护，别手改。

import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { printBanner } from './utils/watermark'
import { setRuntimeBase } from './api/backend'

// 桌面版（Tauri）：Rust 侧内置了一个本地后端，先把地址注入进去再挂载。
//
// 为什么必须在 `mount` **之前**：首屏就有组件会探测后端（`probeBackend()`），
// 而探测结论会被缓存（`state.checked`）。先挂载再注入的话，那次探测打向
// `tauri.localhost` 是个无效请求 —— `setRuntimeBase` 虽然会清缓存纠正，
// 但首屏那一下的降级可能已经画到界面上（比如设置页显示"未连接后端"）。
//
// 浏览器版（网站 / 单文件）不走这支：`__TAURI_INTERNALS__` 只在 Tauri 里注入。
// 这里用动态 import 是刻意的 —— Vite 会把它切成独立分片，网站版用户不为它买单。
if (globalThis.__TAURI_INTERNALS__) {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const base = await invoke('api_base')
    if (base) setRuntimeBase(base)
    else console.warn('[蓝笔] 本地服务未就绪，将退回浏览器直连（批改可能受 CORS 限制）')
  } catch (e) {
    console.warn('[蓝笔] 取本地服务地址失败，将退回浏览器直连：', e)
  }
}

// 外部链接交给系统浏览器打开。
//
// 为什么要在入口统一接管：`<a target="_blank">` 在 WebView2 里会被 Tauri 拦下，
// 表现就是**点仓库地址没反应**（桌面版实测报上来的问题）。而这类链接散在
// 侧边栏底部、首页页脚、更新日志页、微信面板四处 —— 逐个改不仅容易漏，
// 而且**漏掉的那一处不会有任何报错**，只会静默失效。
//
// 所以在这里拦一次收口：`http(s)` 与 `mailto` 一律交出去。
// 内部路由（`#/xxx`）和页内锚点不匹配这两个前缀，原样交给 vue-router。
//
// 用**捕获阶段**（第三个参数 true）是刻意的：要在组件自己的 click 处理之前生效。
if (globalThis.__TAURI_INTERNALS__) {
  document.addEventListener(
    'click',
    async (e) => {
      const a = e.target?.closest?.('a[href]')
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!/^(https?:|mailto:)/i.test(href)) return
      e.preventDefault()
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(href)
      } catch (err) {
        // 打不开也不能让页面乱掉：桌面版权限里只放行了作者自己的仓库与邮箱，
        // 别的域名会被拒 —— 这是有意的（见 src-tauri/capabilities/default.json）
        console.warn('[蓝笔] 打开外部链接失败：', href, err)
      }
    },
    true
  )
}

const app = createApp(App)
app.use(router)
app.mount('#app')

// 控制台水印：发出去的包被改了也不至于认不出出处
printBanner()
