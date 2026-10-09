/**
 * 「Jev 聊天助手网页版」一轮引擎的自检。
 *
 * 跑法：`node tools/jev-round-check.mjs`（不需要任何 key，**不花一次 API 调用**）
 *
 * 为什么能这么跑：引擎的所有模型调用都是注入的（判断 `judge`、起草 `draft`），
 * 所以这里塞一份**脚本化的假 gateway**，就能把整条流程走完并逐条断言：
 * 对话解析、阈值三态、立场选择、不确定项上交、话术过滤、硬检查拦截、
 * 缺必含项封顶 G、S = 0.7G + 0.3E、首选规则、请求计数、没配起草时的诚实状态。
 *
 * 上游产品也是这个套路（`core/` 是纯 Kotlin + 脚本化 gateway，整条流程在 JVM 上跑单测）；
 * 这里用同样的办法，因为**真跑一次要花钱，而错误往往出现在解析和规则这些不花钱的地方**。
 */

import assert from 'node:assert/strict'
import {
  analyseConversation,
  draftAndCheck,
  latestTurn,
  parseCandidates,
  parseChat,
  validateDraftInput,
  validateRoundInput,
} from '../server/utils/jevRound.ts'
import { JEV_SCENES } from '../server/data/jevScenes.ts'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  }
  catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message.split('\n')[0]}`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  }
  catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message.split('\n')[0]}`)
  }
}

/* ── 假 gateway ───────────────────────────────────────── */

function scriptedJudge(handler) {
  const calls = []
  return {
    calls,
    async judge(state, questions) {
      calls.push({ state, ids: Object.keys(questions) })
      return handler(state, questions)
    },
  }
}

function choiceAnswer(level, count, prefix, top = 0.86) {
  const probabilities = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`${prefix}${i}`, i === level ? top : (1 - top) / (count - 1)]),
  )
  return { type: 'choice', choice: `${prefix}${level}`, confidence: 0.9, probabilities }
}

/** 判断阶段的答案：按索引给三档概率，立场给一个明确的选择。 */
function analysisTable(scene, { detected = [], unsureBehaviour = -1, unsureFriction = -1, stanceId }) {
  const table = {}
  scene.behaviours.forEach((b, i) => {
    table[b.id] = { type: 'noul', noul: detected.includes(i) ? 0.92 : i === unsureBehaviour ? 0.4 : 0.03 }
  })
  scene.tone.forEach((t) => { table[t.id] = { type: 'noul', noul: 0.05 } })
  scene.friction.forEach((f, i) => {
    table[f.id] = { type: 'noul', noul: i === unsureFriction ? 0.45 : 0.02 }
  })
  table.stance = {
    type: 'choice',
    choice: stanceId,
    confidence: 0.93,
    probabilities: Object.fromEntries(scene.stances.map(s => [s.id, s.id === stanceId ? 0.71 : 0.29 / (scene.stances.length - 1)])),
  }
  return table
}

/** 候选检查的答案：按候选文本切换好坏。 */
function candidateAnswer(questions, { bad, g, e, hasRequired, splitValue = null }) {
  const out = {}
  for (const id of Object.keys(questions)) {
    if (id === 'G') out[id] = choiceAnswer(g, 6, 'l')
    else if (id === 'E') out[id] = choiceAnswer(e, 6, 'e')
    else if (id.startsWith('has_')) out[id] = { type: 'noul', noul: hasRequired ? 0.95 : 0.08 }
    else if (id.startsWith('avoid_')) out[id] = { type: 'noul', noul: 0.02 }
    else if (id === 'new_commitment') out[id] = { type: 'noul', noul: bad ? 0.88 : 0.03 }
    // 落在 0.35~0.65 之间 = 判断被分裂，用来验「分裂时不许自称首选」
    else if (id === 'contradicts_numbers' && splitValue !== null) out[id] = { type: 'noul', noul: splitValue }
    else out[id] = { type: 'noul', noul: 0.02 }
  }
  return out
}

/* ── 材料 ─────────────────────────────────────────────── */

const sceneId = 'work'
const scene = JEV_SCENES[sceneId]
const CHAT = [
  '对方：关于那个报告',
  '我：嗯',
  '对方：今天能给我吗',
].join('\n')

if (!scene) {
  console.error(`场景表里没有 ${sceneId}，检查 server/data/jevScenes.ts`)
  process.exit(1)
}

