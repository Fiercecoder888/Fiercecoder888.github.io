#!/usr/bin/env node
/**
 * 检查站点 HTML 里引用的所有本地静态资源是否都能取到（重点：/_nuxt/ 下的 chunk）。
 * 静态托管上只要有 chunk 404，按需加载的组件会静默失效，页面却看着正常。
 *
 * 用法: node tools/asset-check.mjs https://example.github.io [更多页面路径...]
 */
const base = (process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('用法: node tools/asset-check.mjs <baseUrl> [路径...]')
  process.exit(1)
}
const pages = process.argv.slice(3)
const paths = pages.length ? pages : ['/', '/blog', '/about', '/tags']

const seen = new Map() // url -> Set(来源页面)
const collect = (html, page) => {
  const urls = new Set()
  for (const m of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) urls.add(m[1])
  for (const m of html.matchAll(/import\("(\/_nuxt\/[^"]+)"\)/g)) urls.add(m[1])
  for (const m of html.matchAll(/["'](\/_nuxt\/[^"']+)["']/g)) urls.add(m[1])
  for (const u of urls) {
    if (!seen.has(u)) seen.set(u, new Set())
    seen.get(u).add(page)
  }
}

for (const p of paths) {
  try {
    const r = await fetch(base + p)
    const t = await r.text()
    if (r.status !== 200) console.log(`页面 ${p} → HTTP ${r.status}（跳过资源收集）`)
    else collect(t, p)
  } catch (e) {
    console.log(`页面 ${p} 请求失败: ${e.message}`)
  }
}

console.log(`共收集到 ${seen.size} 个本地资源引用，逐个校验…\n`)
let bad = 0
for (const [u, from] of [...seen].sort()) {
  try {
    const r = await fetch(base + u, { method: 'GET' })
    if (r.status !== 200) {
      bad++
      console.log(`  ✘ HTTP ${r.status}  ${u}   ← 引用于 ${[...from].join(', ')}`)
    }
  } catch (e) {
    bad++
    console.log(`  ✘ 请求失败 ${u}  (${e.message})`)
  }
}
console.log(bad === 0 ? '\n✔ 所有引用到的资源均返回 200' : `\n✘ 有 ${bad} 个资源取不到`)
process.exit(bad === 0 ? 0 : 1)
