// 题库管理员端 · 工具集成面板
// 只做三件事：探测仓库根、按按钮拼出「程序 + 参数」、把输出流式打进控制台。
// 真正的活全由仓库里的 .tools/ 与 frontend/scripts/ 脚本干 —— 这里不重新实现任何逻辑。
const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

const $ = (id) => document.getElementById(id)
const consoleEl = $('console')
const statusEl = $('status')
let busy = false

// ── 工具清单：程序 / 参数 / 需要哪些输入 ──
// 程序名用语义名交给 Rust 解析：
//   "node"   → PATH / 常见安装位置
//   "python" → **仓库内 venv 优先**（管线依赖装在 backend/.venv 里；PATH 上那个
//              可能是完全无关的解释器，随手用了会 ModuleNotFoundError）
// 这里**不要**写相对路径（如 backend/.venv/Scripts/python.exe）：Windows 上
// Command::new 的相对路径按父进程 CWD 解析、不是 current_dir，会 os error 3。
const PY = 'python'
const TOOLS = [
  {
    group: '题库（PDF → 前端数据）',
    hint: '先放 PDF、配置 exams_config.py，再按这个顺序跑：提取 → 编入 → 说明',
    items: [
      {
        name: '盘点题库',
        desc: '公开/私有卷、分发包、标准各多少',
        cmd: 'node',
        args: () => ['.tools/admin-bank.mjs', 'list'],
      },
      {
        name: 'PDF 提取真题',
        desc: '按 exams_config 里的卷清单提取（留空卷 id = 全量）',
        cmd: PY,
        args: () => ['.tools/exams/extract.py', ...$('exam-ids').value.trim().split(/\s+/).filter(Boolean)],
      },
      {
        name: '编入前端数据',
        desc: 'out/*.json → real-exams / real-exams-private（按年份自动分层）',
        cmd: PY,
        args: () => ['.tools/exams/to_frontend.py'],
      },
      {
        name: '生成真题数据说明',
        desc: 'docs/题库/真题数据说明.md（数字现算）',
        cmd: PY,
        args: () => ['.tools/exams/report_doc.py'],
      },
    ],
  },
  {
    group: '分发（加密题库包）',
    hint: '包与口令分两条路发；发之前先验一次',
    items: [
      {
        name: '打包加密题库包',
        desc: '源 JSON → 明文包 → 加密签名包（含自检）',
        cmd: 'node',
        args: () => {
          const a = ['.tools/admin-bank.mjs', 'pack', '--user', $('pack-user').value || '']
          if ($('year-from').value) a.push('--year-from', $('year-from').value)
          if ($('year-to').value) a.push('--year-to', $('year-to').value)
          return a
        },
        needPass: true,
      },
      {
        name: '验包',
        desc: '验签 + 解密自检：发出去的是不是能打开的那份',
        cmd: 'node',
        args: () => ['.tools/admin-bank.mjs', 'verify', $('verify-file').value.trim()],
        needPass: true,
      },
    ],
  },
  {
    group: '文档与素材',
    items: [
      {
        name: '生成题库汇编',
        desc: 'docs/题库/汇编/ 下按体系·年份·卷别的目录树（采分点永不导出）',
        cmd: 'node',
        args: () => ['.tools/export-bank-docs.mjs', ...($('with-private').checked ? ['--private'] : [])],
      },
      {
        name: '生成文章库镜像',
        desc: 'docs/题库/文章库/ 下按主题分组的可读 md',
        cmd: 'node',
        args: () => ['frontend/scripts/export-articles-to-docs.mjs'],
      },
    ],
  },
  {
    group: '标准与回归',
    hint: '采分点是泄题级数据；回归测试在改完工具链后跑一遍',
    items: [
      {
        name: '采分点覆盖盘点',
        desc: '多少题有标准、来源分布、缺口清单',
        cmd: 'node',
        args: () => ['.tools/standards/calibrate.mjs', '--list'],
      },
      {
        name: '采分点校验',
        desc: '权重合计 vs 题分、id 唯一、字段齐全',
        cmd: 'node',
        args: () => ['.tools/standards/calibrate.mjs', '--check'],
      },
      {
        name: '一键回归测试',
        desc: '全部前端测试套件 + pytest（发版前跑这一条）',
        cmd: 'node',
        args: () => ['.tools/test-all.mjs'],
      },
    ],
  },
]

