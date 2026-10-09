/**
 * 网页版两个端点的探针 —— 对着**正在跑的**服务器打真实 HTTP。
 *
 * 跑法（先起服务）：
 *   pnpm dev --port 3011
 *   node tools/jev-endpoints-check.mjs --base http://localhost:3011
 *
 * 它同时管两件事：
 *
 * 1. **哪一类错由谁负责** —— 这些不需要真的调模型：
 *    请求体不合法 → 400 且说清哪儿不对；请求合法但没配 key → 503 且说清去哪儿配；
 *    POST-only 的路由收到 GET 要被拒；老的 `/api/jev/ask` 照旧（改 handler 时别碰坏它）。
 *    校验刻意排在查 key **之前**：否则一个没配 key 的部署会把所有输入问题都吞成 503，
 *    前端也就永远调不对自己的请求。
 *
 * 2. **配了 key 的环境里，把整条真路走通** —— 这几条会**真的调 Jev（花钱）**：
 *    判断那一路必须拿回真实的行为概率和立场（不是一片零、也不是空 answers），
 *    ask 那一路必须拿回答案。**「HTTP 200 但什么都没有」是最危险的失败**：
 *    零概率和零答案在界面上长得一模一样，所以这里查的是内容，不是状态码。
 *
 * ⚠️ 注意 TypeSafe 按**出口 IP** 做地区限制：直连会返回 451
 * `Typesafe is not available in your region.`。本机需要让服务端进程走代理：
 *   $env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:NODE_USE_ENV_PROXY='1'; pnpm dev --port 3011
 * （Node 24 起 `NODE_USE_ENV_PROXY` 才让 fetch 认这两个环境变量。）
 *
 * 还有一点：`nuxt dev` 只监听 IPv6 的 localhost，所以 `--base http://127.0.0.1:3011`
 * 会被直接拒绝 —— 用 `http://localhost:3011` 或 `http://[::1]:3011`。
 */

const argv = process.argv.slice(2)
const baseArg = argv[argv.indexOf('--base') + 1]
const BASE = (argv.includes('--base') ? baseArg : 'http://localhost:3011').replace(/\/+$/, '')

/** 等服务器起来：`nuxt dev` 首次编译要几十秒，别一上来就判死。 */
async function waitReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/worklog/`, { redirect: 'manual' })
      if (response.status < 500) return true
    }
    catch {
      // 还没起来
    }
    await new Promise(resolve => setTimeout(resolve, 1_500))
  }
  return false
}

async function post(path, body, method = 'POST') {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await response.json()
  }
  catch {
    // 非 JSON 响应：状态码仍然算数
  }
  return { status: response.status, code: json?.code, message: String(json?.message ?? ''), data: json?.data }
}

const CHAT = '对方：关于上周那个方案\n我：嗯，你说\n对方：你看今天下班前能不能先把目录定下来'

/**
 * 每一条：[名字, 路径, 请求体, 期望状态, 消息要匹配的正则, 配了 key 时（即真的返回 200）
 * 要验证的内容]。最后一项是这次探针的重点 —— 状态码 200 什么都不能证明。
 */
const cases = [
  ['round 完全空的请求体', '/api/jev/round', {}, 400, /scene 必须是/],
  ['round 场景合法但对话为空', '/api/jev/round', { scene: 'work', chat: '   ' }, 400, /粘进来/],
  ['round 场景不存在', '/api/jev/round', { scene: 'nope', chat: CHAT }, 400, /scene 必须是/],
  ['round 关系不属于该场景', '/api/jev/round', { scene: 'work', chat: CHAT, relationship: '外星人' }, 400, /不属于/],
  ['round 对话超长', '/api/jev/round', { scene: 'work', chat: 'x'.repeat(9_000) }, 400, /太长/],
  [
    'round 合法输入',
    '/api/jev/round',
    { scene: 'work', chat: CHAT },
    503,
    /NUXT_TYPESAFE_API_KEY/,
    (data) => {
      const behaviours = data?.analysis?.behaviours ?? []
      if (!behaviours.length) return '返回里没有行为题 —— 判断没真的跑成'
      const answered = behaviours.filter(b => typeof b.p === 'number' && b.p > 0).length
      if (!answered) return '所有行为概率都是 0 —— 这正是「200 但一片零」的静默失败'
      if (!data.analysis.stanceSplit?.length) return '没有立场分布 —— 立场那一步没跑成'
      return null
    },
  ],
  [
    'draft 合法输入',
    '/api/jev/draft',
    { scene: 'work', chat: CHAT, stanceId: '认不出来的立场' },
    503,
    /NUXT_TYPESAFE_API_KEY/,
    (data) => (data?.stage ? null : '返回里没有 stage —— 起草那一步的状态没人交代'),
  ],
  [
    '老端点 ask 没被改坏',
    '/api/jev/ask',
    { state: '现在是白天', questions: { q: { type: 'noul', instructions: '现在是白天吗？' } } },
    503,
    /NUXT_TYPESAFE_API_KEY/,
    (data) => (Object.keys(data?.answers ?? {}).length ? null : 'ask 返回了 200 但一个答案都没有'),
  ],
]

if (!await waitReady()) {
  console.error(`✗ 两分钟内没能连上 ${BASE} —— 先起服务：pnpm dev --port 3011`)
  console.error('  提示：`nuxt dev` 只监听 IPv6 的 localhost，`http://127.0.0.1:3011` 会被拒绝；')
  console.error('       用 `--base http://localhost:3011`，或显式写 `--base \'http://[::1]:3011\'`。')
  process.exit(1)
}
console.log(`端点探针 ${BASE}\n`)

let failed = 0
for (const [name, path, body, wantStatus, wantMessage, verifyWhenKeyed] of cases) {
  const result = await post(path, body)

  if (result.status === 200 && wantStatus === 503) {
    // 这个环境配了 key：状态码对了不等于内容对了，继续往下看内容
    const problem = verifyWhenKeyed ? verifyWhenKeyed(result.data) : null
    if (problem) failed += 1
    console.log(`  ${problem ? '✗' : '✓'} ${name.padEnd(24)} HTTP 200（这个环境配了 key，真调了模型）`
      + `${problem ? `  ← ${problem}` : '  内容核对通过'}`)
    continue
  }

  const ok = result.status === wantStatus && wantMessage.test(result.message)
  if (!ok) failed += 1
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(24)} HTTP ${result.status}（期望 ${wantStatus}）  ${result.message.slice(0, 52)}`)
}

// POST-only 路由收到 GET：Nitro 回 404（它不会替一个只有 .post.ts 的路由补 405）。
// 两种都算「没被受理」，但别把 200 放过 —— 那说明方法约束没了。
const get = await post('/api/jev/round', null, 'GET')
const getRejected = get.status === 404 || get.status === 405
if (!getRejected) failed += 1
console.log(`  ${getRejected ? '✓' : '✗'} ${'GET 不该被受理'.padEnd(24)} HTTP ${get.status}（期望 404 或 405）`)

const total = cases.length + 1
console.log(`\n${failed ? '✗' : '✓'} ${total - failed}/${total} 项符合预期`)
process.exit(failed ? 1 : 0)
