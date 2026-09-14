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

const app = createApp(App)
app.use(router)
app.mount('#app')

// 控制台水印：发出去的包被改了也不至于认不出出处
printBanner()