console.log(`场景表：${Object.keys(JEV_SCENES).length} 个场景；本轮用「${scene.label}」`
  + `（${scene.behaviours.length} 行为 / ${scene.tone.length} 语气 / ${scene.friction.length} 摩擦 / ${scene.stances.length} 立场）\n`)

/* ── 1. 对话解析 ──────────────────────────────────────── */

test('带前缀的对话按人分开，无前缀的行算作上一条的续行', () => {
  const messages = parseChat(`对方：在吗\n我：在\n对方：那个报告\n今天能给我吗`)
  assert.equal(messages.length, 3)
  assert.deepEqual(messages.map(m => m.side), ['other', 'me', 'other'])
  assert.equal(messages[2].text, '那个报告\n今天能给我吗')
})

test('整段没有前缀时，当成「对方刚说的那几句」', () => {
  const messages = parseChat('你上次说的那个东西还没好')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].side, 'other')
})

test('我最后一条之后、对方说的话就是「最新一轮」', () => {
  const messages = parseChat('对方：A\n我：B\n对方：C\n对方：D')
  assert.deepEqual(latestTurn(messages).map(m => m.text), ['C', 'D'])
})

test('超过上限时只留最近的消息', () => {
  const long = Array.from({ length: 40 }, (_, i) => `对方：第${i}条`).join('\n')
  assert.equal(parseChat(long, 24).length, 24)
})

/* ── 2. 候选解析（起草模型输出的容错） ────────────────── */

test('起草输出的 JSON 数组（含代码围栏）能抠出来', () => {
  assert.deepEqual(parseCandidates('```json\n["收到，我下午发你", "好，我看看"]\n```', 3), ['收到，我下午发你', '好，我看看'])
})

test('不是 JSON 时按行切，并去掉编号与引号', () => {
  assert.deepEqual(parseCandidates('- "第一条"\n2. 第二条\n* 第三条', 3), ['第一条', '第二条', '第三条'])
})

test('空数组就是「给不出」，不许把 [] 本身当成一条候选', () => {
  assert.deepEqual(parseCandidates('[]', 3), [])
})

/* ── 3. 判断阶段 ──────────────────────────────────────── */

const stanceId = scene.stances[1]?.id ?? scene.stances[0].id

async function judgeRound() {
  const scripted = scriptedJudge((_state, questions) => {
    const table = analysisTable(scene, { detected: [0], unsureBehaviour: 1, unsureFriction: 0, stanceId })
    const out = {}
    for (const id of Object.keys(questions)) out[id] = table[id] ?? { type: 'noul', noul: 0.02 }
    return out
  })
  const result = await analyseConversation(
    { chat: CHAT, scene: sceneId, relationship: scene.relationships[0] },
    { scenes: JEV_SCENES, judge: scripted.judge },
  )
  return { result, scripted }
}

const { result: judged, scripted: judgeGateway } = await judgeRound()

await testAsync('判断阶段：两次请求（行为/语气/立场 + 摩擦），并行发出', async () => {
  assert.equal(judgeGateway.calls.length, 2)
  assert.equal(judged.budget.requests, 2)
  assert.equal(judged.stage.ok, true)
})

await testAsync('阈值把概率翻成三态：0.92 检测到 / 0.40 不确定 / 0.03 没有', async () => {
  const [first, second] = judged.analysis.behaviours
  assert.equal(first.verdict, 'detected')
  assert.equal(second.verdict, 'unsure')
  assert.ok(judged.analysis.behaviours.every(b => ['detected', 'unsure', 'absent'].includes(b.verdict)))
})

await testAsync('检测到的行为把它的下一步带出来', async () => {
  assert.deepEqual(judged.analysis.nextSteps, [scene.behaviours[0].nextStep])
})

await testAsync('不确定的答案交回给人，不替用户拍板', async () => {
  const ids = judged.analysis.mustChoose.map(m => m.id)
  assert.ok(ids.includes(scene.behaviours[1].id), '行为里的不确定项应该在 mustChoose 里')
  assert.ok(ids.includes(scene.friction[0].id), '摩擦里的不确定项应该在 mustChoose 里')
  assert.ok(judged.notes.some(n => n.includes('不确定')), '并且要有一条说明')
})

await testAsync('立场取 Jev 选的那个，分布按概率排序', async () => {
  assert.equal(judged.analysis.stanceId, stanceId)
  assert.equal(judged.analysis.stanceSplit[0].id, stanceId)
  assert.ok((judged.analysis.stanceP ?? 0) > 0.7)
})

