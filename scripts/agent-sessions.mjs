#!/usr/bin/env node
/**
 * Agent 会话适配器：把本机三个 Agent（Codex CLI / Claude Code / DSH）的会话记录，
 * 压缩成**极简信号**，喂给 scripts/new-log.mjs 当草稿原料。
 *
 * ┌─ 隐私红线（改这个文件前先读一遍）───────────────────────────────────────┐
 * │ 会话原文里可能有公司代码、内部路径、密钥、客户信息。                    │
 * │ 因此本模块**只提取元数据 + 截断摘要**：                                 │
 * │   ✔ 会话起止时间、cwd、会话 id（截断）、模型 / agentPreset、            │
 * │     工具调用**次数**（只计数，不看内容）、首条需求的 ≤80 字摘要、       │
 * │     最后结论的 ≤120 字摘要                                              │
 * │   ✘ 绝不导出正文：完整对话、工具入参/出参、文件内容、附件一律丢弃，     │
 * │     连中间变量都不保留（读到即丢，见下面的 `discard()`）。              │
 * │ 采集**只在本机跑**，不联网；产出的摘要进的是 drafts/（私有草稿仓库），  │
 * │ 发布前用户自己再过一遍。                                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * 用法（模块）：
 *   import { collectAgentSessions, collectAgentNames } from './agent-sessions.mjs'
 *   const result = await collectAgentSessions('2026-09-11')   // → { date, sessions, dropped, notes, counts }
 *
 * 用法（CLI，方便排查「为什么今天没有采集到」）：
 *   node scripts/agent-sessions.mjs                          # 今天的信号
 *   node scripts/agent-sessions.mjs --date 2026-05-19        # 指定日期
 *   node scripts/agent-sessions.mjs --date 2026-05-19 --json # 机器可读
 *   node scripts/agent-sessions.mjs --all --json             # 不做噪音预算，看全部候选
 *   node scripts/agent-sessions.mjs --exact                  # 只认仓库根，不含它所在的工作区目录
 *   node scripts/agent-sessions.mjs --debug                  # 每个会话的筛选过程打到 stderr
 *
 * 三个适配器的位置与格式（都是实测确认的，不是猜的）：
 *   Codex CLI   ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl
 *               明文 JSONL，{timestamp,type,payload}；session_meta.payload 有 cwd/session_id/originator，
 *               turn_context.payload 有 model，event_msg/user_message 有首条需求，
 *               event_msg/agent_message（phase=final_answer）有结论。
 *   Claude Code ~/.claude/projects/<路径变形>/<sessionId>.jsonl
 *               明文 JSONL，{type,sessionId,...}；user/assistant 记录带 cwd/timestamp，
 *               ai-title 是一句话标题，system/turn_duration 有单轮耗时。
 *   DSH         ~/.dsh/sessions/<路径变形>/<会话id>/session.jsonl.zstd
 *               zstd **多帧**压缩的 JSONL（一帧一条记录，Node 内置 zlib 就能解，不需要第三方包）。
 *               第 1 帧是 {type:'session',createdAt,cwd,agentPreset,delegationDepth,origin}；
 *               之后是 text-chunks / tool/call / turn-start 等事件流。
 *
 * 注意：非 ASCII 字符在「路径变形」目录名里会被替换成 `-`（例如
 * `--E-AIStudy-AIProjects-factory-WorkLog-Work0909-Work09098--`），所以判断会话属于哪个仓库时
 * **优先用记录里的 cwd 字段**，目录名只在 cwd 缺失时才退化使用。
 *
 * 纯 Node 实现，零第三方依赖。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

// ── 噪音预算（硬性上限，用户最在意的一条）──────────────────────────────────
/** 每个 Agent 每天最多几条信号 */
export const PER_AGENT_LIMIT = 3
/** 跨 Agent 合计最多几条信号 */
export const TOTAL_LIMIT = 5
/** 摘要截断长度（首条需求 / 最终结论） */
const REQUEST_MAX = 80
const CONCLUSION_MAX = 120

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── 小工具 ────────────────────────────────────────────────────────────────
function localDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}

