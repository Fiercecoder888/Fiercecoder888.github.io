/**
 * 把「一轮引擎」接到真实模型上：谁当 judge、谁来起草、key 从哪读。
 *
 * 引擎本身（`jevRound.ts`）**不 import 任何东西**，这是刻意的 —— 它要能被一份
 * 脚本化的假 gateway 完整跑一遍（`tools/jev-round-check.mjs`，不花一次 API 调用）。
 * 于是所有 I/O、所有环境变量都收在这个文件里，本地 Nitro 路由与线上 Netlify
 * 函数共用同一份接线，只有「配置从哪来」各交各的。
 *
 * 两个模型分工，这一点很关键，别混：
 *   - **判断**走 Jev（TypeSafe）：只回答 是非题/选择题/打分，**不生成文字**。
 *   - **起草**走一个 chat 模型（任何 OpenAI 兼容端点）：它写的候选**一个字都不能信**，
 *     所以写完之后每一条都要再拿 Jev 检查一遍。
 * 判断这条线是这套东西的价值所在，起草只是省你打字。
 */

import { askJev, JevError, type JevClientConfig } from './jev'
import { JEV_SCENES } from '../data/jevScenes'
import {
  analyseConversation,
  draftAndCheck,
  type Draft,
  type RoundDeps,
  validateDraftInput,
  validateRoundInput,
} from './jevRound'

/* ── 环境变量 ─────────────────────────────────────────── */

/**
 * 读环境变量，Deno 和 Node 都认。
 *
 * 与 `jev-api.ts` 里的 `readKey()` 同一套做法：线上是 Netlify / Deno Deploy 的
 * 平台环境变量，本地是 `pnpm dev` 时读到的站点根目录 `.env`。
 * **任何时候都不打印值**，也不写进任何文件 —— 本站是公开仓库 + 公开静态产物。
 */
function env(name: string): string {
  const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno
  const fromDeno = deno?.env?.get(name)
  if (fromDeno) return fromDeno.trim()
  const fromNode = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name]
  return (fromNode || '').trim()
}

export interface ReplyConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * 起草模型的配置。默认对齐上游（`Drafting` 的默认模型 `deepseek/deepseek-chat-v3.1`，
 * 走 OpenRouter 的 chat completions）。
 *
 * 没配就返回空 key —— 调用方据此把起草阶段整个跳过，判断阶段照常可用。
 * 这条「缺什么就明说、不用假数据顶」的规矩，和 Jev 那条线是一样的。
 */
export function readReplyConfig(): ReplyConfig {
  return {
    apiKey: env('JEV_REPLY_API_KEY') || env('OPENROUTER_API_KEY'),
    baseUrl: env('JEV_REPLY_BASE_URL') || 'https://openrouter.ai/api/v1',
    model: env('JEV_REPLY_MODEL') || 'deepseek/deepseek-chat-v3.1',
  }
}

/* ── 起草 ─────────────────────────────────────────────── */

const REPLY_TIMEOUT_MS = 60_000
const MAX_TOKENS = 420

function makeDraft(config: ReplyConfig): Draft {
  return async ({ system, user, count, temperature }) => {
    let response: Response
    try {
      response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens: MAX_TOKENS,
          stream: false,
        }),
        signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
      })
    }
    catch (error) {
      throw new Error(`连不上起草模型：${(error as Error).message}`)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(describeReplyStatus(response.status, detail))
    }

    const body = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null
    return parseCandidates(String(body?.choices?.[0]?.message?.content ?? ''), count)
  }
}

function describeReplyStatus(status: number, detail: string): string {
  const suffix = detail ? `（${detail.slice(0, 200)}）` : ''
  if (status === 401 || status === 403) {
    return `起草模型的 key 被拒（${status}）：查线上环境变量 OPENROUTER_API_KEY（或 JEV_REPLY_API_KEY）${suffix}`
  }
  if (status === 402) return `起草模型账户余额不足（402）${suffix}`
  if (status === 429) return `起草模型限流（429），过一会儿再来${suffix}`
  return `起草模型返回 HTTP ${status}${suffix}`
}

/*
 * 注意：这里**不再转出** `parseCandidates`。Nitro 会把 `server/utils/**` 的导出
 * 全部自动导入（auto-import），同一个名字从两个模块导出会触发
 * 「Duplicated imports ... has been ignored」告警，而真正被用的那个还未必是你想的那个。
 * 实现留在引擎里（纯函数，可被自检脚本打），调用方（起草那条路）从引擎 import。
 */

/* ── 组装 ─────────────────────────────────────────────── */

