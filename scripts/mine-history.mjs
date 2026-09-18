#!/usr/bin/env node
/**
 * 把散落在本机三个 Agent 会话记录里的历史，压成**按天分文件的摘要**，供人工/模型蒸馏成工作日志。
 *
 * 为什么需要它：本机 Codex + Claude Code + DSH 三个 Agent 的会话加起来 2.6 GB 以上，
 * 直接喂给模型不现实。这一步是**确定性压缩** —— 只保留「用户说了什么问题」「哪里报错了」
 * 「最后的结论」，其余（思考链、工具入参出参、命令全文、文件内容）全部丢弃。
 *
 * 与 scripts/agent-sessions.mjs 的分工：
 *   - agent-sessions.mjs：给「当天 + 本仓库」出**少量**信号（每 Agent ≤3 条），给写日志用
 *   - 本脚本：给**全部项目 + 全部日期**出**完整摘要**，给「补历史日志」这种一次性考古用
 * 两者共用同一套底层技巧（DSH 多帧 zstd 解压复用 agent-sessions.mjs 的导出）。
 *
 * 用法：
 *   node scripts/mine-history.mjs --from 2026-08-17 --to 2026-09-18 --out .data/mine
 *   node scripts/mine-history.mjs --date 2026-09-10 --out .data/mine --verbose
 *
 * 产出：`<out>/<日期>.md` 每天一个摘要文件 + `<out>/index.md` 总览。
 * ⚠️ 摘要里**会包含本机路径与项目名**（那是给人/模型判断取材用的），落盘在 .data/（已 gitignore），
 *    绝不要把摘要原文发布出去。
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { zstdFrameOffsets } from './agent-sessions.mjs'

// ── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const has = name => argv.includes(`--${name}`)

const OUT = arg('out', join('.data', 'mine'))
const VERBOSE = has('verbose')
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const FROM = arg('from', '2026-08-17')
const TO = arg('to', TODAY)
const ONLY_DATE = arg('date', null)

// 每条会话的抽取上限（**这是控量的关键**：不加这些上限摘要会有几十 MB）
const MAX_USER_MSGS = 4
const MAX_USER_CHARS = 170
const MAX_ERRORS = 4
const MAX_ERROR_CHARS = 150
const MAX_CONCLUSION_CHARS = 240
const SKIP_FILE_BYTES = 2 * 1024      // 太小的会话（基本是空壳）
const MAX_SESSIONS_PER_DAY = 14       // 每天最多保留多少条会话摘要（按"有信息量"排序）

// ── 小工具 ────────────────────────────────────────────────────────────────
const localDay = ts => {
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/** 从各种奇形怪状的内容结构里抠出纯文本 */
function textOf(x, depth = 0) {
  if (depth > 6 || x == null) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map(v => textOf(v, depth + 1)).filter(Boolean).join('\n')
  if (typeof x === 'object') {
    if (typeof x.text === 'string') return x.text
    if (typeof x.message === 'string') return x.message
    if (x.content != null) return textOf(x.content, depth + 1)
    if (x.parts != null) return textOf(x.parts, depth + 1)
  }
  return ''
}

/** 看起来像"报错/失败"的片段才留下 */
const ERROR_HINT = /(error|failed|failure|exception|cannot|not found|undefined is not|exit code: [1-9]|traceback|EPERM|ENOENT|EACCES|panic|fatal|拒绝|失败|报错|找不到|不可用)/i
const isErrorish = s => ERROR_HINT.test(s) && s.length > 8

/**
 * 是不是 Agent 自己注入的样板（不是用户真的说的话）。
 *
 * 实测：三个 Agent 都会往"用户消息"里塞环境说明与运行时提示 ——
 * Codex 是 `<environment_context>`，DSH 是 `Current runtime context` / `The approval policy changed…`，
 * Claude 是 `isMeta` 与 `<command-name>` 包裹。不过滤的话摘要里全是这些，真正的诉求会被淹掉。
 */
