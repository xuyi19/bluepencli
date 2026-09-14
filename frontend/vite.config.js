// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 私有真题目录：2022 年起的国考卷。**不进版本库**，只在本机存在。
const PRIVATE_DIR = resolve(HERE, 'src/data/real-exams-private')
// 空实现：随仓库走，别人 clone 后靠它构建
const PRIVATE_STUB = resolve(HERE, 'src/data/real-exams-private-stub')

// 私有卷的**采分点标准**同样敏感（写出采分点等于泄题），走同一套分层机制。
const PRIVATE_STD_DIR = resolve(HERE, 'src/data/standards-private')
const PRIVATE_STD_STUB = resolve(HERE, 'src/data/standards-private-stub')

// 四种构建产物，靠 --mode 区分（Windows 下 npm script 里没法直接写 `FOO=1 cmd`，
// 所以用 mode 而不是环境变量，免得多装一个 cross-env）：
//
//   vite build                      → dist/              公开·网站版
//   vite build --mode single        → dist-single/       公开·单文件版（发给别人）
//   vite build --mode full          → dist/              本机·网站版（含私有卷）
//   vite build --mode single-full   → dist-single-local/ 本机·单文件版（含私有卷）
//
// mode 里带 `full` 才把私有卷编进去。默认（不带 mode）是**不含私有卷**的，
// 这一点是刻意的：忘记加 mode 时宁可少东西，也不能把私有资产漏出去。
//
// 为什么不叫 `local`：Vite 明确禁止 mode 名以 `.local` 后缀冲突（会与 .env.local 打架），
// `--mode local` 会在 loadEnv 阶段直接抛错。踩过，别再改回去。
export default defineConfig(({ mode }) => {
  const single = mode.startsWith('single')
  const includePrivate = mode.includes('full')

  const privateEntry = includePrivate && existsSync(PRIVATE_DIR)
    ? resolve(PRIVATE_DIR, 'index.js')
    : resolve(PRIVATE_STUB, 'index.js')

  const privateStdEntry = includePrivate && existsSync(PRIVATE_STD_DIR)
    ? resolve(PRIVATE_STD_DIR, 'index.js')
    : resolve(PRIVATE_STD_STUB, 'index.js')

  return {
    plugins: [vue(), ...(single ? [viteSingleFile()] : [])],
    resolve: {
      alias: {
        // 私有卷的唯一入口。data/questions.js 只认这个别名，
        // 换目录 / 换空实现都在这一处完成，业务代码不用动。
        '@private-exams': privateEntry,
        // 私有卷采分点标准，同样只认别名
        '@private-standards': privateStdEntry,
      },
    },
    base: './',
    build: {
      outDir: mode === 'single-full' ? 'dist-single-local' : single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      // 单文件模式必须关闭代码分割，否则会产生多个 chunk
      cssCodeSplit: !single,
      assetsInlineLimit: single ? 100000000 : 4096,
      rollupOptions: single
        ? { output: { inlineDynamicImports: true } }
        : undefined,
      chunkSizeWarningLimit: 2000,
    },
    server: {
      host: '0.0.0.0',
      // 5273 而不是 Vite 默认的 5173：本机上 5173 常被其他项目的前端占用。
      // strictPort：端口被占时直接报错，而不是静默换到 5274 —— 否则浏览器
      // 书签会莫名失效，排查起来像"代码 bug"。
      port: 5273,
      strictPort: true,
      allowedHosts: true,
      hmr: { clientPort: 443 },
      // 「更新日志」页直接 ?raw 导入仓库根的 CHANGELOG.md（它是唯一数据源），
      // 该文件在 frontend/ 之外，默认会被 Vite 的文件白名单拦成 403。
      // 注意 fs.allow 是整体覆盖而非追加，所以 '.'（前端自身）也要写回来。
      fs: { allow: ['.', '..'] },
      // 代理到 FastAPI 后端，前端无需处理跨域
      // 注意：8000 常被 resumatch-ai 占用，本项目固定用 8100，避免两个项目抢端口
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8100',
          changeOrigin: true,
        },
      },
    },
  }
})
