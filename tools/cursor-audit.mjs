#!/usr/bin/env node
/**
 * 光标巡检：在真实浏览器里逐点报告「鼠标悬停在那里会显示什么光标」。
 *
 * 为什么需要它：自定义光标（macOS 那套 SVG）有两个容易出错的地方，肉眼看截图看不出来：
 *   1. **覆盖盲区** —— 某个元素没被 cursor 规则覆盖，于是该出「手」的地方还是箭头；
 *   2. **热点错位** —— SVG 光标不带 hotspot 时浏览器把热点定在图片左上角 (0,0)，
 *      而图形本身不是从左上角起笔的，于是「看得见的指尖」和「真正的点击点」错开，
 *      手感就是「不灵敏 / 点不准」。
 * 本工具查第 1 类，并顺带守住第 2 类的**回归**：自定义光标只要没写热点坐标就判失败
 * （坐标该怎么量见 scripts/cursor-hotspots.mjs）。
 *
 * 判定用的是**目标元素自己**的 `getComputedStyle(el).cursor`，不是探针点上那个元素的：
 * 用点上元素会把「点在视口外 / 被别的元素盖住 / 该状态下元素本就不存在」误报成光标规则缺失。
 * 覆盖情况只作为提示打印，不参与判定。
 *
 * 用法：
 *   node tools/cursor-audit.mjs                              # 打本地 .output 产物
 *   node tools/cursor-audit.mjs --base http://127.0.0.1:4180
 *   node tools/cursor-audit.mjs --base https://example.github.io --verbose
 */
import { spawn } from 'node:child_process'
import { resolveChromeOrExit } from './chrome-path.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1] }
const BASE = String(arg('base', 'http://127.0.0.1:4180')).replace(/\/$/, '')
const PORT = Number(arg('port', '9471'))
const VERBOSE = argv.includes('--verbose')

