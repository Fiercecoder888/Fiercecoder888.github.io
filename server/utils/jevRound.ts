/**
 * 「Jev 聊天助手」网页版 —— 一轮的引擎。
 *
 * 移植自开源产品 `jev-chat/jev-chat-jarvis` 的一轮流程（`global/ARCHITECTURE.md`）：
 *
 *   读对方最新消息 → 判断（2 次 Jev）→ 定立场与目标 → 起草 2~3 条候选
 *   → 逐条硬检查 + G/E 打分（Jev）→ 填入输入框 → **人自己按发送**
 *
 * 网页版只换掉两端：**读屏**（网页读不到别的 App，改成粘贴文本）和**填入**
 * （改成复制到剪贴板）。中间那一段 —— 判断、立场、起草、检查、评分 —— 按产品的
 * 口径搬过来，因为那才是这个产品值钱的部分；两端只是适配器。
 *
 * 四条刻意的设计：
 *
 * 1. **这个文件不 import 任何东西**。judge / draft / 场景表都由调用方注入
 *    （产品也一样：`core/` 是纯 Kotlin + 脚本化 gateway，整条流程能在 JVM 上跑单测）。
 *    于是 `tools/jev-round-check.mjs` 可以拿一份脚本化的假 gateway **不花一次
 *    API 调用、不需要任何 key** 把整条流程跑一遍，包括打分与「首选」规则。
 * 2. **本地 Nitro 路由与线上 Netlify 函数共用这一份**，不存在两边各写一套。
 * 3. **不替用户拍板**：概率落在「不确定」区间的答案，交回给人自己选
 *    （产品原话：unsure answers that matter make the user choose rather than guess）。
 * 4. **绝不自动发送**：这一层只输出候选，没有、也不会有任何发送路径。
 *
 * 与上游的差异（都写在这里，避免以后误以为搬全了）：
 * - 上游按 `behaviour × 关系` 的**矩阵**决定「位置」与下一步，五个矩阵是手工逐格审定
 *   并 pin 在 `approved/matrix.tsv` 里的。v0 没有移植矩阵，用的是每个 behaviour 自带的
 *   `nextStep` —— 这是**明确的简化**，不是等价物。
 * - 阈值（`DETECTED_AT` 等）是我们自己定的整数值，不是上游标定过的值。
 * - 上游实测过：Jev 的 instructions/criteria 用**英文**、state 用中文，confidence 明显更高
 *   （0.99 vs 0.84）且打分整体上移。所以这里问 Jev 时优先用场景表里的 `qEn` /
 *   `labelEn`，没有才退回中文；界面显示一律用中文的 `q` / `label`。
 */

/* ── 类型 ─────────────────────────────────────────────── */

export type SceneId = 'work' | 'romance' | 'friends' | 'family' | 'general'

export type ApologyLevel = 'expected' | 'optional' | 'avoid'

/** 一个是非题：Jev 只回答 0~1 的一个数（noul）。 */
export interface SceneQuestion {
  id: string
  /** 中文问法，用于界面显示 */
  q: string
  /** 英文问法，用于问 Jev（见头部第 4 条差异） */
  qEn?: string
}

export interface Behaviour extends SceneQuestion {
  /** 检测到这个行为时，下一步该做什么（上游是矩阵给的，这里是行为自带） */
  nextStep: string
}

/** 一个可选的立场（上游叫 stance group）。 */
export interface Stance {
  id: string
  label: string
  labelEn?: string
  /** 必须包含（Goal 的 must_include） */
  mustInclude: string[]
  /** 必须避免（Goal 的 must_avoid） */
  mustAvoid: string[]
  /** 允许做出的承诺（authorized commitments） */
  commitments: string[]
  apology: ApologyLevel
}

export interface SceneDef {
  label: string
  relationships: string[]
  behaviours: Behaviour[]
  tone: SceneQuestion[]
  friction: SceneQuestion[]
  stances: Stance[]
}

export type SceneTable = Record<SceneId, SceneDef>

export interface Message {
  side: 'me' | 'other'
  text: string
}

export type Verdict = 'detected' | 'unsure' | 'absent'

export interface Judged extends SceneQuestion {
  /** 概率（noul 的原值） */
  p: number
  verdict: Verdict
}

export interface Analysis {
  behaviours: Judged[]
  tone: Judged[]
  friction: Judged[]
  /** Jev 在若干立场里挑的那个 */
  stanceId: string | null
  stanceP: number | null
  /** 立场分布（平的时候界面要显示「它也拿不准」） */
  stanceSplit: Array<{ id: string, label: string, p: number }>
  /** 每个检测到的行为给出的下一步 */
  nextSteps: string[]
  /** 概率在不确定区间、且要紧的答案 —— 交给用户自己判断 */
  mustChoose: Judged[]
  confidence: number | null
}

export type CandidateState = 'eligible' | 'confirm' | 'failed' | 'unscored'

