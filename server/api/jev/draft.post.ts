/**
 * `POST /api/jev/draft` —— 「Jev 聊天助手网页版」的第二段：起草候选，再逐条检查打分。
 *
 * 单独一条路由（而不是跟判断挤在一起）有两个实际理由：
 *   1. 页面能先把判断结果给出来，不用等起草模型 —— 上游的一轮也是分阶段的；
 *   2. 起草要走一次 chat 模型、后面还会跟着几次 Jev 请求，耗时比判断长得多，
 *      分开之后两段的超时与失败互不牵连。
 *
 * 没配起草模型的 key 时这里**不是报错**：返回 200 + `stage.ok=false` + 原因，
 * 页面照实说明「判断能用，起草没配」，不用假数据顶。
 */

import { readJevConfig } from '../../utils/jev'
import { runDraftEndpoint } from '../../utils/jevRoundWiring'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const result = await runDraftEndpoint(body, readJevConfig())
  setResponseStatus(event, result.status)
  return result.body
})
