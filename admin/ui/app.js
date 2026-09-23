// 题库管理员端 · 前端逻辑（静态页，无构建）
// 只做三件事：探测/保存仓库根、收参数、把后端事件流式打进控制台。
const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const $ = (id) => document.getElementById(id)
const consoleEl = $('console')
const statusEl = $('status')
let busy = false

function log(text, cls = '') {
  const line = document.createElement('span')
  if (cls) line.className = cls
  line.textContent = text + '\n'
  consoleEl.appendChild(line)
  if (consoleEl.textContent.startsWith('（等待操作）')) consoleEl.textContent = ''
  consoleEl.scrollTop = consoleEl.scrollHeight
}

function setBusy(on, label) {
  busy = on
  for (const b of document.querySelectorAll('button.run, #btn-detect, #btn-save-root')) {
    b.disabled = on
  }
  statusEl.textContent = on ? label : '就绪'
}

// ── 后端事件 → 控制台 ──
listen('admin-log', (e) => {
  const { stream, text } = e.payload
  log(text, stream === 'err' ? 'err' : '')
})
listen('admin-exit', (e) => {
  const code = e.payload
  if (code === 0) log('✓ 完成（exit 0）', 'sys')
  else log(`✗ 失败（exit ${code}）—— 别把半成品发出去。`, 'err')
  setBusy(false, '就绪')
})

// ── 仓库根 ──
async function detectRoot() {
  const rootEl = $('root')
  try {
    const r = await invoke('find_root', { explicit: null })
    rootEl.value = r
    log(`仓库根：${r}`, 'sys')
  } catch (err) {
    rootEl.value = ''
    log(`⚠ ${err}`, 'err')
  }
}
$('btn-detect').onclick = detectRoot
$('btn-save-root').onclick = async () => {
  try {
    await invoke('save_root', { root: $('root').value })
    log('已保存到 exe 同级 admin-config.json', 'sys')
  } catch (err) {
    log(`⚠ ${err}`, 'err')
  }
}

// ── 四个子命令 ──
async function run(sub, args, pass) {
  const root = $('root').value.trim()
  if (!root) {
    log('⚠ 先探测/指定仓库根', 'err')
    return
  }
  consoleEl.textContent = ''
  setBusy(true, `运行中：${sub} …`)
  log(`$ node .tools/admin-bank.mjs ${sub} ${args.join(' ')}${pass ? '（口令经环境变量传入，不显示）' : ''}`, 'sys')
  try {
    await invoke('run_admin', { root, sub, args, passphrase: pass || null })
  } catch (err) {
    log(`⚠ ${err}`, 'err')
    setBusy(false, '就绪')
  }
}

for (const btn of document.querySelectorAll('button.run')) {
  btn.onclick = () => {
    if (busy) return
    const sub = btn.dataset.sub
    if (sub === 'list') return run('list', [])
    if (sub === 'pack') {
      const pass = $('pack-pass').value
      if (!pass) return log('⚠ 没有给口令。口令永不写默认值 —— 留默认值等于没加密。', 'err')
      const args = ['--user', $('pack-user').value || '']
      const yf = $('year-from').value
      const yt = $('year-to').value
      if (yf) args.push('--year-from', yf)
      if (yt) args.push('--year-to', yt)
      return run('pack', args, pass)
    }
    if (sub === 'verify') {
      const file = $('verify-file').value.trim()
      if (!file) return log('⚠ 给出包文件路径（相对仓库根）', 'err')
      return run('verify', [file], $('verify-pass').value)
    }
    if (sub === 'docs') {
      const args = $('docs-private').checked ? ['--private'] : []
      return run('docs', args)
    }
  }
}

// ── 启动 ──
detectRoot()