/* ── 3b. 静默失败：一个答案都没有 ≠ 什么都没检测到 ──────
 * 这三条来自一次真实事故（2026-09-28）：TypeSafe 以 HTTP 200 回了一个
 * 「不在你所在地区」的 body，[answers] 是空的，而当时的代码把它翻成了
 * 「所有概率 0.0% → 对方什么都没做」。零概率和零答案在界面上长得一样。
 */

await testAsync('Jev 一个答案都没给时，说「没给」，不许翻成「全都没检测到」', async () => {
  const result = await analyseConversation(
    { chat: CHAT, scene: sceneId, relationship: scene.relationships[0] },
    { scenes: JEV_SCENES, judge: async () => ({}) },
  )
  assert.equal(result.stage.ok, false)
  assert.match(result.stage.reason, /一个答案都没给/)
})

await testAsync('判断整条挂掉时，把上游原话带出来，别吞掉', async () => {
  const result = await analyseConversation(
    { chat: CHAT, scene: sceneId, relationship: scene.relationships[0] },
    {
      scenes: JEV_SCENES,
      judge: async () => {
        throw new Error('Jev 返回 200 但一个答案都没有（Typesafe is not available in your region）')
      },
    },
  )
  assert.equal(result.stage.ok, false)
  assert.match(result.stage.reason, /not available in your region/)
})

/* ── 4. 起草 + 检查 + 打分 ────────────────────────────── */

const CLEAN = '收到，我下午三点前把第一版发你。'
const STOCK = '希望这条消息找到你的时候你一切都好，关于报告我说明一下。'
const BAD = '没问题，以后这种事都我来兜，包在我身上。'
const ALT = '好的我看下，晚点回你。'

/**
 * 三种剧本：
 *   normal     好候选 4.7 / 被拦的那条 2.0 → 应该给出首选
 *   tie        两条分数一样 → 按规则**不给**首选（领先不到 0.2 的「最高分」不叫首选）
 *   split-top  最高那条自己判断分裂 → 也不给首选
 */
async function draftRound({ hasRequired = true, withDraft = true, drafts = [CLEAN, STOCK, BAD], mode = 'normal', draftFails = false } = {}) {
  const scripted = scriptedJudge((state, questions) => {
    const text = String(state.candidate_reply)
    const isBad = text.includes('我来兜')
    const isAlt = text.includes('好的我看下')
    if (mode === 'tie') return candidateAnswer(questions, { bad: isBad, g: 5, e: 4, hasRequired })
    if (mode === 'split-top') {
      return candidateAnswer(questions, {
        bad: false,
        g: isAlt ? 3 : 5,
        e: isAlt ? 3 : 4,
        hasRequired,
        splitValue: isAlt ? null : 0.4,
      })
    }
    return candidateAnswer(questions, { bad: isBad, g: isBad ? 2 : 5, e: isBad ? 2 : 4, hasRequired })
  })
  const deps = {
    scenes: JEV_SCENES,
    judge: scripted.judge,
    draft: !withDraft
      ? null
      : draftFails
        ? async () => { throw new Error('起草模型账户余额不足（402）') }
        : async () => drafts,
  }
  const result = await draftAndCheck(
    { chat: CHAT, scene: sceneId, relationship: scene.relationships[0], stanceId, goalNote: '给一个时间，但不承诺范围' },
    deps,
  )
  return { result, scripted }
}

const { result: drafted, scripted: draftGateway } = await draftRound()

await testAsync('起草 + 逐条检查：每条候选一次请求，总共三次', async () => {
  assert.equal(drafted.stage.ok, true)
  assert.equal(drafted.budget.requests, 3, '1 次起草 + 2 条候选各一次检查')
  assert.equal(draftGateway.calls.length, 2)
})

await testAsync('带「像助手」话术的候选整条丢掉，不参与打分', async () => {
  assert.equal(drafted.candidates.length, 2, '三条里去掉带话术的那条')
  assert.ok(!drafted.candidates.some(c => c.text.includes('希望这条消息')))
  assert.ok(drafted.notes.some(n => n.includes('话术')))
})

await testAsync('干净的那条：G=5 E=4 → S = 0.7×5 + 0.3×4 = 4.7，状态可用', async () => {
  const clean = drafted.candidates.find(c => c.text === CLEAN)
  assert.equal(clean.g, 5)
  assert.equal(clean.e, 4)
  assert.equal(clean.score, 4.7)
  assert.equal(clean.state, 'eligible')
  assert.deepEqual(clean.blocks, [])
})

