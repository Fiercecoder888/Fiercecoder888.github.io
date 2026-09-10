#!/usr/bin/env node
/**
 * 笔记批量迁移工具：把散落的 Markdown / 纯文本笔记转成博客文章。
 *
 * 用法：
 *   node scripts/import-notes.mjs --src notes/示例 --dry-run
 *   node scripts/import-notes.mjs --src notes --out content/blog --category 笔记 --tag 旧文
 *   node scripts/import-notes.mjs --src notes --date-from filename
 *
 * 参数：
 *   --src <dir>              必填，笔记目录（递归扫描 .md/.markdown/.txt）
 *   --out <dir>              输出目录，默认 content/blog
 *   --category <name>        统一分类（不传则取笔记所在子目录名）
 *   --tag <a,b>              追加标签，逗号分隔
 *   --date-from <mode>       mtime（默认）| filename | frontmatter
 *   --dry-run                只打印将写入的内容，不落盘
 *   --overwrite              目标文件已存在时覆盖（默认自动加 -2、-3 后缀）
 *
 * 纯 Node 实现，无第三方依赖。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = name => argv.includes(name)

const SRC = arg('--src')
const OUT = arg('--out', 'content/blog')
const CATEGORY = arg('--category', '')
const TAGS = (arg('--tag', '') ?? '').split(',').map(t => t.trim()).filter(Boolean)
const DATE_FROM = arg('--date-from', 'mtime')
const DRY = has('--dry-run')
const OVERWRITE = has('--overwrite')

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', '.vscode', '.idea', 'dist', '.nuxt'])
const EXTS = new Set(['.md', '.markdown', '.txt'])
const TECH_WORDS = ['vue', 'nuxt', 'react', 'next', 'node', 'nest', 'git', 'css', 'html', 'js', 'ts', 'typescript', 'javascript', 'ai', 'mcp', 'seo', 'linux', 'windows', 'docker', 'sql', 'python', 'java', 'vite', 'webpack', 'tailwind']

if (!SRC) {
  console.error('用法：node scripts/import-notes.mjs --src <笔记目录> [--out content/blog] [--dry-run]')
  process.exit(1)
}
const srcRoot = resolve(SRC)
if (!existsSync(srcRoot) || !statSync(srcRoot).isDirectory()) {
  console.error(`✘ 目录不存在：${srcRoot}`)
  process.exit(1)
}

/** 递归收集文件 */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, acc)
    }
    else if (EXTS.has(extname(entry.name).toLowerCase())) {
      acc.push(full)
    }
  }
  return acc
}

/** 极简 YAML frontmatter 解析：支持 key: value 与 - item 列表 */
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, body: raw }

  const data = {}
  let currentKey = null
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(unquote(listItem[1]))
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (pair) {
      currentKey = pair[1]
      const value = pair[2].trim()
      data[currentKey] = value === '' ? [] : unquote(value)
    }
  }
  return { data, body: raw.slice(match[0].length) }
}

function unquote(value) {
  const v = String(value).trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  return v
}

/** YAML 值序列化：需要时用单引号包裹并转义 */
function yamlValue(value) {
  const v = String(value)
  const needsQuote = v === ''
    || /[:#\-?*&!|>%@`{}[\],'"]/.test(v)
    || /^\s|\s$/.test(v)
    || /^(true|false|null|~|\d+)$/i.test(v)
  if (!needsQuote) return v
  return `'${v.replace(/'/g, "''")}'`
}

function serializeFrontmatter(data) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (!value.length) continue
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${yamlValue(item)}`)
    }
    else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`)
    }
    else if (value !== undefined && value !== null && value !== '') {
      lines.push(`${key}: ${yamlValue(value)}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

/** 从正文里提取第一个标题 / 第一段摘要 */
function extractTitle(body, fallback) {
  const m = /^\s*#\s+(.+)$/m.exec(body)
  return m ? m[1].trim() : fallback
}

function extractDescription(body) {
  const lines = body.split(/\r?\n/)
  let inCode = false
  const buffer = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) { inCode = !inCode; continue }
    if (inCode) continue
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed.startsWith('![')) {
      if (buffer.length) break
      continue
    }
    buffer.push(trimmed)
    if (buffer.join(' ').length > 80) break
  }
  const text = buffer.join(' ').replace(/\s+/g, ' ').replace(/[*_`\[\]]/g, '')
  if (!text) return ''
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