export interface Candidate {
  label: string
  text: string
  /** G：目标完成度 0~5 */
  g: number | null
  /** E：这个关系里的分寸 0~5 */
  e: number | null
  /** S = 0.7G + 0.3E，显示成 x/5 */
  score: number | null
  state: CandidateState
  /** 阻断性的硬检查命中 */
  blocks: Array<{ id: string, p: number }>
  /** 需要你先确认的项 */
  confirms: Array<{ id: string, p: number }>
  /** 目标里没做到的必含项 */
  missing: string[]
  /** 判断被分裂（有检查落在 0.35~0.65）—— 这种不许自称首选 */
  split: boolean
}

export interface StageStatus {
  ok: boolean
  reason?: string
}

export interface RoundBudgetReport {
  requests: number
  elapsedMs: number
  capped: boolean
}

/* ── 口径常量 ─────────────────────────────────────────── */

/** 判为「检测到」的概率门槛。**我们自己定的**，不是上游标定值。 */
export const DETECTED_AT = 0.5
/** 「检测到」与「没有」之间的不确定带下沿。 */
export const UNSURE_AT = 0.35
/** 硬检查判为命中的门槛。 */
export const BLOCK_AT = 0.5
/** 判断被分裂的区间：分布平的时候不许自称最高分。 */
export const SPLIT_LOW = 0.35
export const SPLIT_HIGH = 0.65
/** 首选必须领先第二名多少（上游：0.2）。 */
export const TOP_PICK_MARGIN = 0.2
/** 一轮的量：上游是 17 次请求 / 90 秒。 */
export const DEFAULT_BUDGET = { maxRequests: 17, maxMs: 90_000 }
/** 最多读多少条消息（上游读屏是 24 条）。 */
export const MAX_MESSAGES = 24
/** 起草温度。上游两档：首次 0.8，换一组 0.95。 */
export const DRAFT_TEMPERATURE = 0.8
export const DRAFT_TEMPERATURE_RETRY = 0.95
/** 单条候选的字数上限（上游 ReplyClient：中文 40 字 / 英文 30 词）。 */
export const MAX_REPLY_CHARS = 60
/** 单次粘贴的字符上限。 */
export const MAX_CHAT_CHARS = 8_000

/**
 * 「像助手」的话术。带这些的候选直接丢掉 —— 上游 Drafting.STOCK_PHRASES 的对应物。
 * 英文那批照抄（起草模型也可能吐英文），中文这批是我们补的。
 */
const STOCK_PHRASES = [
  'i hope this message finds you well',
  'i wanted to reach out',
  'i completely understand',
  'i understand your concern',
  'i apologise for any inconvenience',
  'i apologize for any inconvenience',
  'please do not hesitate',
  'rest assured',
  'i hear you',
  'that being said',
  '希望这条消息',
  '希望您一切都好',
  '感谢您的理解与支持',
  '如有任何不便敬请谅解',
  '有什么可以帮到您',
  '作为人工智能',
  '收到您的消息',
]

/** G 的六档（上游是 "Opposite or absent" 到 "Complete"）。 */
const G_LEVELS = [
  'Opposite or absent: it does not do what the goal asked, or does the opposite',
  'A fragment: it touches the goal but misses the point',
  'Partly there: some required items, the main thing is missing',
  'Broadly there: the main thing is done, details are missing',
  'Nearly complete: all required items present, delivery slightly off',
  'Complete: every required item present, nothing avoided violated, natural here',
]

/** E 的六档（这个关系里的分寸）。 */
const E_LEVELS = [
  'Wrong register for this relationship: rude, cold, or over-familiar',
  'Flat and mechanical, reads like a template',
  'Acceptable but generic, could be sent to anyone',
  'Fits the relationship, slightly stiff',
  'Natural and fitting for this relationship',
  'Exactly how this person would say it in this chat',
]

/** 硬检查：命中就阻断这条候选（上游 CandidateChecks 的硬检查）。 */
const HARD_CHECKS: Array<{ id: string, qEn: string, zh: string }> = [
  { id: 'new_commitment', qEn: 'Does this reply promise something the user did not authorize (a commitment beyond goal.authorized_commitments)?', zh: '它替你许下了没被授权的承诺' },
  { id: 'commits_others', qEn: 'Does this reply commit another person to do something?', zh: '它把别人也一起承诺进去了' },
  { id: 'beyond_goal', qEn: 'Does this reply decide or concede more than the goal covers?', zh: '它超出了这一轮的目标，替你做多了决定' },
  { id: 'unsupported_fact', qEn: 'Does this reply state a fact (reason, event, date, amount, feeling) that appears nowhere in the conversation or user_facts?', zh: '它说了对话里没有依据的事实' },
  { id: 'opposite_stance', qEn: 'Does this reply take the opposite stance to the goal?', zh: '它的立场和目标相反' },
  { id: 'crosses_boundary', qEn: 'Does this reply cross a boundary the other person set?', zh: '它越过了对方划下的边界' },
]

