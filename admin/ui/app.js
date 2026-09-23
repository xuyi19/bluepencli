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
// python 走仓库内的 backend/.venv（与测试、提取管线同一个解释器）
const PY = 'backend/.venv/Scripts/python.exe'
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
  const line = document.createElement('span')
  if (cls) line.className = cls
  line.textContent = text + '\n'
  consoleEl.appendChild(line)
  if (consoleEl.textContent.startsWith('（等待操作）')) consoleEl.textContent = ''
  consoleEl.scrollTop = consoleEl.scrollHeight
}

function setBusy(on, label) {
  busy = on
  for (const b of document.querySelectorAll('button.run, #btn-detect, #btn-save-root')) b.disabled = on
  statusEl.textContent = on ? label : '就绪'
}

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
  log(`$ ${t.cmd === 'node' ? 'node' : 'python'} ${shown}`, 'sys')
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
