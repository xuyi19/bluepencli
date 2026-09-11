import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  // hash 模式：打包成单文件后，用 file:// 双击打开也不会白屏
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/teachers', name: 'teachers', component: () => import('../views/TeachersView.vue') },
    { path: '/articles', name: 'articles', component: () => import('../views/ArticlesView.vue') },
    { path: '/questions', name: 'questions', component: () => import('../views/QuestionsView.vue') },
    { path: '/practice', name: 'practice', component: () => import('../views/PracticeView.vue') },
    { path: '/records', name: 'records', component: () => import('../views/RecordsView.vue') },
    { path: '/stats', name: 'stats', component: () => import('../views/StatsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
  ],
})
