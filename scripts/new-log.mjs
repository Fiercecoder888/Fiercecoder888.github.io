#!/usr/bin/env node
/**
 * 工作日志脚手架：把「当天干了什么」从 git 里自动挖出来，生成一份待批注的日志草稿。
 *
 * 用法：
 *   node scripts/new-log.mjs                        # 生成今天的日志草稿（按本机时区）
 *   node scripts/new-log.mjs --date 2026-09-09      # 补写某一天
 *   node scripts/new-log.mjs --force                # 草稿已存在时覆盖
 *   node scripts/new-log.mjs --dry-run              # 只打印草稿，不落盘
 *   node scripts/new-log.mjs --publish 2026-09-10   # 发布：drafts/ → content/worklog/，并改 draft: false
 *
 * 草稿写在与 content/ 平级的 drafts/（已被 .gitignore 忽略，不进构建、不进仓库）。
 * 不要在 content/ 里用 draft: true 当草稿箱：站点会公开 sql_dump.txt（内容库的原始 SQLite
 * 导出，构建期不按 draft 过滤），草稿正文会连带泄露到公网。细节见 docs/工作日志.md。
 *
 * 纯 Node 实现，无第三方依赖。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
/** 取 --xxx value 或 --xxx=value；返回 null 表示没给这个参数，'' 表示给了但不带值 */
function readArg(name) {
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
const has = name => argv.includes(name)

const DRAFTS_DIR = 'drafts'
const WORKLOG_DIR = join('content', 'worklog')
const USAGE = `工作日志脚手架

  node scripts/new-log.mjs                        # 生成今天的日志草稿
  node scripts/new-log.mjs --date 2026-09-09      # 补写某一天
  node scripts/new-log.mjs --force                # 草稿已存在时覆盖
  node scripts/new-log.mjs --dry-run              # 只打印草稿，不落盘
  node scripts/new-log.mjs --no-sessions          # 跳过 Agent 会话采集（只按 git 归属）
  node scripts/new-log.mjs --publish 2026-09-10   # 发布草稿到 content/worklog/

归属：提交里的 \`Agent: dsh\` trailer 优先；没有 trailer 时用 scripts/agent-sessions.mjs
     从本机 Codex / Claude Code / DSH 的会话记录推断（只取元数据与截断摘要，正文永不进日志）。

流程：new-log.mjs → 编辑 ${DRAFTS_DIR}/<日期>.md → --publish → git add/commit/push`

if (has('--help') || has('-h')) {
  console.log(USAGE)
  process.exit(0)
}

// ── 日期工具：一律按本机时区算，绝不用 UTC（晚上写的日志否则会跑到第二天） ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

function shiftDate(value, days) {
  const [y, m, d] = value.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

function rel(path) {
  return relative(process.cwd(), path).split(sep).join('/')
}

function fail(message, hint = '') {
  console.error(`✘ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

// ── git 采集 ──────────────────────────────────────────────────────────────
function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', '--no-pager', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

let repoRoot
try {
  repoRoot = git(['rev-parse', '--show-toplevel']).trim()
}
catch {
  fail('当前目录不是 git 仓库。', '请在仓库根目录运行本脚本。')
}
if (resolve(repoRoot).toLowerCase() !== resolve(process.cwd()).toLowerCase()) {
  fail(`请在仓库根目录运行本脚本（当前：${process.cwd()}，仓库根：${repoRoot}）。`)
}

/** numstat 里的重命名写法：`old => new` 或 `dir/{a => b}/x`，都归一到最终路径 */
function normalizePath(path) {
  let p = path.trim()
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  const brace = /\{(.*?) => (.*?)\}/.exec(p)
  if (brace) return p.slice(0, brace.index) + brace[2] + p.slice(brace.index + brace[0].length)
  const arrow = p.lastIndexOf(' => ')
  if (arrow >= 0) return p.slice(arrow + 4)
  return p
}

/** 顶层目录：`app/pages/x.vue` → `app/`；根目录下的散文件 → `(根目录)` */
function topDir(path) {
  const slash = path.indexOf('/')
  return slash > 0 ? `${path.slice(0, slash)}/` : '(根目录)'
}

/**
 * 采集某一天的提交。
 * 一次 git log 拿全部信息（hash / 时间 / 标题 / **正文** / 父提交 / 逐文件增删），
 * 不为每个提交单独调一次 git。
 * 正文（`%b`）只用来读 `Agent:` trailer —— 提交正文本身**不进草稿**。
 */
function collectDay(date) {
  // 查询窗口左右各放宽一天，再在 JS 里按「本机时区的日期」精确过滤：
  // 这样即使提交的 author date 与 committer date 分属两天，也只按作者日期归类。
  const since = `${shiftDate(date, -1)} 00:00:00`
  const until = `${shiftDate(date, 1)} 23:59:59`
  const raw = git([
    'log',
    `--since=${since}`,
    `--until=${until}`,
    '--date=format-local:%Y-%m-%dT%H:%M',
    '--pretty=format:%x01%h%x1f%ad%x1f%s%x1f%p%x1f%b%x02',
    '--numstat',
    '--root',
  ])

  const commits = []
  for (const chunk of raw.split('\x01').slice(1)) {
    // \x02 之后是 numstat：正文里可能有空行，靠这个标记切干净
    const [headerRaw, statRaw = ''] = chunk.split('\x02')
    const parts = headerRaw.split('\x1f')
    if (parts.length < 4) continue
    const [hash, stamp, subjectRaw, parentsRaw, bodyRaw = ''] = parts
    const stampDate = stamp.slice(0, 10)
    if (stampDate !== date) continue

    const files = []
    for (const line of statRaw.split(/\r?\n/)) {
      if (!line) continue
      const cols = line.split('\t')
      if (cols.length < 3) continue
      const [added, deleted, ...rest] = cols
      const binary = added === '-' || deleted === '-'
      files.push({
        path: normalizePath(rest.join('\t')),
        added: binary ? 0 : Number(added) || 0,
        deleted: binary ? 0 : Number(deleted) || 0,
        binary,
      })
    }

    commits.push({
      hash: hash.trim(),
      time: stamp.slice(11, 16),
      subject: subjectRaw.replace(/^\uFEFF/, '').trim(),
      body: bodyRaw.replace(/^\uFEFF/, '').trim(),
      parents: parentsRaw.trim().split(/\s+/).filter(Boolean),
      files,
    })
  }

  commits.reverse() // git log 是新的在前，草稿按时间正序更好读
  return commits
}

function summarize(commits) {
  const dirs = new Map()
  // 「同一文件反复改只算一次」：全天按**唯一路径**去重，重复改的文件只计一次
  const uniquePaths = new Set()
  let hunks = 0
  let added = 0
  let deleted = 0
  let binary = 0
  for (const commit of commits) {
    const seenInCommit = new Set()
    for (const file of commit.files) {
      hunks += 1
      added += file.added
      deleted += file.deleted
      if (file.binary) binary += 1
      uniquePaths.add(file.path)
      if (seenInCommit.has(file.path)) continue
      seenInCommit.add(file.path)
      const dir = topDir(file.path)
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    }
  }
  const top = [...dirs.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  return {
    files: uniquePaths.size,
    hunks,
    added,
    deleted,
    binary,
    top,
    merges: commits.filter(c => c.parents.length > 1).length,
  }
}

// ── 去噪：权重 / 合并 / 折叠 ───────────────────────────────────────────────
/**
 * 提交类型权重。只有 feat/fix/perf/refactor 算「有内容」；
 * chore/style/docs/ci/test/build 一律降级 —— 它们仍然参与统计，但不单独成行。
 */
const TYPE_WEIGHT = { feat: 4, fix: 3, perf: 3, refactor: 2, docs: 1, test: 1, build: 0, ci: 0, chore: 0, style: 0 }
/** 有内容的最低权重（>= 这个值才可能单独成行） */
const CONTENT_WEIGHT = 2
/** 「今天做了什么」最多几行 */
const MAX_CONTENT_LINES = 5
/** 折叠摘要里会点名统计的类型（顺序就是打印顺序） */
const FOLD_NAMES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style']

/** fixup!/squash!/wip/typo/合并/回滚这类提交：不单独成行，并进最近的可见提交 */
const MERGE_INTO_PREVIOUS = [
  /^(fixup|squash|amend)!\s*/i,
  /^wip\b/i,
  /^typo\b/i,
  /^(merge|revert|lint|format|style)\b/i,
  /^Merge (branch|pull request|remote-tracking)/,
]

function stripTypePrefix(subject) {
  const match = /^[a-zA-Z]+(\([^)]*\))?!?:\s*/.exec(subject)
  return match ? subject.slice(match[0].length).trim() : subject
}

function typeOf(subject) {
  const match = /^([a-zA-Z]+)(\([^)]*\))?!?:/.exec(subject)
  return match ? match[1].toLowerCase() : ''
}

function isNoiseCommit(commit) {
  if (commit.parents.length > 1) return true
  return MERGE_INTO_PREVIOUS.some(re => re.test(commit.subject.trim()))
}

function weightOf(commit) {
  if (isNoiseCommit(commit)) return 0
  return TYPE_WEIGHT[typeOf(commit.subject)] ?? 1
}

function hasContent(commit) {
  return weightOf(commit) >= CONTENT_WEIGHT
}

/** 从当天提交里挑一个最像「今天标题」的：优先 feat/fix，同档取最长的 */
function candidateTitles(commits) {
  return [...commits]
    .map(commit => ({
      text: stripTypePrefix(commit.subject) || commit.subject,
      score: (TYPE_WEIGHT[typeOf(commit.subject)] ?? 0) * 1000 + commit.subject.length,
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.text)
    .filter((text, index, all) => text && all.indexOf(text) === index)
}

/**
 * 选「今天做了什么」要展开的行。
 * 规则（用户最在意的「不要垃圾信息」）：
 *   1. 噪声提交（merge / fixup! / wip / typo / revert）直接并进前一条，不单独成行；
 *   2. 只有 feat/fix/perf/refactor 算有内容，其它只参与统计；
 *   3. 硬预算：最多 MAX_CONTENT_LINES 行，按权重（同权重按改动量）截断；
 *   4. 被截掉的和被折叠的，统一在末尾用**一行**摘要说明「另有 N 个低权重提交：chore ×3」。
 */
function pickContentLines(commits) {
  const shown = []
  const folded = new Map() // type → count
  const mergedInto = new Map() // hash → [被并进来的提交标题]
  let foldedNoise = 0

  // 先按权重分出「能单独成行」和「折叠」两类，并记录顺序，
  // 之后再决定哪些噪声能并进「上一条**被保留下来的**提交」。
  const noise = []
  for (const commit of commits) {
    if (isNoiseCommit(commit)) {
      foldedNoise += 1
      noise.push(commit)
      continue
    }
    if (!hasContent(commit)) {
      const type = typeOf(commit.subject) || 'other'
      folded.set(type, (folded.get(type) ?? 0) + 1)
      continue
    }
    shown.push({ commit, weight: weightOf(commit) })
  }

  const ranked = [...shown].sort((a, b) => b.weight - a.weight
    || b.commit.files.length - a.commit.files.length
    || a.commit.time.localeCompare(b.commit.time))
  const keep = new Set(ranked.slice(0, MAX_CONTENT_LINES).map(item => item.commit.hash))
  const lines = []
  for (const item of shown) {
    if (keep.has(item.commit.hash)) lines.push({ commit: item.commit, merged: mergedInto.get(item.commit.hash) ?? [] })
    else {
      const type = typeOf(item.commit.subject) || 'other'
      folded.set(type, (folded.get(type) ?? 0) + 1)
    }
  }

  // 噪声提交并进「时间上最近的、且真的会被打印出来的」那条；
  // 前面没有可见提交时（例如当天第一条就是 fixup!）只能并进折叠摘要，不能凭空挂到一个不存在的行上。
  for (const commit of noise) {
    const target = lines.filter(line => line.commit.time <= commit.time).pop()
    if (!target) continue
    const list = mergedInto.get(target.commit.hash) ?? []
    list.push(commit.subject)
    mergedInto.set(target.commit.hash, list)
  }
  for (const line of lines) line.merged = mergedInto.get(line.commit.hash) ?? []
  lines.sort((a, b) => a.commit.time.localeCompare(b.commit.time))

  // 折叠摘要：一行说清「被折叠了什么」，但不展开
  const parts = FOLD_NAMES
    .filter(type => folded.has(type))
    .map(type => `${type} ×${folded.get(type)}`)
  const other = [...folded.keys()].filter(type => !FOLD_NAMES.includes(type))
  for (const type of other.sort()) parts.push(`${type} ×${folded.get(type)}`)
  const total = [...folded.values()].reduce((sum, n) => sum + n, 0)
  const noiseText = foldedNoise ? `；${foldedNoise} 个合并/修补提交已并入上一条` : ''
  const foldText = total
    ? `（另有 ${total} 个低权重提交：${parts.join('、')}${noiseText}，已折叠 —— 要看细节跑 git log）`
    : (foldedNoise ? `（${foldedNoise} 个合并/修补提交已并入上一条，未展开）` : '')

  return { lines, folded, foldedNoise, foldText, total }
}

/** YAML 标量：需要时用单引号包裹并转义 */
function yamlString(value) {
  const text = String(value)
  const needsQuote = text === ''
    || /[:#\-?*&!|>%@`{}[\],'"]/.test(text)
    || /^\s|\s$/.test(text)
    || /^(true|false|null|~|\d+)$/i.test(text)
  return needsQuote ? `'${text.replace(/'/g, "''")}'` : text
}

// ── 归属：提交 trailer + 会话记录 ─────────────────────────────────────────
/**
 * 已知 Agent 的别名 → 规范名（写进 frontmatter 的 agents 用短名）。
 * 未知名字不做归一化，直接小写原样保留 —— 以后多接一个 Agent 不用改代码。
 */
const AGENT_ALIASES = {
  'dsh': 'dsh',
  'deepseek-harness': 'dsh',
  'codex': 'codex',
  'codex-cli': 'codex',
  'openai-codex': 'codex',
  'claude': 'claude',
  'claude-code': 'claude',
  'claudecode': 'claude',
  'cursor': 'cursor',
  'copilot': 'copilot',
  'gemini': 'gemini',
  'human': '你',
  'me': '你',
  '我': '你',
  '你': '你',
}

const AGENT_TRAILER_RE = /^[ \t]*(?:Agent|智能体|agent)[ \t]*[:：][ \t]*([^\r\n]+)$/gim

function canonicalAgent(raw) {
  const name = String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim()
  if (!name) return ''
  return AGENT_ALIASES[name.toLowerCase()] ?? name.toLowerCase()
}

/** 从提交信息里读 `Agent: dsh` 这类 trailer（大小写不敏感、允许缩进），返回规范名数组 */
function agentsFromTrailers(commits) {
  const found = []
  for (const commit of commits) {
    if (!commit.body) continue
    for (const match of commit.body.matchAll(AGENT_TRAILER_RE)) {
      for (const piece of String(match[1]).split(/[,、/|]/)) {
        const name = canonicalAgent(piece)
        if (name && !found.includes(name)) found.push(name)
      }
    }
  }
  return found
}

/**
 * 采集三个 Agent 的会话信号。
 * 适配器是独立模块，出错/缺失一律降级为「今天没有会话线索」，**绝不让草稿生成失败**。
 * 隐私：适配器只返回元数据与截断摘要（见 scripts/agent-sessions.mjs 顶部说明）。
 */
async function collectSessions(date, enabled) {
  if (!enabled) return { ok: false, skipped: true, sessions: [], notes: [], agents: [] }
  try {
    const { collectAgentSessions } = await import('./agent-sessions.mjs')
    const result = await collectAgentSessions(date, {
      repoDir: process.cwd(),
      // 别把「正在写这篇日志的会话」算成今天参与工作的 Agent
      excludeSessionIds: [process.env.DSH_SESSION_ID].filter(Boolean),
    })
    return {
      ok: true,
      skipped: false,
      sessions: result.sessions,
      notes: result.notes,
      dropped: result.dropped,
      agents: [...new Set(result.sessions.map(s => s.agent))],
    }
  }
  catch (error) {
    return {
      ok: false,
      skipped: false,
      sessions: [],
      notes: [`会话适配器没跑起来（${error?.message ?? error}），本次只按 git 归属`],
      agents: [],
    }
  }
}

/**
 * 合并归属：**提交 trailer 优先**（那是人明确写下的），
 * trailer 一点都没有时，才用会话记录推断。
 */
function mergeAgents(trailerAgents, sessionAgents) {
  if (trailerAgents.length) {
    return { agents: trailerAgents, source: 'trailer' }
  }
  if (sessionAgents.length) {
    return { agents: sessionAgents, source: 'sessions' }
  }
  return { agents: [], source: 'none' }
}

function agentListYaml(agents) {
  return `[${agents.map(a => yamlString(a)).join(', ')}]`
}

/**
 * 「今天的会话线索」小节。
 * 明确标注这是**候选**：会话摘要由脚本截断生成，发布前请删掉或改写。
 */
function buildSessionSection(sessions, notes) {
  const lines = []
  lines.push('', '## 今天的会话线索（自动采集，可删）', '')
  lines.push('<!-- 以下内容由 scripts/agent-sessions.mjs 从本机会话记录里采集：**只有元数据与截断摘要**，')
  lines.push('     正文从未被写入。这是**候选**，不是事实陈述 —— 发布前请删掉整节，或改写后再留。 -->')
  if (!sessions.length) {
    lines.push('')
    lines.push('（今天没有从 Codex / Claude Code / DSH 里采集到属于本仓库的会话）')
    for (const note of notes) lines.push(`<!-- ${note} -->`)
    return lines
  }
  lines.push('')
  for (const session of sessions) {
    lines.push(`- **${session.agent}** ${session.startTime}–${session.endTime}（约 ${session.durationMinutes} 分钟，工具调用 ${session.toolCalls} 次${session.childSessions ? `，含 ${session.childSessions} 个子代理会话` : ''}${session.codeChanges ? '，有代码改动' : ''}${session.retries ? `，失败/重试 ${session.retries} 次` : ''}）`)
    if (session.request) lines.push(`  - 需求（截断）：${session.request}`)
    if (session.conclusion) lines.push(`  - 结论（截断）：${session.conclusion}`)
  }
  lines.push('')
  lines.push(`<!-- 采集说明：${notes.join('；')} -->`)
  return lines
}

function commitLine(commit) {
  const stats = commit.parents.length > 1
    ? '（合并提交，git 不给单文件统计）'
    : commit.files.length
      ? `（+${commit.files.reduce((sum, f) => sum + f.added, 0)} / -${commit.files.reduce((sum, f) => sum + f.deleted, 0)}，${commit.files.length} 个文件）`
      : '（无文件改动）'
  return `- ${commit.time} \`${commit.hash}\` ${commit.subject}${stats}`
}

function buildDraft(date, commits, summary, ownership, sessions) {
  const titles = candidateTitles(commits)
  const title = titles[0] ?? '（待填）'
  const { agents } = ownership
  const pick = pickContentLines(commits)
  const lines = []

  lines.push('---')
  lines.push(`title: ${yamlString(title)}`)
  lines.push(`date: '${date}'`)
  lines.push('summary: （一句话总结今天）')
  lines.push('tags: []')
  // 归属契约：agents 是「今天有哪些 Agent 参与」，每条坑再用 pitfalls[].agent 记「这条坑是谁踩的」
  lines.push(`agents: ${agentListYaml(agents)}${agents.length ? '' : '   # 今天有哪些 Agent 参与：dsh / codex / claude / 你'}`)
  lines.push('# project: my-blog         # 可选：项目名，方便以后按项目聚合')
  lines.push('pitfalls: []')
  lines.push('# pitfalls:                # 填坑时改成这个形状（agent 表示这条坑是谁踩的）')
  lines.push('#   - problem: （现象）')
  lines.push('#     solution: （怎么解决的）')
  lines.push('#     time: 约 30 分钟       # 可选')
  lines.push("#     agent: 'dsh'          # 可选：dsh / codex / claude / 你")
  lines.push('learned: []')
  lines.push('# mood: 4                  # 可选：心情 1-5')
  lines.push('draft: true')
  lines.push('---', '')
  lines.push(`<!-- 由 node scripts/new-log.mjs 生成：git 原料已填好，只差「踩坑 / 学到」。`)
  lines.push(`     补完后发布：node scripts/new-log.mjs --publish ${date} -->`, '')
  lines.push('## 今天做了什么', '')

  if (!commits.length) {
    lines.push('<!-- 当天没有采集到 git 提交（可能确实没写代码，也可能提交时间不在这一天）。 -->')
    lines.push('', `（${date} 没有 git 提交）`)
  }
  else {
    lines.push('<!-- 下面这几行是从 git 提交里**按权重挑出来**的：只有 feat/fix/perf/refactor 单独成行，')
    lines.push(`     最多 ${MAX_CONTENT_LINES} 行；chore/docs/test 这类低权重提交已折叠成下面那行摘要（原文没删，跑 git log 还能看到）。`)
    lines.push('     想看某个提交改了哪些文件：git show --stat <hash> -->', '')
    for (const line of pick.lines) {
      lines.push(commitLine(line.commit))
      for (const merged of line.merged) lines.push(`  - （并入）${merged}`)
    }
    if (pick.foldText) lines.push(`- ${pick.foldText}`)
    lines.push('')
    const dirText = summary.top.length
      ? summary.top.map(([dir, count]) => `\`${dir}\` ${count} 个文件`).join('、')
      : '（无）'
    lines.push(`主要改动目录：${dirText}`)
    const extra = summary.binary ? `，其中 ${summary.binary} 个二进制文件（不计行数）` : ''
    const hunks = summary.hunks !== summary.files ? `（同一文件反复改只算一次；实际改动记录 ${summary.hunks} 条）` : ''
    lines.push(`全天合计：${commits.length} 个提交，${summary.files} 个文件${hunks}，+${summary.added} / -${summary.deleted}${extra}`)
    if (summary.merges) lines.push(`（含 ${summary.merges} 个合并提交，其文件统计为空是 git 的正常行为）`)
  }

  if (titles.length > 1) {
    lines.push('', `<!-- 备选标题：${titles.slice(1, 4).join(' / ')} -->`)
  }

  lines.push('', '## 踩的坑与解决', '')
  lines.push('<!-- 把 frontmatter 里的 pitfalls 在这里展开写（problem / solution / 耗时 / agent）；')
  lines.push('     结构化的那份留在 frontmatter 里，以后「坑库」要靠它聚合，散在正文里就永远是死数据。 -->')
  const participant = agents.length ? agents.join('、') : '（未采集到）'
  lines.push(`<!-- 每条坑请补上 agent（dsh / codex / claude / 你）；会话记录显示今天参与：${participant} -->`)
  lines.push('', '## 今天学到', '')
  lines.push('<!-- 一句话一条，同步进 frontmatter 的 learned -->')

  for (const line of buildSessionSection(sessions.sessions, sessions.notes)) lines.push(line)
  lines.push('')

  return lines.join('\n')
}

function reportNextSteps(date) {
  console.log('下一步：')
  console.log(`  1. 打开 ${DRAFTS_DIR}/${date}.md，补完 summary / 坑与解决 / 学到`)
  console.log(`  2. node scripts/new-log.mjs --publish ${date}   # 移到 content/worklog/ 并自动改 draft: false`)
  console.log(`  3. git add ${WORKLOG_DIR.split(sep).join('/')}/${date}.md && git commit -m "worklog: ${date}" && git push`)
}

/**
 * 把 drafts/ 的改动同步到**草稿私有仓库**。
 *
 * `drafts/` 本身是一个独立 git 仓库，remote 指向私有的 `my-blog-drafts` —— 它不在公开的
 * 站点仓库里（站点仓库会公开导出内容库 dump、不过滤草稿，所以草稿不能放那儿）。
 *
 * 为什么要在脚手架里顺手做这件事：`drafts/` 被主仓库 gitignore 之后，
 * 这道防线对人是**隐形**的 —— `git status` 看不到草稿、`git add .` 也永远不含它，
 * 很容易误以为「在仓库里所以有备份」。而工作日志是天天写、随手写的东西，没有备份迟早出事。
 *
 * 全程 best-effort：没初始化 / 没 remote / 推送失败（没网、没凭据）都只警告不中断 ——
 * 草稿已经写在磁盘上了，不该因为备份失败而让「记录」这件事本身失败。
 */
function syncDrafts(action) {
  const dir = resolve(DRAFTS_DIR)
  if (!existsSync(join(dir, '.git'))) {
    console.log(`  ⚠ ${DRAFTS_DIR}/ 还不是独立仓库，跳过备份`)
    console.log(`     （想启用：在 ${DRAFTS_DIR}/ 里 git init，再加一个私有 remote）`)
    return
  }
  const run = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const firstLine = error => String(error?.stderr || error?.message || error).trim().split('\n')[0]
  try {
    run(['add', '-A'])
    if (!run(['status', '--porcelain']).trim()) {
      console.log(`  · 草稿仓库无变化，无需提交`)
      return
    }
    run(['-c', 'core.autocrlf=false', 'commit', '-q', '-m', `draft: ${action}`])
    try {
      run(['push'])
      console.log(`  ✔ 已备份到私有草稿仓库（my-blog-drafts）`)
    }
    catch (error) {
      console.log(`  ⚠ 已提交到本地草稿仓库，但推送失败：${firstLine(error)}`)
      console.log(`     稍后补推：git -C ${DRAFTS_DIR} push`)
    }
  }
  catch (error) {
    console.log(`  ⚠ 草稿仓库同步失败（草稿本身已写入，不影响使用）：${firstLine(error)}`)
  }
}

async function doDraft(date) {
  const target = resolve(DRAFTS_DIR, `${date}.md`)
  const force = has('--force')
  const dry = has('--dry-run')

  if (existsSync(target) && !force && !dry) {
    console.log(`… 草稿已存在，未覆盖：${rel(target)}`)
    console.log(`  要重新生成（会丢掉已写的内容）加 --force；要直接发布：node scripts/new-log.mjs --publish ${date}`)
    process.exit(0)
  }

  let commits
  try {
    commits = collectDay(date)
  }
  catch (error) {
    fail(`读取 git 日志失败：${error.message}`)
  }
  const summary = summarize(commits)

  // 归属：提交 trailer 优先，没有才用会话记录推断
  const trailerAgents = agentsFromTrailers(commits)
  const sessions = await collectSessions(date, !has('--no-sessions'))
  const ownership = mergeAgents(trailerAgents, sessions.agents)
  const draft = buildDraft(date, commits, summary, ownership, sessions)

  if (dry) {
    console.log(draft)
    console.log(`（--dry-run：未写入 ${rel(target)}；采集到 ${commits.length} 个提交，${sessions.sessions.length} 条会话信号）`)
    process.exit(0)
  }

  mkdirSync(resolve(DRAFTS_DIR), { recursive: true })
  writeFileSync(target, draft, 'utf8')

  console.log(`✔ 草稿已生成：${rel(target)}`)
  console.log(`  · 采集到 ${commits.length} 个提交${commits.length ? `（${commits[0].time}–${commits[commits.length - 1].time}）` : ''}`)
  if (commits.length) {
    console.log(`  · 涉及 ${summary.files} 个文件，+${summary.added} / -${summary.deleted}`)
    console.log(`  · 主要改动目录：${summary.top.map(([dir, count]) => `${dir} ${count}`).join('、')}`)
  }
  else {
    console.log('  · 当天没有提交：仍生成了一份空骨架，手动补写即可')
  }
  console.log(`  · 会话线索 ${sessions.sessions.length} 条（${sessions.agents.length ? sessions.agents.join('、') : '无'}）`)
  console.log(`  · agents 归属来源：${ownership.source === 'trailer' ? '提交里的 Agent: trailer' : ownership.source === 'sessions' ? '会话记录推断' : '没有采集到'}${ownership.agents.length ? ` → ${ownership.agents.join('、')}` : ''}`)
  if (sessions.skipped) console.log('  · 已用 --no-sessions 跳过会话采集')
  syncDrafts(`new ${date}`)
  console.log('')
  reportNextSteps(date)
}

// ── 发布：drafts/<date>.md → content/worklog/<date>.md，并把 draft 改成 false ──
function splitFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { frontmatter: null, body: raw }
  return { frontmatter: match[1], body: raw.slice(match[0].length) }
}

function readField(frontmatter, key) {
  const match = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm').exec(frontmatter)
  if (!match) return ''
  return match[1].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1').trim()
}

function setDraftFalse(frontmatter) {
  const lines = frontmatter.split(/\r?\n/)
  let found = false
  const next = lines.map((line) => {
    if (/^\s*draft\s*:/.test(line)) {
      found = true
      return 'draft: false'
    }
    return line
  })
  if (!found) next.push('draft: false')
  return next.join('\n')
}

function doPublish(date) {
  const force = has('--force')
  const dry = has('--dry-run')
  const source = resolve(DRAFTS_DIR, `${date}.md`)
  const target = resolve(WORKLOG_DIR, `${date}.md`)

  if (!existsSync(source)) {
    fail(`草稿不存在：${rel(source)}`, `先生成：node scripts/new-log.mjs --date ${date}`)
  }
  if (existsSync(target) && !force) {
    fail(
      `目标已存在，拒绝覆盖：${rel(target)}`,
      '已发布过？改完想重发就加 --force；不想覆盖就别动它。',
    )
  }

  const raw = readFileSync(source, 'utf8').replace(/^\uFEFF/, '')
  const { frontmatter, body } = splitFrontmatter(raw)
  if (frontmatter === null) {
    fail(`${rel(source)} 里没有 frontmatter，无法发布。`, '工作日志必须带 --- 包裹的 frontmatter（见 docs/工作日志.md）。')
  }

  const title = readField(frontmatter, 'title')
  const summary = readField(frontmatter, 'summary')
  const warnings = []
  if (!title || title === '（待填）') warnings.push('title 还是空的/占位（（待填））')
  if (!summary || summary === '（一句话总结今天）') warnings.push('summary 还是占位（一句话总结今天）')
  if (/^pitfalls\s*:\s*\[\s*\]\s*$/m.test(frontmatter)) warnings.push('pitfalls 还是空的')
  if (/^learned\s*:\s*\[\s*\]\s*$/m.test(frontmatter)) warnings.push('learned 还是空的')

  if (warnings.length && !force) {
    for (const warning of warnings) console.warn(`⚠ ${warning}`)
    if (!title) fail('title 为空的话构建会被 schema 拒绝，先补上再发布（或用 --force 硬发）。')
    console.warn('  （只是提醒，继续发布；不想看到这些提醒就用 --force）')
  }

  // 统一成 LF：草稿可能被编辑器存成 CRLF，混在一起提交不好看
  const output = `---\n${setDraftFalse(frontmatter)}\n---\n\n${body.replace(/^\r?\n+/, '')}`.replace(/\r\n/g, '\n')

  if (dry) {
    console.log(`（--dry-run：未写入 ${rel(target)}，草稿保留在 ${rel(source)}）`)
    console.log(output.split(/\r?\n/).slice(0, 14).join('\n'))
    process.exit(0)
  }

  mkdirSync(resolve(WORKLOG_DIR), { recursive: true })
  writeFileSync(target, output, 'utf8')
  rmSync(source)

  console.log(`✔ 已发布：${rel(target)}（draft: false）`)
  console.log(`  · ${rel(source)} 已移走（不再留在 ${DRAFTS_DIR}/）`)
  // 把「这份草稿已发布」这件事也记进草稿仓库的历史里
  syncDrafts(`publish ${date}`)
  console.log('')
  console.log('下一步：')
  console.log('  1. pnpm check:drafts                      # 可选：确认 content/ 里没有 draft: true')
  console.log(`  2. git add ${WORKLOG_DIR.split(sep).join('/')}/${date}.md`)
  console.log(`  3. git commit -m "worklog: ${date}" && git push   # push 后 CI 自动部署`)
}

// ── 入口 ──────────────────────────────────────────────────────────────────
const publishArg = readArg('--publish')
const dateArg = readArg('--date')
const today = localDate()

for (const [label, value] of [['--date', dateArg], ['--publish', publishArg]]) {
  if (value && !isValidDate(value)) {
    fail(`${label} 的日期格式不对：${value}`, '要 YYYY-MM-DD，例如 2026-09-10。')
  }
}

if (publishArg !== null) doPublish(publishArg || dateArg || today)
else await doDraft(dateArg || today)
