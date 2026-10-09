/**
 * Netlify Functions v2 适配层 —— **只是一个转调**，和 `jev-api.ts` 用的是同一个 handler。
 *
 * 为什么单独一个文件、单独声明挂载路径，而不是把 `/api/jev/ask` 改成通配
 * `/api/jev/*` 一把抓：改老的挂载点有把已经在跑的那个端点弄挂的风险，而多一个
 * 三行的适配层没有任何逻辑成本。三个路径各挂各的，互不影响；handler 内部按
 * 路径后缀分发（见 `../../jev-api.ts`）。
 *
 * 什么逻辑都不在这里：CORS、限流、读 key 在根目录 `jev-api.ts`，
 * 判断流程在 `../../server/utils/jevRoundWiring.ts` → `../../server/utils/jevRound.ts`。
 */

import { handler } from '../../jev-api.ts'

export const config = { path: '/api/jev/round' }

export default function jevRound(
  req: Request,
  context: { ip?: string },
): Promise<Response> {
  return handler(req, { remoteAddr: { hostname: context?.ip || '' } })
}
