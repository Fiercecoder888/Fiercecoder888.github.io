/**
 * `POST /api/jev/round` —— 「Jev 聊天助手网页版」的第一段：看懂对方在做什么。
 *
 * 与 `ask.post.ts` 同一套口径：取私有配置 → 校验请求体 → 把结果/失败翻成
 * `{ code, message, data }` 信封。区别只在于这一条不需要浏览器自己拼问题 ——
 * 问题集来自 `server/data/jevScenes.ts`，由引擎按场景挑。
 *
 * 线上（GitHub Pages 是纯静态，没有 Nitro）这条路由走的是 Netlify 上的
 * `netlify/functions/jev-round.ts`，两边调到的是**同一个** `runRoundEndpoint`。
 */

import { readJevConfig } from '../../utils/jev'
import { runRoundEndpoint } from '../../utils/jevRoundWiring'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const result = await runRoundEndpoint(body, readJevConfig())
  setResponseStatus(event, result.status)
  return result.body
})