const INJECTED = [
  /^</,                                              // <environment_context> / <system-reminder> / <command-name>
  /^Current runtime context/i,
  /^The approval policy changed/i,
  /^Current DSH file policy/i,
  /^#\s*AGENTS/i,
  /^Caveat:/i,
  /^\[Request interrupted by user/i,
  /^This session is being continued from a previous conversation/i,
  /^System: /i,
]
const isInjected = t => {
  const s = oneLine(t)
  if (!s) return true
  if (INJECTED.some(re => re.test(s))) return true
  // 像系统提示词的超长块：含大量 markdown 小标题且很长
  if (s.length > 1500 && (s.match(/##\s/g) || []).length >= 4) return true
  return false
}

// ── Codex ─────────────────────────────────────────────────────────────────
function mineCodexDir(dir, date) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const file = join(dir, name)
    try {
      if (statSync(file).size < SKIP_FILE_BYTES) continue
      const records = []
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue
        try { records.push(JSON.parse(line)) } catch { /* 半写行丢弃 */ }
      }
      const s = { agent: 'codex', date, file: file.replace(homedir(), '~'), userMsgs: [], errors: [], conclusion: '', cwd: '', model: '', toolCalls: 0, start: null, end: null }
      for (const r of records) {
        const ts = r.timestamp
        if (ts) { if (!s.start) s.start = ts; s.end = ts }
        const p = r.payload
        if (!p) continue
        if (r.type === 'session_meta') { s.cwd = p.cwd || s.cwd; continue }
        if (r.type === 'turn_context') { s.model = p.model || s.model; continue }
        if (r.type === 'event_msg') {
          if (p.type === 'agent_message') {
            const t = clip(textOf(p.message ?? p.text ?? p.content), MAX_CONCLUSION_CHARS)
            if (t) s.conclusion = t
          }
          continue
        }
        if (r.type === 'response_item') {
          const t = p.type || ''
          if (/function_call|custom_tool_call|local_shell_call|web_search/.test(t)) { s.toolCalls++; continue }
          if (/output/.test(t)) {
            const txt = clip(textOf(p.output ?? p.content), MAX_ERROR_CHARS)
            if (txt && isErrorish(txt) && s.errors.length < MAX_ERRORS) s.errors.push(txt)
            continue
          }
          // 实测：Codex 的用户消息在这里 —— response_item + role=user + content[].type=input_text。
          // 别再找 event_msg/user_message，那个类型在真实文件里根本不存在（踩过一次）。
          if (p.role === 'user' || p.role === 'assistant') {
            const blocks = Array.isArray(p.content) ? p.content : []
            const text = blocks.map(b => (b?.type === 'input_text' || b?.type === 'output_text' || b?.type === 'text') ? b.text : '').filter(Boolean).join('\n')
            if (p.role === 'user') {
              const c = clip(text, MAX_USER_CHARS)
              if (c && !isInjected(c) && s.userMsgs.length < MAX_USER_MSGS && !s.userMsgs.includes(c)) s.userMsgs.push(c)
            }
            else {
              const c = clip(text, MAX_CONCLUSION_CHARS)
              if (c && !isInjected(c)) s.conclusion = c
            }
            continue
          }
          continue
        }
      }
      out.push(s)
    } catch { /* 读不了就跳过 */ }
  }
  return out
}

// ── Claude Code ───────────────────────────────────────────────────────────
function mineClaudeProject(dir, dirName) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const file = join(dir, name)
    try {
      if (statSync(file).size < SKIP_FILE_BYTES) continue
      const s = { agent: 'claude', date: null, file: file.replace(homedir(), '~'), userMsgs: [], errors: [], conclusion: '', cwd: '', model: '', toolCalls: 0, start: null, end: null, project: dirName }
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue
        let r
        try { r = JSON.parse(line) } catch { continue }
        const ts = r.timestamp
        if (ts) { if (!s.start) s.start = ts; s.end = ts }
        if (r.cwd) s.cwd = r.cwd
        if (r.type === 'assistant') {
          s.model = r.message?.model || s.model
          const blocks = Array.isArray(r.message?.content) ? r.message.content : []
          for (const b of blocks) {
            if (b?.type === 'tool_use') s.toolCalls++
            if (b?.type === 'text') { const t = clip(b.text, MAX_CONCLUSION_CHARS); if (t) s.conclusion = t }
          }
          continue
        }
        if (r.type === 'user') {
          if (r.isMeta) continue
          const blocks = Array.isArray(r.message?.content) ? r.message.content : []
          for (const b of blocks) {
            if (b?.type === 'tool_result') {
              const txt = clip(textOf(b.content), MAX_ERROR_CHARS)
              if (txt && isErrorish(txt) && s.errors.length < MAX_ERRORS) s.errors.push(txt)
              continue
            }
            if (b?.type === 'text' || typeof b?.text === 'string') {
              const raw = textOf(b)
              if (/^<[a-z-]+>/i.test(oneLine(raw)) || oneLine(raw).startsWith('Caveat:')) continue
              const t = clip(raw, MAX_USER_CHARS)
              if (t && s.userMsgs.length < MAX_USER_MSGS && !s.userMsgs.includes(t)) s.userMsgs.push(t)
            }
          }
          continue
        }
      }
      s.date = localDay(s.start) || null
      out.push(s)
    } catch { /* 跳过 */ }
  }
  return out
}