/** 只提示、不阻断（上游的 confirm-only checks）。 */
const CONFIRM_CHECKS: Array<{ id: string, qEn: string, zh: string }> = [
  { id: 'admits_fault', qEn: 'Does this reply admit the user was wrong or at fault?', zh: '它承认了错在你自己' },
  { id: 'contradicts_numbers', qEn: 'Does this reply contradict a date, time or amount the user stated earlier?', zh: '它和你先前说过的时间/数目对不上' },
  { id: 'unstated_declaration', qEn: 'Does this reply declare something (a feeling, an intention) the user never stated?', zh: '它替你表白了没说过的态度' },
]

/* ── 对话解析 ─────────────────────────────────────────── */

const ME_PREFIX = /^\s*(?:我|自己|本人|me|Me|ME)\s*[:：]\s*(.*)$/
const OTHER_PREFIX = /^\s*(?:对方|他|她|ta|TA|Ta|them|other|Other)\s*[:：]\s*(.*)$/

/**
 * 把粘贴进来的对话解析成消息。
 *
 * 网页版没有气泡位置可看（那是读屏才有的东西），所以靠前缀认人：
 * `我：` / `对方：`。两条刻意的宽容：
 * - 一整段没有任何前缀时，**当成「对方刚说的这一段」** —— 最常见的用法就是
 *   复制对方那几句话过来。
 * - 有前缀的行之间出现没前缀的行，算作上一条的续行（聊天记录换行很多）。
 */
export function parseChat(raw: string, maxMessages = MAX_MESSAGES): Message[] {
  const text = (raw || '').slice(0, MAX_CHAT_CHARS).replace(/\r\n?/g, '\n')
  const out: Message[] = []

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const me = line.match(ME_PREFIX)
    if (me) {
      push(out, 'me', me[1])
      continue
    }
    const other = line.match(OTHER_PREFIX)
    if (other) {
      push(out, 'other', other[1])
      continue
    }
    // 没有前缀：接在上一条后面；一条都还没有时，当成对方说的
    if (!out.length) push(out, 'other', line)
    else out[out.length - 1]!.text += `\n${line.trim()}`
  }

  const cleaned = out
    .map(m => ({ side: m.side, text: m.text.trim() }))
    .filter(m => m.text)
  return cleaned.slice(-maxMessages)
}

function push(list: Message[], side: Message['side'], text: string) {
  list.push({ side, text })
}

/** 对方的最新一轮：我最后一条之后、对方说的所有话（上游 Conversation 的口径）。 */
export function latestTurn(messages: Message[]): Message[] {
  let lastMine = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.side === 'me') {
      lastMine = i
      break
    }
  }
  return messages.slice(lastMine + 1).filter(m => m.side === 'other')
}

/** 渲染成给模型看的文本。 */
function render(messages: Message[]): string {
  return messages.map(m => `${m.side === 'me' ? '我' : '对方'}：${m.text}`).join('\n')
}

/* ── 注入点 ───────────────────────────────────────────── */

/** Jev 的一条答案（与本仓库 JevWindow.vue 里读到的形状一致）。 */
export interface JudgeAnswer {
  type?: string
  noul?: number
  choice?: string
  score?: number
  probabilities?: Record<string, number>
  legend?: Record<string, string>
  confidence?: number
}

export type Judge = (
  state: unknown,
  questions: Record<string, unknown>,
) => Promise<Record<string, JudgeAnswer>>

export interface DraftRequest {
  system: string
  user: string
  count: number
  temperature: number
}

/** 起草：给一段提示词，回 1~3 条候选文本。 */
export type Draft = (req: DraftRequest) => Promise<string[]>

export interface RoundDeps {
  scenes: SceneTable
  judge: Judge
  /** 没配 reply key 时是 null —— 判断阶段照样能跑 */
  draft?: Draft | null
  now?: () => number
  budget?: { maxRequests?: number, maxMs?: number }
}

export interface RoundInput {
  chat: string
  scene: SceneId
  relationship?: string
  dispute?: boolean
  /** 我和对方的背景（知识库），起草时要求与之一致 */
  background?: string
  /** 这一轮想达到什么 / 必须提到的事 */
  goalNote?: string
}

export interface DraftInput extends RoundInput {
  stanceId: string
}

/* ── 请求体校验（信任边界：前端能随便打字） ───────────── */

const MAX_TEXT = 2_000

function asText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/**
 * 校验一次判断的输入。返回第一条问题即停 —— 一次说清一个比堆一串可读。
 *
 * 场景表是**参数**不是 import：这样校验规则也能被自检脚本用真表打一遍，
 * 而不是靠「线上跑一次看看」。
 */
