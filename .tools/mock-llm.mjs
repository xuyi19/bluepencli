// 本地 mock LLM：把 OpenAI 兼容接口假装出来，用来端到端验证批改链路。
//
// 存在的理由：没有真 API Key 时，「答题 → 批改 → 色标批注 → 归档复盘」这条主链路
// 完全无法验证。用一个返回固定 JSON 的假服务，可以把前端编排、解析、渲染、
// 落盘全跑一遍——真 Key 只影响内容质量，不影响链路正确性。
//
// 用法：node mock-llm.mjs [port]
// 然后在设置页把 Base URL 填成 http://127.0.0.1:9731/v1 （模型名随意）

import http from 'node:http'

const PORT = Number(process.argv[2] || 9731)

// 作答里必须能定位到这些句子，色标批注才标得出来
const QUOTES = {
  yuandong: '把养老产业简单等同于养老院和护理床位',
  zhoutairan: '一方面企业要加快研发，另一方面政府要加大补贴',
  bailu: '因此，我们要高度重视养老问题',
}

function teacherReply(name, id) {
  const quote = QUOTES[id] || '养老问题十分重要'
  return {
    teacherId: id,
    score: id === 'yuandong' ? 31 : id === 'zhoutairan' ? 35 : 33,
    maxScore: 40,
    level: '三类上',
    dimensions: [
      { name: '采分点', score: 12, max: 15, comment: '主要分论点基本到位，但"银发经济"未展开。' },
      { name: '结构', score: 10, max: 12, comment: '总分总清晰，中间两段略单薄。' },
      { name: '语言', score: 9, max: 13, comment: '表达平实，缺少提炼。' },
    ],
    annotations: [
      {
        quote,
        type: '采分词缺失',
        comment: `${name}视角：这句把银发经济的产业属性窄化了，丢掉了"适老化产品""消费升级"两个采分词。`,
        fix: '改成：银发经济不只是养老服务，更涵盖适老化产品研发与银发消费市场培育。',
      },
      {
        quote: '因此，我们要高度重视养老问题',
        type: '空泛表态',
        comment: '结尾只表态不落措施，阅卷时容易滑档。',
        fix: '结尾应回扣分论点，落到"需求—供给—政策"三个抓手上。',
      },
    ],
    deductions: [
      { point: '银发经济的产业属性未点明', score: 3, reason: '材料强调"产业蓝海"，作答只谈民生。', fix: '在第二段补一句产业视角。' },
      { point: '结尾空泛', score: 2, reason: '无具体抓手。', fix: '用三句话分别回扣三个分论点。' },
    ],
    summary: `${name}认为：整体框架立得住，问题在于把"养老刚需"写成了纯民生题，产业蓝海这一层没有接住。`,
    advice: `如果只改一处，先改第二段。现在这段只写了"企业要研发、政府要补贴"，是正确但没信息量的话。把它换成"需求侧升级—供给侧补短—政策侧托举"的三层递进，并直接引用材料里的适老化产品增速数据，这一处改完大概能从三类上摸到二类下。`,
    suggestions: ['第二段补产业视角', '结尾落到三个抓手', '引用材料数据'],
  }
}

const FUSION = {
  finalScore: 33,
  maxScore: 40,
  level: '三类上',
  roundtableNote: '三位老师对结构判断一致，对"产业属性"是否点明存在分歧，经复核采纳。',
  criticalIssues: [
    { issue: '把"养老刚需"写成纯民生题，未接住"产业蓝海"', fix: '第二段补产业视角与材料数据', source: '袁东' },
    { issue: '结尾空泛表态', fix: '用三个抓手回扣', source: '白鹭' },
  ],
  minorIssues: [{ issue: '分论点三展开不足', fix: '补一个具体案例' }],
  highlights: [{ point: '开篇引"老吾老以及人之老"', why: '引用贴切，入题自然' }],
  dimensions: [
    { name: '采分点', score: 13, max: 15, comment: '主要要点齐，产业属性缺' },
    { name: '结构', score: 10, max: 12, comment: '总分总清晰' },
    { name: '语言', score: 10, max: 13, comment: '平实' },
  ],
  summary: '框架完整、要点基本到位，主要失分在"产业蓝海"这一层没有接住，以及结尾空泛。',
  suggestions: ['第二段补产业视角', '引用材料数据', '结尾落到三个抓手'],
}

const DEBATE = {
  disputes: [
    {
      topic: '把银发经济写成为民生题是否算偏题',
      positions: [
        { teacher: 'yuandong', view: '漏掉产业采分词，应扣分' },
        { teacher: 'zhoutairan', view: '要点处理尚可，不必重扣' },
      ],
      ruling: '采纳袁东意见，扣 2 分',
      reason: '材料标题即为"产业蓝海"，产业属性属核心采分点。',
      adopted: ['yuandong'],
    },
  ],
  overall: '复核后确认核心分歧属实，已按材料主旨收敛。',
}

function pickReply(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  if (sys.includes('阅卷组组长')) return FUSION
  if (sys.includes('裁定') || sys.includes('分歧')) return DEBATE
  const m = sys.match(/你是基于「([^」]+)」/)
  const name = m ? m[1] : '老师'
  const map = { 袁东: 'yuandong', 周泰然: 'zhoutairan', 白鹭: 'bailu', Kiwi: 'kiwi', 李崇立: 'lichongli' }
  return teacherReply(name, map[name] || 'yuandong')
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    })
    return res.end()
  }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(body || '{}')
    } catch {
      /* 忽略 */
    }
    const reply = pickReply(payload.messages || [])
    const text = JSON.stringify(reply)
    console.log(`[mock] ${req.url} -> 返回 ${text.length} 字符`)

    if (payload.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      })
      // 分片推，模拟真实流式（也能顺带验证前端增量拼接）
      for (let i = 0; i < text.length; i += 200) {
        const piece = text.slice(i, i + 200)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(
      JSON.stringify({
        model: 'mock-model',
        choices: [{ message: { content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      })
    )
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LLM 已启动：http://127.0.0.1:${PORT}/v1/chat/completions`)
})
