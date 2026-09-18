#!/usr/bin/env node
/**
 * 博客验收脚本（captain 维护，无第三方依赖）
 *
 * 用法：
 *   node tools/verify.mjs                          # 默认 http://localhost:3123
 *   node tools/verify.mjs --base http://localhost:3000
 *   node tools/verify.mjs --skip-comments          # 只验页面与 SEO
 *   node tools/verify.mjs --json                   # 输出 JSON
 *
 * 退出码：0 全部通过（未实现的功能记为 pending，不算失败）；1 有硬失败。
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)

function arg(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = String(arg('--base', process.env.BLOG_BASE || 'http://localhost:3123')).replace(/\/$/, '')
const SKIP_COMMENTS = argv.includes('--skip-comments')
const AS_JSON = argv.includes('--json')

/**
 * 站点名「唯一的真相」在 shared/site.ts 的 SITE.name —— 这里读它，而不是写死字面量。
 * 否则用户一改站名，/llms.txt 的断言就会假红，让人误以为改坏了东西。
 *
 * 为什么是「读文件 + 正则」而不是 import / 构建：
 *   shared/site.ts 是 TypeScript，tools/ 下是纯 .mjs，node 原生 import 不了 .ts；
 *   为了拿一个字符串去加依赖或加构建步骤，代价远大于收益。
 *   SITE 是纯字面量对象、name 又是它的第一个属性，所以「从 `export const SITE` 之后
 *   取第一个行首的 `name: '...'`」既简单又稳：行首锚点保证了文档注释里的
 *   `name:` 之类字样不会被误匹配，`'` / `"` / 反引号三种引号都支持，
 *   值里的转义引号（`'It\'s'`）也能正确读到结尾。
 * 解析失败时大声报错并退出，而不是悄悄退回旧字面量 —— 那样只会制造更难查的假红。
 */
function readSiteName() {
  const source = readFileSync(new URL('../shared/site.ts', import.meta.url), 'utf8')
  const from = source.indexOf('export const SITE')
  const match = from === -1 ? null : source.slice(from).match(/^[ \t]*name[ \t]*:[ \t]*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/m)
  const name = match && match[2].trim()
  if (!name) {
    console.error('✘ 无法从 shared/site.ts 解析出 SITE.name —— 请检查 SITE 对象的 name 字段写法。')
    process.exit(1)
  }
  return name.replace(/\\(['"`])/g, '$1')
}

const SITE_NAME = readSiteName()

const results = []
const record = (group, name, status, detail = '') => results.push({ group, name, status, detail })

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    redirect: 'follow',
    ...options,
    headers: { accept: 'text/html,application/json,application/xml,text/plain,*/*', ...(options.headers || {}) },
  })
  const text = await res.text()
  return { status: res.status, text, res }
}