function prettifyFilename(name) {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function sanitizeSlug(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    || 'untitled'
}

function parseDateFromFilename(name) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const compact = /(\d{4})(\d{2})(\d{2})/.exec(name)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

function detectTags(text, extra = []) {
  const lower = text.toLowerCase()
  const found = TECH_WORDS.filter(word => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(lower))
  const normalized = found.map(word => (word === 'js' ? 'JavaScript' : word === 'ts' ? 'TypeScript' : word.charAt(0).toUpperCase() + word.slice(1)))
  return [...new Set([...extra, ...normalized])]
}

function uniquePath(outDir, slug, used) {
  let candidate = join(outDir, `${slug}.md`)
  if (OVERWRITE || (!existsSync(candidate) && !used.has(candidate))) {
    used.add(candidate)
    return candidate
  }
  let n = 2
  while (true) {
    candidate = join(outDir, `${slug}-${n}.md`)
    if (!existsSync(candidate) && !used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    n += 1
  }
}

const files = walk(srcRoot)
if (!files.length) {
  console.error(`✘ 目录里没有 .md/.markdown/.txt 文件：${srcRoot}`)
  process.exit(1)
}

const outRoot = resolve(OUT)
if (!DRY) mkdirSync(outRoot, { recursive: true })

const used = new Set()
const ok = []
const skipped = []
const failed = []

for (const file of files) {
  try {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    const { data: fm, body } = parseFrontmatter(raw)
    const name = basename(file)
    const rel = relative(srcRoot, file)
    const parentDir = dirname(rel)
    const fallbackTitle = prettifyFilename(name)

    const title = fm.title || extractTitle(body, fallbackTitle)
    const description = fm.description || extractDescription(body)

    let date = fm.date ? String(fm.date).slice(0, 10) : ''
    if (!date && DATE_FROM === 'filename') date = parseDateFromFilename(name) ?? ''
    if (!date && DATE_FROM === 'frontmatter' && !fm.date) {
      skipped.push({ file: rel, reason: '缺少 frontmatter 日期且 --date-from=frontmatter' })
      continue
    }
    if (!date) date = statSync(file).mtime.toISOString().slice(0, 10)

    const category = fm.category || CATEGORY || (parentDir && parentDir !== '.' ? parentDir : '随笔')

    const fmTags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? String(fm.tags).split(',').map(t => t.trim()) : [])
    const tags = [...new Set([
      ...fmTags.filter(Boolean),
      ...TAGS,
      ...(parentDir && parentDir !== '.' ? [parentDir] : []),
      ...detectTags(`${title}\n${body.slice(0, 500)}`),
    ])]

    const slug = sanitizeSlug(fm.slug || name)
    const target = uniquePath(outRoot, slug, used)

    // 显式写 path：Nuxt Content 默认会对文件名做 slugify，中文会被整段剥掉
    // （`学习笔记-网络基础` 甚至会塌成 `/blog`），必须显式指定才能保住 URL。
    const routePath = fm.path || `/blog/${slug}`

    const frontmatter = serializeFrontmatter({
      title,
      description: description || `${title} 的笔记整理。`,
      path: routePath,
      date,
      category,
      tags,
      draft: fm.draft === true || fm.draft === 'true',
    })
    const output = `${frontmatter}${body.replace(/^\s+/, '')}`

    if (DRY) {
      ok.push({ file: rel, target: relative(process.cwd(), target), dry: true })
      console.log(`\n──── [dry-run] ${rel} → ${relative(process.cwd(), target)}`)
      console.log(frontmatter.trimEnd())
      continue
    }

    writeFileSync(target, output, 'utf8')
    ok.push({ file: rel, target: relative(process.cwd(), target) })
  }
  catch (error) {
    failed.push({ file: relative(srcRoot, file), reason: error.message })
  }
}

console.log(`\n${DRY ? '（dry-run，未写入任何文件）' : ''}`)
console.log(`成功 ${ok.length} / 跳过 ${skipped.length} / 失败 ${failed.length}`)
for (const item of ok) console.log(`  ✔ ${item.file} → ${item.target}`)
for (const item of skipped) console.log(`  … 跳过 ${item.file}：${item.reason}`)
for (const item of failed) console.log(`  ✘ 失败 ${item.file}：${item.reason}`)

process.exit(failed.length ? 1 : 0)
