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
  node scripts/new-log.mjs --publish 2026-09-10   # 发布草稿到 content/worklog/

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
 * 一次 git log 拿全部信息（hash / 时间 / 标题 / 父提交 / 逐文件增删），
 * 不为每个提交单独调一次 git。
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
    '--pretty=format:%x01%h%x1f%ad%x1f%s%x1f%p',
    '--numstat',
    '--root',
  ])

  const commits = []
  for (const chunk of raw.split('\x01').slice(1)) {
    const lines = chunk.split(/\r?\n/)
    const header = lines.find(line => line.includes('\x1f'))
    if (!header) continue
    const [hash, stamp, subjectRaw, parentsRaw] = header.split('\x1f')
    const stampDate = stamp.slice(0, 10)
    if (stampDate !== date) continue

    const files = []
    for (const line of lines) {
      if (!line || line.includes('\x1f')) continue
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const [added, deleted, ...rest] = parts
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
      parents: parentsRaw.trim().split(/\s+/).filter(Boolean),
      files,
    })
  }

  commits.reverse() // git log 是新的在前，草稿按时间正序更好读
  return commits
}

function summarize(commits) {
  const dirs = new Map()
  let files = 0
  let added = 0
  let deleted = 0
  let binary = 0
  for (const commit of commits) {
    for (const file of commit.files) {
      files += 1
      added += file.added
      deleted += file.deleted
      if (file.binary) binary += 1
      const dir = topDir(file.path)
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    }
  }
  const top = [...dirs.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  return { files, added, deleted, binary, top, merges: commits.filter(c => c.parents.length > 1).length }
}

// ── 草稿生成 ──────────────────────────────────────────────────────────────
const TYPE_WEIGHT = { feat: 4, fix: 3, perf: 3, refactor: 2, docs: 2, test: 1, build: 1, ci: 1, chore: 0, style: 0 }

function stripTypePrefix(subject) {
  const match = /^[a-zA-Z]+(\([^)]*\))?!?:\s*/.exec(subject)
  return match ? subject.slice(match[0].length).trim() : subject
}

function typeOf(subject) {
  const match = /^([a-zA-Z]+)(\([^)]*\))?!?:/.exec(subject)
  return match ? match[1].toLowerCase() : ''
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

/** YAML 标量：需要时用单引号包裹并转义 */
function yamlString(value) {
  const text = String(value)
  const needsQuote = text === ''
    || /[:#\-?*&!|>%@`{}[\],'"]/.test(text)
    || /^\s|\s$/.test(text)
    || /^(true|false|null|~|\d+)$/i.test(text)
  return needsQuote ? `'${text.replace(/'/g, "''")}'` : text
}

function commitLine(commit) {
  const stats = commit.parents.length > 1
    ? '（合并提交，git 不给单文件统计）'
    : commit.files.length
      ? `（+${commit.files.reduce((sum, f) => sum + f.added, 0)} / -${commit.files.reduce((sum, f) => sum + f.deleted, 0)}，${commit.files.length} 个文件）`
      : '（无文件改动）'
  return `- ${commit.time} \`${commit.hash}\` ${commit.subject}${stats}`
}

function buildDraft(date, commits, summary) {
  const titles = candidateTitles(commits)
  const title = titles[0] ?? '（待填）'
  const lines = []

  lines.push('---')
  lines.push(`title: ${yamlString(title)}`)
  lines.push(`date: '${date}'`)
  lines.push('summary: （一句话总结今天）')
  lines.push('tags: []')
  lines.push('# project: my-blog         # 可选：项目名，方便以后按项目聚合')
  lines.push('pitfalls: []')
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
    lines.push('<!-- 下面这组是从 git 提交自动生成的，按需增删；想看某个提交改了哪些文件：git show --stat <hash> -->', '')
    for (const commit of commits) lines.push(commitLine(commit))
    lines.push('')
    const dirText = summary.top.length
      ? summary.top.map(([dir, count]) => `\`${dir}\` ${count} 个文件`).join('、')
      : '（无）'
    lines.push(`主要改动目录：${dirText}`)
    const extra = summary.binary ? `，其中 ${summary.binary} 个二进制文件（不计行数）` : ''
    lines.push(`全天合计：${commits.length} 个提交，${summary.files} 个文件，+${summary.added} / -${summary.deleted}${extra}`)
    if (summary.merges) lines.push(`（含 ${summary.merges} 个合并提交，其文件统计为空是 git 的正常行为）`)
  }

  if (titles.length > 1) {
    lines.push('', `<!-- 备选标题：${titles.slice(1, 4).join(' / ')} -->`)
  }

  lines.push('', '## 踩的坑与解决', '')
  lines.push('<!-- 把 frontmatter 里的 pitfalls 在这里展开写（problem / solution / 耗时）；')
  lines.push('     结构化的那份留在 frontmatter 里，以后「坑库」要靠它聚合，散在正文里就永远是死数据。 -->')
  lines.push('', '## 今天学到', '')
  lines.push('<!-- 一句话一条，同步进 frontmatter 的 learned -->')
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

function doDraft(date) {
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
  const draft = buildDraft(date, commits, summary)

  if (dry) {
    console.log(draft)
    console.log(`（--dry-run：未写入 ${rel(target)}；采集到 ${commits.length} 个提交）`)
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
else doDraft(dateArg || today)