/**
 * 一份接好线的 deps。`reply.apiKey` 为空时 `draft` 是 null —— 引擎据此把起草阶段
 * 标成「没配」而不是「失败」，判断阶段不受影响。
 */
export function makeDeps(jev: JevClientConfig, reply: ReplyConfig = readReplyConfig()): RoundDeps {
  return {
    scenes: JEV_SCENES,
    judge: async (state, questions) => (await askJev(jev, state, questions)).answers,
    draft: reply.apiKey ? makeDraft(reply) : null,
  }
}

/** 这个部署到底能做什么 —— 页面据此决定要不要显示「起草」按钮。 */
export function capabilities(reply: ReplyConfig = readReplyConfig()) {
  return {
    analyse: true,
    draft: Boolean(reply.apiKey),
    draftModel: reply.apiKey ? reply.model : null,
  }
}

/* ── 请求体校验 ───────────────────────────────────────── */

/**
 * 校验搬到了引擎里（`jevRound.validateRoundInput` / `validateDraftInput`）：
 * 那是**信任边界** —— 前端能随便打字，所以这道闸值得被自检脚本用真场景表打一遍。
 * 代价只是调用时把场景表当参数传进去，换来的是规则可测。
 */

/* ── 两个端点（Nitro 路由与 Netlify 函数都调这里） ───── */

export interface Envelope {
  code: number
  message: string
  data: unknown
}

export interface EndpointResult {
  status: number
  body: Envelope
}

/**
 * 判断阶段。**不需要起草模型的 key**：这条路只需要 Jev。
 *
 * 校验放在查 key 之前是刻意的：请求体对不对，跟服务端配没配 key 是两件事。
 * 先校验，那么「你粘的是空的」这种错在**任何配置下**都答得出来；反过来的话，
 * 一个没配 key 的部署会把所有输入问题都吞成 503，前端也就永远调不对自己的请求。
 */
export async function runRoundEndpoint(
  raw: unknown,
  jev: JevClientConfig,
  reply: ReplyConfig = readReplyConfig(),
): Promise<EndpointResult> {
  const { input, problem } = validateRoundInput(raw, JEV_SCENES)
  if (problem || !input) return { status: 400, body: { code: 400, message: problem!, data: null } }
  if (!jev.apiKey) return missingJevKey()

  try {
    const result = await analyseConversation(input, makeDeps(jev, reply))
    if (!result.stage.ok) {
      return { status: 400, body: { code: 400, message: result.stage.reason ?? '判断没有完成', data: null } }
    }
    return {
      status: 200,
      body: {
        code: 200,
        message: 'ok',
        data: {
          analysis: result.analysis,
          messages: result.messages.length,
          turn: result.turn.length,
          budget: result.budget,
          notes: result.notes,
          capabilities: capabilities(reply),
        },
      },
    }
  }
  catch (error) {
    return jevFailure(error)
  }
}

/**
 * 起草 + 检查 + 打分。没配起草 key 时**不是错误**，是一种明确的状态：
 * 返回 200 + `stage.ok=false` + 原因，页面上照实说，判断部分继续可用。
 */
export async function runDraftEndpoint(
  raw: unknown,
  jev: JevClientConfig,
  reply: ReplyConfig = readReplyConfig(),
): Promise<EndpointResult> {
  const { input, problem } = validateDraftInput(raw, JEV_SCENES)
  if (problem || !input) return { status: 400, body: { code: 400, message: problem!, data: null } }
  if (!jev.apiKey) return missingJevKey()

  try {
    const result = await draftAndCheck(input, makeDeps(jev, reply))
    return {
      status: 200,
      body: {
        code: 200,
        message: 'ok',
        data: {
          candidates: result.candidates,
          topPick: result.topPick,
          stage: result.stage,
          budget: result.budget,
          notes: result.notes,
        },
      },
    }
  }
  catch (error) {
    return jevFailure(error)
  }
}

function missingJevKey(): EndpointResult {
  return {
    status: 503,
    body: {
      code: 503,
      message: '服务端没读到 Jev 的 key：本地开发在站点根目录 .env 写 NUXT_TYPESAFE_API_KEY；'
        + '线上在部署平台的环境变量里配 TYPESAFE_API_KEY',
      data: null,
    },
  }
}

function jevFailure(error: unknown): EndpointResult {
  if (error instanceof JevError) {
    // 上游 401 是**本站 key 的问题**，回给访客 401 会把人引到「我请求写错了」那个方向去
    return {
      status: error.status === 422 ? 400 : 502,
      body: { code: error.status, message: error.message, data: { retryable: error.retryable } },
    }
  }
  return {
    status: 502,
    body: { code: 502, message: `服务端异常：${(error as Error).message}`, data: null },
  }
}