export function validateRoundInput(raw: unknown, scenes: SceneTable): { input?: RoundInput, problem?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: '请求体必须是一个对象' }
  }
  const body = raw as Record<string, unknown>

  const scene = String(body.scene ?? '') as SceneId
  const sceneDef = scenes[scene]
  if (!sceneDef) {
    return { problem: `scene 必须是 ${Object.keys(scenes).join(' / ')} 之一` }
  }

  const chat = asText(body.chat, MAX_CHAT_CHARS + 1)
  if (!chat.trim()) {
    return { problem: '把对话粘进来：每行「我：…」「对方：…」，或者直接粘对方那几句话' }
  }
  if (chat.length > MAX_CHAT_CHARS) {
    return { problem: `对话太长了（${chat.length} 字符，上限 ${MAX_CHAT_CHARS}）` }
  }

  const relationship = asText(body.relationship, 40)
  if (relationship && !sceneDef.relationships.includes(relationship)) {
    return { problem: `关系「${relationship}」不属于「${sceneDef.label}」这个场景` }
  }

  return {
    input: {
      chat,
      scene,
      relationship: relationship || sceneDef.relationships[0] || '',
      dispute: body.dispute === true,
      background: asText(body.background, MAX_TEXT),
      goalNote: asText(body.goalNote, MAX_TEXT),
    },
  }
}

/** 起草还要一个立场，且必须属于这个场景；认不出来的立场退回该场景的第一个。 */
export function validateDraftInput(raw: unknown, scenes: SceneTable): { input?: DraftInput, problem?: string } {
  const base = validateRoundInput(raw, scenes)
  if (base.problem || !base.input) return { problem: base.problem }
  const scene = scenes[base.input.scene]
  const stanceId = String((raw as Record<string, unknown>).stanceId ?? '')
  const stance = scene.stances.find(s => s.id === stanceId) ?? scene.stances[0]
  if (!stance) return { problem: `「${scene.label}」这个场景没有可用的立场` }
  return { input: { ...base.input, stanceId: stance.id } }
}

/* ── 判断阶段 ─────────────────────────────────────────── */

export interface AnalysisResult {
  analysis: Analysis
  messages: Message[]
  turn: Message[]
  stage: StageStatus
  budget: RoundBudgetReport
  notes: string[]
}

/**
 * 第一段：看懂对方在做什么。
 *
 * 两次 Jev 请求，跑在一起（上游 AnalysisEngine 也是两次并行，只是它的第二次
 * 单独问摩擦题）：
 *   A 行为 + 语气 + 立场选择，state 是整段对话
 *   B 摩擦/风险题，state 只给最新一轮和它前面四条 —— 问「对方是不是在施压」
 *     这类问题，给他太长上下文反而会把更早的旧账算进来
 */
export async function analyseConversation(input: RoundInput, deps: RoundDeps): Promise<AnalysisResult> {
  const meta = makeMeta(deps)
  const scene = deps.scenes[input.scene]
  const messages = parseChat(input.chat)
  const turn = latestTurn(messages)
  const notes: string[] = []

  if (!messages.length) {
    return {
      analysis: emptyAnalysis(),
      messages,
      turn,
      stage: { ok: false, reason: '没有解析出任何消息：粘贴一段对话，或者直接粘贴对方那几句话' },
      budget: meta.report(),
      notes,
    }
  }
  if (!turn.length) {
    notes.push('对方没有在我最后一条之后说话，判断依据是整段对话的尾部。')
  }
  if (!scene) {
    return {
      analysis: emptyAnalysis(),
      messages,
      turn,
      stage: { ok: false, reason: `没有这个场景：${input.scene}` },
      budget: meta.report(),
      notes,
    }
  }

  const context = {
    scene: scene.label,
    relationship: input.relationship || scene.relationships[0] || '未指定',
    in_dispute: Boolean(input.dispute),
    my_background: (input.background || '').slice(0, 2_000) || null,
    conversation: render(messages),
    latest_turn_from_them: turn.length ? render(turn) : render(messages.slice(-3)),
    my_goal_note: input.goalNote || null,
  }
  const frictionState = {
    scene: scene.label,
    relationship: context.relationship,
    in_dispute: context.in_dispute,
    latest_turn_from_them: context.latest_turn_from_them,
    the_four_messages_before: render(messages.slice(-6, -turn.length || undefined)),
  }

  const questionsA: Record<string, unknown> = {}
  for (const b of scene.behaviours) questionsA[b.id] = noul(b.qEn || b.q, b.nextStep)
  for (const t of scene.tone) questionsA[t.id] = noul(t.qEn || t.q)
  questionsA.stance = {
    type: 'choice',
    instructions: input.dispute
      ? 'They are in a dispute. Which stance should the user take now, given what the other person is doing?'
      : 'Which stance should the user take now, given what the other person is doing?',
    criteria: Object.fromEntries(scene.stances.map(s => [s.id, s.labelEn || s.label])),
  }

  const questionsB: Record<string, unknown> = {}
  for (const f of scene.friction) questionsB[f.id] = noul(f.qEn || f.q)

  const [answersA, answersB] = await meta.parallel([
    () => deps.judge(context, questionsA),
    () => deps.judge(frictionState, questionsB),
  ])

  /**
   * 一个答案都没有就是**失败**，不是「什么都没检测到」。
   *
   * 这道闸是被真实事故逼出来的（2026-09-28 实测）：TypeSafe 以 HTTP 200 回了一个
   * 「不在你所在地区」的 body，`answers` 是空的，而这里以前会把它翻成
   * 「所有概率 0.0 → 对方什么都没做」。零概率和零答案是两种完全不同的东西，
   * 但它们在界面上长得一模一样 —— 所以必须在**这里**分开，不能指望界面去猜。
   */
  if (!answersA || !Object.keys(answersA).length) {
    return {
      analysis: emptyAnalysis(),
      messages,
      turn,
      stage: { ok: false, reason: `Jev 一个答案都没给${meta.errors.length ? `：${meta.errors[0]}` : ''}` },
      budget: meta.report(),
      notes,
    }
  }

  const behaviours = judgeList(scene.behaviours, answersA)
  const tone = judgeList(scene.tone, answersA)
  const friction = judgeList(scene.friction, answersB)

  const stanceAnswer = answersA?.stance
  const stanceId = stanceAnswer?.choice && scene.stances.some(s => s.id === stanceAnswer.choice)
    ? stanceAnswer.choice
    : (topKey(stanceAnswer?.probabilities) ?? null)
  const stanceP = stanceId ? (stanceAnswer?.probabilities?.[stanceId] ?? null) : null
  const stanceSplit = Object.entries(stanceAnswer?.probabilities ?? {})
    .map(([id, p]) => ({ id, label: scene.stances.find(s => s.id === id)?.label ?? id, p }))
    .sort((a, b) => b.p - a.p)

  const mustChoose = [...behaviours, ...tone, ...friction].filter(j => j.verdict === 'unsure')
  if (mustChoose.length) {
    notes.push(`有 ${mustChoose.length} 个答案落在不确定区间，界面上交给你自己判断，不替你选。`)
  }

  return {
    analysis: {
      behaviours,
      tone,
      friction,
      stanceId,
      stanceP,
      stanceSplit,
      nextSteps: behaviours.filter(b => b.verdict === 'detected').map(b => b.nextStep),
      mustChoose,
      confidence: stanceAnswer?.confidence ?? null,
    },
    messages,
    turn,
    stage: { ok: true },
    budget: meta.report(),
    notes,
  }
}