/** 本机时区的 HH:MM */
function hhmm(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 单行化 + 砍到 max 个字符（截断是隐私边界的一部分，不是排版） */
function clip(text, max) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

/** 路径比较用：统一小写、统一分隔符、去尾斜杠 */
function normalizePath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 会话的工作目录是否属于这个仓库。
 * 精确等于、或落在仓库里面（子目录）都算；仓库落在会话目录里面不算。
 * 大小写与尾斜杠差异都容忍（Windows 上盘符大小写、`E:\x\` vs `E:\x` 都常见）。
 */
export function cwdMatches(cwd, repoDir) {
  const a = normalizePath(cwd)
  const b = normalizePath(repoDir)
  if (!a || !b) return false
  return a === b || a.startsWith(`${b}/`)
}

/**
 * 目录名退化匹配：路径变形把非 ASCII 换成 `-`，先把路径做同样的变形再比。
 * 只在记录里没有 cwd 时用。注意保留前导 `-`（`E:\x` → `E-x`，不是 `-E-x`）。
 */
export function mangledDirOf(dir) {
  const abs = normalizePath(dir)
  return abs.replace(/[^a-z0-9/]/g, '-').replace(/\//g, '-')
}

function mangledMatches(mangled, repoDirs) {
  if (!mangled) return false
  const a = mangled.toLowerCase().replace(/-+$/, '')
  for (const repoDir of repoDirs) {
    // 允许两边互为前缀：会话目录可能是仓库本身，也可能是仓库所在的工作区目录
    const b = mangledDirOf(repoDir).replace(/-+$/, '')
    if (b && (a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`))) return true
    // cwd 恰好等于仓库或其父目录时，变形目录名只等于最后一层目录名，单独比一次
    const base = repoDir.replace(/\/[^/]*$/, '').split('/').pop()
    const baseDir = repoDir.split('/').pop()
    if (base && a === base) return true
    if (baseDir && a === baseDir) return true
  }
  return false
}

/**
 * 「属于本仓库」的判定目录集合。
 *
 * 为什么要带一层父目录：这个博客**嵌在一个工作区里** —— 仓库根是
 * `...\Work09098\my-blog`，而 Agent 实际是在外面那层 `...\Work09098` 里启动的
 * （DSH 的 cwd 就是 `E:\AIStudy\AIProjects\factory\WorkLog\Work0909\Work09098`）。
 * 只认仓库根的话，本机上真正在改这个博客的三次会话一条都采不到 —— 实测过。
 * 所以默认把父目录也当成「相关」，可用 `--exact` / `exact: true` 收紧成只认仓库根。
 */
export function repoDirsOf(repoDir, exact = false) {
  const abs = normalizePath(repoDir)
  const dirs = [abs]
  if (!exact) {
    const parent = abs.replace(/\/[^/]+$/, '')
    if (parent && parent !== abs) dirs.push(parent)
  }
  return dirs
}

function matchesAny(cwd, repoDirs) {
  return repoDirs.some(dir => cwdMatches(cwd, dir))
}

/** 安全列目录：读不了就返回空数组（不是每个用户都装了这三个 Agent） */
function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return []
  }
}

function safeStat(path) {
  try {
    return statSync(path)
  }
  catch {
    return null
  }
}

/** 逐行解析 JSONL；坏行直接跳过（截断/半写状态的文件很常见） */
function* jsonLines(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      yield JSON.parse(trimmed)
    }
    catch {
      // 半行、被截断的尾巴：丢掉，不报错
    }
  }
}

/**
 * 不保留原文：把读过的字符串丢掉。
 * 这不是故弄玄虚 —— 这里显式点出「原文到此为止」，是为了防止后来者顺手把 body 传出去。
 */
function discard() {}

function note(msg, notes) {
  notes.push(msg)
}

function debug(debugEnabled, ...args) {
  if (debugEnabled) console.error('[debug]', ...args)
}

// ── 通用：会话记录 → 信号（各适配器只负责填这几个字段）────────────────────
function makeSession(agent, extra) {
  return {
    agent,
    startMs: null,
    endMs: null,
    cwd: '',
    sessionId: '',
    model: '',
    request: '',      // 首条用户需求的极短摘要
    conclusion: '',   // 最后一条助手结论的极短摘要
    toolCalls: 0,     // 只计数
    codeChanges: false, // 有没有落盘类工具调用（write/edit/apply_patch）
    retries: 0,       // 失败 / 重试次数（只计数）
    turns: 0,
    root: true,       // 是不是用户直接开的会话（DSH 的子代理会话为 false）
    durationMs: 0,
    ...extra,
  }
}

// ── 适配器 1：Codex CLI ───────────────────────────────────────────────────
const CODEX_DEFAULT_DIR = () => join(homedir(), '.codex', 'sessions')
const CODEX_EDIT_TOOLS = /^(apply_patch|write|write_file|edit|edit_file|create_file|multi_edit|notebook_edit)$/i

