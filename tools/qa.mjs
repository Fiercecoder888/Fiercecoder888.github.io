#!/usr/bin/env node
/**
 * 体验 QA（CDP）：找「功能能跑但用起来不对劲」的问题
 *
 *   node tools/qa.mjs [--base http://localhost:3123] [--dark]
 *
 * 检查项：
 *   1. 控制台 error / Vue warning
 *   2. 命中测试：关键可点元素中心点是否真的能点到（有没有被别的层盖住）
 *   3. 裁剪检测：放大的 Dock 图标有没有被容器裁掉
 *   4. 横向溢出：页面是否出现横向滚动条
 *   5. 文本对比度：把文字颜色和实际背景像素做对比（截图采样）
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { inflateSync } from 'node:zlib'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = String(arg('--base', 'http://localhost:3123')).replace(/\/$/, '')
const WANT_DARK = argv.includes('--dark')
const PORT = Number(arg('--port', WANT_DARK ? '9341' : '9340'))
const WIN_W = Number(arg('--width', '1440'))
const WIN_H = Number(arg('--height', '900'))
const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\USER\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe'

const issues = []
const notes = []
const add = (level, area, message) => issues.push({ level, area, message })

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu',
  '--hide-scrollbars', `--window-size=${WIN_W},${WIN_H}`, 'about:blank',
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) } }, 25000)
  })
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'Runtime 异常')
  return res.result?.result?.value
}

/** 开机/登录层如果出现了就点掉；返回是否处理过 */
async function dismissBoot() {
  if (!(await evaluate(`Boolean(document.querySelector('[data-boot-screen]'))`))) return false
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`Boolean(document.querySelector('[data-login-enter]'))`)) break
    await sleep(200)
  }
  await evaluate(`document.querySelector('[data-login-enter]')?.click()`)
  for (let i = 0; i < 50; i++) {
    if (!(await evaluate(`Boolean(document.querySelector('[data-boot-screen]'))`))) return true
    await sleep(200)
  }
  return true
}

async function goto(path) {
  await send('Page.navigate', { url: BASE + path })
  for (let i = 0; i < 60; i++) {
    if ((await evaluate('document.readyState')) === 'complete') break
    await sleep(200)
  }
  await sleep(1200)
}

async function shot() {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(res.result.data, 'base64')
}

/* ---------- 极简 PNG 解码（只支持 8bit RGB/RGBA，非隔行） ---------- */
function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 6
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }

  const raw = inflateSync(Buffer.concat(idat))
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const out = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[x] = value & 0xFF
    }
  }
  return { width, height, channels, data: out }
}

function pixelAt(img, x, y) {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)))
  const i = (yi * img.width + xi) * img.channels
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

