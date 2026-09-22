/**
 * Jev（TypeSafe System One）服务端客户端。
 *
 * 为什么必须有这一层，而不是让页面直接打 `api.typesafe.ai`：
 *   1. **Jev 拒绝浏览器直连** —— 预检返回 `400 Disallowed CORS origin`（实测）；
 *   2. **key 绝不能进前端** —— 本站是 `pnpm generate` 出的公开静态产物，
 *      任何走到浏览器的东西等于公开发布。
 * 所以 key 只活在服务端（私有 runtimeConfig），浏览器只同源打 `/api/jev/ask`。
 * 同源还有个附带好处：这个站本身也就不用碰 CORS 白名单。
 *
 * 失败口径沿用本仓库 `server/api/comments` 的 `{ code, message, data }`：
 * 外部服务失败是一种**可解释的业务结果**，不是让异常穿透成 500。
 */

/** 三种问题类型。Jev 不是聊天模型：只做结构化决策，不生成文本。 */
export type JevQuestionType = 'noul' | 'choice' | 'score'

export interface JevUsage {
  input_tokens?: number
  output_tokens?: number
}

export interface JevResult {
  model: string
  answers: Record<string, unknown>
  usage: JevUsage
}

export class JevError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

/** 官方文档只列了这两个可重试状态；5xx 一并重试，网络错误同理。 */
const RETRY_STATUSES = new Set([429, 529])
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400
const TIMEOUT_MS = 60_000

/** 官方上限：Choice 最多 255 个选项，Score 接受 2~10 个档位。 */
const MAX_CHOICE_OPTIONS = 255
const MIN_SCORE_LEVELS = 2
const MAX_SCORE_LEVELS = 10

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `instructions` / `criteria` 的每一项都允许字符串或结构化 JSON
 * （见官方 /primitives/advanced：把长问题拆成「问题 + 它要引用的数据」）。
 * 这里只挡掉既不是字符串也不是结构化值的输入 —— 具体语义交给 Jev。
 */
function isDescription(value: unknown): boolean {
  return typeof value === 'string' || isPlainObject(value) || Array.isArray(value)
}

/**
 * 信任边界校验。前端能随便打字，所以这道闸放在服务端，不靠界面自觉。
 * 返回第一条问题即停 —— 一次说清一个比堆一串更可读。
 */
export function validateRequest(state: unknown, questions: unknown): string | null {
  if (typeof state !== 'string' && !isPlainObject(state) && !Array.isArray(state)) {
    return 'state 必须是字符串、对象或数组'
  }
  if (typeof state === 'string' && !state.trim()) return 'state 不能为空'
  if (!isPlainObject(questions) || !Object.keys(questions).length) {
    return '至少要问一个问题'
  }

  for (const [id, raw] of Object.entries(questions)) {
    if (!isPlainObject(raw)) return `问题「${id}」必须是对象`
    const { type, instructions, criteria } = raw as Record<string, unknown>

    if (type !== 'noul' && type !== 'choice' && type !== 'score') {
      return `问题「${id}」的 type 必须是 noul / choice / score`
    }
    if (!isDescription(instructions)) {
      return `问题「${id}」的 instructions 必须是字符串、对象或数组`
    }

    if (type === 'choice') {
      if (!isPlainObject(criteria) || !Object.keys(criteria).length) {
        return `Choice 问题「${id}」必须给出至少一个选项`
      }
      if (Object.keys(criteria).length > MAX_CHOICE_OPTIONS) {
        return `Choice 问题「${id}」的选项超过 ${MAX_CHOICE_OPTIONS} 个上限`
      }
    }

    if (type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < MIN_SCORE_LEVELS) {
        return `Score 问题「${id}」至少要有 ${MIN_SCORE_LEVELS} 个档位`
      }
      if (criteria.length > MAX_SCORE_LEVELS) {
        return `Score 问题「${id}」的档位超过 ${MAX_SCORE_LEVELS} 个上限`
      }
      if (!criteria.every(isDescription)) {
        return `Score 问题「${id}」的档位必须是字符串、对象或数组`
      }
    }

    // noul 的 criteria（true / false 各一句判据）是可选的，只要形状对就放行。
    if (type === 'noul' && criteria !== undefined && !isPlainObject(criteria)) {
      return `Noul 问题「${id}」的 criteria 必须是对象（true / false）`
    }
  }

  return null
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 服务端已给的 `retry-after`（秒）优先于自算的退避：它是权威值。 */
function backoffMs(attempt: number, retryAfter: string | null): number {
  const fromHeader = retryAfter ? Number(retryAfter) : Number.NaN
  if (Number.isFinite(fromHeader) && fromHeader > 0) {
    return Math.min(fromHeader * 1000, 10_000)
  }
  // 抖动：多个问题一起重试时不要同拍打过去
  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200
}