/** 按 <YYYY>/<MM>/<DD> 定位当天的 rollout 文件（目录本身就是本地日期） */
function codexFilesForDate(root, date) {
  const [y, m, d] = date.split('-')
  const dir = join(root, y, m, d)
  if (!existsSync(dir)) return []
  return safeReaddir(dir)
    .filter(entry => entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl'))
    .map(entry => join(dir, entry.name))
}

/**
 * 读一个 Codex rollout：只留元数据与截断摘要，正文一律丢弃。
 * 不需要再按日期过滤：这个文件本来就躺在 `<YYYY>/<MM>/<DD>` 目录里。
 */
function parseCodexFile(file, repoDirs) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  }
  catch {
    return null
  }

  const session = makeSession('codex')
  let rawUserRequest = ''
  let finalAnswer = ''
  let anyAnswer = ''
  let inRepo = false

  for (const record of jsonLines(text)) {
    const payload = record?.payload
    const stamp = Date.parse(record?.timestamp ?? '')
    if (Number.isFinite(stamp)) {
      if (session.startMs === null || stamp < session.startMs) session.startMs = stamp
      if (session.endMs === null || stamp > session.endMs) session.endMs = stamp
    }
    if (record?.type === 'session_meta' && payload) {
      session.cwd = String(payload.cwd ?? session.cwd)
      session.sessionId = String(payload.session_id ?? payload.id ?? session.sessionId)
      if (!session.sessionId) session.sessionId = sessionIdHintFromName(file)
      session.model = String(payload.model ?? session.model ?? '')
      session.originator = String(payload.originator ?? '')
      if (matchesAny(session.cwd, repoDirs)) inRepo = true
      continue
    }
    if (record?.type === 'turn_context' && payload) {
      // 会话中途换目录也算「在这个仓库里干过」
      if (payload.cwd) session.cwd = String(payload.cwd)
      if (payload.model) session.model = String(payload.model)
      session.turns += 1
      if (matchesAny(session.cwd, repoDirs)) inRepo = true
      continue
    }
    if (record?.type === 'event_msg' && payload?.type === 'user_message') {
      const message = String(payload.message ?? '')
      // 跳过 <environment_context> 这类运行时注入的合成消息，只认人话
      if (!rawUserRequest && message.trim() && !message.trimStart().startsWith('<')) rawUserRequest = message
      continue
    }
    if (record?.type === 'event_msg' && payload?.type === 'agent_message') {
      const message = String(payload.message ?? '')
      if (message.trim()) {
        anyAnswer = message
        if (payload.phase === 'final_answer') finalAnswer = message
      }
      continue
    }
    if (record?.type === 'event_msg' && payload?.type === 'turn_aborted') {
      session.retries += 1
      continue
    }
    if (record?.type === 'response_item') {
      const kind = String(payload?.type ?? '')
      if (kind === 'function_call' || kind === 'custom_tool_call') {
        session.toolCalls += 1
        const name = String(payload?.name ?? payload?.tool_name ?? '')
        if (CODEX_EDIT_TOOLS.test(name)) session.codeChanges = true
      }
      else if (kind === 'custom_tool_call_output' || kind === 'function_call_output') {
        // 工具**返回内容**绝对不进日志：只看它有没有失败（计数用），随后立刻丢弃
        const blob = String(payload?.output ?? '')
        if (/^\s*(\{|\[)/.test(blob) && /"error"|"failed"|exit code: [1-9]/i.test(blob.slice(0, 4000))) session.retries += 1
        discard(blob)
      }
    }
  }

  session.request = clip(rawUserRequest, REQUEST_MAX)
  session.conclusion = clip(finalAnswer || anyAnswer, CONCLUSION_MAX)
  if (!inRepo && !matchesAny(session.cwd, repoDirs)) {
    // cwd 缺失时才退化用文件名里的会话 id（不可逆，别硬编一个假 cwd）
    session.cwdUnknown = !session.cwd
  }
  session.inRepo = inRepo
  return session
}

function sessionIdHintFromName(file) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)
  return m ? m[1] : basename(file)
}

async function collectCodex(date, repoDirs, notes, debugEnabled = false) {
  const root = CODEX_DEFAULT_DIR()
  if (!existsSync(root)) {
    note(`codex：没有找到 ${root}（这台机器没装 Codex CLI / 或没跑过会话），已跳过`, notes)
    return []
  }
  const files = codexFilesForDate(root, date)
  if (!files.length) {
    note(`codex：${join(root, ...date.split('-'))} 下没有当天会话，已跳过`, notes)
    return []
  }
  debug(debugEnabled, `codex root=${root} files=${files.length} repoDirs=${repoDirs.join(' | ')}`)
  const out = []
  for (const file of files) {
    const session = parseCodexFile(file, repoDirs)
    if (!session) {
      note(`codex：读不了 ${basename(file)}，已跳过该文件`, notes)
      continue
    }
    debug(debugEnabled, `codex ${basename(file)} cwd=${session.cwd} inRepo=${session.inRepo} tools=${session.toolCalls}`)
    if (session.inRepo) out.push(session)
  }
  return out
}

// ── 适配器 2：Claude Code ─────────────────────────────────────────────────
const CLAUDE_DEFAULT_DIR = () => join(homedir(), '.claude', 'projects')
const CLAUDE_EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|str_replace_editor|create_file)$/