/* ── 起草 + 检查 + 打分 ───────────────────────────────── */

export interface DraftResult {
  candidates: Candidate[]
  topPick: number | null
  stage: StageStatus
  budget: RoundBudgetReport
  notes: string[]
}

/**
 * 第二段：起草候选，然后**逐条**拿 Jev 检查、打分。
 *
 * 检查放在起草之后是刻意的：起草模型写得好不好不重要，重要的是写出来的东西
 * 有没有替用户多承诺、有没有编事实 —— 那正是判断模型擅长而生成模型不可信的地方。
 */
export async function draftAndCheck(input: DraftInput, deps: RoundDeps): Promise<DraftResult> {
  const meta = makeMeta(deps)
  const scene = deps.scenes[input.scene]
  const notes: string[] = []
  const messages = parseChat(input.chat)
  const stance = scene?.stances.find(s => s.id === input.stanceId) ?? scene?.stances[0]

  if (!scene || !stance) {
    return {
      candidates: [],
      topPick: null,
      stage: { ok: false, reason: '场景或立场不存在' },
      budget: meta.report(),
      notes,
    }
  }
  if (!deps.draft) {
    return {
      candidates: [],
      topPick: null,
      stage: {
        ok: false,
        reason: '没配起草模型：判断阶段不依赖它，但候选回复需要一个 chat 模型的 key（服务端 OPENROUTER_API_KEY）',
      },
      budget: meta.report(),
      notes,
    }
  }

  const goal = {
    summary: input.goalNote || stance.label,
    stance: stance.label,
    must_include: stance.mustInclude,
    must_avoid: stance.mustAvoid,
    authorized_commitments: stance.commitments,
    apology: stance.apology,
  }
  const convo = render(messages.slice(-10))
  const relationship = input.relationship || scene.relationships[0] || '未指定'

  // ① 起草
  let drafts: string[] | null = null
  try {
    drafts = await meta.run(() => deps.draft!({
      system: draftSystem(goal),
      user: draftUser({ relationship, convo, goal, background: input.background, count: 3 }),
      count: 3,
      temperature: DRAFT_TEMPERATURE,
    }))
  }
  catch (error) {
    // 起草这条路本来就常出问题（余额、限流、key 被拒）。那不是「没有候选」，
    // 是「这一步没跑成」—— 两件事在界面上必须分开说，否则用户会以为模型就是写不出来。
    return {
      candidates: [],
      topPick: null,
      stage: { ok: false, reason: `起草模型调用失败：${(error as Error).message}` },
      budget: meta.report(),
      notes,
    }
  }
  const given = (drafts ?? []).map(t => (t || '').trim()).filter(Boolean)
  const clean = given.filter(t => !hasStockPhrase(t))
  if (given.length > clean.length) {
    // 明说丢了几条：用户看到的候选变少了，得知道为什么，而不是以为模型只给了这些
    notes.push(`起草模型给的 ${given.length} 条里有 ${given.length - clean.length} 条带「像助手」的话术`
      + '（「希望这条消息…」这类），按上游的规矩整条丢掉。')
  }
  const usable = clean.slice(0, 3)

  if (!usable.length) {
    return {
      candidates: [],
      topPick: null,
      stage: { ok: false, reason: '起草模型没给出可用的候选' },
      budget: meta.report(),
      notes,
    }
  }

  // ② 逐条检查 + 打分（每条一次 Jev 请求，几条并行）
  const checked = await meta.parallel(usable.map(text => async (): Promise<Candidate> => {
    const questions = candidateQuestions(goal)
    let answers: Record<string, JudgeAnswer> | null = null
    try {
      answers = await deps.judge(
        {
          conversation: convo,
          relationship,
          in_dispute: Boolean(input.dispute),
          user_facts: (input.background || '').slice(0, 2_000) || null,
          goal,
          candidate_reply: text,
        },
        questions,
      )
    }
    catch (error) {
      notes.push(`有一条候选的检查没跑成：${(error as Error).message}`)
    }
    return scoreCandidate(text, answers, goal)
  }))

  const candidates = checked.filter(Boolean) as Candidate[]

  /**
   * 每一条都「未评分」= 检查这一步整体没跑成 —— 还是那个静默失败的老问题：
   * 「未评分」和「分数低」在界面上看起来差不多，必须在这里分开。
   */
  if (candidates.length && candidates.every(c => c.state === 'unscored')) {
    return {
      candidates,
      topPick: null,
      stage: { ok: false, reason: `候选的检查一条都没跑成${meta.errors.length ? `：${meta.errors[0]}` : ''}` },
      budget: meta.report(),
      notes,
    }
  }

  const topPick = pickTop(candidates)
  if (topPick === null && candidates.length) {
    notes.push('没有任何一条拿到「首选」：首选只给状态正常、判断没有分裂、且领先第二条 0.2 以上的候选。')
  }
  notes.push('候选只是候选：发不发、怎么改，由你自己定，这个页面没有发送这个动作。')

  return { candidates, topPick, stage: { ok: true }, budget: meta.report(), notes }
}

