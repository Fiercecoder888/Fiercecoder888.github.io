# Jev 聊天助手 · 网页版

把一段对话粘进来 → **Jev 判断对方在做什么、该采取什么立场** → （可选）起草 3 条候选回复并**逐条检查打分** → 你自己挑一条复制走。

地址：`/jev`（线上 `https://fiercecoder888.github.io/jev/`）

移植自开源产品 [jev-chat/jev-chat-jarvis](https://github.com/jev-chat/jev-chat-jarvis)（MIT）。原产品挂在聊天 App 旁边读屏；网页读不到别的 App，所以两端换掉了（**读屏 → 粘贴**、**填入输入框 → 复制**），中间那一段按原口径搬过来。**发送永远由人自己做 —— 这个页面没有任何发送路径。**

---

## 一轮是怎么走的

```
粘贴对话 → 判断（2 次 Jev）→ 定立场 → 起草 2~3 条（chat 模型）
        → 逐条硬检查 + G/E 打分（每条 1 次 Jev）→ 复制 → 你自己按发送
```

| 阶段 | 靠什么 | 现在能不能用 |
|---|---|---|
| 判断（行为 / 语气 / 摩擦 / 立场 / 下一步） | Jev（TypeSafe），只答是非题、选择题、打分 | ✅ 只要是能连上 TypeSafe 的网络就能用 |
| 起草 3 条候选 | 一个 chat 模型（任何 OpenAI 兼容端点） | ⚠️ 需要额外配 `OPENROUTER_API_KEY`；没配就只出判断，页面会明说 |
| 检查 + 打分 | Jev | ✅ 跟着起草走 |

三个关键口径（都来自原产品，不是我们发明的）：

- **不确定就交回给人**。概率落在 0.35~0.5 之间的答案不进结论，页面单独列出来让你自己判断。
- **硬检查会拦下候选**：替你许下没授权的承诺、替别人承诺、超出这一轮的目标、说了对话里没有的事实、立场相反、越过对方立的边界 —— 命中就不给用，并说明是哪一条。
- **分数是 `S = 0.7G + 0.3E`**（G 目标完成度、E 这个关系里的分寸，各 0~5）。「首选」只给状态正常、判断不分裂、且比第二名高 0.2 以上的那条；缺了必含项时 G 封顶 3。

---

## 本机怎么跑

```powershell
# 1) 起服务（端口随便挑）
$env:HTTPS_PROXY='http://127.0.0.1:7890'; $env:NODE_USE_ENV_PROXY='1'
pnpm dev --port 3011
# 2) 打开 http://localhost:3011/jev/
```

**为什么要带代理**：TypeSafe 按**出口 IP** 做地区限制，直连返回
`451 Typesafe is not available in your region.`（实测）。经代理后同一个请求变成 `401`
（只是 key 无效），说明限制是按出口 IP 的。`NODE_USE_ENV_PROXY=1` 是必须的 ——
Node 24 起 `fetch` 才认 `HTTPS_PROXY` 这两个环境变量，只设代理地址没用。

> 线上不需要代理：Netlify 函数的出口不在受限地区。受限的只是**本机直连**。

key 放站点根目录 `.env`（已被 `.gitignore` 忽略，**别提交**）：

```
NUXT_TYPESAFE_API_KEY=...          # Jev 的 key，判断这一路必须
OPENROUTER_API_KEY=...             # 可选：起草候选回复要用；不配就只出判断
```

---

## 线上要配什么

网页是 GitHub Pages 上的纯静态产物，没有 Node 运行时，所以判断必须打到外面那个函数上：

1. **部署两个函数**：仓库里 `netlify/functions/jev-round.ts`（判断）与
   `netlify/functions/jev-draft.ts`（起草+检查）已经写好，各挂 `/api/jev/round`、
   `/api/jev/draft`。它们和老的 `jev-api.ts`（`/api/jev/ask`）**共用同一个 handler**
   —— CORS、限流、读 key 只有一份。
2. **给函数配环境变量**：`TYPESAFE_API_KEY`（必须），`OPENROUTER_API_KEY`（可选）。
   key 只活在平台侧，**永远不进仓库、不进前端产物**。
3. **给仓库配变量** `JEV_API_BASE` = 函数所在站点的地址（Settings → Secrets and
   variables → Actions → Variables，不是 Secret —— 它只是个 URL，本来就会进公开产物）。
   `deploy.yml` 会把它传给构建：`NUXT_PUBLIC_JEV_API_BASE`。
4. 重新触发一次部署（推一次 main 或在 Actions 里手动跑）。**没配第 3 步时页面顶部会明说
   「还没接上后端」**，而不是等一个 404 —— 这是刻意做的：假装能用比报错糟。

限流在函数里：**每 IP 每分钟 20 次**。一轮判断约 2 次 Jev 调用、起草约 4 次
（1 次 chat + 3 次检查），一轮的量级是几厘钱。

---

## 代码在哪

| 文件 | 干什么 |
|---|---|
| `app/pages/jev/index.vue` | 页面 |
| `server/api/jev/round.post.ts`、`draft.post.ts` | 本地（Nitro）的两条路由 |
| `netlify/functions/jev-round.ts`、`jev-draft.ts` | 线上（Netlify）的两个适配层，只是转调 |
| `server/utils/jevRound.ts` | **一轮引擎**：解析、问法、三态阈值、检查、G/E、首选规则。不 import 任何东西（依赖全注入），所以能被脚本化 gateway 完整验一遍 |
| `server/utils/jevRoundWiring.ts` | 接线：谁当 judge、谁起草、key 从哪读、请求体校验、两个端点 |
| `server/utils/jev.ts` | Jev 客户端（原有） |
| `server/data/jevScenes.ts` | 5 个场景的判断题与立场表（46 行为 / 15 语气 / 25 摩擦 / 20 立场），中英双份问法 |

**为什么问句有中英两份**：原产品实测，Jev 的 `instructions/criteria` 用**英文**、
`state` 用中文时，confidence 明显更高（0.99 vs 0.84）且打分更稳。所以问 Jev 用 `qEn`，
界面显示用 `q`。

---

## 怎么验（都不需要花 API 额度）

```powershell
node tools/jev-round-check.mjs                       # 29 项：解析、阈值、硬检查、G 封顶、首选、静默失败
node tools/jev-endpoints-check.mjs --base http://localhost:3011   # 9 项：四条 400、真调 Jev 的内容核对、老端点回归
```

第一条**不花一次 API 调用**（脚本化 gateway），已经挂在 CI 里（`deploy.yml`）跑。
第二条要一个正在跑的 dev server；配了 key 的环境里它会真的调 Jev 并**查内容**
（「HTTP 200 但一片零」是最危险的失败，只查状态码查不出来）。

---

## 已知的边界

- **读不到别的 App**：网页没有无障碍树也没有截屏权限，所以输入只能是粘贴（后续可以加
  「截图 → 视觉模型 OCR」，但那是另一条路）。
- **矩阵没搬全**：原产品按「行为 × 关系」的手工矩阵决定位置与下一步（逐格 pin 过），
  这里用的是每个行为自带的 `nextStep` —— 是明确的简化，不是等价物。
- **阈值是我们定的**（检测 0.5 / 不确定 0.35 / 拦截 0.5），原产品的标定值在
  `Analysis.kt` 里，没有移植。
- 署名要求：保留上游 LICENSE 与 NOTICE、注明出处，**不得**用其名称或域名暗示对方为本站背书。