async function collectClaude(date, repoDirs, notes, debugEnabled = false) {
  const root = CLAUDE_DEFAULT_DIR()
  if (!existsSync(root)) {
    note(`claude：没有找到 ${root}（这台机器没装 Claude Code / 或没跑过会话），已跳过`, notes)
    return []
  }
  const dirs = safeReaddir(root).filter(entry => entry.isDirectory())
  const out = []
  for (const dir of dirs) {
    const dirPath = join(root, dir.name)
    const files = safeReaddir(dirPath)
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => join(dirPath, entry.name))
    for (const file of files) {
      const session = parseClaudeFile(file, repoDirs, dir.name, date)
      debug(debugEnabled, `claude ${basename(file)} cwd=${session?.cwd} inRepo=${session?.inRepo}`)
      if (session?.inRepo) out.push(session)
    }
  }
  return out
}

function parseClaudeFile(file, repoDirs, dirName, date) {
  const stat = safeStat(file)
  if (!stat) return null
  let text
  try {
    text = readFileSync(file, 'utf8')
  }
  catch {
    return null
  }

  const session = makeSession('claude')
  session.sessionId = basename(file, '.jsonl')
  let request = ''
  let lastPrompt = ''
  let conclusion = ''
  let title = ''
  let inRepo = false
  let fileCwd = ''

  for (const record of jsonLines(text)) {
    if (record.sessionId && !session.sessionId) session.sessionId = String(record.sessionId)
    const stamp = Date.parse(record?.timestamp ?? '')
    if (Number.isFinite(stamp)) {
      if (session.startMs === null || stamp < session.startMs) session.startMs = stamp
      if (session.endMs === null || stamp > session.endMs) session.endMs = stamp
    }
    switch (record?.type) {
      case 'user': {
        if (record.cwd) fileCwd = String(record.cwd)
        const content = record.message?.content
        const text_ = typeof content === 'string'
          ? content
          : Array.isArray(content) ? content.filter(p => p?.type === 'text').map(p => p.text).join(' ') : ''
        // isSidechain=true 是子代理的合成消息，不算「人类需求」
        if (!record.isSidechain && !request && text_.trim() && !text_.trimStart().startsWith('<')) request = text_
        break
      }
      case 'assistant': {
        if (record.cwd) fileCwd = String(record.cwd)
        if (record.message?.model) session.model = String(record.message.model)
        const content = record.message?.content
        if (!Array.isArray(content)) break
        for (const part of content) {
          if (part?.type === 'tool_use') {
            session.toolCalls += 1
            if (CLAUDE_EDIT_TOOLS.test(String(part.name ?? ''))) session.codeChanges = true
            else if (/^Bash$/i.test(String(part.name ?? ''))) {
              const cmd = String(part.input?.command ?? '')
              if (/\b(git\s+(commit|apply|add)|Set-Content|Out-File|>\s*\S|sed -i|tee\b)/i.test(cmd.slice(0, 400))) session.codeChanges = true
              if (/\b(error|failed|not found|failed to)\b/i.test(cmd.slice(0, 400))) session.retries += 1
              discard(cmd)
            }
          }
          else if (part?.type === 'text' && part.text?.trim()) {
            conclusion = String(part.text)
          }
          else if (part?.type === 'thinking') {
            discard(part.thinking) // 思考链绝对不进日志
          }
        }
        break
      }
      case 'ai-title':
        if (record.aiTitle) title = String(record.aiTitle)
        break
      case 'last-prompt':
        if (record.lastPrompt) lastPrompt = String(record.lastPrompt)
        break
      case 'system':
        if (record.subtype === 'turn_duration' && Number.isFinite(record.durationMs)) {
          session.durationMs = Math.max(session.durationMs, Number(record.durationMs))
        }
        break
      default:
        // mode / permission-mode / file-history-snapshot / attachment / queue-operation：
        // 要么没有信息量，要么含文件内容与路径细节 —— 直接跳过，不解析。
        break
    }
  }

  if (!session.endMs && stat.mtimeMs) session.endMs = stat.mtimeMs
  session.request = clip(request || lastPrompt || title, REQUEST_MAX)
  session.title = clip(title, REQUEST_MAX)
  session.conclusion = clip(conclusion, CONCLUSION_MAX)
  const cwd = fileCwd
  inRepo = matchesAny(cwd, repoDirs) || (!cwd && mangledMatches(dirName, repoDirs))
  session.cwd = cwd
  if (!session.startMs && session.endMs) session.startMs = session.endMs
  if (session.startMs === null) return null
  if (localDate(new Date(session.startMs)) !== date) return null
  session.inRepo = inRepo
  return session
}

// ── 适配器 3：DSH（zstd 多帧）────────────────────────────────────────────
const DSH_DEFAULT_DIR = () => join(homedir(), '.dsh', 'sessions')
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const DSH_EDIT_TOOLS = /^(write|edit|multi_edit|apply_patch|notebook_edit)$/i

