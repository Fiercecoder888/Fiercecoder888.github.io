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
const argv = process.argv.slice(2)

function arg(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = String(arg('--base', process.env.BLOG_BASE || 'http://localhost:3123')).replace(/\/$/, '')
const SKIP_COMMENTS = argv.includes('--skip-comments')
const AS_JSON = argv.includes('--json')

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
    ['/llms.txt', '# 我的博客'],
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
  try {
    const { status, text } = await req('/__verify_not_exist__')
    record('404', '不存在路径', status === 404 && text.includes('页面走丢了') ? 'pass' : 'fail', `HTTP ${status}`)
  }
  catch (error) {
    record('404', '不存在路径', 'fail', error.message)
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