const chrome = spawn(resolveChromeOrExit(), ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
let ws, msgId = 0
const pending = new Map()
const send = (method, params = {}) => {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP 超时 ${method}`)) } }, 20000)
  })
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.result?.exceptionDetails) return undefined
  return r.result?.result?.value
}
const sleep = ms => new Promise(s => setTimeout(s, ms))

/** 要巡检的位置：选择器 + 用元素的哪个点去问 + 期望语义
 *  mode='center' 时判「该元素自身的 cursor」；其余 mode 是**点的命中测试**
 *  （图标之间的空隙、顶栏空白、桌面空白 —— 这些问的是「这里会不会冒出不该有的光标」）。 */
const TARGETS = [
  ['Dock 图标中心', '[data-dock-item="finder"]', 'center', 'pointer'],
  ['Dock 图标之间的空隙', '[data-dock-item="finder"]', 'gapRight', 'default'],
  ['Dock 容器背景', '.mac-dock', 'edge', 'default'],
  ['顶栏 🍎', '[data-menubar-logo]', 'center', 'pointer'],
  ['顶栏 控制中心', '[data-menubar-control]', 'center', 'pointer'],
  ['顶栏 时钟', '[data-menubar-clock]', 'center', 'pointer'],
  ['顶栏空白处', '[data-topbar]', 'edge', 'default'],
  ['窗口标题栏（可拖）', '[data-window-titlebar]', 'center', 'default'],
  ['窗口关闭按钮', '[data-mac-close]', 'center', 'pointer'],
  ['窗口右下角（可缩放）', '[data-resize="se"]', 'center', 'resize'],
  ['清空桌面按钮', '[data-desktop-clear]', 'center', 'pointer'],
  ['文章卡片链接', 'a[href^="/blog/"]', 'center', 'pointer'],
  ['正文文字', '.prose-article p', 'center', 'text'],
  ['壁纸（空白桌面）', 'body', 'blank', 'default'],
]

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch { /* 等 */ }
    await sleep(250)
  }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m) }
  })
  await send('Runtime.enable')
  await send('Page.enable')

  // 先开一篇文章页（正文/链接/标题栏都在），桌面层仍然渲染在上层
  await send('Page.navigate', { url: `${BASE}/blog/nuxt4-content-blog/` })
  await sleep(3500)

  // 开机层会盖住一切，点掉它
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`Boolean(document.querySelector('[data-login-enter]'))`)) {
      await evaluate(`document.querySelector('[data-login-enter]').click()`)
      await sleep(800)
      break
    }
    await sleep(300)
  }

  // 打开一个桌面窗口，好让标题栏/交通灯/缩放手柄存在
  await evaluate(`document.querySelector('[data-dock-item="finder"]')?.click()`)
  await sleep(1200)

  const result = await evaluate(`
    (() => {
      const targets = ${JSON.stringify(TARGETS.map(t => [t[0], t[1], t[2]]))}
      const describe = (el) => {
        if (!el) return 'null'
        const cls = typeof el.className === 'string' ? el.className : (el.getAttribute?.('class') || '')
        return el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).slice(0, 2).join('.') : '')
      }
      const out = []
      for (const [name, sel, mode] of targets) {
        const el = document.querySelector(sel)
        if (!el) { out.push({ name, sel, missing: true }); continue }
        const r = el.getBoundingClientRect()
        let x, y
        if (mode === 'center') { x = r.left + r.width / 2; y = r.top + r.height / 2 }
        else if (mode === 'gapRight') { x = r.right + 6; y = r.top + r.height / 2 }
        // edge：取「底部内边距带」的中点。不要用 (left+2, top+2) —— Dock 的圆角有 1.2rem，
        // 左上角那个点根本不在 Dock 形状里，elementFromPoint 会穿透到底下的窗口去（实测命中文章里的 span.line）。
        else if (mode === 'edge') { x = r.left + r.width / 2; y = r.bottom - 3 }
        else { x = innerWidth - 60; y = innerHeight / 2 }   // blank：右侧空白壁纸
        const inView = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight
        const hit = inView ? document.elementFromPoint(x, y) : null
        // 判定用的是**目标元素自己**的 cursor（继承/层叠都算进去），不是点上那个元素的：
        // 用点上元素会让「点在视口外」「被别的元素盖住」这类探针问题被误报成光标规则缺失。
        out.push({
          name, sel, x: Math.round(x), y: Math.round(y),
          own: getComputedStyle(el).cursor,
          hitCursor: hit ? getComputedStyle(hit).cursor : '',
          inView,
          hit: describe(hit),
          covered: Boolean(hit) && hit !== el && !el.contains(hit) && !hit.contains(el),
        })
      }
      return out
    })()
  `)

  console.log(`光标巡检：${BASE}`)
  console.log('')
  const rows = []
  for (let i = 0; i < TARGETS.length; i++) {
    const expect = TARGETS[i][3]
    const r = result?.[i] || { name: TARGETS[i][0], missing: true }
    if (r.missing) { rows.push({ ...r, skip: true, note: `页面上没有 ${r.sel}（该状态下本就不存在，跳过）` }); continue }
    if (!r.inView) { rows.push({ ...r, skip: true, note: '探针点不在视口内，跳过判定' }); continue }
    // 点命中类目标判「点上那个元素」的光标，其余判目标元素自身
    const pointMode = TARGETS[i][2] !== 'center'
    const cursor = String((pointMode ? r.hitCursor : r.own) || '')
    // 自定义光标：'url("...svg") 3 2, pointer' —— 取最后那个关键字判断语义
    const kw = cursor.split(',').pop().trim()
    const isCustom = cursor.includes('url(')
    let ok
    if (expect === 'default') ok = kw === 'auto' || kw === 'default'
    else if (expect === 'resize') ok = /resize/.test(kw)
    else ok = kw === expect
    // 自定义光标必须带热点坐标，否则浏览器按 (0,0) 取锚点 → 指尖和触发点错开（手感「不灵敏」）
    const hotspot = /url\([^)]*\)\s+(-?\d+)\s+(-?\d+)/.exec(cursor)
    const note = (!pointMode && r.covered) ? `该点被 ${r.hit} 覆盖（只影响命中测试，不影响规则判定）` : ''
    if (ok && isCustom && !hotspot) {
      rows.push({ ...r, kw, isCustom, expect, ok: false, note: '自定义光标没写热点坐标 → 浏览器按 (0,0) 取锚点，指尖会偏' })
      continue
    }
    rows.push({ ...r, kw, isCustom, expect, ok, hotspot: hotspot ? `${hotspot[1]} ${hotspot[2]}` : '', note, byPoint: pointMode })
  }

  for (const r of rows) {
    const mark = r.skip ? '·' : (r.ok ? '✔' : '✘')
    const scope = r.byPoint ? '点上' : '元素'
    console.log(`  ${mark} ${String(r.name).padEnd(22)} ${String(r.kw || '-').padEnd(12)} ${r.isCustom ? `[自定义光标 热点 ${r.hotspot || '缺失'}]` : '[系统默认]'}  ${r.skip ? '' : `判${scope} `}命中 ${r.hit}`)
    if (!r.ok && !r.skip) console.log(`      期望 ${r.expect}${r.note ? ' — ' + r.note : ''}`)
    else if (r.skip || r.note) console.log(`      ${r.note}`)
  }
  const bad = rows.filter(r => !r.ok && !r.skip)
  const skipped = rows.filter(r => r.skip).length
  console.log('')
  console.log(bad.length
    ? `✘ ${bad.length} / ${rows.length} 处不符合预期${skipped ? `（另有 ${skipped} 处跳过）` : ''}`
    : `✔ ${rows.length - skipped} 处全部符合预期${skipped ? `（另有 ${skipped} 处跳过）` : ''}`)

  if (VERBOSE) {
    console.log('\n完整光标值：')
    for (const r of rows) console.log(`  ${String(r.name).padEnd(22)} ${r.own || '-'}`)
  }
  process.exitCode = bad.length ? 1 : 0
} finally {
  try { ws?.close() } catch { /* 忽略 */ }
  chrome.kill()
  await sleep(300)
}