/**
 * 扫描 zstd 帧边界：DSH 是一帧一条记录追加写的。
 *
 * **导出给 scripts/mine-history.mjs 复用**：`zlib.zstdDecompressSync` 只解第一帧就返回，
 * 必须按魔数逐帧解才能读全 —— 这个坑踩过一次，不要在两处各写一份实现。
 */
export function zstdFrameOffsets(buffer) {
  const offsets = []
  let from = 0
  for (;;) {
    const at = buffer.indexOf(ZSTD_MAGIC, from)
    if (at < 0) break
    offsets.push(at)
    from = at + 1
  }
  return offsets
}

/**
 * 读一个 DSH 会话。
 * 第 1 帧（`type: 'session'`）就足以拿到 cwd / 时间 / agentPreset —— 先解这一帧做筛选，
 * 只有真的进了当天的候选，才把整份事件流解一遍（大会话有 2 万多帧、12 MB，别白解）。
 */
function parseDshSession(file, repoDirs, date, { deep = true } = {}) {
  let buffer
  try {
    buffer = readFileSync(file)
  }
  catch {
    return null
  }
  const stat = safeStat(file)

  // ① 轻量：第一帧 = 会话头（大会话有 2 万多帧、12 MB，先只解这一帧做筛选）
  let header = null
  try {
    header = JSON.parse(zstdDecompressSync(buffer, { maxOutputLength: 1 << 20 }).toString('utf8').split('\n')[0])
  }
  catch {
    return null
  }
  if (header?.type !== 'session') return null

  const session = makeSession('dsh')
  session.sessionId = String(header.id ?? basename(join(file, '..')))
  session.cwd = String(header.cwd ?? '')
  session.model = String(header.agentPreset ?? '')
  session.root = String(header.origin ?? 'root') !== 'subagent'
  session.startMs = Number(header.createdAt) || (stat?.birthtimeMs ?? stat?.mtimeMs ?? null)
  session.endMs = stat?.mtimeMs ?? session.startMs
  session.depth = Number(header.delegationDepth ?? 0)
  // cwd 缺失时退化用目录名：# file = <root>/<变形目录>/<会话id>/session.jsonl.zstd
  const mangledDir = basename(join(file, '..', '..'))
  session.inRepo = matchesAny(session.cwd, repoDirs) || (!session.cwd && mangledMatches(mangledDir, repoDirs))
  if (!session.inRepo) return session
  if (localDate(new Date(session.startMs)) !== date) {
    session.inRepo = false
    return session
  }
  if (!deep) return session

  // ② 重量：解完整事件流，只留计数与截断摘要
  let title = ''
  let head = ''
  let tail = ''
  let request = ''
  let finalConclusion = ''
  let lastAssistantText = ''
  let lastTurnEndMs = null
  let completedTurns = 0
  for (const offset of zstdFrameOffsets(buffer)) {
    let chunk
    try {
      chunk = zstdDecompressSync(buffer.subarray(offset), { maxOutputLength: 8 << 20 }).toString('utf8')
    }
    catch {
      continue // 伪帧头（魔数出现在压缩数据里）或半写帧：跳过
    }
    for (const record of jsonLines(chunk)) {
      const time = Number(record?.time ?? record?.time0)
      if (Number.isFinite(time)) {
        if (session.startMs === null || time < session.startMs) session.startMs = time
        if (session.endMs === null || time > session.endMs) session.endMs = time
        if (record.type === 'turn/end') {
          lastTurnEndMs = time
          completedTurns += 1
          // 刚结束的这一轮如果以正文收尾，它就是「最后一条助手结论」的候选
          if (lastAssistantText) finalConclusion = lastAssistantText
        }
      }
      switch (record?.type) {
        case 'session/title':
          if (record.data?.title) title = String(record.data.title)
          break
        case 'user/message': {
          // 首条**人话**需求；跳过运行时注入的合成消息（DSH 也会注入 runtime context）
          if (request) break
          const content = record.data?.content
          const text = Array.isArray(content)
            ? content.filter(p => p?.type === 'text').map(p => p.text ?? '').join(' ')
            : ''
          if (text.trim() && !text.trimStart().startsWith('<') && !/^Current runtime context/i.test(text.trim())) request = text
          break
        }
        case 'tool/call':
          session.toolCalls += 1
          if (DSH_EDIT_TOOLS.test(String(record.data?.name ?? ''))) session.codeChanges = true
          break
        case 'assistant/message': {
          const content = record.data?.message?.content
          if (!Array.isArray(content)) break
          const text = content.filter(p => p?.type === 'text').map(p => p.text ?? '').join('')
          // 只保留**最后一条**带正文的助手消息；中间那些是过程解说，不是结论
          if (text.trim()) lastAssistantText = text
          break
        }
        case 'text-chunks': {
          const texts = record.data?.texts
          if (!Array.isArray(texts)) break
          const part = texts.join('')
          if (!head && part.trim()) head = part
          tail = (tail + part).slice(-(CONCLUSION_MAX * 8))
          break
        }
        case 'llm/retry-started':
          session.retries += 1
          break
        case 'turn/start':
          session.turns += 1
          break
        case 'command/done':
          if (record.data?.exitCode && Number(record.data.exitCode) !== 0) session.retries += 1
          break
        default:
          break
      }
    }
  }

  session.title = clip(title, REQUEST_MAX)
  // 首条需求优先取真人写的那段；取不到才退到 LLM 生成的会话标题
  session.request = clip(request || title, REQUEST_MAX)
  session.conclusion = clip(finalConclusion || lastAssistantText || tail || head, CONCLUSION_MAX)
  session.completedTurns = completedTurns
  if (lastTurnEndMs) session.endMs = Math.max(session.endMs ?? 0, lastTurnEndMs)
  return session
}