/** 一轮全跑（判断 + 起草 + 检查）。网页上是分两步调的，这个入口给自检脚本用。 */
export async function runRound(input: DraftInput, deps: RoundDeps) {
  const first = await analyseConversation(input, deps)
  const second = first.stage.ok && deps.draft
    ? await draftAndCheck(input, deps)
    : { candidates: [], topPick: null, stage: { ok: false, reason: first.stage.reason ?? '没有起草模型' } as StageStatus, notes: [], budget: { requests: 0, elapsedMs: 0, capped: false } }
  return {
    analysis: first.analysis,
    messages: first.messages.length,
    candidates: second.candidates,
    topPick: second.topPick,
    stages: { analysis: first.stage, draft: second.stage },
    budget: {
      requests: first.budget.requests + second.budget.requests,
      elapsedMs: first.budget.elapsedMs + second.budget.elapsedMs,
      capped: first.budget.capped || second.budget.capped,
    },
    notes: [...first.notes, ...second.notes],
  }
}

/* ── 提示词 ───────────────────────────────────────────── */

/**
 * 起草的系统提示。十条通用规则是上游 Drafting.UNIVERSAL_RULES 的移植，
 * 一条都没删 —— 这些规则同时也是候选检查在查的东西，两边必须对齐：
 * 提示词要求「不编事实」，检查里就有 unsupported_fact；要求「不替别人承诺」，
 * 检查里就有 commits_others。
 */
function draftSystem(goal: { apology: ApologyLevel }): string {
  const apology = goal.apology === 'expected'
    ? '要带一句短的道歉（这是礼貌，不能等于承认自己错了）'
    : goal.apology === 'optional'
      ? '最多一句自然的「抱歉」，不自然就不写'
      : '不要道歉'
  return [
    '你在替用户起草给别人的回复。用户会自己读、自己挑一条发出去。',
    '',
    '每一条都必须满足：',
    '1. 只做目标里写的事：目标说不同意的，不能同意；目标说同意的，不能反悔。',
    '2. 目标里「必须包含」的项一个都不能少；「必须避免」的项一个都不能出现。',
    '3. 只陈述对话里或用户背景里出现过的事实。不要编理由、事件、时间、金额、感受或个人信息。缺的事实就不写，或者去问。',
    '4. 只做目标授权的承诺。别替第三方答应任何事。',
    `5. 道歉按目标来：${apology}。不要说自己错了，除非目标允许。`,
    '6. 第一句就给答案或决定，不要热身句。',
    '7. 要提到对方具体说的那件事，不要泛泛而谈。',
    '8. 长度跟对方看齐：默认一到三句短句。',
    '9. 语气贴合这个聊天：先看用户自己以前怎么说的，再看对方怎么说的。用户平时不打标点，你也可以不打。',
    '10. 不要引入新的缩写或网络用语，用户在这个对话里用过的才可以复用。',
    '',
    '只输出一个 JSON 数组，不要解释，不要代码块以外的东西。',
  ].join('\n')
}

