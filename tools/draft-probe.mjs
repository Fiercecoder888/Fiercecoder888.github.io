#!/usr/bin/env node
/**
 * 草稿泄露探针：检查 `draft: true` 的文章会不会漏进公开产物。
 *
 * 查四个面：
 *   1. sql_dump.txt（原始 SQLite 导出，静态托管上匿名可下载）
 *   2. 预渲染出的页面 /blog/<slug>/index.html
 *   3. sitemap.xml / rss.xml / llms.txt（这三处查询都带 .where('draft','=',false)）
 *   4. Finder / 废纸篓 这些列出草稿的组件是否把草稿路径写进了产物
 *
 * 用法: node tools/draft-probe.mjs <标记>   （默认标记 DRAFTPROBE7f3a）
 */
import { gunzipSync } from 'node:zlib'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MARK = process.argv[2] || 'DRAFTPROBE7f3a'
const OUT = '.output/public'

if (!existsSync(OUT)) {
  console.log(`✘ 找不到 ${OUT}，先跑 pnpm generate`)
  process.exit(1)
}

const hit = (label, text, name) => {
  const found = text.includes(MARK)
  console.log(`  ${found ? '✘ 泄露' : '✔ 未出现'}  ${label}${name ? `  (${name})` : ''}`)
  return found
}

const leaks = {}

// ── 1. sql_dump.txt ──────────────────────────────────────────
console.log('【1】内容库导出 sql_dump.txt（静态托管上匿名可下载）')
const dumpPath = join(OUT, '__nuxt_content', 'blog', 'sql_dump.txt')
if (existsSync(dumpPath)) {
  const sql = gunzipSync(Buffer.from(readFileSync(dumpPath, 'utf8').trim(), 'base64')).toString('utf8')
  leaks.dump = hit('dump 正文', sql)
  const times = sql.split(MARK).length - 1
  console.log(`      dump 里标记出现 ${times} 次；dump 总长 ${sql.length} 字符`)
} else {
  console.log('  · 没有 dump 文件')
}

// ── 2. 预渲染页面 ────────────────────────────────────────────
console.log('\n【2】预渲染出的页面')
let pageHit = false
const blogDir = join(OUT, 'blog')
if (existsSync(blogDir)) {
  for (const name of readdirSync(blogDir)) {
    const p = join(blogDir, name)
    if (!statSync(p).isDirectory()) continue
    const idx = join(p, 'index.html')
    if (existsSync(idx)) {
      const t = readFileSync(idx, 'utf8')
      if (t.includes(MARK)) {
        pageHit = true
        hit('页面 HTML', t, `/blog/${name}/index.html`)
      }
    }
  }
}
if (!pageHit) console.log('  ✔ 未出现  没有任何预渲染页面含标记')
leaks.page = pageHit

// 有没有生成一个以探针 slug 命名的目录
const probeDirs = existsSync(blogDir) ? readdirSync(blogDir).filter((n) => /probe/i.test(n)) : []
console.log(`      与 probe 相关的产物目录: ${probeDirs.length ? probeDirs.join(', ') : '（无）'}`)

// ── 3. SEO 文件 ──────────────────────────────────────────────
console.log('\n【3】SEO 文件（这三处查询都带 draft = false 过滤）')
for (const f of ['sitemap.xml', 'rss.xml', 'llms.txt']) {
  const p = join(OUT, f)
  if (existsSync(p)) leaks[f] = hit(f, readFileSync(p, 'utf8'))
  else console.log(`  · 没有 ${f}`)
}

// ── 4. 整个产物里任何地方出现标记 ────────────────────────────
// 注意：必须跳过 __nuxt_content/ —— 那里的 sql_dump.txt 是 base64(gzip) 的，
// 按原始字节扫描**必然扫不到明文**，会给出假阴性（第 1 步已经解压查过了）。
// 这一步只负责抓「其它没被压缩的文件里有没有明文残留」。
console.log('\n【4】全产物文本扫描（兜底，已排除压缩过的 __nuxt_content/）')
const hits = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = p.replace(/\\/g, '/')
    if (statSync(p).isDirectory()) {
      if (rel.includes('__nuxt_content')) {
        console.log(`      （跳过 ${rel}：内容经过基址64+gzip，明文扫描不适用）`)
        continue
      }
      walk(p)
    } else if (statSync(p).size < 8 * 1024 * 1024) {
      try {
        if (readFileSync(p).includes(MARK)) hits.push(rel.replace(`${OUT}/`, ''))
      } catch {}
    }
  }
}
walk(OUT)
console.log(hits.length ? `  ✘ 标记出现在 ${hits.length} 个文件里：` : '  ✔ 明文文件里没有残留')
for (const h of hits) console.log(`      ${h}`)
leaks.all = hits.length > 0

const anyLeak = Object.values(leaks).some(Boolean)
console.log(`\n===== 结论：${anyLeak ? '草稿内容确实泄漏到了公开产物' : '草稿未泄漏到公开产物'} =====`)
process.exitCode = anyLeak ? 2 : 0