async function collectDsh(date, repoDirs, notes, debugEnabled = false) {
  const root = DSH_DEFAULT_DIR()
  if (!existsSync(root)) {
    note(`dsh：没有找到 ${root}（这台机器没装 DSH / 或没跑过会话），已跳过`, notes)
    return []
  }
  const dirs = safeReaddir(root).filter(entry => entry.isDirectory())
  const candidates = []
  for (const dir of dirs) {
    const inner = safeReaddir(join(root, dir.name)).filter(entry => entry.isDirectory())
    for (const sessionDir of inner) {
      const file = join(root, dir.name, sessionDir.name, 'session.jsonl.zstd')
      if (!existsSync(file)) continue
      const session = parseDshSession(file, repoDirs, date, { deep: false })
      debug(debugEnabled, `dsh ${sessionDir.name.slice(0, 8)} cwd=${session?.cwd} inRepo=${session?.inRepo} start=${session?.startMs ? localDate(new Date(session.startMs)) : '-'}`)
      if (!session) continue
      if (session.inRepo && localDate(new Date(session.startMs)) === date) candidates.push({ file, session })
    }
  }
  // 深度解析只对当天候选做（前面的筛选已经把绝大多数会话挡掉了）
  const out = []
  for (const { file, session } of candidates) {
    const full = parseDshSession(file, repoDirs, date, { deep: true }) ?? session
    out.push(full)
  }
  if (!out.length) note(`dsh：${root} 下没有 ${date} 当天、且 cwd 属于本仓库的会话`, notes)
  return out
}

// ── 噪音预算：rank → 截断 → 合并 ─────────────────────────────────────────
/**
 * 打分：越高越值得留。
 * 排序依据（题目要求的优先级，逐条对应）：
 *   1. 有没有代码改动（write/edit/apply_patch 类工具调用）
 *   2. 有没有失败重试
 *   3. 时长
 * 再叠一点小权重做同分裁决：根会话优于子代理会话、工具有调用优于纯聊天、有摘要优于空壳。
 * 同一根会话下的子代理会话会被合并（见 mergeSubagents），所以这里的分只影响「哪几条留」。
 */
export function scoreOf(session) {
  return (session.codeChanges ? 100 : 0)
    + Math.min(session.retries, 20) * 50
    + Math.min(Math.round((session.durationMs || (session.endMs ?? 0) - (session.startMs ?? 0)) / 60000), 60)
    + (session.root ? 5 : 0)
    + (session.toolCalls > 0 ? 4 : 0)
    + (session.conclusion ? 2 : 0)
}

/**
 * 把同一 Agent、当天的子代理会话并进根会话 —— 这是最大的降噪来源：
 * 一次「派 3 个子代理」的任务在原始记录里是 4 个会话，进日志只需要 1 条。
 * 没有根会话时（例如只留下了子代理），就把子代理们合成一条汇总。
 */
export function mergeSubagents(sessions) {
  const roots = sessions.filter(s => s.root)
  const subs = sessions.filter(s => !s.root)
  const used = new Set()
  const merged = []

  for (const root of roots.sort((a, b) => scoreOf(b) - scoreOf(a))) {
    const children = subs.filter((sub) => {
      if (used.has(sub)) return false
      // 子代理会话总是启动在父会话之后、且在父会话结束之前（或紧邻）
      const after = (sub.startMs ?? 0) >= (root.startMs ?? 0)
      const near = (sub.startMs ?? 0) <= (root.endMs ?? sub.startMs ?? 0) + 6 * 3600_000
      return after && near
    })
    for (const child of children) used.add(child)
    merged.push(attach(root, children))
  }

  const orphans = subs.filter(sub => !used.has(sub))
  if (orphans.length) {
    orphans.sort((a, b) => scoreOf(b) - scoreOf(a))
    const head = { ...orphans[0] }
    head.root = true
    head.sessionId = `${head.sessionId}+${orphans.length - 1}`
    head.childSessions = orphans.length
    head.toolCalls = orphans.reduce((sum, s) => sum + s.toolCalls, 0)
    head.codeChanges = orphans.some(s => s.codeChanges)
    head.retries = orphans.reduce((sum, s) => sum + s.retries, 0)
    head.startMs = Math.min(...orphans.map(s => s.startMs ?? Infinity))
    head.endMs = Math.max(...orphans.map(s => s.endMs ?? 0))
    head.request = head.request || `（${orphans.length} 个没挂上主会话的子代理会话）`
    head.conclusion = head.conclusion || clip(
      orphans.map(s => s.conclusion).filter(Boolean).join('；'), CONCLUSION_MAX,
    )
    merged.push(head)
  }

  return merged.sort((a, b) => scoreOf(b) - scoreOf(a))
}

