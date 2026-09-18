// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 让 Node 能像 Vite 那样解析 `frontend/src` 的源码。
//
// 为什么需要它：
//   Vite 有两件事 Node 原生做不到 —— ① 省略 `.js` 后缀的 import；
//   ② 自定义别名（`@private-exams` / `@private-standards`）。
//   于是「在 Node 里直接 import 前端源码做测量/单测」会被这两条卡住：
//     ERR_MODULE_NOT_FOUND: Cannot find module './teachers'
//     ERR_INVALID_MODULE_SPECIFIER: Invalid module "@private-standards"
//   给纯函数（`utils/grading/rules.js` 这类）写单测没问题，因为它们既不碰别名、
//   也不省略后缀；一旦要 import `agents/skills.js`（它顺着依赖链会碰到
//   `@private-standards`）就不行了。
//
// 用法（必须在 import 被测模块**之前**注册，所以源码要用动态 import）：
//   import { registerViteAlias } from './vite-alias.mjs'
//   registerViteAlias()                                  // ← 注册本文件为 loader hooks
//   const m = await import('../frontend/src/agents/skills.js')
//
// ⚠️ 别名一律指向**公开 / 空实现**那一份（与 `vite.config.js` 非 full 模式一致）。
//    私有目录是 gitignore 掉的，Node 侧若依赖它，换台机器就跑不起来 ——
//    而且工具的职责是测「所有人都能拿到的那份代码」。

import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 逻辑位置是 .tools/ 下的兄弟文件，用 url 相对解析避免中文路径/cwd 影响
const HERE_URL = new URL('.', import.meta.url)
const HERE = fileURLToPath(HERE_URL)

function absFile(rel) {
  return pathToFileURL(path.resolve(HERE, rel)).href
}

/** Vite 别名 → Node 能加载的真实文件（一律取公开 / 空实现那一分支）。 */
export const VITE_ALIASES = {
  '@private-exams': absFile('../frontend/src/data/real-exams-private-stub/index.js'),
  '@private-standards': absFile('../frontend/src/data/standards-private-stub/index.js'),
}

/** 把本文件注册为 loader hooks。幂等 —— 重复调用无副作用。 */
export function registerViteAlias() {
  register(pathToFileURL(fileURLToPath(import.meta.url)).href, HERE_URL)
}

/** loader hook：解析 Vite 别名 + 补全 `.js` 后缀。 */
export async function resolve(specifier, context, next) {
  const aliased = VITE_ALIASES[specifier]
  if (aliased) return { url: aliased, shortCircuit: true }
  try {
    return await next(specifier, context)
  } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && !specifier.endsWith('.js')) {
      return await next(specifier + '.js', context)
    }
    throw e
  }
}
