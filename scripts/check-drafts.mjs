#!/usr/bin/env node
/**
 * 草稿守卫：禁止把「未发布的草稿」留在 content/ 目录里。
 *
 * 为什么需要它（已实测，不是推测）：
 *   `@nuxt/content` 的构建期**没有任何按 draft 字段过滤数据库行的逻辑**。
 *   `nuxt generate` 会把整个内容库导出成 `/_nuxt_content/blog/sql_dump.txt`
 *   （SQLite 的原始导出，gzip + base64），部署到 GitHub Pages 后可被任何人匿名下载（HTTP 200）。
 *   查询层的 `.where('draft', '=', false)` 只挡住页面 / 列表 / sitemap / RSS / llms.txt，
 *   挡不住这份 dump —— `draft: true` 的文章正文会随 dump 一起全文公开。
 *   所以正确做法不是"过滤"，而是让草稿**根本不进 content/**（见 drafts/README.md）。
 *
 * 用法：
 *   node scripts/check-drafts.mjs
 *   node scripts/check-drafts.mjs --content content     # 默认就是 content
 *
 * 判定规则（命中任意一条即失败，exit 1）：
 *   1. content/ 下任意 *.md / *.markdown 的 frontmatter 里 draft 取值为真
 *      （`true` / `TRUE` / `'true'` / `"true"` / `yes` / `on` 都算；
 *        `draft: false` 与完全不写 draft 都**不算**问题）
 *   2. 文件名以 `.draft.md` 结尾（@nuxt/content 的草稿文件名约定，同样会进 dump）
 *   只解析 frontmatter 块，不扫正文 —— 正文里出现 `draft: true` 只是文字，不是元数据。
 *   content/ 目录不存在时按**失败**处理：守卫必须真的扫到东西，否则目录改名会让它静默失效。
 *
 * 纯 Node 实现，无第三方依赖。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = name => argv.includes(name)

if (has('--help') || has('-h')) {
  console.log('用法：node scripts/check-drafts.mjs [--content content]')
  console.log('发现 content/ 下任何 draft: true（或 *.draft.md）就报错退出，退出码 1；干净则退出码 0。')
  process.exit(0)
}

const CONTENT_DIR = arg('--content', 'content')
const SKIP_DIRS = new Set(['node_modules', '.git', '.nuxt', '.output', 'dist', 'preview'])
const EXTS = new Set(['.md', '.markdown'])
// 只有这些取值算"草稿为真"。故意不猜 `1`/`y` 之类：schema 是 z.boolean()，
// 真写成那些值构建本身就会因类型不合法而失败，不会静默泄露。
const TRUE_VALUES = new Set(['true', 'yes', 'on'])

const contentRoot = resolve(CONTENT_DIR)
if (!existsSync(contentRoot) || !statSync(contentRoot).isDirectory()) {
  console.error(`✘ 内容目录不存在：${contentRoot}`)
  console.error('  守卫必须真的扫到 content/ 才有意义，所以这里按失败处理（避免目录改名后守卫静默失效）。')
  process.exit(1)
}

/** 递归收集 content/ 下的 Markdown 文件（跳过点目录与构建产物目录） */
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

/** 归一化 frontmatter 里的标量值：去掉成对引号与行尾注释，再转小写 */
function normalizeValue(raw) {
  const v = String(raw).trim()
  const quoted = /^(['"])([\s\S]*)\1$/.exec(v)
  if (quoted) return quoted[2].trim().toLowerCase()
  return v.replace(/\s+#.*$/, '').trim().toLowerCase()
}

/**
 * 在 frontmatter 块里找顶层 `draft` 键。
 * 返回 { value, line, text }（line 是文件里的实际行号），找不到返回 null。
 */
function findDraftKey(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) return null
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    // 行首不允许缩进：只认顶层的 draft 键，嵌套的同名键不影响 content schema
    const pair = /^draft\s*:\s*(.*)$/.exec(lines[i])
    if (!pair) continue
    return { value: normalizeValue(pair[1]), line: i + 2, text: lines[i].trim() } // +2：第 1 行是 ---
  }
  return null
}

const files = walk(contentRoot)
const problems = []

for (const file of files) {
  const rel = relative(process.cwd(), file).split('\\').join('/')
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  }
  catch (error) {
    problems.push({ file: rel, reason: `读取失败：${error.message}` })
    continue
  }

  const draftKey = findDraftKey(raw)
  if (draftKey && TRUE_VALUES.has(draftKey.value)) {
    problems.push({ file: rel, reason: `frontmatter 第 ${draftKey.line} 行：${draftKey.text}` })
    continue
  }
  if (/\.draft\.md$/i.test(file)) {
    problems.push({ file: rel, reason: '文件名以 .draft.md 结尾（@nuxt/content 的草稿文件名约定）' })
  }
}

if (!problems.length) {
  console.log(`✔ 未发现草稿：${relative(process.cwd(), contentRoot).split('\\').join('/')} 下 ${files.length} 个 Markdown 文件都没有 draft: true`)
  process.exit(0)
}

console.error(`✘ 发现 ${problems.length} 处「草稿留在 content/ 里」：\n`)
for (const item of problems) console.error(`  ✘ ${item.file} —— ${item.reason}`)

console.error(`
为什么这是错的：
  @nuxt/content 构建期不按 draft 字段过滤数据库行。nuxt generate 会把整个内容库导出成
  /_nuxt_content/blog/sql_dump.txt（SQLite 导出，gzip + base64），部署到 GitHub Pages 后可被
  任何人匿名下载。页面 / 列表 / sitemap / RSS / llms.txt 都用 .where('draft','=',false) 挡住了，
  但这份 dump 挡不住 —— draft: true 的文章正文（可能含公司项目名、内部信息）会全文公开。
  实测数据：临时放入一篇带唯一标记的 draft: true 文章，dump 长度 29763 → 30618 字符，
  标记出现 3 次；删掉后恢复。dump 不能直接删，客户端内容库（Spotlight 搜索 / Finder / 终端 ls）
  就靠 fetchDatabase() 加载它。

应该怎么做：
  1. 把草稿移出构建范围（drafts/ 已在 .gitignore 里，只存在本地）：
       git mv content/blog/xxx.md drafts/xxx.md      # 未被跟踪时直接 move
  2. 发布时再移动回 content/blog/（或以后的 content/worklog/），并删掉 draft 字段，
     这一步才叫"发布"。
  详见 drafts/README.md。
`)

process.exit(1)