function attach(root, children) {
  if (!children.length) return root
  const session = { ...root }
  session.childSessions = children.length
  session.toolCalls = root.toolCalls + children.reduce((sum, s) => sum + s.toolCalls, 0)
  session.codeChanges = root.codeChanges || children.some(s => s.codeChanges)
  session.retries = root.retries + children.reduce((sum, s) => sum + s.retries, 0)
  session.endMs = Math.max(root.endMs ?? 0, ...children.map(s => s.endMs ?? 0))
  session.subagentToolCalls = children.reduce((sum, s) => sum + s.toolCalls, 0)
  return session
}

/**
 * 硬预算：每个 Agent 最多 perAgent 条、合计最多 total 条。
 * 按 scoreOf 排序后截断，被截掉的条数记在 dropped 上（打印出来，不写进草稿正文）。
 */
export function applyBudget(sessions, { perAgent = PER_AGENT_LIMIT, total = TOTAL_LIMIT } = {}) {
  const byAgent = new Map()
  for (const session of sessions) {
    if (!byAgent.has(session.agent)) byAgent.set(session.agent, [])
    byAgent.get(session.agent).push(session)
  }
  const kept = []
  const dropped = []
  for (const [agent, list] of byAgent) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a))
    kept.push(...list.slice(0, perAgent))
    dropped.push(...list.slice(perAgent).map(s => ({ agent, sessionId: s.sessionId, reason: `超出单 Agent 上限 ${perAgent} 条` })))
  }
  kept.sort((a, b) => scoreOf(b) - scoreOf(a))
  const final = kept.slice(0, total)
  dropped.push(...kept.slice(total).map(s => ({ agent: s.agent, sessionId: s.sessionId, reason: `超出合计上限 ${total} 条` })))
  final.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
  return { sessions: final, dropped }
}

// ── 输出：结构化信号 ─────────────────────────────────────────────────────
function toSignal(session) {
  const durationMs = session.durationMs
    || ((session.endMs ?? 0) - (session.startMs ?? 0))
  return {
    agent: session.agent,
    date: session.startMs ? localDate(new Date(session.startMs)) : '',
    startTime: hhmm(session.startMs),
    endTime: hhmm(session.endMs),
    durationMinutes: durationMs > 0 ? Math.round(durationMs / 60000) : 0,
    // 会话 id 截断：够你 `node scripts/agent-sessions.mjs --json` 里回溯，又不至于到处散布整串
    sessionId: String(session.sessionId ?? '').slice(0, 12),
    cwd: String(session.cwd ?? ''),
    model: String(session.model ?? ''),
    request: session.request ?? '',
    conclusion: session.conclusion ?? '',
    toolCalls: session.toolCalls ?? 0,
    codeChanges: Boolean(session.codeChanges),
    retries: session.retries ?? 0,
    childSessions: session.childSessions ?? 0,
    score: scoreOf(session),
  }
}

/**
 * 采集某一天、属于 repoDir 的所有 Agent 会话信号。
 * 永不抛错：任何一个适配器出错都只记一条 note（草稿生成不能因为采集失败而中断）。
 */
export async function collectAgentSessions(date = localDate(), options = {}) {
  const {
    repoDir = process.cwd(),
    exact = false,
    perAgent = PER_AGENT_LIMIT,
    total = TOTAL_LIMIT,
    budget = true,
    excludeSessionIds = [],
    deep = true,
    debug: debugEnabled = false,
  } = options

  if (!isValidDate(date)) throw new Error(`日期格式不对：${date}（要 YYYY-MM-DD）`)

  const repoDirs = repoDirsOf(repoDir, exact)
  const notes = []
  const raw = []
  const adapters = [
    ['codex', collectCodex],
    ['claude', collectClaude],
    ['dsh', collectDsh],
  ]

  for (const [name, collect] of adapters) {
    const started = Date.now()
    try {
      const found = await collect(date, repoDirs, notes, debugEnabled)
      const filtered = found.filter(session => session && session.inRepo)
        .filter(session => !excludeSessionIds.includes(String(session.sessionId ?? '')))
      raw.push(...filtered)
      notes.push(`${name}：找到 ${filtered.length} 个「${date} + 本仓库」的会话（耗时 ${Date.now() - started} ms）`)
    }
    catch (error) {
      // 目录不存在 / 权限不足 / 格式变了 —— 一律降级为「这个 Agent 跳过」，绝不中断
      note(`${name}：采集失败，已跳过 —— ${error?.message ?? error}`, notes)
    }
  }

  const merged = mergeSubagents(raw)
  const { sessions, dropped } = budget
    ? applyBudget(merged, { perAgent, total })
    : { sessions: merged.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0)), dropped: [] }

  return {
    date,
    repoDir,
    matchedDirs: repoDirs,
    sessions: sessions.map(toSignal),
    dropped,
    notes,
    counts: {
      raw: raw.length,
      merged: merged.length,
      kept: sessions.length,
      byAgent: raw.reduce((acc, s) => {
        acc[s.agent] = (acc[s.agent] ?? 0) + 1
        return acc
      }, {}),
    },
    budget: { perAgent, total },
    deep,
  }
}

