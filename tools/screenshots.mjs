#!/usr/bin/env node
/**
 * 页面截图工具（CDP）：会先跳过开机/登录动画再截图。
 *
 * 用法：node tools/screenshots.mjs [--base http://localhost:3123]
 * 产物：preview/home.png、preview/blog-list.png、preview/post.png、preview/about.png、preview/boot.png
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = String(arg('--base', 'http://localhost:3123')).replace(/\/$/, '')
const PORT = Number(arg('--port', '9335'))
const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\USER\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe'

const SHOTS = [
  { name: 'home', path: '/' },
  { name: 'blog-list', path: '/blog' },
  { name: 'post', path: '/blog/hello-blog' },
  { name: 'about', path: '/about' },
]

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
    }, 20000)
  })
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true })
  return res.result?.result?.value
}

async function waitFor(fn, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true } catch {}
    await sleep(200)
  }
  return false
}

async function readState() {
  return evaluate('document.readyState')
}

async function screenshot(file) {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  mkdirSync('preview', { recursive: true })
  writeFileSync(file, Buffer.from(res.result.data, 'base64'))
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch {}
    await sleep(250)
  }

  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}`, { method: 'PUT' })).json()
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
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')

  // 首屏：先抓一张开机页（苹果 logo + 进度条），再走完登录
  await send('Page.navigate', { url: `${BASE}/` })
  await waitFor(async () => (await readState()) === 'complete', 20000)
  if (await waitFor(() => evaluate(`Boolean(document.querySelector('[data-boot-progress]'))`), 8000)) {
    await sleep(1200)
    await screenshot('preview/boot.png')
    console.log('  ✔ preview/boot.png  ←  开机页')
  }
  const loginReady = await waitFor(() => evaluate(`Boolean(document.querySelector('[data-login-enter]'))`), 14000)
  if (loginReady) {
    await evaluate(`document.querySelector('[data-login-enter]').click()`)
    await waitFor(() => evaluate(`!document.querySelector('[data-boot-screen]')`), 6000)
  }
  await sleep(900)

  for (const shot of SHOTS) {
    await send('Page.navigate', { url: `${BASE}${shot.path}` })
    await waitFor(async () => (await readState()) === 'complete', 20000)
    await sleep(1200)
    await screenshot(`preview/${shot.name}.png`)
    console.log(`  ✔ preview/${shot.name}.png  ←  ${shot.path}`)
  }
}

main()
  .catch(error => {
    console.error(`✘ 截图失败：${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    try { ws?.close() } catch {}
    chrome.kill()
    await sleep(300)
  })
