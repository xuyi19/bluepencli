import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 两种构建产物：
//   pnpm build         → dist/       多文件，用于部署到网站
//   pnpm build:single  → dist-single/单文件 index.html，双击即用，可直接发给别人
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    plugins: [vue(), ...(single ? [viteSingleFile()] : [])],
    base: './',
    build: {
      outDir: single ? 'dist-single' : 'dist',
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
