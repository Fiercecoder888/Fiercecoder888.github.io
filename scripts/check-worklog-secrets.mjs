#!/usr/bin/env node
/**
 * 工作日志的**泄露守卫**：扫描 `content/worklog/**` 里有没有不该公开的东西。
 *
 * 为什么需要它：`content/worklog/` 里的内容会**直接发布到公开网站**（会被搜索引擎与 AI 收录）。
 * 工作日志天然贴着工作项目写，很容易带出公司/客户/项目代号、内网地址、内部文件路径、真实姓名、
 * 密钥……而 `scripts/check-drafts.mjs` 只管「有没有草稿漏进构建」，管不了**内容里的敏感信息**。
 *
 * 设计原则：
 *   - **默认拦截、允许显式豁免**：命中即报错；确实要写的（例如技术文章里必须引用一个公开库名）
 *     可以在同一行加 `<!-- leak-ok: 原因 -->` 豁免，并在代码评审里说明。
 *   - **宁可误报**：漏一个敏感词，代价是它永久留在公网上。
 *
 * 用法：
 *   node scripts/check-worklog-secrets.mjs           # 扫 content/worklog/
 *   node scripts/check-worklog-secrets.mjs --all     # 连 content/blog/ 一起扫
 *   node scripts/check-worklog-secrets.mjs --path content/worklog/2026-09-01.md
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const argv = process.argv.slice(2)
const has = n => argv.includes(`--${n}`)
const argOf = (n, fb) => { const i = argv.indexOf(`--${n}`); return i === -1 ? fb : argv[i + 1] }

/**
 * 规则表。每条：{ id, re, why }
 * 注意正则都用 `g` 以便报告列号；匹配到的原文**只打印前 40 字**，避免把敏感内容写进日志输出。
 */
const RULES = [
  // ── 真实身份 ──────────────────────────────────────────────────────
  { id: 'user-path', re: /[A-Za-z]:[\\/]Users[\\/](?!<|\{|USER\b|user\b|%|你的|某某)[^\\/\s"'`）)]+/g, why: 'Windows 用户目录里带真实用户名（应写成 <用户>）' },
  { id: 'home-path', re: /[A-Za-z]:[\\/](?:Users|home)[\\/][^\s"'`）)]*Documents[\\/]Codex/gi, why: '本机 Codex 工作目录，含真实路径' },
  { id: 'email', re: /[\w.+-]+@(?!example\.(?:com|org)|yourname)[\w-]+\.[\w.]{2,}/g, why: '邮箱地址（可能是真实邮箱）' },
  { id: 'phone-cn', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, why: '疑似手机号' },

  // ── 项目 / 组织代号 ───────────────────────────────────────────────
  { id: 'codename-newwork', re: /\bNewWork\d*\b/gi, why: '工作项目代号' },
  { id: 'codename-workdir', re: /\bWork\d{4,5}\b/g, why: '工作目录/工单编号（如 Work09098、Work09140）' },
  { id: 'codename-short', re: /\b(?:RXZY|AiHR|Aimoney|worktree)\b/gi, why: '工作项目代号' },
  { id: 'codename-work1', re: /\bwork\d\b/gi, why: '工作目录名（work1/work2…）' },
  { id: 'codename-wh', re: /\b(?:wh|WH)\d{3,5}\b/g, why: '疑似物料/工单编号' },
  { id: 'biz-bom-sop', re: /\b(?:BOM|SOP|HDTV|HDMI)\b/g, why: '业务/制造领域术语，可能指向具体产品线' },

  // ── 内部网络与系统 ────────────────────────────────────────────────
  { id: 'ip-private', re: /(?<!\d)(?:10\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}(?:\.\d{1,3})?(?!\d)/g, why: '内网 IP 地址' },
  { id: 'ip-any', re: /(?<!\d)(?!127\.0\.0\.1|0\.0\.0\.0)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(?!\d)/g, why: '具体 IP 地址（若是公网示例请改写成 example.com）' },
  { id: 'internal-host', re: /\b[\w-]+\.(?:local|internal|corp|lan|intra)\b/gi, why: '内部域名' },
  { id: 'wechat-path', re: /(?:xwechat_files|WeChat Files|[\\/]微信[\\/])/gi, why: '微信文件路径' },
  { id: 'ssh-cred', re: /\bssh\s+[\w.-]+@[\w.-]+/gi, why: 'SSH 登录串（含账号与主机）' },
  { id: 'private-repo', re: /\b(?:git@|https?:\/\/)[\w.-]*(?:gitlab|gitea|bitbucket|codeup|git\.[\w.-]+)[\w./-]*/gi, why: '私有代码仓库地址' },

  // ── 凭据 ──────────────────────────────────────────────────────────
  { id: 'key-prefix', re: /\b(?:sk|pk|ghp|gho|ghs|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/g, why: '疑似密钥/token' },
  { id: 'key-assign', re: /\b(?:api[_-]?key|apikey|access[_-]?token|secret|passwd|password|密码)\b\s*[:=]\s*["'`]?[A-Za-z0-9_\-.]{6,}/gi, why: '疑似密钥赋值' },
  { id: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g, why: '疑似 Bearer token' },
]

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.md', '.markdown'].includes(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

const explicit = argOf('path', null)
const targets = explicit
  ? [explicit]
  : [...walk('content/worklog'), ...(has('all') ? walk('content/blog') : [])]

if (!targets.length) {
  console.log('· 没有找到要扫描的文件（content/worklog 为空？）')
  process.exit(0)
}

const findings = []
for (const file of targets) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/leak-ok:/.test(line)) return // 显式豁免
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        findings.push({ file, line: i + 1, id: rule.id, hit: m[0].slice(0, 40), why: rule.why })
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++
      }
    }
  })
}

console.log(`扫描 ${targets.length} 个文件，规则 ${RULES.length} 条`)
if (!findings.length) {
  console.log('✔ 没发现疑似敏感内容')
  process.exit(0)
}

console.log(`\n✘ 发现 ${findings.length} 处疑似敏感内容（这些内容会**直接公开发布**）：\n`)
for (const f of findings) {
  console.log(`  ${relative(process.cwd(), f.file).replace(/\\/g, '/')}:${f.line}  [${f.id}]  「${f.hit}」`)
  console.log(`      ${f.why}`)
}
console.log('\n处理办法（三选一）：')
console.log('  1. 脱敏：把公司/项目代号、内网地址、真实路径改成通用说法')
console.log('  2. 降级：把这条坑从 content/worklog/ 移到 drafts/（草稿不进网站）')
console.log('  3. 豁免：确实要保留时，在同一行加  <!-- leak-ok: 原因 -->')
process.exitCode = 1