function draftUser(args: {
  relationship: string
  convo: string
  goal: Record<string, unknown>
  background?: string
  count: number
}): string {
  const { relationship, convo, goal, background, count } = args
  return [
    background
      ? `以下是我和对方的背景，回复必须与之一致，可以直接引用其中的事实，不要编造背景里没有的事实：\n${background.slice(0, 2_000)}\n`
      : '',
    `关系：${relationship}`,
    `\n最近对话：\n${convo}`,
    `\n这一轮的目标（JSON）：\n${JSON.stringify(goal, null, 2)}`,
    `\n请给出 ${count} 条候选回复。各条策略要有区别：一条稳妥承接、一条给具体的行动或时间、一条简短低姿态。`,
    `每条不超过 ${MAX_REPLY_CHARS} 字，口语、自然、像真人在聊天软件里发消息。`,
    '回复语言跟随对方最近一条消息：对方用英文就用自然的英文，用中文就用中文。',
    '只输出 JSON 数组。',
  ].filter(Boolean).join('\n')
}

function noul(instructions: string, trueHint?: string): Record<string, unknown> {
  return {
    type: 'noul',
    instructions,
    criteria: trueHint
      ? { true: `Yes. ${trueHint}`, false: 'No, that is not what is happening.' }
      : { true: 'Yes.', false: 'No.' },
  }
}

function candidateQuestions(goal: { must_include: string[], must_avoid: string[] }): Record<string, unknown> {
  const questions: Record<string, unknown> = {}
  for (const c of HARD_CHECKS) questions[c.id] = noul(c.qEn)
  for (const c of CONFIRM_CHECKS) questions[c.id] = noul(c.qEn)
  goal.must_include.forEach((item, i) => {
    questions[`has_${i}`] = noul(`Does the reply include this required item: "${item}"?`)
  })
  goal.must_avoid.forEach((item, i) => {
    questions[`avoid_${i}`] = noul(`Does the reply contain this forbidden item: "${item}"?`)
  })
  questions.G = {
    type: 'choice',
    instructions: 'How completely does this reply achieve the goal?',
    criteria: Object.fromEntries(G_LEVELS.map((label, i) => [`l${i}`, label])),
  }
  questions.E = {
    type: 'choice',
    instructions: 'How well does the delivery fit this relationship and this chat?',
    criteria: Object.fromEntries(E_LEVELS.map((label, i) => [`e${i}`, label])),
  }
  return questions
}

/* ── 打分 ─────────────────────────────────────────────── */

function scoreCandidate(
  text: string,
  answers: Record<string, JudgeAnswer> | null,
  goal: { must_include: string[], must_avoid: string[] },
): Candidate {
  if (!answers) {
    return {
      label: '', text, g: null, e: null, score: null, state: 'unscored',
      blocks: [], confirms: [], missing: [], split: false,
    }
  }

  const blocks: Array<{ id: string, p: number }> = []
  const confirms: Array<{ id: string, p: number }> = []
  for (const c of HARD_CHECKS) {
    const p = answers[c.id]?.noul ?? 0
    if (p >= BLOCK_AT) blocks.push({ id: `${c.zh}（${c.id}）`, p })
  }
  goal.must_avoid.forEach((item, i) => {
    const p = answers[`avoid_${i}`]?.noul ?? 0
    if (p >= BLOCK_AT) blocks.push({ id: `踩了必须避免的「${item}」`, p })
  })
  for (const c of CONFIRM_CHECKS) {
    const p = answers[c.id]?.noul ?? 0
    if (p >= BLOCK_AT) confirms.push({ id: `${c.zh}（${c.id}）`, p })
  }

  const missing: string[] = []
  goal.must_include.forEach((item, i) => {
    const p = answers[`has_${i}`]?.noul ?? 0
    if (p < BLOCK_AT) missing.push(item)
  })

  const gLevel = levelOf(answers.G, 'l')
  const eLevel = levelOf(answers.E, 'e')
  // 上游：缺必含项时 G 封顶 3
  const g = gLevel === null ? null : Math.min(gLevel, missing.length ? 3 : 5)
  const e = eLevel
  const score = g === null || e === null ? null : round1(0.7 * g + 0.3 * e)

  const values = [
    ...HARD_CHECKS.map(c => answers[c.id]?.noul ?? 0),
    ...CONFIRM_CHECKS.map(c => answers[c.id]?.noul ?? 0),
  ]
  const split = values.some(p => p >= SPLIT_LOW && p <= SPLIT_HIGH)
    || (answers.G?.confidence !== undefined && answers.G.confidence < 0.5)

  const state: CandidateState = score === null
    ? 'unscored'
    : blocks.length ? 'failed' : confirms.length ? 'confirm' : 'eligible'

  return { label: '', text, g, e, score, state, blocks, confirms, missing, split }
}

function levelOf(answer: JudgeAnswer | undefined, prefix: string): number | null {
  if (!answer) return null
  const fromChoice = answer.choice?.match(new RegExp(`^${prefix}(\\d)$`))
  if (fromChoice) return Number(fromChoice[1])
  const top = topKey(answer.probabilities)
  const fromTop = top?.match(new RegExp(`^${prefix}(\\d)$`))
  return fromTop ? Number(fromTop[1]) : null
}

