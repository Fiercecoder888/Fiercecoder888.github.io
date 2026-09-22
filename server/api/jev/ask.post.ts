/**
 * `POST /api/jev/ask` —— 浏览器与 Jev 之间唯一的通道。
 *
 * 为什么不直接暴露 `api.typesafe.ai`：见 `server/utils/jev.ts` 顶部（CORS + key）。
 * 这里只做三件事：取私有配置 → 校验请求体 → 把 Jev 的结果/失败翻成本仓库的
 * `{ code, message, data }` 信封（与 `server/api/comments` 同一口径）。
 */

import { askJev, JevError, readJevConfig, validateRequest } from '../../utils/jev'

interface AskBody {
  state?: unknown
  questions?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AskBody>(event).catch(() => ({} as AskBody))
  const problem = validateRequest(body?.state, body?.questions)
  if (problem) {
    setResponseStatus(event, 400)
    return { code: 400, message: problem, data: null }
  }

  // 配置在请求时读 process.env —— 为什么不用 useRuntimeConfig，见 utils/jev.ts 里的说明
  const config = readJevConfig()
  if (!config.apiKey) {
    // 说清「去哪配」，而不是只说「没配置」——这条失败第一次就会遇到
    setResponseStatus(event, 503)
    return {
      code: 503,
      message: '服务端没读到 NUXT_TYPESAFE_API_KEY：在站点根目录建 .env 写一行 `NUXT_TYPESAFE_API_KEY=...`，然后重启 pnpm dev',
      data: null,
    }
  }

  try {
    const result = await askJev(config, body!.state, body!.questions as Record<string, unknown>)
    return { code: 200, message: 'ok', data: result }
  }
  catch (error) {
    if (error instanceof JevError) {
      // 对外一律 502/400：上游的 401 是**本站 key 的问题**，回给访客 401 会把人
      // 引到「我请求头写错了」那个错误方向去。原始状态码留在 message 里不丢。
      setResponseStatus(event, error.status === 422 ? 400 : 502)
      return { code: error.status, message: error.message, data: { retryable: error.retryable } }
    }
    throw error
  }
})