await testAsync('替你多承诺的那条被硬检查拦下，状态是「被拦下」', async () => {
  const bad = drafted.candidates.find(c => c.text === BAD)
  assert.equal(bad.state, 'failed')
  assert.ok(bad.blocks.some(b => b.id.includes('new_commitment')), '要能说出被哪一条拦的')
})

await testAsync('被拦下的那条照样有分数（状态与分数是两根轴），但排在可用那条之后', async () => {
  const bad = drafted.candidates.find(c => c.text === BAD)
  assert.equal(bad.g, 2)
  assert.equal(bad.score, 2.0)
})

await testAsync('首选只给「状态正常 + 判断不分裂 + 领先 0.2 以上」的那条', async () => {
  assert.equal(drafted.topPick, 0)
  const clean = drafted.candidates[0]
  assert.equal(clean.split, false)
})

await testAsync('两条分数一样时不给首选：领先不到 0.2 的「最高分」不叫首选', async () => {
  const { result } = await draftRound({ drafts: [CLEAN, BAD], mode: 'tie' })
  assert.equal(result.candidates[0].score, result.candidates[1].score, '这个剧本里两条同分')
  assert.equal(result.topPick, null)
})

await testAsync('最高那条自己判断分裂时也不给首选', async () => {
  const { result } = await draftRound({ drafts: [CLEAN, ALT], mode: 'split-top' })
  const top = result.candidates[0]
  assert.equal(top.state, 'eligible')
  assert.equal(top.split, true, '有一条检查落在 0.35~0.65 之间')
  assert.equal(result.topPick, null)
})

await testAsync('缺了必含项时 G 封顶 3（上游原话：a missing required item caps G at 3）', async () => {
  const { result } = await draftRound({ hasRequired: false })
  const clean = result.candidates.find(c => c.text === CLEAN)
  assert.equal(clean.g, 3, 'Jev 给的是 l5，但必含项没做到')
  assert.equal(clean.score, 3.3, '0.7×3 + 0.3×4')
  assert.ok(clean.missing.length > 0)
})

await testAsync('没配起草模型时：判断照常可用，起草给出诚实状态而不是假数据', async () => {
  const { result } = await draftRound({ withDraft: false })
  assert.equal(result.stage.ok, false)
  assert.ok(result.stage.reason.includes('起草'), `原因要说到起草：${result.stage.reason}`)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.budget.requests, 0, '一次请求都不该发出去')
})

await testAsync('起草模型挂了 ≠ 没有候选：要说清是「这一步没跑成」', async () => {
  const { result } = await draftRound({ draftFails: true })
  assert.equal(result.stage.ok, false)
  assert.match(result.stage.reason, /起草模型调用失败/)
  assert.match(result.stage.reason, /余额不足/, '上游原话要带出来')
})

/* ── 5. 请求体校验（信任边界） ────────────────────────── */

test('空对话、不存在的场景、不属于该场景的关系都会被挡下', () => {
  assert.match(validateRoundInput({ scene: sceneId, chat: '   ' }, JEV_SCENES).problem, /粘进来/)
  assert.match(validateRoundInput({ scene: 'nope', chat: CHAT }, JEV_SCENES).problem, /scene 必须是/)
  assert.match(validateRoundInput({ scene: sceneId, chat: CHAT, relationship: '外星人' }, JEV_SCENES).problem, /不属于/)
})

test('超长对话被挡下，长度按字符算', () => {
  assert.match(validateRoundInput({ scene: sceneId, chat: 'x'.repeat(9_000) }, JEV_SCENES).problem, /太长/)
})

test('合法输入被规整：关系留空取场景第一个，dispute 只认 true', () => {
  const { input, problem } = validateRoundInput({ scene: sceneId, chat: CHAT, dispute: 'yes' }, JEV_SCENES)
  assert.equal(problem, undefined)
  assert.equal(input.relationship, scene.relationships[0])
  assert.equal(input.dispute, false, '字符串 "yes" 不算数')
})

test('认不出来的立场退回该场景第一个 —— 不因为前端传错就整轮失败', () => {
  const { input } = validateDraftInput({ scene: sceneId, chat: CHAT, stanceId: '不存在' }, JEV_SCENES)
  assert.equal(input.stanceId, scene.stances[0].id)
})

/* ── 汇总 ─────────────────────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} ${passed} 项通过，${failures.length} 项失败`)
if (failures.length) {
  for (const f of failures) console.error(`\n--- ${f.name}\n${f.error.stack}`)
  process.exit(1)
}
