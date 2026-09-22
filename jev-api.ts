/**
 * Jev 决策台的服务端代理 —— 部署在 **Deno Deploy**（免费档）。
 *
 * 为什么需要这个文件（而不是让网页直接调 Jev）：
 *   1. **Jev 拒绝浏览器直连** —— 对 api.typesafe.ai 发 CORS 预检返回
 *      `400 Disallowed CORS origin`（实测）。
 *   2. **key 不能进浏览器** —— 本仓库是 public，Pages 上发的是公开静态产物，
 *      任何走到前端的东西等于公开发布。
 * 所以 key 只活在这里（Deno Deploy 的环境变量，加密存储、不进仓库），
 * 网页只跟这个函数的地址说话。
 *
 * 为什么不用 Cloudflare Workers / Vercel：**在本机网络下这两个域被 DNS 投毒** ——
 * 随机子域 `*.workers.dev` 解析到 Dropbox 的 IP、`*.vercel.app` 解析到 Facebook 的 IP，
 * 都返回 000。Deno Deploy（`*.deno.dev`）解析正常且能拿到真实响应。
 *
 * ⚠️ 这个端点一旦公开，任何人都能花掉你的 Jev 额度。两道闸见下。
 */

import { askJev, JevError, validateRequest } from './server/utils/jev.ts'

/**
 * Jev 的调用逻辑（请求体校验、429/529 退避重试、错误翻译）**只有一份**：
 * `server/utils/jev.ts`。它没有 import 任何 Node 专属 API（只用 `fetch` 和
 * `AbortSignal.timeout`），所以本地 Nitro 路由和这个线上 worker 能共用同一个实现，
 * 不存在「两边各写一套、迟早分叉」的问题。
 *
 * 这里只负责**这个端点特有的三件事**：CORS、限流、从环境变量取 key。
 */

const BASE_URL = 'https://api.typesafe.ai'

/** 单次请求的 state 上限。Jev 自己限制 32k token，这里再加一道更保守的字符数闸。 */
const MAX_STATE_CHARS = 60_000
/** 一次最多问几个问题。官方建议合并调用，但不该无限。 */
const MAX_QUESTIONS = 50

/**
 * 允许的来源。注意这只是**挡浏览器跨站调用**，不是安全边界：
 * `Origin` 是请求头，脚本可以随便伪造。真正的防线是下面的限流。
 */
const ALLOWED_ORIGINS = new Set([
  'https://fiercecoder888.github.io',
  // 本地调试用（Nuxt dev / 静态产物预览）
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4180',
  'http://127.0.0.1:4180',
])

/**
 * 每 IP 限流 —— **默认防护的主力**。
 *
 * 记忆体限流的固有局限：Deno Deploy 的 isolate 会被回收、也可能多实例，
 * 所以它是「每实例、尽力而为」，不是精确配额。对个人站足够：
 * Jev 只收 input token（$0.042/百万），一次请求约 450 token ≈ $0.000019，
 * $1 约等于 53000 次请求 —— 就算被刷，配合限流也只是可忽略的量级。
 *
 * 加限流还有个实际理由：TypeSafe 的账号级限流是 1200 次/分钟，
 * 被刷爆的话**先拿到 429 的是你自己**。
 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 20
const hits = new Map<string, { count: number, resetAt: number }>()

function clientKey(req: Request, info?: { remoteAddr?: { hostname?: string } }): string {
  const direct = info?.remoteAddr?.hostname
  if (direct) return direct
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return 'unknown'
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const entry = hits.get(key)

  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    // 顺手清理过期条目，避免 Map 无限增长
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k)
    }
    return false
  }

  entry.count += 1
  return entry.count > RATE_MAX
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'vary': 'Origin',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin
  }
  return headers
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

/**
 * key 的来源：Deno Deploy 的环境变量。
 *
 * 同时兼容 `process.env`，这样验证脚本能在 Node 下 import 同一份代码 ——
 * 不必为了测一次就去装 Deno。
 */
function readKey(): string {
  const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno
  const fromDeno = deno?.env?.get('TYPESAFE_API_KEY')
  if (fromDeno) return fromDeno.trim()
  const fromNode = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TYPESAFE_API_KEY
  return (fromNode || '').trim()
}

interface AskBody {
  state?: unknown
  questions?: unknown
}

export async function handler(
  req: Request,
  info?: { remoteAddr?: { hostname?: string } },
): Promise<Response> {
  const origin = req.headers.get('origin')

  // 预检：浏览器发 POST 之前会先问这一句
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return json({ code: 405, message: '只支持 POST', data: null }, 405, origin)
  }

  // 闸 1：来源
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ code: 403, message: `来源不被允许：${origin}`, data: null }, 403, origin)
  }

  // 闸 2：限流（主力）
  if (rateLimited(clientKey(req, info))) {
    return json(
      { code: 429, message: `请求太频繁（每分钟最多 ${RATE_MAX} 次），请稍后再试`, data: { retryable: true } },
      429,
      origin,
    )
  }

  const apiKey = readKey()
  if (!apiKey) {
    // 说清「去哪配」，而不是只说「没配置」
    return json(
      {
        code: 503,
        message: '服务端没读到 TYPESAFE_API_KEY：去 Deno Deploy 控制台 → 你的 App → Settings → 环境变量，加一个 TYPESAFE_API_KEY',
        data: null,
      },
      503,
      origin,
    )
  }

  let body: AskBody
  try {
    body = (await req.json()) as AskBody
  }
  catch {
    return json({ code: 400, message: '请求体不是合法 JSON', data: null }, 400, origin)
  }

  const problem = validateRequest(body?.state, body?.questions)
  if (problem) return json({ code: 400, message: problem, data: null }, 400, origin)

  if (typeof body.state === 'string' && body.state.length > MAX_STATE_CHARS) {
    return json(
      { code: 400, message: `state 太长（${body.state.length} 字符，上限 ${MAX_STATE_CHARS}）`, data: null },
      400,
      origin,
    )
  }
  if (Object.keys(body.questions as object).length > MAX_QUESTIONS) {
    return json({ code: 400, message: `问题太多（上限 ${MAX_QUESTIONS} 个）`, data: null }, 400, origin)
  }

  try {
    const result = await askJev(
      { apiKey, baseUrl: BASE_URL, model: 'jev-latest' },
      body.state,
      body.questions as Record<string, unknown>,
    )
    return json({ code: 200, message: 'ok', data: result }, 200, origin)
  }
  catch (error) {
    if (error instanceof JevError) {
      // 上游的 401 是**本站 key 的问题**，回给访客 401 会把人引到
      // 「我请求头写错了」那个错误方向。所以对外一律 502/400，
      // 原始状态码留在 message 里不丢。
      return json(
        { code: error.status, message: error.message, data: { retryable: error.retryable } },
        error.status === 422 ? 400 : 502,
        origin,
      )
    }
    return json({ code: 502, message: `服务端异常：${(error as Error).message}`, data: null }, 502, origin)
  }
}

/**
 * Deno Deploy 的约定：入口模块自己起服务。
 *
 * 加 `typeof Deno` 判断是为了让同一份代码能在 Node 下被 import 验证 ——
 * Node 里没有 Deno.serve，于是不会起监听，验证脚本直接调 `handler`。
 */
const maybeDeno = (globalThis as { Deno?: { serve?: (h: typeof handler) => unknown } }).Deno
if (maybeDeno?.serve) {
  maybeDeno.serve(handler)
}