// ── DSH ───────────────────────────────────────────────────────────────────
function dshFrames(file) {
  const buf = readFileSync(file)
  const offs = zstdFrameOffsets(buf)
  const frames = []
  for (let i = 0; i < offs.length; i++) {
    const end = i + 1 < offs.length ? offs[i + 1] : buf.length
    try {
      for (const line of zstdDecompressSync(buf.subarray(offs[i], end)).toString('utf8').split('\n')) {
        if (!line) continue
        try { frames.push(JSON.parse(line)) } catch { /* 半写帧丢弃 */ }
      }
    } catch { /* 尾帧可能写到一半 */ }
  }
  return frames
}

function mineDshSession(file, dirName) {
  const frames = dshFrames(file)
  if (!frames.length) return null
  const head = frames.find(f => f.type === 'session') || {}
  const s = {
    agent: 'dsh',
    date: localDay(head.createdAt) || localDay(statSync(file).mtime),
    file: file.replace(homedir(), '~'),
    userMsgs: [], errors: [], conclusion: '',
    cwd: head.cwd || '',
    model: head.agentPreset || '',
    toolCalls: 0,
    start: head.createdAt ? new Date(head.createdAt).toISOString() : null,
    end: new Date(statSync(file).mtime).toISOString(),
    project: dirName,
    isSubagent: head.origin === 'subagent' || (head.delegationDepth ?? 0) > 0,
    title: '',
  }
  for (const f of frames) {
    const t = f.type || ''
    if (t === 'session/title') { s.title = clip(textOf(f.data), 80); continue }
    if (t === 'user/message') {
      const txt = clip(textOf(f.data?.content ?? f.data?.text ?? f.data), MAX_USER_CHARS)
      if (txt && !isInjected(txt) && s.userMsgs.length < MAX_USER_MSGS && !s.userMsgs.includes(txt)) s.userMsgs.push(txt)
      continue
    }
    if (t === 'assistant/message') {
      const txt = clip(textOf(f.data?.content ?? f.data?.text ?? f.data), MAX_CONCLUSION_CHARS)
      if (txt && !isInjected(txt)) s.conclusion = txt
      continue
    }
    if (t === 'tool/call') { s.toolCalls++; continue }
    if (t === 'command/done' || t === 'tool/result') {
      const code = f.data?.exitCode ?? f.data?.code
      const txt = clip(textOf(f.data?.output ?? f.data?.stderr ?? f.data?.content ?? f.data), MAX_ERROR_CHARS)
      const failed = (typeof code === 'number' && code !== 0) || (txt && isErrorish(txt))
      if (failed && txt && s.errors.length < MAX_ERRORS) s.errors.push(txt)
      continue
    }
  }
  return s
}

// ── 采集 ──────────────────────────────────────────────────────────────────
const sessions = []

// Codex：路径里就带日期，最省事
const codexRoot = join(homedir(), '.codex', 'sessions')
if (existsSync(codexRoot)) {
  for (const y of readdirSync(codexRoot)) {
    const yp = join(codexRoot, y)
    if (!statSync(yp).isDirectory()) continue
    for (const m of readdirSync(yp)) {
      const mp = join(yp, m)
      if (!statSync(mp).isDirectory()) continue
      for (const d of readdirSync(mp)) {
        const dp = join(mp, d)
        if (!statSync(dp).isDirectory()) continue
        const date = `${y}-${m}-${d}`
        sessions.push(...mineCodexDir(dp, date))
      }
    }
  }
}

// Claude
const claudeRoot = join(homedir(), '.claude', 'projects')
if (existsSync(claudeRoot)) {
  for (const proj of readdirSync(claudeRoot)) {
    const pp = join(claudeRoot, proj)
    if (!statSync(pp).isDirectory()) continue
    sessions.push(...mineClaudeProject(pp, proj))
  }
}

// DSH
const dshRoot = join(homedir(), '.dsh', 'sessions')
if (existsSync(dshRoot)) {
  for (const proj of readdirSync(dshRoot)) {
    const pp = join(dshRoot, proj)
    if (!statSync(pp).isDirectory()) continue
    for (const sub of readdirSync(pp)) {
      const f = join(pp, sub, 'session.jsonl.zstd')
      if (!existsSync(f)) continue
      if (statSync(f).size < SKIP_FILE_BYTES) continue
      try {
        const s = mineDshSession(f, proj)
        if (s) sessions.push(s)
      } catch { /* 跳过 */ }
    }
  }
}

