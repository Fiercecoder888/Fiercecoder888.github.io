/**
 * Netlify Functions v2 适配层 —— **只是一个转调**，和 `jev-api.ts` 用的是同一个 handler。
 *
 * 起草这一路会往外发一次 chat 模型请求（真花钱），所以它和判断一样受
 * 根目录 `jev-api.ts` 里那道每 IP 限流管着 —— 这也是把两条路放进同一个 handler
 * 而不是各写一套的原因：限流一旦复制成两份，迟早有一份忘了改。
 */

import { handler } from '../../jev-api.ts'

export const config = { path: '/api/jev/draft' }

export default function jevDraft(
  req: Request,
  context: { ip?: string },
): Promise<Response> {
  return handler(req, { remoteAddr: { hostname: context?.ip || '' } })
}
