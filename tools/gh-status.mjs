#!/usr/bin/env node
/**
 * 查看 GitHub 仓库 / Actions / Pages 状态。
 * 本机 hosts 把 github.com、api.github.com 指向 127.0.0.1，由 Steam++ 加速器反代，所以直连可用。
 *
 * 用法：
 *   node tools/gh-status.mjs                        # 默认查 origin 对应的仓库
 *   node tools/gh-status.mjs owner/repo             # 指定仓库
 *   node tools/gh-status.mjs owner/repo --logs 123  # 拉某次 run 的日志摘要
 *   GH_TOKEN=xxx node tools/gh-status.mjs           # 带 token（避免限流、可读私有）
 */
import { execFileSync } from 'node:child_process'

const API = 'https://api.github.com'

function targetRepo() {
  const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
  if (arg) return arg
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/)
    if (m) return `${m[1]}/${m[2]}`
  } catch {}
  throw new Error('无法从 origin 推断仓库，请显式传 owner/repo')
}

const repo = targetRepo()
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''

async function api(path) {
  const res = await fetch(API + path, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'work09098-status',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body }
}

const line = (s = '') => process.stdout.write(s + '\n')

line(`仓库: ${repo}`)

// ── 仓库基础信息 ───────────────────────────────────────────────
const info = await api(`/repos/${repo}`)
if (info.status !== 200) {
  line(`  仓库读取失败: HTTP ${info.status} ${typeof info.body === 'string' ? info.body.slice(0, 120) : info.body?.message || ''}`)
} else {
  const r = info.body
  line(`  默认分支: ${r.default_branch}`)
  line(`  可见性  : ${r.private ? 'private' : 'public'}`)
  line(`  体积    : ${r.size} KB`)
  line(`  创建于  : ${r.created_at}`)
  line(`  已推送  : ${r.pushed_at}`)
  const isUserSite = r.name.toLowerCase() === `${r.owner.login.toLowerCase()}.github.io`
  line(`  站点类型: ${isUserSite ? '用户站（URL 在根目录）' : '项目站（URL 带 /<repo>/ 前缀）'}`)
  if (!isUserSite) line(`  ⚠️  仓库名不等于 <账号>.github.io，根路径资源会 404`)
}

// ── Pages 状态 ────────────────────────────────────────────────
const pages = await api(`/repos/${repo}/pages`)
if (pages.status === 200) {
  line(`Pages   : 已启用  build_type=${pages.body.build_type}  url=${pages.body.html_url}`)
  line(`  状态  : ${pages.body.status}  cname=${pages.body.cname || '(无)'}`)
} else if (pages.status === 404) {
  line(`Pages   : 未启用（Settings → Pages，或由工作流 enablement:true 自动开）`)
} else {
  line(`Pages   : HTTP ${pages.status} ${pages.body?.message || ''}`)
}

// ── 最近的工作流运行 ──────────────────────────────────────────
const runs = await api(`/repos/${repo}/actions/runs?per_page=5`)
if (runs.status !== 200) {
  line(`Actions : 读取失败 HTTP ${runs.status} ${runs.body?.message || ''}`)
} else {
  const list = runs.body.workflow_runs || []
  line(`Actions : 共 ${runs.body.total_count} 次运行，最近 ${list.length} 次`)
  for (const r of list) {
    const dur = r.run_started_at && r.updated_at
      ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) + 's'
      : '-'
    line(`  #${r.run_number} ${r.name} [${r.status}${r.conclusion ? '/' + r.conclusion : ''}] ${dur} ${r.head_sha.slice(0, 7)} ${r.created_at}`)
    line(`      ${r.html_url}`)
  }
  const last = list[0]
  if (last && (last.conclusion === 'failure' || last.conclusion === 'cancelled')) {
    line(`\n最近一次失败，各 job 结论：`)
    const jobs = await api(`/repos/${repo}/actions/runs/${last.id}/jobs`)
    if (jobs.status === 200) {
      for (const j of jobs.body.jobs || []) {
        line(`  ${j.name}: ${j.status}/${j.conclusion || '-'}`)
        for (const s of j.steps || []) {
          const mark = s.conclusion === 'success' ? 'ok  ' : s.conclusion === 'failure' ? 'FAIL' : '·   '
          line(`    ${mark} ${s.name}  (${s.conclusion || s.status})`)
        }
        // 失败步骤的真实报错往往在 check-run annotation 里
        if (j.conclusion === 'failure' && j.check_run_id) {
          const ann = await api(`/repos/${repo}/check-runs/${j.check_run_id}/annotations`)
          if (ann.status === 200 && Array.isArray(ann.body) && ann.body.length) {
            line(`  ── ${j.name} 的报错 ──`)
            for (const a of ann.body) {
              line(`    [${a.annotation_level}] ${a.title || ''} ${a.message || ''}`.trimEnd())
            }
          } else {
            line(`  (annotation 读取: HTTP ${ann.status}，无报错文本)`)
          }
        }
      }
    }
  }
}

// ── 可选：拉日志尾部 ─────────────────────────────────────────
const logsIdx = process.argv.indexOf('--logs')
if (logsIdx !== -1) {
  const runId = process.argv[logsIdx + 1]
  line(`\n拉取 run ${runId} 日志…`)
  const res = await fetch(`${API}/repos/${repo}/actions/runs/${runId}/logs`, {
    headers: { 'user-agent': 'work09098-status', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: 'follow',
  })
  if (!res.ok) {
    line(`  日志不可读: HTTP ${res.status}（未登录时 GitHub 不提供日志下载，用 GH_TOKEN 再试）`)
  } else {
    const buf = Buffer.from(await res.arrayBuffer())
    const zipPath = '.gh-run-logs.zip'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(zipPath, buf)
    line(`  已保存 ${zipPath} (${(buf.length / 1024).toFixed(1)} KB)`)
  }
}
