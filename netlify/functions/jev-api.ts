/**
 * Netlify Functions v2 适配层 —— **只是一个转调**。
 *
 * 真正的实现有两处，都不在这里：
 *   - `../../jev-api.ts`（仓库根）：CORS、限流、从环境变量取 key，并导出 handler
 *   - `../../server/utils/jev.ts`：请求体校验、429/529 退避重试、错误翻译
 *     （本地 Nitro 路由 `server/api/jev/ask.post.ts` 用的是同一份）
 *
 * 所以这个文件里**没有任何业务逻辑**，只有一个「Netlify 的入参 → 我们的 handler」
 * 的签名转换。多一个平台适配层是平台的代价，不是逻辑的副本。
 *
 * 为什么不用 `import type { Config, Context } from '@netlify/functions'`：
 * 那会给这个仓库引入一个新依赖，而它只提供类型。这里用内联类型，
 * 效果一样但不多装任何东西。
 *
 * `config.path` 把函数挂到 `/api/jev/ask`（默认会挂在
 * `/.netlify/functions/jev-api`），于是前端 `JEV_API_BASE` + `/api/jev/ask`
 * 的组合不用改一个字 —— 和本地 Nitro 路由的路径也完全一致。
 */

import { handler } from '../../jev-api.ts'

export const config = { path: '/api/jev/ask' }

export default function jev(
  req: Request,
  context: { ip?: string },
): Promise<Response> {
  // handler 的第二个参数是「请求来自哪个 IP」，限流按它分桶。
  // Netlify 会给 context.ip；万一没有，handler 内部还会回退到 x-forwarded-for。
  return handler(req, { remoteAddr: { hostname: context?.ip || '' } })
}