/** 会话里出现过的 Agent 名（合并进日志 frontmatter 的 agents 用） */
export async function collectAgentNames(date = localDate(), options = {}) {
  const result = await collectAgentSessions(date, options)
  return { agents: [...new Set(result.sessions.map(s => s.agent))], result }
}

// ── CLI ──────────────────────────────────────────────────────────────────
const USAGE = `Agent 会话适配器（Codex CLI / Claude Code / DSH）

  node scripts/agent-sessions.mjs                       # 今天的信号（默认本机时区的今天）
  node scripts/agent-sessions.mjs --date 2026-05-19     # 指定日期
  node scripts/agent-sessions.mjs --json                # 机器可读（new-log.mjs 内部也是这么用的）
  node scripts/agent-sessions.mjs --all                 # 不做噪音预算，打印全部候选
  node scripts/agent-sessions.mjs --repo <路径>          # 指定仓库目录（默认当前工作目录）
  node scripts/agent-sessions.mjs --exact               # 只认仓库根目录，不含它所在的工作区目录

只提取元数据与截断摘要；会话正文绝不输出、绝不写盘。`

function readArg(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === name) {
      const next = argv[i + 1]
      return next && !next.startsWith('--') ? next : ''
    }
    if (item.startsWith(`${name}=`)) return item.slice(name.length + 1)
  }
  return null
}

const isCli = process.argv[1] && /agent-sessions\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))
if (isCli) {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }
  const date = readArg(argv, '--date') || localDate()
  const repo = readArg(argv, '--repo') || process.cwd()
  const json = argv.includes('--json')
  const all = argv.includes('--all')
  const exact = argv.includes('--exact')

  if (!isValidDate(date)) {
    console.error(`✘ 日期格式不对：${date}（要 YYYY-MM-DD）`)
    process.exit(1)
  }

  const started = Date.now()
  const result = await collectAgentSessions(date, { repoDir: repo, exact, budget: !all, debug: argv.includes('--debug') })
  const elapsed = Date.now() - started

  if (json) {
    console.log(JSON.stringify({ ...result, elapsedMs: elapsed }, null, 2))
    process.exit(0)
  }

  console.log(`Agent 会话信号 · ${date} · 仓库 ${repo}`)
  console.log(`（匹配目录：${result.matchedDirs.join('、')}）`)
  console.log('─'.repeat(72))
  for (const line of result.notes) console.log(`  ${line}`)
  console.log('')
  if (!result.sessions.length) {
    console.log('（没有采集到任何会话信号：这一天可能没跑 Agent，或跑的 Agent 没装在默认位置）')
  }
  else {
    for (const s of result.sessions) {
      const flags = [s.codeChanges ? '有代码改动' : '', s.retries ? `重试×${s.retries}` : '', s.childSessions ? `含子代理×${s.childSessions}` : '']
        .filter(Boolean).join('、')
      console.log(`● [${s.agent}] ${s.startTime}–${s.endTime}（${s.durationMinutes} 分钟）${s.model ? `模型 ${s.model}` : ''}`)
      console.log(`  会话 ${s.sessionId}${flags ? ` · ${flags}` : ''} · 工具调用 ${s.toolCalls} 次`)
      if (s.request) console.log(`  需求：${s.request}`)
      if (s.conclusion) console.log(`  结论：${s.conclusion}`)
    }
  }
  if (result.dropped.length) {
    console.log('')
    console.log(`  已按噪音预算丢掉 ${result.dropped.length} 条：${result.dropped.map(d => `[${d.agent}] ${d.sessionId}（${d.reason}）`).join('、')}`)
  }
  console.log('')
  console.log(`预算：每 Agent ≤${result.budget.perAgent} 条、合计 ≤${result.budget.total} 条；候选 ${result.counts.raw} → 合并后 ${result.counts.merged} → 保留 ${result.counts.kept}（耗时 ${elapsed} ms）`)
  process.exit(0)
}
