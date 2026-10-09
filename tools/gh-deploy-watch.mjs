#!/usr/bin/env node
/**
 * 等某次 GitHub Actions 部署跑完，然后探测线上站点是否真的上线。
 * 用法: node --use-system-ca tools/gh-deploy-watch.mjs [sha] [--site https://x.github.io]
 *
 * 不给 sha 时锚定**本地 HEAD**（不是「最新的那次 run」）。
 * 为什么改：原先默认取 runs[0]，于是「刚 push 下一条提交」时会盯上**上一条**的部署 ——
 * 它报 success，而线上其实还是旧版（实测踩过：核验四项全红，才发现盯错了 run）。
 * 指定 sha 永远最稳；这里只是让默认行为也不骗人。若 HEAD 还没 push，会明确报出来。
 */
import { execFileSync } from 'node:child_process'

const repo = process.env.GH_REPO || 'Fiercecoder888/Fiercecoder888.github.io'
const site = process.argv.includes('--site')
  ? process.argv[process.argv.indexOf('--site') + 1]
  : 'https://fiercecoder888.github.io/'
/** 本地 HEAD 的完整 sha；不在 git 仓库里就退回空字符串（退回旧行为） */
function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return ''
  }
}
const sha = (process.argv[2] || '').replace(/^--.*/, '') || process.env.GH_SHA || headSha()

const h = {
  accept: 'application/vnd.github+json',
  'user-agent': 'work09098-watch',
  ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
}
const get = async (p) => {
  const r = await fetch(`https://api.github.com${p}`, { headers: h })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

// ── 1. 找到这次运行的 run ─────────────────────────────────────
let run = null
for (let i = 0; i < 20 && !run; i++) {
  const r = await get(`/repos/${repo}/actions/runs?per_page=10`)
  const list = r.body?.workflow_runs || []
  run = sha ? list.find((x) => x.head_sha.startsWith(sha)) : list[0]
  if (!run) await sleep(5000)
}
if (!run) {
  console.log(sha
    ? `没找到 ${sha.slice(0, 7)} 对应的运行 —— 这条提交推送了吗？（也可以显式传 sha：node tools/gh-deploy-watch.mjs <sha>）`
    : '没找到对应的运行')
  process.exit(1)
}
console.log(`监控 run #${run.run_number} (${run.head_sha.slice(0, 7)}) ${run.html_url}\n`)

// ── 2. 等它结束，并逐次打印步骤状态 ──────────────────────────
let prev = ''
for (let i = 1; i <= 60; i++) {
  const r = await get(`/repos/${repo}/actions/runs/${run.id}`)
  const j = await get(`/repos/${repo}/actions/runs/${run.id}/jobs`)
  const jobs = j.body?.jobs || []
  const snap = jobs.map((x) => `${x.name}:${x.status}/${x.conclusion || '-'}`).join('  ')
  if (snap !== prev) {
    console.log(`[${String(i).padStart(2)}] run=${r.body.status}/${r.body.conclusion || '-'}  ${snap}`)
    prev = snap
  }
  if (r.body.status === 'completed') {
    console.log('\n===== 各步骤结果 =====')
    for (const job of jobs) {
      console.log(`${job.name}: ${job.status}/${job.conclusion || '-'}`)
      for (const s of job.steps || []) {
        const m = s.conclusion === 'success' ? 'ok  ' : s.conclusion === 'failure' ? 'FAIL' : '·   '
        console.log(`  ${m} ${s.name}  (${s.conclusion || s.status})`)
      }
      if (job.conclusion === 'failure' && job.check_run_url) {
        const cid = job.check_run_url.split('/').pop()
        const ann = await get(`/repos/${repo}/check-runs/${cid}/annotations`)
        for (const a of ann.body || []) {
          if (a.annotation_level === 'failure') console.log(`  ✖ ${a.message}`)
        }
      }
    }
    if (r.body.conclusion !== 'success') {
      console.log(`\n结论: ${r.body.conclusion} — 部署未成功，跳过线上探测`)
      process.exit(2)
    }
    break
  }
  await sleep(10000)
}

// ── 3. 线上探测 ──────────────────────────────────────────────
console.log(`\n===== 线上探测 ${site} =====`)
for (let i = 1; i <= 24; i++) {
  try {
    const res = await fetch(site, { redirect: 'follow' })
    const html = await res.text()
    const ok = res.status === 200 && html.includes('/_nuxt/')
    console.log(`[${i}] HTTP ${res.status}  ${html.length} bytes  含 /_nuxt/ = ${html.includes('/_nuxt/')}  ${ok ? '← 上线了' : ''}`)
    if (ok) {
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '(无 title)'
      console.log(`    title: ${title}`)
      // 抽查关键静态资源是否 200
      const assets = [...new Set(html.match(/(?:href|src)="(\/_nuxt\/[^"]+)"/g) || [])]
        .map((s) => s.replace(/^(?:href|src)="/, '').replace(/"$/, ''))
        .slice(0, 3)
      for (const a of assets) {
        const ar = await fetch(new URL(a, site).href, { method: 'GET' })
        console.log(`    资源 ${a} → HTTP ${ar.status}`)
      }
      for (const extra of ['/wallpapers/big-sur-1.jpg', '/sitemap.xml', '/rss.xml', '/llms.txt', '/robots.txt']) {
        const er = await fetch(new URL(extra, site).href)
        console.log(`    ${extra} → HTTP ${er.status}  ${(er.headers.get('content-type') || '').split(';')[0]}`)
      }
      process.exit(0)
    }
  } catch (e) {
    console.log(`[${i}] 请求失败: ${e.message}`)
  }
  await sleep(10000)
}
console.log('超时：站点仍未上线')
process.exit(3)
