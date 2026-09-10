#!/usr/bin/env node
/**
 * 审计 @nuxt/content 生成的公开数据库导出 `__nuxt_content/blog/sql_dump.txt`。
 *
 * 为什么需要它：这个文件是**原始 SQLite 导出**，含每篇文章的**完整正文**且无任何过滤，
 * 部署到静态托管后会被匿名访问（GitHub Pages 上是 200）。而 `@nuxt/content` v3 里
 * `draft` 只是普通 frontmatter 字段，构建期**没有**任何按它过滤行的逻辑
 * （`dist` 全量 grep 只命中 `draft-07` JSON schema 与 `xxx.draft.md` 文件名约定），
 * 应用里的 `.where('draft','=',false)` 只挡住页面路由查询，挡不住这个文件。
 *
 * 所以：源码里任何 `draft: true` 的文章，它的标题与正文都可能出现在这个公开文件里。
 * 本工具用「拿源码里的草稿去 dump 里搜」的方式来查证，不依赖解析 SQL 语法。
 *
 * 用法：
 *   node tools/dump-audit.mjs                                   # 查本地产物
 *   node tools/dump-audit.mjs https://site/__nuxt_content/blog/sql_dump.txt
 *   node --use-system-ca tools/dump-audit.mjs https://...       # 查线上（本机经 Steam++ 自签证书时需要）
 */
import { gunzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DEFAULT_LOCAL = '.output/public/__nuxt_content/blog/sql_dump.txt'
const target = process.argv[2] || DEFAULT_LOCAL
const CONTENT_DIR = 'content/blog'

// ── 1. 取 dump ────────────────────────────────────────────────
let raw
if (/^https?:\/\//i.test(target)) {
  const res = await fetch(target)
  if (!res.ok) {
    console.log(`✘ 拉取失败：HTTP ${res.status} ${target}`)
    process.exit(1)
  }
  raw = (await res.text()).trim()
  console.log(`来源：${target}\n  HTTP 200  base64 长度 ${raw.length}  ← 匿名可下载${res.headers.get('content-type') ? `  (${res.headers.get('content-type').split(';')[0]})` : ''}`)
} else {
  if (!existsSync(target)) {
    console.log(`✘ 找不到 ${target}\n先跑 pnpm generate，或显式传线上 URL`)
    process.exit(1)
  }
  raw = readFileSync(target, 'utf8').trim()
  console.log(`来源：${target}\n  base64 长度 ${raw.length}`)
}

// ── 2. 解压 ──────────────────────────────────────────────────
let sql
try {
  sql = gunzipSync(Buffer.from(raw, 'base64')).toString('utf8')
} catch (e) {
  console.log(`✘ 解压失败（不是 base64(gzip) 格式？）：${e.message}`)
  process.exit(1)
}
console.log(`  解压后 ${sql.length} 字符`)
console.log(`  形态：${/DROP TABLE/i.test(sql) ? '含 DROP TABLE ' : ''}${/CREATE TABLE/i.test(sql) ? '含 CREATE TABLE ' : ''}${/\bSELECT\b/i.test(sql) ? '' : '不含 SELECT（= 原始导出，不是查询结果）'}`)

// ── 3. 从源码收集所有文章的 frontmatter ───────────────────────
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.md', '.markdown'].includes(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const files = walk(CONTENT_DIR)
const posts = files.map((f) => {
  const text = readFileSync(f, 'utf8')
  const fm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1]
  const pick = (k) => {
    const m = fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
  }
  return {
    file: f.replace(/\\/g, '/'),
    title: pick('title'),
    path: pick('path'),
    draft: /^draft:\s*(true|'true'|"true")\s*$/im.test(fm),
  }
})

const published = posts.filter((p) => !p.draft)
const drafts = posts.filter((p) => p.draft)

console.log(`\n源码 ${CONTENT_DIR}/ 共 ${posts.length} 篇：已发布 ${published.length}，草稿 ${drafts.length}`)

// ── 4. 用标题去 dump 里搜（标题只作为数据出现，是强信号）──────
const inDump = (s) => Boolean(s) && sql.includes(s)

console.log('\n【已发布文章】应出现在 dump 里（找不到说明构建或统计有问题）')
let missing = 0
for (const p of published) {
  const hit = inDump(p.title)
  if (!hit) missing++
  console.log(`  ${hit ? '✔' : '✘'} ${p.title || '(无 title)'}   ${p.file}`)
}
if (missing) console.log(`  注意：有 ${missing} 篇已发布文章没在 dump 里搜到，可能标题里有转义字符，不必惊慌，但要人工看一眼`)

console.log('\n【草稿 draft: true】**不应该**出现在 dump 里')
if (!drafts.length) {
  console.log('  （当前源码里没有草稿，所以这一项今天查不出东西——这也正是要趁现在搞清楚机制的原因）')
} else {
  let leaked = 0
  for (const p of drafts) {
    const hit = inDump(p.title)
    if (hit) leaked++
    console.log(`  ${hit ? '✘ 泄露' : '✔ 未出现'} ${p.title || '(无 title)'}   ${p.file}`)
  }
  console.log(
    leaked
      ? `\n结论：**${leaked} 篇草稿的标题出现在公开 dump 里** —— 草稿内容正在泄露，必须处理。`
      : '\n结论：草稿标题未出现在 dump 里，构建期确实排除了草稿。',
  )
}

// ── 5. 顺带确认 draft 列与取值 ───────────────────────────────
// 注意：dump 里的 SQL 是带转义引号的（形如 \"draft\" BOOLEAN DEFAULT false），
// 所以不能直接按 "draft" 找。
const colMatch = sql.match(/\\?"draft\\?"\s+BOOLEAN[^,]*/i)
console.log(`\n表结构里的 draft 列：${colMatch ? colMatch[0].trim() : '(未找到)'}`)

// 用 exitCode 而不是 process.exit()：本机 Windows 上 fetch 之后立刻 process.exit()
// 会触发 libuv 的 "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"，
// 让进程以 1 退出，从而掩盖本工具自己的结论码。
process.exitCode = drafts.some((p) => inDump(p.title)) ? 2 : 0