/** 1. 静态页面与 SEO 文件 */
async function checkPages() {
  const pages = [
    ['/', '站点概览'],
    ['/blog', '全部文章'],
    ['/tags', '标签'],
    ['/about', '关于我'],
    ['/sitemap.xml', '<urlset'],
    ['/rss.xml', '<rss'],
    ['/llms.txt', `# ${SITE_NAME}`], // 站名读自 shared/site.ts，改站名不会假红
    ['/robots.txt', 'GPTBot'],
  ]

  for (const [path, marker] of pages) {
    try {
      const { status, text } = await req(path)
      if (status !== 200) record('页面', path, 'fail', `HTTP ${status}`)
      else if (!text.includes(marker)) record('页面', path, 'fail', `200 但缺少标记「${marker}」`)
      else record('页面', path, 'pass', `${text.length} bytes`)
    }
    catch (error) {
      record('页面', path, 'fail', error.message)
    }
  }

  // 「汇总视图 → 日志原文」的出口体检（第 13 轮新增）
  // 为什么不能只查 href="/worklog"：app/layouts/default.vue 的页脚本来就有个全局「工作日志」链接，
  // 三个进度页里都跟着渲染出来了 —— 只查 href 的话，新加的「看日志原文 →」被谁删掉，断言照样绿，等于没加。
  // 所以这里要求「带 data-progress-to-worklog 这个测试钩子的 <a>，且它的 href 正好是 /worklog」才算出口还在。
  // 三页合起来算一条断言：任一页缺了就是失败，detail 里点名是哪一页。
  try {
    const exitPages = ['/progress', '/progress/pitfalls', '/progress/stats']
    const missingExit = []
    for (const path of exitPages) {
      try {
        const { status, text } = await req(path)
        if (status !== 200) missingExit.push(`${path}（HTTP ${status}）`)
        else {
          const tag = text.match(/<a[^>]*data-progress-to-worklog[^>]*>/)?.[0] || ''
          if (!tag.includes('href="/worklog"')) missingExit.push(path)
        }
      }
      catch (error) { missingExit.push(`${path}（${error.message}）`) }
    }
    record('页面', '无限进步三页 → 日志原文出口', missingExit.length === 0 ? 'pass' : 'fail',
      missingExit.length
        ? `缺少「看日志原文」出口（<a href="/worklog" data-progress-to-worklog>）：${missingExit.join('、')}`
        : '3/3 页含 href="/worklog" 的出口锚点')
  }
  catch (error) { record('页面', '无限进步三页 → 日志原文出口', 'fail', error.message) }

  // 文章详情：从 /blog 抓真实链接逐个验证
  try {
    const { text } = await req('/blog')
    const slugs = [...new Set([...text.matchAll(/href="(\/blog\/[^"#?]+)"/g)].map(m => m[1]))]
    if (!slugs.length) record('文章', '动态发现', 'fail', '/blog 页面里没有找到任何文章链接')
    for (const slug of slugs.slice(0, 20)) {
      const { status } = await req(slug)
      record('文章', decodeURIComponent(slug), status === 200 ? 'pass' : 'fail', `HTTP ${status}`)
    }
  }
  catch (error) {
    record('文章', '动态发现', 'fail', error.message)
  }

  // 404
  // 注意：`nuxt generate` 产出的 404.html 是「客户端渲染」的外壳（和 200.html 同一份模板），
  // 所以正文里不会有「页面走丢了」——那段文案是浏览器里跑完 Nuxt 才有的。
  // 因此这一层只断言 HTTP 语义（状态码 404 + 服务的是我们自己的 404 页而不是主机默认页），
  // 渲染后的文案由 tools/e2e-desktop.mjs 的浏览器用例负责。
  try {
    const { status, text } = await req('/__verify_not_exist__')
    const isOurShell = text.includes('id="__nuxt"') || text.includes('页面走丢了')
    record('404', '不存在路径返回 404', status === 404 ? 'pass' : 'fail', `HTTP ${status}`)
    record('404', '服务自己的 404 页', isOurShell ? 'pass' : 'fail', isOurShell ? `${text.length} bytes` : '拿到的是主机默认 404 页')
  }
  catch (error) {
    record('404', '不存在路径返回 404', 'fail', error.message)
  }

  // SEO 内容体检
  try {
    const { text } = await req('/sitemap.xml')
    record('SEO', 'sitemap 含文章', /\/blog\/[^<\s]+/.test(text) ? 'pass' : 'fail', '')
  }
  catch (error) { record('SEO', 'sitemap 含文章', 'fail', error.message) }
  try {
    const { text } = await req('/rss.xml')
    record('SEO', 'rss 含条目', (text.match(/<item>/g) || []).length > 0 ? 'pass' : 'fail', `${(text.match(/<item>/g) || []).length} 条`)
  }
  catch (error) { record('SEO', 'rss 含条目', 'fail', error.message) }
  try {
    const { text } = await req('/robots.txt')
    record('SEO', 'robots 放行 AI 爬虫', ['GPTBot', 'ClaudeBot', 'PerplexityBot'].every(bot => text.includes(bot)) ? 'pass' : 'fail', '')
  }
  catch (error) { record('SEO', 'robots 放行 AI 爬虫', 'fail', error.message) }

  // macOS 外观体检
  try {
    const { text } = await req('/')
    const checks = [
      ['菜单栏', text.includes('mac-menubar')],
      ['Dock', text.includes('mac-dock')],
      ['真实 App 图标', text.includes('/app-icons/')],
      ['壁纸层', text.includes('data-wallpaper')],
    ]
    const missing = checks.filter(([, ok]) => !ok).map(([name]) => name)
    record('macOS 外观', '菜单栏/Dock/图标/壁纸', missing.length === 0 ? 'pass' : 'fail', missing.length ? `缺少：${missing.join('/')}` : '')
  }
  catch (error) { record('macOS 外观', '菜单栏/Dock/图标/壁纸', 'fail', error.message) }

  try {
    const { text } = await req('/blog/hello-blog')
    record('macOS 外观', '文章页 Safari 窗口壳', text.includes('data-safari-toolbar') ? 'pass' : 'fail', '')
  }
  catch (error) { record('macOS 外观', '文章页 Safari 窗口壳', 'fail', error.message) }
}

/** 2. 桌面 OS（子任务 B） */
async function checkDesktop() {
  try {
    const { status, text } = await req('/')
    if (status !== 200) return record('桌面', '首页', 'fail', `HTTP ${status}`)
    const dockLabels = ['Finder', '终端', '废纸篓', '设置']
    const present = dockLabels.filter(label => text.includes(label))
    if (present.length === 0) {
      record('桌面', 'Dock 图标', 'pending', '子任务 B 未落盘')
    }
    else {
      const missing = dockLabels.filter(label => !text.includes(label))
      record('桌面', 'Dock 图标', missing.length === 0 ? 'pass' : 'fail', missing.length ? `缺少：${missing.join('/')}` : dockLabels.join('/'))
    }
  }
  catch (error) { record('桌面', 'Dock 图标', 'fail', error.message) }

  // 窗口层不能破坏阅读页
  for (const path of ['/blog', '/about']) {
    try {
      const { status } = await req(path)
      record('桌面', `不影响 ${path}`, status === 200 ? 'pass' : 'fail', `HTTP ${status}`)
    }
    catch (error) { record('桌面', `不影响 ${path}`, 'fail', error.message) }
  }
}

/** 3. 评论 API（子任务 A） */
async function checkComments() {
  const path = '/blog/hello-blog'
  let createdId = null

  const probe = await req(`/api/comments?path=${encodeURIComponent(path)}`)
  if (probe.status === 404) {
    record('评论', 'API 存在', 'pending', '子任务 A 未落盘（404）')
    return
  }
  record('评论', 'GET 列表', probe.status === 200 ? 'pass' : 'fail', `HTTP ${probe.status}`)

  // 校验失败用例
  const bad = await req('/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, author: '', content: 'x' }),
  })
  record('评论', '空昵称被拒', bad.status === 400 ? 'pass' : 'fail', `HTTP ${bad.status}`)

  // 正常写入
  const author = `验收脚本-${Date.now()}`
  const created = await req('/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, author, content: 'verify.mjs 自动测试评论' }),
  })
  if (created.status === 200) {
    try { createdId = JSON.parse(created.text)?.data?.id ?? null } catch { createdId = null }
    record('评论', 'POST 写入', 'pass', `id=${createdId}`)
  }
  else {
    record('评论', 'POST 写入', 'fail', `HTTP ${created.status} ${created.text.slice(0, 120)}`)
  }

  // 列表能读到
  try {
    const list = await req(`/api/comments?path=${encodeURIComponent(path)}`)
    record('评论', 'GET 读到新评论', list.text.includes(author) ? 'pass' : 'fail', '')
  }
  catch (error) { record('评论', 'GET 读到新评论', 'fail', error.message) }

  // 限流
  const again = await req('/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, author, content: '限流测试' }),
  })
  record('评论', '限流生效', again.status === 429 ? 'pass' : 'fail', `HTTP ${again.status}（期望 429）`)

  // 删除鉴权
  if (createdId != null) {
    const noToken = await req(`/api/comments/${createdId}`, { method: 'DELETE' })
    record('评论', '无 token 删除被拒', noToken.status === 401 ? 'pass' : 'fail', `HTTP ${noToken.status}`)

    const withToken = await req(`/api/comments/${createdId}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': process.env.NUXT_COMMENTS_ADMIN_TOKEN || 'dev-admin-token' },
    })
    record('评论', '带 token 删除成功', withToken.status === 200 ? 'pass' : 'fail', `HTTP ${withToken.status}`)

    const after = await req(`/api/comments?path=${encodeURIComponent(path)}`)
    record('评论', '删除后不再出现', after.text.includes(author) ? 'fail' : 'pass', '')
  }
  else {
    record('评论', '删除流程', 'fail', '未能拿到新建评论 id，跳过删除验证')
  }
}

async function main() {
  try {
    await checkPages()
    await checkDesktop()
    if (!SKIP_COMMENTS) await checkComments()
  }
  catch (error) {
    record('致命', '脚本异常', 'fail', error.message)
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, results }, null, 2))
  }
  else {
    const icon = { pass: '✔', fail: '✘', pending: '…' }
    console.log(`站点名（读自 shared/site.ts 的 SITE.name）：${SITE_NAME}`)
    let group = ''
    for (const r of results) {
      if (r.group !== group) { group = r.group; console.log(`\n【${group}】`) }
      console.log(`  ${icon[r.status]} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    }
    const fail = results.filter(r => r.status === 'fail').length
    const pending = results.filter(r => r.status === 'pending').length
    const pass = results.filter(r => r.status === 'pass').length
    console.log(`\n合计：通过 ${pass} / 失败 ${fail} / 未实现 ${pending}　（${BASE}）`)
  }

  process.exit(results.some(r => r.status === 'fail') ? 1 : 0)
}

main()