async function main() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch {}
    await sleep(250)
  }

  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' })).json()
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
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push({ type: 'exception', text: msg.params.exceptionDetails?.exception?.description ?? '' })
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleMsgs.push({ type: msg.params.type, text: msg.params.args.map(a => a.value ?? a.description ?? '').join(' ') })
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')

  // 在任何页面脚本之前注入：跳过开机动画 + 指定主题（避免被开屏层干扰测量）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try {
        sessionStorage.setItem('blog_boot_done', '1');
        var raw = JSON.parse(localStorage.getItem('blog_settings') || '{}');
        raw.theme = '${WANT_DARK ? 'dark' : 'light'}';
        localStorage.setItem('blog_settings', JSON.stringify(raw));
      } catch (e) {}
    `,
  })

  await goto('/')

  // 双保险：万一开屏还是出来了，等登录按钮出现并点掉，再确认它消失
  if (await evaluate(`Boolean(document.querySelector('[data-boot-screen]'))`)) {
    for (let i = 0; i < 40; i++) {
      if (await evaluate(`Boolean(document.querySelector('[data-login-enter]'))`)) break
      await sleep(200)
    }
    await evaluate(`document.querySelector('[data-login-enter]')?.click()`)
    for (let i = 0; i < 40; i++) {
      if (!(await evaluate(`Boolean(document.querySelector('[data-boot-screen]'))`))) break
      await sleep(200)
    }
  }
  const bootGone = !(await evaluate(`Boolean(document.querySelector('[data-boot-screen]'))`))
  if (!bootGone) add('error', '开屏', '开机动画层没有消失，后续测量会被遮挡')
  await sleep(600)

  /* ---------- 1. 控制台 ---------- */
  const noisy = consoleMsgs.filter(m => !/favicon|DevTools|vite|Hydration completed/i.test(m.text))
  for (const m of noisy.slice(0, 8)) add('error', '控制台', `${m.type}: ${m.text.slice(0, 160)}`)
  notes.push(`控制台 error/warning：${noisy.length} 条`)

  /* ---------- 1.5 emoji 残留扫描（图标应全部来自图标库） ---------- */
  const emojiScan = await evaluate(`
    (() => {
      const re = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]/u
      const found = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const parent = node.parentElement
        if (!parent) continue
        const tag = parent.tagName.toLowerCase()
        if (['script', 'style', 'noscript', 'textarea', 'code', 'pre'].includes(tag)) continue
        const text = (node.textContent || '').trim()
        if (!text || !re.test(text)) continue
        if (parent.closest('[data-context-menu], [data-launchpad], [data-spotlight]')) {
          // 这些浮层可能未打开，跳过
        }
        found.push({ text: text.slice(0, 24), cls: (parent.className || '').toString().slice(0, 50) })
      }
      return found.slice(0, 10)
    })()
  `)
  if (emojiScan.length) {
    for (const item of emojiScan) add('warn', 'emoji 残留', `「${item.text}」出现在 ${item.cls}`)
  }
  else {
    notes.push('emoji 扫描：桌面 UI 里没有 emoji ✓')
  }

  /* ---------- 1.6 macOS 自定义指针 ---------- */
  const cursorCheck = await evaluate(`
    (() => {
      const out = {}
      out.body = getComputedStyle(document.body).cursor
      out.html = getComputedStyle(document.documentElement).cursor
      const a = document.querySelector('a[href]')
      out.link = a ? getComputedStyle(a).cursor : 'no-link'
      const titlebar = document.querySelector('[data-window-titlebar]')
      out.titlebar = titlebar ? getComputedStyle(titlebar).cursor : 'no-window'
      return out
    })()
  `)
  const usesCustom = (v) => typeof v === 'string' && v.includes('/cursors/')
  const cursorOk = usesCustom(cursorCheck.body) && usesCustom(cursorCheck.link)
  if (cursorOk) {
    notes.push('macOS 自定义指针 ✓')
  }
  else {
    add('error', 'macOS 指针', `没有生效：body=${cursorCheck.body.slice(0, 50)} / link=${cursorCheck.link.slice(0, 40)}`)
  }

  /* ---------- 2. 命中测试 ---------- */
  // 开机层如果冒出来会盖住一切，先处理掉
  if (await dismissBoot()) await sleep(500)

  const hitTargets = [
    ['Dock Finder', '[data-dock-item="finder"]'],
    ['Dock 终端', '[data-dock-item="terminal"]'],
    ['菜单栏 🍎', '[data-menubar-logo]'],
    ['菜单栏 控制中心', '[data-menubar-control]'],
    ['菜单栏 时钟', '[data-menubar-clock]'],
    ['文章卡片', 'a[href^="/blog/"]'],
  ]
  // 命中测试：如果被开机层盖住，点掉后重测一次
  let hitResult = await evaluate(`
    (() => {
      const list = ${JSON.stringify(hitTargets)}
      const out = []
      for (const [name, sel] of list) {
        const el = document.querySelector(sel)
        if (!el) { out.push({ name, status: 'missing' }); continue }
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) { out.push({ name, status: 'zero-size' }); continue }
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        const top = document.elementFromPoint(x, y)
        const ok = top === el || el.contains(top) || top?.contains(el)
        out.push({ name, status: ok ? 'ok' : 'covered', by: ok ? '' : (top?.className || top?.tagName || 'unknown').toString().slice(0, 70), boot: Boolean(top?.closest?.('[data-boot-screen]')) })
      }
      return out
    })()
  `)

  if (hitResult.some(item => item.boot)) {
    if (await dismissBoot()) {
      await sleep(600)
      hitResult = await evaluate(`
        (() => {
          const list = ${JSON.stringify(hitTargets)}
          const out = []
          for (const [name, sel] of list) {
            const el = document.querySelector(sel)
            if (!el) { out.push({ name, status: 'missing' }); continue }
            const r = el.getBoundingClientRect()
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            const ok = top === el || el.contains(top) || top?.contains(el)
            out.push({ name, status: ok ? 'ok' : 'covered', by: ok ? '' : (top?.className || top?.tagName || 'unknown').toString().slice(0, 70) })
          }
          return out
        })()
      `)
    }
  }
  for (const item of hitResult) {
    if (item.status === 'ok') continue
    add('error', '命中测试', `${item.name} → ${item.status}${item.by ? `，被「${item.by}」盖住` : ''}`)
  }

  /* ---------- 3. Dock 放大是否真的被裁掉 ---------- */
  /* 注意：图标超出 Dock 底板是 macOS 的正常外观，只有「祖先有 overflow 裁剪」才算 bug */
  const clip = await evaluate(`
    (() => {
      const item = document.querySelector('[data-dock-item="finder"]')
      if (!item) return null
      const r = item.getBoundingClientRect()
      // 找最近的、会裁剪的祖先
      let node = item.parentElement
      let clipper = null
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node)
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { clipper = node; break }
        node = node.parentElement
      }
      return {
        itemTop: Math.round(r.top), itemHeight: Math.round(r.height),
        clipperClass: clipper ? clipper.className.toString().slice(0, 60) : '',
        clipperTop: clipper ? Math.round(clipper.getBoundingClientRect().top) : null,
      }
    })()
  `)
  if (clip) {
    await evaluate(`
      (() => {
        const r = document.querySelector('[data-dock-item="finder"]').getBoundingClientRect()
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
      })()
    `)
    await sleep(1100)
    const grown = await evaluate(`
      (() => {
        const item = document.querySelector('[data-dock-item="finder"]')
        const r = item.getBoundingClientRect()
        let node = item.parentElement
        let clipper = null
        while (node && node !== document.documentElement) {
          const cs = getComputedStyle(node)
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { clipper = node; break }
          node = node.parentElement
        }
        const clipTop = clipper ? clipper.getBoundingClientRect().top : null
        return {
          itemHeight: Math.round(r.height),
          itemTop: Math.round(r.top),
          clipperClass: clipper ? clipper.className.toString().slice(0, 60) : '',
          clippedPx: clipper ? Math.round(Math.max(0, clipTop - r.top)) : 0,
        }
      })()
    `)
    notes.push(`Dock 图标 ${clip.itemHeight}px → 放大 ${grown.itemHeight}px；裁剪祖先：${grown.clipperClass || '（无，正常溢出显示）'}`)
    if (grown.clipperClass && grown.clippedPx > 1) {
      add('warn', 'Dock 裁剪', `放大后的图标被「${grown.clipperClass}」裁掉 ${grown.clippedPx}px`)
    }
  }

  /* ---------- 4. 横向溢出 ---------- */
  const overflowX = await evaluate(`({ doc: document.documentElement.scrollWidth, win: window.innerWidth })`)
  if (overflowX.doc > overflowX.win + 2) {
    const offenders = await evaluate(`
      (() => {
        const vw = window.innerWidth
        const bad = []
        function clippedByAncestor(el) {
          let n = el.parentElement
          while (n && n !== document.body) {
            const cs = getComputedStyle(n)
            if (cs.overflowX !== 'visible') return true
            n = n.parentElement
          }
          return false
        }
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width < 4 || r.height < 4) continue
          if (clippedByAncestor(el)) continue
          if (r.right > vw + 2 || r.left < -2) {
            bad.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 46), right: Math.round(r.right), left: Math.round(r.left) })
          }
        }
        return bad.slice(0, 4)
      })()
    `)
    add('warn', '横向溢出', `文档宽 ${overflowX.doc}px > 视口 ${overflowX.win}px，越界元素：${offenders.map(o => `<${o.tag}.${o.cls}> left=${o.left} right=${o.right}`).join(' ｜ ') || '（未定位到）'}`)
  }
  else {
    notes.push(`无横向溢出（${overflowX.doc} ≤ ${overflowX.win}）`)
  }

  /* ---------- 5. 文本对比度（截图采样） ---------- */
  const samples = await evaluate(`
    (() => {
      // 用 canvas 把任意颜色写法（rgb/oklch/color-mix）归一成 RGB 字节
      const cv = document.createElement('canvas')
      cv.width = cv.height = 1
      const ctx = cv.getContext('2d')
      function toRgba(color) {
        try {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = 'rgba(0,0,0,0)'
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return [d[0], d[1], d[2], d[3] / 255]
        } catch (e) { return null }
      }

      const targets = [
        ['首页卡片标题', '.article-item p:first-child'],
        ['首页卡片摘要', '.article-item p:nth-child(2)'],
        ['首页卡片日期', '.article-item div span'],
        ['统计卡标签', '.stat-card span:first-child'],
        ['统计卡数值', '.stat-card span:nth-child(2)'],
        ['站点概览标题', '.widget-container h3, .widget-container span.text-sm'],
        ['顶部菜单文字', '[data-menubar-clock]'],
        ['菜单栏站名', '[data-menubar-menu="app"]'],
      ]
      const out = []
      for (const [name, sel] of targets) {
        const el = document.querySelector(sel)
        if (!el) { out.push({ name, status: 'missing' }); continue }
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) { out.push({ name, status: 'zero' }); continue }
        const cs = getComputedStyle(el)
        const rgba = toRgba(cs.color)
        if (!rgba) { out.push({ name, status: 'unparsable', color: cs.color }); continue }
        // 背景采样点：元素自身框内的四个角落（padding 区），避开中心笔画
        const inset = 2
        out.push({
          name,
          status: 'ok',
          rgba,
          colorRaw: cs.color,
          fontSize: parseFloat(cs.fontSize),
          probes: [
            [Math.round(r.left + inset), Math.round(r.top + inset)],
            [Math.round(r.right - inset), Math.round(r.top + inset)],
            [Math.round(r.left + inset), Math.round(r.bottom - inset)],
            [Math.round(r.right - inset), Math.round(r.bottom - inset)],
            [Math.round(r.left + inset), Math.round(r.top + r.height / 2)],
          ],
        })
      }
      return out
    })()
  `)

  const img = decodePng(await shot())

  // 菜单栏实际渲染探针
  const menubarProbe = await evaluate(`
    (() => {
      const bar = document.querySelector('[data-topbar]')
      if (!bar) return null
      const cs = getComputedStyle(bar)
      const r = bar.getBoundingClientRect()
      return { bg: cs.backgroundColor, backdrop: cs.backdropFilter, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
    })()
  `)
  if (menubarProbe) {
    const mid = pixelAt(img, Math.round(menubarProbe.rect[0] + menubarProbe.rect[2] / 2), Math.round(menubarProbe.rect[1] + menubarProbe.rect[3] / 2))
    const left = pixelAt(img, menubarProbe.rect[0] + 60, Math.round(menubarProbe.rect[1] + menubarProbe.rect[3] / 2))
    notes.push(`菜单栏 computed background=${menubarProbe.bg} backdrop=${menubarProbe.backdrop}`)
    notes.push(`菜单栏像素采样：中部 rgb(${mid.join(',')})／左部 rgb(${left.join(',')})`)
  }
  for (const s of samples) {
    if (s.status !== 'ok') { add('warn', '对比度', `${s.name} → ${s.status}（${s.colorRaw ?? ''}）`); continue }

    // 文字颜色可能是半透明的，需要先与背景合成
    const [fr, fgc, fb, alpha] = s.rgba
    const ratios = []
    for (const [x, y] of s.probes) {
      const bg = pixelAt(img, x, y)
      const composited = [
        Math.round(fr * alpha + bg[0] * (1 - alpha)),
        Math.round(fgc * alpha + bg[1] * (1 - alpha)),
        Math.round(fb * alpha + bg[2] * (1 - alpha)),
      ]
      ratios.push({ ratio: contrast(composited, bg), bg })
    }
    // 取中位数，避免个别采样点正好压在文字笔画上造成误判
    ratios.sort((a, b) => a.ratio - b.ratio)
    const median = ratios[Math.floor(ratios.length / 2)]
    const threshold = s.fontSize >= 18 ? 3 : 4.5
    if (median.ratio < threshold) {
      add('warn', '对比度', `${s.name} 对比度 ${median.ratio.toFixed(2)}:1（要求 ≥ ${threshold}），文字 rgba(${s.rgba.map(v => Math.round(v * 255)).join(',')}) / 背景 rgb(${median.bg.join(',')})`)
    }
    else {
      notes.push(`${s.name} 对比度 ${median.ratio.toFixed(2)}:1 ✓`)
    }
  }

  /* ---------- 6. 文章页 ---------- */
  await goto('/blog/hello-blog')
  const articleIssues = await evaluate(`
    (() => {
      const out = []
      const win = document.querySelector('[data-mac-window]')
      if (!win) out.push('找不到 mac 窗口')
      const bar = document.querySelector('[data-safari-toolbar]')
      if (!bar) out.push('文章页缺少 Safari 工具栏')
      const prose = document.querySelector('.prose-article')
      if (!prose) out.push('缺少正文容器')
      const link = document.querySelector('a[href^="/blog/"], .prose-article a')
      if (link) {
        const r = link.getBoundingClientRect()
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!(top === link || link.contains(top))) out.push('正文链接被遮挡：' + (top?.className || top?.tagName))
      }
      return out
    })()
  `)
  for (const item of articleIssues) add('warn', '文章页', item)

  /* ---------- 输出 ---------- */
  console.log(`\n===== QA 报告（${WANT_DARK ? '深色' : '浅色'}模式 ${WIN_W}×${WIN_H}，${BASE}）=====\n`)
  if (issues.length === 0) console.log('  ✔ 没有发现问题')
  for (const issue of issues) console.log(`  ${issue.level === 'error' ? '✘' : '⚠'} [${issue.area}] ${issue.message}`)
  console.log('\n--- 观测数据 ---')
  for (const n of notes) console.log(`  · ${n}`)
  console.log(`\n合计：error ${issues.filter(i => i.level === 'error').length} / warn ${issues.filter(i => i.level === 'warn').length}`)
  process.exitCode = issues.some(i => i.level === 'error') ? 1 : 0
}

main()
  .catch((error) => {
    console.error(`✘ QA 运行失败：${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    try { ws?.close() } catch {}
    chrome.kill()
    await sleep(300)
  })
