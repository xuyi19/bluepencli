// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
//
// 路由表。**页面一律静态导入，不用懒加载分片。**
//
// ── 为什么放弃懒加载（`() => import(...)`）────────────────────────
// 懒加载会把每个页面单独打成一个按内容 hash 命名的文件，点导航时再去取。
// 升级后旧文件被删掉，而**已经打开的页面**手里还攥着旧地址：
//
//     GET /assets/ChangelogView-Cd9uacJ9.js  →  404
//     TypeError: Failed to fetch dynamically imported module
//
// vue-router 于是中止这次跳转 —— 用户看到的是「点了没反应」：不白屏、不报红字，
// 只有控制台里一行错。这个症状被反复报成"页面坏了"，查了三轮才到底。
//
// 桌面版尤其致命，因为它叠加了第二个因素：每次启动都开**同一个地址**，
// 浏览器很可能复用那个早就打开的标签页 —— 页面里的代码可能还是好几版之前的。
// 实测遇到的那一个标签页是 v0.8.1 留下的，它连"自动刷新"的兜底代码都没有，
// 所以后面每一版都修不到它：**换成静态导入之后，导航只是渲染一个已经在内存里的
// 组件，不产生任何网络请求，也就没有"取不到"这回事。**
// （"页面自己发现版本落后"这件事由 frontend/index.html 里的一段自检负责。）
//
// 代价是首屏包变大。桌面版与单文件版都在本地加载，这点体积换"点了一定能跳"值得。
// 护栏：`.tools/test-route-eager.mjs` 检查构建产物里没有页面分片，
// 防止哪天顺手又改回懒加载。

import { createRouter, createWebHashHistory } from 'vue-router'

import HomeView from '../views/HomeView.vue'
import TeachersView from '../views/TeachersView.vue'
import ArticlesView from '../views/ArticlesView.vue'
import QuestionsView from '../views/QuestionsView.vue'
import PracticeView from '../views/PracticeView.vue'
import RecordsView from '../views/RecordsView.vue'
import StatsView from '../views/StatsView.vue'
import WeaknessView from '../views/WeaknessView.vue'
import SettingsView from '../views/SettingsView.vue'
import ChangelogView from '../views/ChangelogView.vue'

export default createRouter({
  // hash 模式：打包成单文件后，用 file:// 双击打开也不会白屏
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/teachers', name: 'teachers', component: TeachersView },
    { path: '/articles', name: 'articles', component: ArticlesView },
    { path: '/questions', name: 'questions', component: QuestionsView },
    { path: '/practice', name: 'practice', component: PracticeView },
    { path: '/records', name: 'records', component: RecordsView },
    { path: '/stats', name: 'stats', component: StatsView },
    { path: '/weakness', name: 'weakness', component: WeaknessView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/changelog', name: 'changelog', component: ChangelogView },
  ],
})
