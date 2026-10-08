// 嵌套 spawn EBUSY 环境病的临时补丁（2026-10-08）
// 症状：node 当父进程起任何子进程，只要 stdin 是 pipe 就 EBUSY（stdout/stderr 管道正常）；
//       bash/cmd 当父进程则一切正常。疑似沙箱/杀软对「父→子字节流管道」的限制。
// 绕法：把子进程 stdin 从 pipe 换成 ignore。
// ⚠️ 例外：调用带 input 选项（要往子进程 stdin 喂数据）时，ignore 会断粮 ——
//        改用「临时文件 fd 当 stdin」：不建管道、数据照样到，读到的就是 input 内容。
// 传播：NODE_OPTIONS="--require <本文件绝对路径>" 让所有 node 子进程自动带上补丁：
//   NODE_OPTIONS="--require E:/code/bluepencil/.tools/fix-stdio.cjs" node <脚本>
'use strict'
const cp = require('node:child_process')
const { tmpdir } = require('node:os')
const { writeFileSync, openSync, closeSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')

function fixStdio(stdio) {
  if (stdio === 'pipe' || stdio === undefined || stdio === null) return ['ignore', 'pipe', 'pipe']
  if (Array.isArray(stdio)) {
    const s = [...stdio]
    if (s[0] === 'pipe') s[0] = 'ignore'
    return s
  }
  return stdio
}

function stdinWantsPipe(stdio) {
  if (stdio === 'pipe' || stdio === undefined || stdio === null) return true
  return Array.isArray(stdio) && stdio[0] === 'pipe'
}

// 返回改写后的 opts；把 input 落成临时文件、其读 fd 顶替 stdin 管道。
// 返回值带 cleanup（异步场景由调用方在 close 后调用，同步场景立即调用）。
function rewriteInput(opts) {
  const tmp = join(tmpdir(), `fix-stdio-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(tmp, opts.input)
  const fd = openSync(tmp, 'r')
  const stdio = fixStdio(opts.stdio).slice()
  stdio[0] = fd
  const next = { ...opts, stdio }
  delete next.input
  return { opts: next, cleanup: () => { try { closeSync(fd) } catch {} try { unlinkSync(tmp) } catch {} } }
}

function normalizeArgs(file, args, opts) {
  if (args && !Array.isArray(args) && typeof args === 'object') return [file, undefined, args]
  return [file, args, opts]
}

const origSpawn = cp.spawn
const origSpawnSync = cp.spawnSync

cp.spawnSync = function (file, args, opts = {}) {
  ;[file, args, opts] = normalizeArgs(file, args, opts)
  if (opts.input != null && stdinWantsPipe(opts.stdio)) {
    const { opts: next, cleanup } = rewriteInput(opts)
    try { return origSpawnSync.call(this, file, args, next) } finally { cleanup() }
  }
  return origSpawnSync.call(this, file, args, { ...opts, stdio: fixStdio(opts.stdio) })
}

cp.spawn = function (file, args, opts = {}) {
  ;[file, args, opts] = normalizeArgs(file, args, opts)
  if (opts.input != null && stdinWantsPipe(opts.stdio)) {
    const { opts: next, cleanup } = rewriteInput(opts)
    const child = origSpawn.call(this, file, args, next)
    child.on('close', cleanup)
    child.on('error', cleanup)
    return child
  }
  return origSpawn.call(this, file, args, { ...opts, stdio: fixStdio(opts.stdio) })
}

// execFileSync 内部走的是不可拦截的私有 spawn，这里用打补丁的 spawnSync 重造：
// 语义 = 同步执行、非零退出抛错、支持 input、返回 stdout（保持 Buffer/encoding 行为）
cp.execFileSync = function (file, args, opts = {}) {
  ;[file, args, opts] = normalizeArgs(file, args, opts)
  const r = cp.spawnSync(file, args, { ...opts, shell: false })
  if (r.status !== 0) {
    const err = new Error(`Command failed: ${file}\n${r.stderr || r.stdout || ''}`)
    err.status = r.status
    err.stdout = r.stdout
    err.stderr = r.stderr
    throw err
  }
  return r.stdout
}
