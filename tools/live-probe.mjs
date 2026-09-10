#!/usr/bin/env node
/**
 * 聚焦探针：在真实浏览器里打开一个 URL，逐项报告关键选择器**第一次出现的时间**。
 *
 * 存在的理由：某些现象只能在浏览器里量。例如线上文章页在 `qa.mjs` 里报
 * 「找不到 mac 窗口 / 缺少 Safari 工具栏 / 缺少正文容器」，但同一份源码的本地产物没有，
 * 而且 qa 的 goto 已经等了两轮 readyState=complete + 2.4s —— 说明不是「测得太早」。
 * 本工具用来判断到底是「慢」还是「根本没渲染出来」。
 *
 * 用法：
 *   node --use-system-ca tools/live-probe.mjs <url> [--timeout 60000] [--keep]
 *   node --use-system-ca tools/live-probe.mjs https://example.github.io/blog/hello-blog/
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const URL_ = argv.find((a) => /^https?:\/\//i.test(a))
if (!URL_) {
  console.error('用法: node --use-system-ca tools/live-probe.mjs <url> [--timeout 60000]')
  process.exit(1)
}
const TIMEOUT = Number(arg('timeout', '60000'))
const PORT = Number(arg('port', '9441'))

const CANDIDATES = [
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const CHROME = CANDIDATES.find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到可用的 Chrome/chromium-headless-shell')
  process.exit(1)
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,1100',
  'about:blank',
], { stdio: 'ignore' })

let ws
let msgId = 0
const pending = new Map()
const consoleMsgs = []

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }
    }, 30000)
  })
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (res.result?.exceptionDetails) return undefined
  return res.result?.result?.value
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms))

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome 启动超时')
}

try {
  await waitForChrome()
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (['error', 'warning'].includes(msg.params.type)) consoleMsgs.push(`${msg.params.type}: ${text}`.slice(0, 300))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push(`exception: ${(msg.params.exceptionDetails?.exception?.description || '').slice(0, 300)}`)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')

  // --goto-first <url>：先打开这个地址，再点击 --click <selector> 跳到下一页。
  // 用来走「真人路径」（首页 → 点文章卡片，SPA 客户端路由），
  // 它和「直接硬刷新目标 URL」是两条不同的代码路径，必须分别验。
  const clickSel = arg('click', '')
  const gotoFirst = arg('goto-first', '')
  const t0 = Date.now()
  if (gotoFirst) {
    console.log(`先打开: ${gotoFirst}`)
    await send('Page.navigate', { url: gotoFirst })
    await sleep(Number(arg('first-wait', '4000')))
  }
  if (clickSel) {
    const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(clickSel)}); if (!el) return false; el.click(); return true })()`)
    console.log(`点击 ${clickSel} → ${clicked ? '已点击' : '没找到该元素'}`)
    await sleep(500)
  }
  const nav = clickSel || gotoFirst ? { result: {} } : await send('Page.navigate', { url: URL_ })
  if (!clickSel) console.log(`导航: ${URL_}`)
  if (nav.result?.errorText) console.log(`  navigate errorText: ${nav.result.errorText}`)

  const SEL = [
    '[data-mac-window]',
    '[data-safari-toolbar]',
    '.prose-article',
    '.mac-menubar',
    '.mac-dock',
  ]
  const firstSeen = Object.fromEntries(SEL.map((s) => [s, null]))
  // 记录每个选择器的**状态变化时间线**，而不只是首次出现 ——
  // 「先渲染出来、再被抹掉、之后才回来」这种闪空缺陷只有看时间线才发现得了。
  const timeline = Object.fromEntries(SEL.map((s) => [s, []]))
  const seenNow = Object.fromEntries(SEL.map((s) => [s, null]))
  let readyAt = null
  let readyLost = false
  let lastReport = 0

  while (Date.now() - t0 < TIMEOUT) {
    const state = await evaluate(`(() => {
      const out = { ready: document.readyState, url: location.href, textLen: (document.body?.innerText || '').length, snippet: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 70) }
      ${SEL.map((s) => `out[${JSON.stringify(s)}] = Boolean(document.querySelector(${JSON.stringify(s)}))`).join('\n      ')}
      return out
    })()`)
    if (!state) { await sleep(400); continue }
    const t = Date.now() - t0
    if (state.ready === 'complete') { if (readyAt === null) readyAt = t }
    else if (readyAt !== null && !readyLost) readyLost = true
    for (const s of SEL) {
      const now = Boolean(state[s])
      if (seenNow[s] === null || seenNow[s] !== now) {
        timeline[s].push({ t, present: now, textLen: state.textLen, snippet: state.snippet })
        seenNow[s] = now
      }
      if (now && firstSeen[s] === null) firstSeen[s] = t
    }
    if (t - lastReport >= 2000) {
      lastReport = t
      const missing = SEL.filter((s) => !state[s])
      console.log(`  [${String(t).padStart(5)} ms] ready=${state.ready} textLen=${String(state.textLen).padStart(5)} 当前缺失: ${missing.length ? missing.join(', ') : '（无）'}`)
    }
    await sleep(500)
  }

  console.log(`\n===== 结果（观察 ${Date.now() - t0} ms）=====`)
  console.log(`  readyState 首次 complete: ${readyAt === null ? '从未' : readyAt + ' ms'}${readyLost ? '（注意：之后又离开了 complete）' : ''}`)
  for (const s of SEL) {
    console.log(`  ${firstSeen[s] === null ? '✘ 从未出现' : '✔ 首次 ' + String(firstSeen[s]).padStart(6) + ' ms'}  ${s}`)
    const tl = timeline[s]
    if (tl.length > 1) {
      console.log(`        时间线（切换 ${tl.length} 次）:`)
      for (const e of tl) {
        console.log(`          ${String(e.t).padStart(6)} ms  ${e.present ? '出现' : '消失'}  (text ${e.textLen})  「${e.snippet}」`)
      }
    }
  }
  const bodyText = await evaluate(`document.body?.innerText || ''`)
  console.log(`\n  最终 URL: ${await evaluate('location.href')}`)
  console.log(`  正文长度: ${bodyText.length}\n  正文前 160 字: ${bodyText.replace(/\s+/g, ' ').slice(0, 160)}`)
  if (consoleMsgs.length) {
    console.log(`\n  控制台 error/warning（${consoleMsgs.length} 条）:`)
    for (const m of consoleMsgs.slice(0, 10)) console.log(`    ${m}`)
  } else {
    console.log('\n  控制台：无 error/warning')
  }

  // 关键资源时序：内容库的 wasm 与 dump 到底有没有被拉、耗时多少、状态码多少。
  // 文章页会闪「页面走丢了」，需要判断那是「内容库还没就绪」还是「加载失败被当成 404」。
  const res = await evaluate(`
    performance.getEntriesByType('resource')
      .filter(r => /sqlite3|\\.wasm|sql_dump|_payload|entry\\./.test(r.name))
      .map(r => ({
        name: r.name.replace(location.origin, ''),
        dur: Math.round(r.duration),
        start: Math.round(r.startTime),
        size: r.transferSize,
        status: r.responseStatus,
      }))
  `)
  console.log(`\n  关键资源时序（${(res || []).length} 条）:`)
  for (const r of res || []) {
    console.log(`    ${String(r.start).padStart(6)}ms 起  耗时 ${String(r.dur).padStart(6)}ms  HTTP ${r.status ?? '-'}  传输 ${r.size ?? '-'}B  ${r.name}`)
  }
} finally {
  try { ws?.close() } catch {}
  if (!argv.includes('--keep')) {
    chrome.kill()
    await sleep(300)
  }
}