// ── 过滤 + 分组 ───────────────────────────────────────────────────────────
const inRange = d => d && d >= FROM && d <= TO && (!ONLY_DATE || d === ONLY_DATE)
const interesting = s => (s.userMsgs.length > 0) || (s.errors.length > 0) || s.toolCalls > 4

const byDate = new Map()
let skipped = 0
for (const s of sessions) {
  if (!inRange(s.date) || !interesting(s)) { skipped++; continue }
  if (!byDate.has(s.date)) byDate.set(s.date, [])
  byDate.get(s.date).push(s)
}

// 每天按信息量排序后截断
const scoreOf = s => s.userMsgs.length * 3 + s.errors.length * 2 + Math.min(s.toolCalls, 200) / 50 + (s.conclusion ? 1 : 0)
for (const [d, list] of byDate) {
  list.sort((a, b) => scoreOf(b) - scoreOf(a))
  if (list.length > MAX_SESSIONS_PER_DAY) byDate.set(d, list.slice(0, MAX_SESSIONS_PER_DAY))
}

// ── 落盘 ──────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const projectOf = s => {
  const cwd = (s.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean)
    return parts.slice(-2).join('/')
  }
  return (s.project || '').replace(/^--|--$/g, '').replace(/-/g, '/')
}

const index = []
for (const date of [...byDate.keys()].sort()) {
  const list = byDate.get(date)
  const lines = [`# ${date} 的会话摘要`, '', `> 本机三个 Agent 的会话压缩摘要（共 ${list.length} 条）。**只含用户诉求、报错片段、最终结论**；`, '> 思考链、工具入参出参、命令全文、文件内容都已丢弃。此文件在 .data/ 下，不进版本库。', '']
  for (const s of list) {
    const proj = projectOf(s)
    const t = [s.start, s.end].filter(Boolean).map(x => new Date(x)).map(d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    lines.push(`## [${s.agent}] ${proj}${s.isSubagent ? '（子代理）' : ''}`)
    lines.push(`- 时间：${t.join('–') || '?'}　工具调用：${s.toolCalls}　模型/预设：${s.model || '?'}`)
    if (s.title) lines.push(`- 会话标题：${s.title}`)
    if (s.cwd) lines.push(`- cwd：${s.cwd}`)
    if (s.userMsgs.length) {
      lines.push('- 用户诉求：')
      for (const m of s.userMsgs) lines.push(`    - ${m}`)
    }
    if (s.errors.length) {
      lines.push('- 报错/失败片段：')
      for (const e of s.errors) lines.push(`    - ${e}`)
    }
    if (s.conclusion) lines.push(`- 最终结论：${s.conclusion}`)
    lines.push('')
  }
  writeFileSync(join(OUT, `${date}.md`), lines.join('\n'), 'utf8')
  const bytes = statSync(join(OUT, `${date}.md`)).size
  index.push({ date, sessions: list.length, kb: (bytes / 1024).toFixed(1) })
}

const totalSessions = index.reduce((n, r) => n + r.sessions, 0)
writeFileSync(join(OUT, 'index.md'), [
  `# 会话摘要总览（${FROM} → ${TO}）`, '',
  `扫描到 ${sessions.length} 条会话，过滤后保留 ${totalSessions} 条，分在 ${index.length} 天。`,
  `被过滤掉的 ${skipped} 条是：不在范围内、或没有用户诉求/报错/工具调用太少的空壳会话。`, '',
  '| 日期 | 保留会话 | 摘要大小 | 文件 |', '|---|---|---|---|',
  ...index.map(r => `| ${r.date} | ${r.sessions} | ${r.kb} KB | \`${r.date}.md\` |`),
  '',
  `合计摘要大小：${index.reduce((n, r) => n + Number(r.kb), 0).toFixed(1)} KB`,
].join('\n'), 'utf8')

console.log(`扫描 ${sessions.length} 条会话 → 保留 ${totalSessions} 条，分 ${index.length} 天`)
console.log(`输出目录：${OUT}`)
console.log(`摘要合计：${index.reduce((n, r) => n + Number(r.kb), 0).toFixed(1)} KB`)
if (VERBOSE) for (const r of index) console.log(`  ${r.date}  ${String(r.sessions).padStart(3)} 条  ${r.kb} KB`)