/**
 * 首选规则（上游原样）：状态正常、判断没有分裂、且比第二条高 0.2 以上才给。
 * 一个「最高分」如果只是 0.05 的领先，那不叫首选，那叫运气。
 */
export function pickTop(candidates: Candidate[]): number | null {
  const rank = (c: Candidate) => (c.state === 'eligible' ? 0 : c.state === 'confirm' ? 1 : c.state === 'failed' ? 2 : 3)
  const sorted = candidates
    .map((c, i) => ({ c, i }))
    .filter(x => x.c.score !== null)
    .sort((a, b) => (rank(a.c) - rank(b.c)) || ((b.c.score ?? 0) - (a.c.score ?? 0)))
  const best = sorted[0]
  if (!best || best.c.state !== 'eligible' || best.c.split) return null
  const second = sorted[1]
  if (second && (best.c.score ?? 0) - (second.c.score ?? 0) <= TOP_PICK_MARGIN) return null
  return best.i
}

/* ── 小工具 ───────────────────────────────────────────── */

/**
 * 把一个场景里的题目列表 × Jev 的答案，翻成带三态判断的列表。
 *
 * 泛型 `<T extends SceneQuestion>` 是为了**把题目自己的字段带出来**：行为题带
 * `nextStep`，语气/摩擦题没有。写成 `Judged[]` 的话，后面读 `b.nextStep` 就是
 * 类型错误（这个仓库没有 typecheck 脚本，所以这种错只在编辑器里现形，容易漏）。
 */
function judgeList<T extends SceneQuestion>(
  items: T[],
  answers: Record<string, JudgeAnswer> | null,
): Array<Judged & T> {
  return items.map((item) => {
    const p = clamp01(answers?.[item.id]?.noul)
    const verdict: Verdict = p >= DETECTED_AT ? 'detected' : p >= UNSURE_AT ? 'unsure' : 'absent'
    return { ...item, p, verdict }
  })
}

function topKey(probabilities?: Record<string, number>): string | null {
  const entries = Object.entries(probabilities ?? {})
  if (!entries.length) return null
  return entries.sort((a, b) => b[1] - a[1])[0]![0]
}

function clamp01(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function hasStockPhrase(text: string): boolean {
  const lower = text.toLowerCase()
  return STOCK_PHRASES.some(p => lower.includes(p.toLowerCase()))
}

/**
 * 从起草模型的输出里抠出候选（上游 `ReplyClient.parseN` 的移植，容错口径照抄）：
 * 先找最外层的 JSON 数组；找不到就按行切，再去掉列表符号与引号。
 * **有几条算几条，绝不用占位文本凑数**。
 *
 * 放在引擎里而不是接线层，是因为它是个纯函数：容错分支不少（围栏、多余解释、
 * 编号列表、引号残留），值得被自检脚本逐条打一遍。
 */
export function parseCandidates(content: string, count: number): string[] {
  const text = (content || '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        const out = parsed
          .map(item => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
        // 空数组是模型在说「给不出」，不是解析失败 —— 别落进下面的按行切，
        // 否则会把 "[]" 本身当成一条候选送进检查
        if (out.length) return out.slice(0, count)
        return []
      }
    }
    catch {
      // 落到下面的按行切
    }
  }
  return text
    .split('\n')
    .map(line => line.trim().replace(/^[-*\d.、)\s"']+/, '').replace(/["',]+$/, '').trim())
    .filter(line => line && line !== '[' && line !== ']')
    .slice(0, count)
}

function emptyAnalysis(): Analysis {
  return {
    behaviours: [], tone: [], friction: [],
    stanceId: null, stanceP: null, stanceSplit: [], nextSteps: [], mustChoose: [], confidence: null,
  }
}

/**
 * 请求计数与并行闸。上游一轮封顶 17 次请求 / 90 秒，这里保留同一套口径：
 * 超了就不再发请求，剩下的候选标成 unscored —— 宁可少给，不可让一次点击
 * 意外花掉几十次调用（这个端点是公开的）。
 */
function makeMeta(deps: RoundDeps) {
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const maxRequests = deps.budget?.maxRequests ?? DEFAULT_BUDGET.maxRequests
  const maxMs = deps.budget?.maxMs ?? DEFAULT_BUDGET.maxMs
  let requests = 0
  let capped = false

  const report = (): RoundBudgetReport => ({
    requests,
    elapsedMs: now() - started,
    capped,
  })

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (requests >= maxRequests || now() - started > maxMs) {
      capped = true
      return null
    }
    requests += 1
    return fn()
  }

  const errors: string[] = []

  /** 并行跑若干次请求；单次失败记下原因并返回 null，不拖垮整轮。 */
  async function parallel<T>(fns: Array<() => Promise<T>>): Promise<Array<T | null>> {
    const results = await Promise.all(fns.map(fn => run(fn).catch((error: unknown) => {
      errors.push((error as Error).message)
      return null
    })))
    return results
  }

  return { run, parallel, report, errors }
}