function log(text, cls = '') {
  gotOutput = true
  // 占位符要在 appendChild **之前**清：先 append 再判断的话，
  // textContent 已包含刚加的内容 → startsWith 命中 → 把新行一起删掉
  // （表现为「仓库根：xxx」这类启动即打印的行永远看不到）
  if (consoleEl.textContent === '（等待操作）') consoleEl.textContent = ''
  const line = document.createElement('span')
  if (cls) line.className = cls
  line.textContent = text + '\n'
  consoleEl.appendChild(line)
  consoleEl.scrollTop = consoleEl.scrollHeight
}

let heartbeat = null
function setBusy(on, label) {
  busy = on
  for (const b of document.querySelectorAll('button.run, #btn-detect, #btn-save-root')) b.disabled = on
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
  if (on) {
    const t0 = Date.now()
    statusEl.textContent = label
    // 心跳：让"卡住了 / 还在跑"一眼可辨；超 8 秒无输出再补一句提示
    heartbeat = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000)
      statusEl.textContent = `${label}（已运行 ${s}s）`
      if (s === 8 && !gotOutput) {
        log('（8 秒没有输出。可能是脚本本身较慢，也可能卡住了 —— 详细输出也会写进 exe 同级 admin-run.log）', 'sys')
      }
    }, 1000)
  } else {
    statusEl.textContent = '就绪'
  }
}
let gotOutput = false

// ── 渲染工具面板 ──
const wrap = $('tools')
for (const g of TOOLS) {
  const fs = document.createElement('fieldset')
  const legend = document.createElement('legend')
  legend.textContent = g.group
  fs.appendChild(legend)
  if (g.hint) {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = g.hint
    fs.appendChild(p)
  }
  for (const t of g.items) {
    const btn = document.createElement('button')
    btn.className = 'run'
    btn.innerHTML = `<span>${t.name}</span><span class="desc">${t.desc || ''}</span>`
    btn.onclick = () => runTool(t)
    fs.appendChild(btn)
  }
  wrap.appendChild(fs)
}

async function runTool(t) {
  if (busy) return
  const root = $('root').value.trim()
  if (!root) return log('⚠ 先探测/指定仓库根', 'err')
  const args = t.args()
  if (t.needPass && !$('pass').value) {
    return log('⚠ 这个工具需要口令。口令永不写默认值 —— 留默认值等于没加密。', 'err')
  }
  consoleEl.textContent = ''
  const shown = args.join(' ').replace(/--passphrase\s+\S+/g, '--passphrase ***')
  // 回显用**语义名**（node / python），真身绝对路径由 Rust 解析后带在报错里
  log(`$ ${t.cmd} ${shown}`, 'sys')
  if (t.needPass) log('（口令经环境变量传入，不显示在命令行）', 'sys')
  setBusy(true, `运行中：${t.name} …`)
  try {
    await invoke('run_tool', {
      root,
      program: t.cmd,
      args,
      envs: t.needPass ? { BPQ_PASSPHRASE: $('pass').value } : {},
    })
  } catch (err) {
    log(`⚠ ${err}`, 'err')
    setBusy(false, '就绪')
  }
}

// ── 后端事件 → 控制台 ──
try {
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
} catch (err) {
  // 事件通道注册失败必须喊出来：否则按钮点了像"没反应"（子进程在跑，输出到不了界面）
  document.addEventListener('DOMContentLoaded', () => {})
  setTimeout(() => {
    const c = document.getElementById('console')
    if (c) {
      const s = document.createElement('span')
      s.className = 'err'
      s.textContent = `⚠ 输出通道注册失败：${err}\n   命令仍会执行，输出会写进 exe 同级 admin-run.log。\n`
      c.appendChild(s)
    }
  }, 600)
}

// ── 输出区高度切换：长输出（回归测试几十行）想多看就放大，选择持久化 ──
const CONSOLE_SIZES = [220, 360, 560]
let sizeIdx = CONSOLE_SIZES.indexOf(Number(localStorage.getItem('console_h')))
if (sizeIdx < 0) sizeIdx = 0
function applyConsoleSize() {
  document.querySelector('.console-wrap').style.flexBasis = CONSOLE_SIZES[sizeIdx] + 'px'
  localStorage.setItem('console_h', String(CONSOLE_SIZES[sizeIdx]))
  $('btn-size').textContent = `高度 ${CONSOLE_SIZES[sizeIdx]}`
}
$('btn-size').onclick = () => {
  sizeIdx = (sizeIdx + 1) % CONSOLE_SIZES.length
  applyConsoleSize()
}
applyConsoleSize()

// ── 仓库根 ──
async function detectRoot() {
  try {
    $('root').value = await invoke('find_root', { explicit: null })
    log(`仓库根：${$('root').value}`, 'sys')
  } catch (err) {
    $('root').value = ''
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

detectRoot()