export interface JevClientConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * 配置来源：**请求时读 `process.env`**，不经过 `useRuntimeConfig()`。
 *
 * 为什么不用 runtimeConfig（这是踩出来的，不是风格偏好）：
 * `nuxt dev` 里 dotenv 加载 `.env` 的时机**晚于** Nitro 应用 `NUXT_*` 运行时覆盖，
 * 于是 `process.env.NUXT_TYPESAFE_API_KEY` 有值、而 `useRuntimeConfig(event).typesafeApiKey`
 * 是空串 —— 接口会报「没读到 key」，但你去 `echo $env:` 明明有值，很难归因。
 * 请求时读 process.env 没有这个时序问题，而且**天然不会被烤进任何产物**：
 * server bundle 里只会留下变量名字面量，不会有值。于是
 * `grep -r "apikey_" .output/` 为空这条验收才真正成立。
 */
export function readJevConfig(): JevClientConfig {
  return {
    apiKey: (process.env.NUXT_TYPESAFE_API_KEY || '').trim(),
    baseUrl: (process.env.NUXT_TYPESAFE_BASE_URL || '').trim() || 'https://api.typesafe.ai',
    model: (process.env.NUXT_TYPESAFE_MODEL || '').trim() || 'jev-latest',
  }
}

export async function askJev(
  config: JevClientConfig,
  state: unknown,
  questions: Record<string, unknown>,
): Promise<JevResult> {
  const payload = { state, model: config.model, questions }
  const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/systemone`
  let lastError: JevError | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          // `fetch` 按 UTF-8 编码字符串 body，中文 state 不会像 PowerShell 5.1 那样被毁掉
          'content-type': 'application/json',
          'authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    }
    catch (error) {
      // 连不上 / 超时：可重试
      lastError = new JevError(502, `连不上 Jev：${(error as Error).message}`, true)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null))
        continue
      }
      break
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { model?: string, answers?: Record<string, unknown>, usage?: JevUsage }
        | null
      if (!body) throw new JevError(502, 'Jev 返回的不是 JSON')
      return {
        model: body.model ?? config.model,
        answers: body.answers ?? {},
        usage: body.usage ?? {},
      }
    }

    const detail = await response.text().catch(() => '')
    const retryable = RETRY_STATUSES.has(response.status) || response.status >= 500

    if (retryable && attempt < MAX_ATTEMPTS) {
      lastError = new JevError(response.status, describeStatus(response.status, detail), true)
      await sleep(backoffMs(attempt, response.headers.get('retry-after')))
      continue
    }

    throw new JevError(response.status, describeStatus(response.status, detail), retryable)
  }

  throw lastError ?? new JevError(502, 'Jev 调用失败')
}

/**
 * 把 Jev 的状态码翻成人话。
 * 关键的一条：`401` 是**服务端 key 的问题**，不是访客的问题 ——
 * 说得含糊会让人去查前端请求头，方向就错了。
 */
function describeStatus(status: number, detail: string): string {
  const suffix = detail ? `（${detail.slice(0, 200)}）` : ''
  if (status === 401) return `服务端 API key 无效或已失效，检查 .env 里的 NUXT_TYPESAFE_API_KEY${suffix}`
  if (status === 422) return `请求体没通过 Jev 校验，多半是某个问题的形状不对${suffix}`
  if (status === 429) return `TypeSafe 限流了（429），已经退避重试仍失败，过一会儿再来${suffix}`
  if (status === 529) return `TypeSafe 暂时过载（529），已经退避重试仍失败，过一会儿再来${suffix}`
  return `Jev 返回 HTTP ${status}${suffix}`
}
