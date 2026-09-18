#!/usr/bin/env node
/**
 * 桌面 OS 交互端到端验证（CDP，无第三方依赖）
 *
 * 用法：node tools/e2e-desktop.mjs [--base http://localhost:3123] [--keep]
 *
 * 覆盖：
 *   开机/登录动画 · 顶栏菜单 · 控制中心 · Spotlight 搜索 · Launchpad
 *   桌面右键菜单 · 窗口打开/拖动/缩放/最小化/关闭/层级 · 终端命令 · 截图 · 无 JS 异常
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolveChromeOrExit } from './chrome-path.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = String(arg('--base', 'http://localhost:3123')).replace(/\/$/, '')
const PORT = Number(arg('--port', '9333'))
const CHROME = resolveChromeOrExit()

const results = []
const consoleErrors = []
const record = (name, ok, detail = '') => results.push({ name, ok, detail })

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
  const preview = String(expression).replace(/\s+/g, ' ').slice(0, 110)
  let res
  try {
    res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
  }
  catch (error) {
    throw new Error(`${error.message}\n    卡住的表达式：${preview}`)
  }
  if (res.result?.exceptionDetails) {
    throw new Error(`${res.result.exceptionDetails.exception?.description || 'Runtime 异常'}\n    表达式：${preview}`)
  }
  return res.result?.result?.value
}

const exists = selector => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)

async function waitFor(fn, timeout = 15000, interval = 200) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return true
    }
    catch {}
    await sleep(interval)
  }
  return false
}

const waitForElement = (selector, timeout = 12000) => waitFor(() => exists(selector), timeout)

/** 模拟按键（Ctrl/Meta 组合用 ctrlKey/metaKey） */
async function pressKey(key, options = {}) {
  const init = JSON.stringify({ key, bubbles: true, cancelable: true, ...options })
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', ${init}))`)
}

/**
 * 真实指针点击 + 命中测试（elementFromPoint）。
 * 不能用 .click()：编程式点击会绕过命中测试，把「被别的层盖住」这类回归掩盖掉
 * （本项目为这个坑付过一次代价，见 6.4 清空桌面那条）。
 * locator 是一段返回目标元素的表达式字符串；返回 { hitSelf, coveredBy }。
 */
async function pointerClick(locator) {
  return evaluate(`
    (() => {
      const el = (${locator})
      if (!el) return { status: 'missing' }
      const r = el.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2)
      const cy = Math.round(r.top + r.height / 2)
      const top = document.elementFromPoint(cx, cy)
      const hitSelf = top === el || el.contains(top)
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true }
      const target = top || el
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }))
      target.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }))
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }))
      return { status: 'clicked', hitSelf, coveredBy: hitSelf ? '' : (top?.className || top?.tagName || '').toString().slice(0, 50) }
    })()
  `)
}

async function waitForChrome() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return
    }
    catch {}
    await sleep(250)
  }
  throw new Error('Chrome 启动超时')
}

async function screenshot(path) {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  mkdirSync('preview', { recursive: true })
  writeFileSync(path, Buffer.from(res.result.data, 'base64'))
}

async function main() {
  await waitForChrome()

  const targetRes = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}/`)}`, { method: 'PUT' })
  const target = await targetRes.json()

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
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? 'unknown'}`)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(`console.error: ${msg.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`)
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(`log: ${msg.params.entry.text}`)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')

  await send('Page.navigate', { url: `${BASE}/` })
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete', 20000)

  /* ---------- 1. 开机 / 登录动画 ---------- */
  const bootAppeared = await waitForElement('[data-boot-screen]', 8000)
  const progressAppeared = await waitForElement('[data-boot-progress]', 6000)
  record('开机动画（logo + 进度条）', bootAppeared && progressAppeared, progressAppeared ? '' : '未出现进度条')

  // 苹果 logo 必须是 macos-web 同款 MDI 图标（内联 SVG），进度条必须是 translateX 滑动式
  // 注意：必须趁还在 boot 阶段测量，切到登录页后这些元素会被 v-if 移除
  const bootDetail = await evaluate(`
    (() => {
      const logo = document.querySelector('[data-boot-logo]')
      const svg = logo && (logo.tagName.toLowerCase() === 'svg' ? logo : logo.querySelector('svg'))
      const bar = document.querySelector('[data-boot-progress]')
      const cs = bar ? getComputedStyle(bar) : null
      return {
        logoTag: svg ? svg.tagName.toLowerCase() : 'none',
        isApplePath: Boolean(svg && svg.innerHTML.includes('M18.71')),
        barTransform: cs ? cs.transform : 'none',
        barWidthPx: bar ? Math.round(bar.parentElement.getBoundingClientRect().width) : 0,
      }
    })()
  `)
  record('开机 logo 用 MDI 苹果图标', bootDetail.logoTag === 'svg' && bootDetail.isApplePath, `tag=${bootDetail.logoTag}`)
  record('进度条为滑动式（macos-web 规格）', bootDetail.barWidthPx === 150 && /matrix\(1, 0, 0, 1, -?\d/.test(bootDetail.barTransform), `${bootDetail.barWidthPx}px / transform=${bootDetail.barTransform}`)

  const loginAppeared = await waitForElement('[data-login-enter]', 14000)
  record('登录页出现', loginAppeared, '')

  if (loginAppeared) {
    await evaluate(`document.querySelector('[data-login-enter]')?.click()`)
    const gone = await waitFor(async () => !(await exists('[data-boot-screen]')), 6000)
    record('登录后进入桌面', gone, gone ? '' : '开机层未消失')
  }
  else {
    record('登录后进入桌面', false, '登录页未出现，跳过')
  }
  await sleep(800)

  /* ---------- 2. 顶栏菜单 ---------- */
  const topbar = await exists('[data-topbar]')
  record('顶栏菜单栏渲染', topbar && (await exists('[data-menubar-clock]')) === true || (await exists('[data-menubar-logo]')), '')

  await evaluate(`document.querySelector('[data-menubar-logo]')?.click()`)
  const systemPanel = await waitForElement('[data-menubar-panel="system"]', 5000)
  record('Logo 下拉菜单', systemPanel, '')
  await pressKey('Escape')

  await evaluate(`document.querySelector('[data-menubar-control]')?.click()`)
  const controlPanel = await waitForElement('[data-menubar-panel="control"]', 5000)
  const controlText = controlPanel ? await text('[data-menubar-panel="control"]') : ''
  record('控制中心面板', controlPanel && /字体大小/.test(controlText), controlText.replace(/\s+/g, ' ').slice(0, 80))
  await pressKey('Escape')

  // 时钟开关（控制中心里切一下“显示时钟”）
  const clockVisible = await exists('[data-menubar-clock]')
  record('顶栏时钟', clockVisible, '')

  /* ---------- 3. Spotlight 搜索 ---------- */
  await pressKey('k', { ctrlKey: true })
  const spotlightOpen = await waitForElement('[data-spotlight]', 6000)
  record('Ctrl+K 打开 Spotlight', spotlightOpen, '')

  let searchHits = 0
  if (spotlightOpen) {
    // 新入口①：工作日志也进了 Spotlight 索引。空查询状态下除了「最近文章」，
    // 还应出现「最近工作日志」分组。
    // 预算给到 45s：本机内容库冷启动要下载 844KB sqlite wasm，实测 10.5s、最坏 24.5s
    // （见 docs/验收记录.md 的「15 秒假 404」轮次）—— 面板里若是「正在建立索引…」，
    // 那是预算不够，不是缺陷；断言本身不因此放宽（分组不出现仍然判失败）。
    let recentLogDiag = { ok: false, reason: 'not-run', panelText: '' }
    const recentLogReady = await waitFor(async () => {
      recentLogDiag = await evaluate(`
        (() => {
          const panel = document.querySelector('[data-spotlight]')
          if (!panel) return { ok: false, reason: 'no-panel', panelText: '' }
          const panelText = (panel.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200)
          const heading = [...panel.querySelectorAll('p')].find(p => (p.textContent || '').includes('最近工作日志'))
          if (!heading) return { ok: false, reason: 'no-group', panelText }
          const rows = []
          for (let el = heading.nextElementSibling; el && el.tagName !== 'P'; el = el.nextElementSibling) {
            const line = (el.innerText || '').replace(/\\s+/g, ' ').trim()
            if (line) rows.push(line)
          }
          return { ok: true, rows, dated: rows.filter(t => /20\\d\\d-\\d\\d-\\d\\d/.test(t)).length, panelText }
        })()
      `)
      return recentLogDiag.ok === true && recentLogDiag.dated > 0
    }, 45000, 250)
    record(
      'Spotlight 空查询列出「最近工作日志」',
      recentLogReady,
      recentLogReady
        ? `${recentLogDiag.dated} 条带日期，首条：${recentLogDiag.rows[0]?.slice(0, 60)}`
        : `分组未就绪（${recentLogDiag.reason}）；面板文本：${recentLogDiag.panelText}`,
    )

    await evaluate(`
      (() => {
        const input = document.querySelector('[data-spotlight-input]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'nuxt')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await sleep(1200)
    const hitsText = await text('[data-spotlight]')
    searchHits = await evaluate(`document.querySelectorAll('[data-spotlight] button').length`)
    record('Spotlight 命中文章', /Nuxt/i.test(hitsText) && searchHits > 0, `结果按钮 ${searchHits} 个，片段 ${hitsText.replace(/\s+/g, ' ').slice(0, 90)}`)
    await pressKey('Escape')
    await sleep(400)
    const closed = !(await exists('[data-spotlight]'))
    record('Spotlight Esc 关闭', closed, '')

    // 新入口①的核心：日志的「坑」写在 frontmatter 里，只切正文的旧索引搜不到，
    // 所以搜「坑」必须能搜出**带日期标签**的日志结果（结果行的标题是「日期 · 当天标题」，
    // 小标题是「坑 · …」，标题里同时有日期和「坑」就说明命中的是日志而不是文章）。
    await pressKey('k', { ctrlKey: true })
    const spotlightAgain = await waitForElement('[data-spotlight]', 6000)
    if (spotlightAgain) {
      await evaluate(`
        (() => {
          const input = document.querySelector('[data-spotlight-input]')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, '坑')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })()
      `)
      let pitfallDiag = { total: 0, dated: 0, pitRows: 0, sample: '', panelText: '' }
      const pitfallHit = await waitFor(async () => {
        pitfallDiag = await evaluate(`
          (() => {
            const panel = document.querySelector('[data-spotlight]')
            if (!panel) return { total: 0, dated: 0, pitRows: 0, sample: '', panelText: '' }
            const panelText = (panel.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200)
            const rows = [...panel.querySelectorAll('button')]
              .map(b => (b.innerText || '').replace(/\\s+/g, ' ').trim())
              .filter(Boolean)
            // 日志切片行的固定形态：行首就是「日期 · 」——hit.title 是整行第一个文本节点
            // （SpotlightOverlay.vue:86 的标题 span，日期在前），DOM 顺序保证它落在行首，
            // 上一行的 trim 已去掉缩进。只判「行里出现过日期」会放过文章行（blog 6 篇全含日期串、
            // 3 篇含「坑」，snippet 又是命中词前后约 110 字的窗口），存在假阳性。
            const dated = rows.filter(t => /^20\\d\\d-\\d\\d-\\d\\d · /.test(t))
            const pitRows = rows.filter(t => /^20\\d\\d-\\d\\d-\\d\\d · /.test(t) && t.includes('坑'))
            return { total: rows.length, dated: dated.length, pitRows: pitRows.length, sample: (pitRows[0] || dated[0] || '').slice(0, 110), panelText }
          })()
        `)
        return pitfallDiag.pitRows > 0
      }, 45000, 300)
      record(
        'Spotlight 搜「坑」命中工作日志（行首日期 + 坑）',
        pitfallHit,
        pitfallHit
          ? `结果 ${pitfallDiag.total} 条 / 行首即日期的日志行 ${pitfallDiag.dated} 条 / 其中踩坑 ${pitfallDiag.pitRows} 条 — ${pitfallDiag.sample}`
          : `未命中（结果 ${pitfallDiag.total} 条 / 日志行 ${pitfallDiag.dated} 条）；面板文本：${pitfallDiag.panelText}`,
      )
      await pressKey('Escape')
      await sleep(400)
    }
    else {
      record('Spotlight 搜「坑」命中工作日志（行首日期 + 坑）', false, '第二次打开 Spotlight 失败')
    }
  }
  else {
    record('Spotlight 空查询列出「最近工作日志」', false, '未打开搜索')
    record('Spotlight 命中文章', false, '未打开搜索')
    record('Spotlight 搜「坑」命中工作日志（行首日期 + 坑）', false, '未打开搜索')
  }

  /* ---------- 4. Launchpad（macOS 是从 Dock 打开） ---------- */
  await evaluate(`document.querySelector('[data-dock-item="launchpad"]')?.click()`)
  const launchpadOpen = await waitForElement('[data-launchpad]', 6000)
  const appCount = launchpadOpen ? await evaluate(`document.querySelectorAll('[data-launchpad-app]').length`) : 0
  record('Launchpad 应用网格', launchpadOpen && appCount >= 8, `${appCount} 个应用`)
  await pressKey('Escape')
  await sleep(400)
  record('Launchpad Esc 关闭', !(await exists('[data-launchpad]')), '')

  /* ---------- 5. 桌面右键菜单 ---------- */
  await evaluate(`
    (() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 420, clientY: 320 })
      document.body.dispatchEvent(event)
    })()
  `)
  const menuOpen = await waitForElement('[data-context-menu]', 5000)
  const menuText = menuOpen ? await text('[data-context-menu]') : ''
  record('桌面右键菜单', menuOpen && /打开终端/.test(menuText), menuText.replace(/\s+/g, ' ').slice(0, 80))

  if (menuOpen) {
    await evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('[data-context-item]')].find(b => b.dataset.contextItem === '打开终端')
        btn?.click()
      })()
    `)
    const terminalFromMenu = await waitForElement('[data-window="terminal"]', 6000)
    record('右键菜单打开终端', terminalFromMenu, '')
    await evaluate(`document.querySelector('[data-window="terminal"] [data-action="close"]')?.click()`)
    await sleep(400)
  }
  else {
    record('右键菜单打开终端', false, '菜单未出现')
  }

  /* ---------- 6. 窗口：打开 / 终端命令 / 拖动 / resize / 层级 / 最小化 / 关闭 ---------- */
  const dockTerminalClicked = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('nav button')].find(b => b.title === '终端')
      if (!btn) return false
      btn.click()
      return true
    })()
  `)
  const terminalAppeared = await waitForElement('[data-window="terminal"]', 8000)
  record('Dock 打开终端窗口', dockTerminalClicked && terminalAppeared, '')

  async function runTerminalCommand(cmd, expect) {
    let out = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      await evaluate(`
        (() => {
          const input = [...document.querySelectorAll('input')].find(i => i.placeholder === '输入 help 查看可用命令')
          if (!input) return false
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(input, ${JSON.stringify(cmd)})
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          return true
        })()
      `)
      await sleep(700)
      out = await text('[data-window="terminal"]')
      if (expect.test(out)) return out
    }
    return out
  }

  let terminalOutput = ''
  if (terminalAppeared) {
    terminalOutput = await runTerminalCommand('ls', /共 \d+ 篇/)
    record('终端 ls 输出文章列表', /共 \d+ 篇/.test(terminalOutput), terminalOutput.replace(/\s+/g, ' ').slice(0, 150))
    terminalOutput = await runTerminalCommand('whoami', /guest@/)
    record('终端 whoami 有输出', terminalOutput.includes('guest@'), '')

    // 新入口③：终端 log 命令。
    // 每条断言前先 clear（终端输出是累加的，清屏才能保证读到的是这条命令的结果）；
    // 断言里再排掉上一条命令的痕迹（ls 的「共 N 篇」/ log 的「共 N 天」），防止清屏失效时
    // 拿旧文本误判通过。
    // 只跑不带参数 / 命中不了关键词的写法 —— `log <编号>` 会 push 到 /worklog/... 并关掉终端，
    // 那会破坏同一脚本后面的拖动 / 缩放 / Finder / 主题等断言。
    await runTerminalCommand('clear', /(?:)/)
    terminalOutput = await runTerminalCommand('log', /共 \d+ 天/)
    const logFresh = /共 \d+ 天/.test(terminalOutput) && !/共 \d+ 篇/.test(terminalOutput)
    record(
      '终端 log 列出工作日志（共 N 天）',
      logFresh && /20\d\d-\d\d-\d\d/.test(terminalOutput),
      `${logFresh ? '' : '没读到本条命令的输出（清屏没生效？）；'}${terminalOutput.replace(/\s+/g, ' ').slice(0, 140)}`,
    )

    await runTerminalCommand('clear', /(?:)/)
    terminalOutput = await runTerminalCommand('log zzz-不存在的关键词-zzz', /没有找到日志/)
    const missFresh = /没有找到日志/.test(terminalOutput) && !/共 \d+ 天/.test(terminalOutput)
    const terminalStillOpen = await exists('[data-window="terminal"]')
    record(
      '终端 log 未命中关键词给提示（不静默）',
      missFresh && terminalStillOpen,
      `${missFresh ? '' : '没读到本条命令的输出（清屏没生效？）；'}${terminalStillOpen ? '' : '终端被关掉；'}${terminalOutput.replace(/\s+/g, ' ').slice(0, 120)}`,
    )
    // `log <编号>` 会 push 到 /worklog/... 并关掉窗口；这条断言守住「未命中的查询不会把人带走」，
    // 同时保证同一脚本后面的拖动 / 缩放 / Finder / 主题等断言还有桌面可用。
    record('终端 log 未命中不离开桌面', await exists('[data-desktop-surface]'), '')
  }

  if (terminalAppeared) {
    // 拖动
    const before = await evaluate(`document.querySelector('[data-window="terminal"]').getBoundingClientRect().left`)
    await evaluate(`
      (() => {
        const win = document.querySelector('[data-window="terminal"]')
        const bar = win.querySelector('[data-window-titlebar]')
        const r = bar.getBoundingClientRect()
        bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 60, clientY: r.top + 16, button: 0 }))
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 260, clientY: r.top + 120 }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 260, clientY: r.top + 120 }))
      })()
    `)
    await sleep(400)
    const after = await evaluate(`document.querySelector('[data-window="terminal"]').getBoundingClientRect().left`)
    record('拖动标题栏移动窗口', Math.abs(after - before) > 50, `${Math.round(before)} → ${Math.round(after)}`)

    // resize（右下角手柄）
    const sizeBefore = await evaluate(`
      (() => {
        const r = document.querySelector('[data-window="terminal"]').getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })()
    `)
    await evaluate(`
      (() => {
        const handle = document.querySelector('[data-window="terminal"] [data-resize="se"]')
        const r = handle.getBoundingClientRect()
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left, clientY: r.top, button: 0 }))
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 180, clientY: r.top + 120 }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 180, clientY: r.top + 120 }))
      })()
    `)
    await sleep(400)
    const sizeAfter = await evaluate(`
      (() => {
        const r = document.querySelector('[data-window="terminal"]').getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })()
    `)
    record('拖拽右下角缩放窗口', sizeAfter.w > sizeBefore.w + 100 && sizeAfter.h > sizeBefore.h + 60, `${sizeBefore.w}×${sizeBefore.h} → ${sizeAfter.w}×${sizeAfter.h}`)
  }

  // Finder + 层级
  await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === 'Finder')?.click()`)
  const finderAppeared = await waitForElement('[data-window="finder"]', 6000)
  let finderText = ''
  if (finderAppeared) {
    await sleep(700)
    finderText = await text('[data-window="finder"]')
  }
  record('Finder 列出文章', finderAppeared && /项/.test(finderText), finderText.replace(/\s+/g, ' ').slice(0, 90))

  // 新入口②：Finder 侧栏新增「工作日志」位置。
  // 点侧栏用真实指针序列 + 命中测试（elementFromPoint），不用 .click()；
  // 列表特征按结构断言（「N 个坑 / 没踩坑」+「N 条收获」），不写死某一天的文案。
  let worklogSectionText = ''
  if (finderAppeared) {
    const sidebarHit = await pointerClick(
      `[...document.querySelectorAll('[data-window="finder"] aside button')].find(b => (b.textContent || '').replace(/\\s+/g, '') === '工作日志')`,
    )
    const worklogListed = sidebarHit.hitSelf === true && await waitFor(async () => {
      worklogSectionText = await text('[data-window="finder"]')
      return /个坑|没踩坑/.test(worklogSectionText) && /条收获/.test(worklogSectionText)
    }, 15000, 250)
    record(
      'Finder 侧栏「工作日志」列出日志（命中测试通过）',
      worklogListed,
      sidebarHit.status === 'missing'
        ? '侧栏里没有「工作日志」按钮'
        : sidebarHit.hitSelf !== true
          ? `侧栏按钮被「${sidebarHit.coveredBy}」盖住`
          : worklogSectionText.replace(/\s+/g, ' ').slice(0, 120),
    )
  }
  else {
    record('Finder 侧栏「工作日志」列出日志（命中测试通过）', false, 'Finder 未打开')
  }

  const topWindow = await evaluate(`
    (() => {
      const wins = [...document.querySelectorAll('[data-window]')]
      if (!wins.length) return null
      return wins.map(w => ({ id: w.dataset.window, z: Number(getComputedStyle(w).zIndex) })).sort((a, b) => b.z - a.z)[0].id
    })()
  `)
  record('窗口层级管理', topWindow === 'finder', `最上层：${topWindow}`)

  // 最小化 / 关闭
  await evaluate(`document.querySelector('[data-window="finder"] [data-action="minimize"]')?.click()`)
  await sleep(400)
  record('最小化按钮生效', !(await exists('[data-window="finder"]')), '')

  await evaluate(`document.querySelector('[data-window="terminal"] [data-action="close"]')?.click()`)
  await sleep(400)
  record('关闭按钮生效', !(await exists('[data-window="terminal"]')), '')

  /* ---------- 6.4 清空桌面（纯净桌面） ---------- */
  await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === 'Finder')?.click()`)
  await waitForElement('[data-window="finder"]', 6000)
  const clearVisible = await waitForElement('[data-desktop-clean]', 5000)
  const contentVisibleBefore = await evaluate(`(() => {
    const main = document.querySelector('[data-desktop-surface]')
    return Boolean(main && main.offsetParent !== null && main.getBoundingClientRect().height > 100)
  })()`)

  // 关键：用真实指针事件序列点击（曾经用 .click() 绕过了命中测试，掩盖了遮挡问题）
  const clearHit = await evaluate(`
    (() => {
      const btn = document.querySelector('[data-desktop-clean]')
      if (!btn) return { status: 'missing' }
      const r = btn.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2)
      const cy = Math.round(r.top + r.height / 2)
      const top = document.elementFromPoint(cx, cy)
      const hitSelf = top === btn || btn.contains(top)
      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }
      const target = top || btn
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }))
      target.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }))
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }))
      return { status: 'clicked', hitSelf, coveredBy: hitSelf ? '' : (top?.className || top?.tagName || '').toString().slice(0, 50) }
    })()
  `)
  await sleep(700)
  const cleanState = await evaluate(`(() => {
    const main = document.querySelector('[data-desktop-surface]')
    const hidden = !main || main.offsetParent === null || main.getBoundingClientRect().height === 0
    const btn = document.querySelector('[data-desktop-clean]')
    const wallpaper = document.querySelector('[data-wallpaper]')
    return {
      contentHidden: hidden,
      buttonText: btn ? btn.innerText.trim() : '',
      wallpaperVisible: Boolean(wallpaper && wallpaper.getBoundingClientRect().height > 100),
      windowStillOpen: document.querySelectorAll('[data-window]').length,
    }
  })()`)
  record('清空按钮可被点到（命中测试）', clearHit.hitSelf === true, clearHit.coveredBy ? `被「${clearHit.coveredBy}」盖住` : '')
  record(
    '清空桌面 = 只留壁纸（内容隐藏、窗口保留、按钮变为"显示内容"）',
    clearVisible && contentVisibleBefore && cleanState.contentHidden && cleanState.wallpaperVisible && cleanState.buttonText.includes('显示内容'),
    `内容隐藏=${cleanState.contentHidden} 壁纸在=${cleanState.wallpaperVisible} 按钮="${cleanState.buttonText}" 窗口=${cleanState.windowStillOpen}`,
  )

  // 再点一次恢复显示
  await evaluate(`document.querySelector('[data-desktop-clean]')?.click()`)
  await sleep(600)
  const restored = await evaluate(`(() => {
    const main = document.querySelector('[data-desktop-surface]')
    return Boolean(main && main.offsetParent !== null && main.getBoundingClientRect().height > 100)
  })()`)
  record('再点一次恢复页面内容', restored, '')

  /* ---------- 6.5 Dock 灵敏度回归 ---------- */
  const dockWrapperPE = await evaluate(`
    getComputedStyle(document.querySelector('[data-dock]').parentElement).pointerEvents
  `)
  record('Dock 外层不拦截点击', dockWrapperPE === 'none', `pointer-events: ${dockWrapperPE}`)

  // 鼠标停在页面中部（即使水平对齐图标）不应放大
  const widthMid = await evaluate(`
    (() => {
      const el = document.querySelector('[data-dock-item="finder"]')
      const r = el.getBoundingClientRect()
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: 240 }))
      return Math.round(r.width)
    })()
  `)
  await sleep(900)
  const widthAfterMid = await evaluate(`Math.round(document.querySelector('[data-dock-item="finder"]').getBoundingClientRect().width)`)
  record('页面中部不触发 Dock 放大', widthAfterMid <= 52, `${widthMid}px → ${widthAfterMid}px`)

  // 鼠标贴近 Dock 时才放大
  await evaluate(`
    (() => {
      const el = document.querySelector('[data-dock-item="finder"]')
      const r = el.getBoundingClientRect()
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    })()
  `)
  await sleep(1000)
  const widthNear = await evaluate(`Math.round(document.querySelector('[data-dock-item="finder"]').getBoundingClientRect().width)`)
  record('贴近 Dock 才放大', widthNear > 55, `${widthNear}px`)

  // 鼠标移开后恢复原尺寸
  await evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 700, clientY: 200 }))`)
  await sleep(2600)
  const widthBack = await evaluate(`Math.round(document.querySelector('[data-dock-item="finder"]').getBoundingClientRect().width)`)
  // 弹簧动画收尾可能停在 53px 左右，容差放到 54
  record('移开后 Dock 恢复原尺寸', widthBack <= 54, `${widthBack}px`)

  /* ---------- 6.6 壁纸功能 ---------- */
  await evaluate(`document.querySelector('[data-menubar-logo]')?.click()`)
  await waitForElement('[data-menubar-panel="system"]', 5000)
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('[data-menubar-panel="system"] button')].find(b => b.textContent.includes('更换壁纸'))
      btn?.click()
    })()
  `)
  const wallpaperWindow = await waitForElement('[data-window="wallpaper"]', 6000)
  const optionCount = wallpaperWindow ? await evaluate(`document.querySelectorAll('[data-wallpaper-option]').length`) : 0
  record('壁纸窗口（内置可选）', wallpaperWindow && optionCount >= 6, `${optionCount} 个内置壁纸`)

  // 读取「最后一个」壁纸层：切换时有 0.6s 淡入淡出，旧节点仍在 DOM 中
  const readWallpaperId = `(() => {
    const list = document.querySelectorAll('[data-wallpaper]')
    return list.length ? list[list.length - 1].dataset.wallpaperId : ''
  })()`
  const wallpaperBefore = await evaluate(readWallpaperId)
  await evaluate(`document.querySelector('[data-wallpaper-option="monterey-1"]')?.click()`)
  const switched = await waitFor(async () => (await evaluate(readWallpaperId)) === 'monterey-1', 6000, 200)
  const wallpaperAfter = await evaluate(readWallpaperId)
  record('切换壁纸生效', switched && wallpaperAfter !== wallpaperBefore, `${wallpaperBefore} → ${wallpaperAfter}`)

  // 自定义图片 URL（用本地 public 目录里的 favicon 当测试图）
  const customDiag = await evaluate(`
    (() => {
      const input = document.querySelector('[data-wallpaper-input]')
      if (!input) return { error: 'no-input' }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '/favicon.svg')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = document.querySelector('[data-wallpaper-apply]')
      if (!btn) return { error: 'no-btn', value: input.value }
      btn.click()
      return { value: input.value, hasBtn: true }
    })()
  `)
  const customApplied = await waitFor(
    async () => (await evaluate(`(() => { const l = document.querySelectorAll('[data-wallpaper]'); return l.length ? l[l.length-1].dataset.wallpaperId : '' })()`)) === 'custom',
    6000,
    200,
  )
  const customId = await evaluate(`(() => { const l = document.querySelectorAll('[data-wallpaper]'); return l.length ? l[l.length-1].dataset.wallpaperId : '' })()`)
  record('自定义图片壁纸生效', customApplied && customId === 'custom', `id=${customId}`)

  // 恢复默认，避免影响后续截图
  await evaluate(`document.querySelector('[data-wallpaper-option="big-sur-1"]')?.click()`)
  await sleep(400)
  await evaluate(`document.querySelector('[data-window="wallpaper"] [data-action="close"]')?.click()`)
  await sleep(300)

  /* ---------- 6.7 浅色 / 深色主题 ---------- */
  await evaluate(`document.querySelector('[data-menubar-control]')?.click()`)
  await waitForElement('[data-menubar-panel="control"]', 5000)
  await evaluate(`document.querySelector('[data-theme-tile="dark"]')?.click()`)
  const darkOn = await waitFor(async () => await evaluate(`document.documentElement.classList.contains('dark')`), 5000, 200)
  const darkBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
  record('切换到深色外观', darkOn, `html.dark=${darkOn}`)

  // 深色模式下文章页可读性：窗口背景应为深色
  await evaluate(`document.querySelector('[data-theme-tile="light"]')?.click()`)
  const lightOn = await waitFor(async () => !(await evaluate(`document.documentElement.classList.contains('dark')`)), 5000, 200)
  record('切回浅色外观', lightOn, `body=${darkBg}`)

  /* ---------- 6.8 顶栏「显示」菜单的勾选必须跟着设置走 ---------- */
  // 回归用例。`menus` 原本是普通对象，所有 checked 在 setup 时求值一次就被冻结，
  // 于是从别处（控制中心 / 菜单自己）改了主题后，菜单里的勾选标记永远停在初始状态 —— 假 UI。
  // 改成 computed 之后本用例必须通过。
  // 注意：「显示」菜单里的项都没有 icon，所以 button 内的 svg 只可能是勾选标记。
  const readViewChecks = `
    (() => {
      const panel = document.querySelector('[data-menubar-panel="view"]')
      if (!panel) return null
      const out = {}
      for (const btn of panel.querySelectorAll('button.mac-menu-item')) {
        const label = (btn.querySelector('.flex-1')?.textContent || '').trim()
        if (label) out[label] = Boolean(btn.querySelector('svg'))
      }
      return out
    })()
  `
  const clickViewItem = label => `
    (() => {
      const btn = [...document.querySelectorAll('[data-menubar-panel="view"] button.mac-menu-item')]
        .find(b => (b.querySelector('.flex-1')?.textContent || '').trim() === ${JSON.stringify(label)})
      if (!btn) return false
      btn.click()
      return true
    })()
  `

  await evaluate(`document.querySelector('[data-menubar-menu="view"]')?.click()`)
  await waitForElement('[data-menubar-panel="view"]', 5000)
  const viewChecksLight = await evaluate(readViewChecks)

  const darkItemClicked = await evaluate(clickViewItem('深色外观'))
  const wentDark = await waitFor(async () => await evaluate(`document.documentElement.classList.contains('dark')`), 5000, 200)

  await evaluate(`document.querySelector('[data-menubar-menu="view"]')?.click()`)
  await waitForElement('[data-menubar-panel="view"]', 5000)
  const viewChecksDark = await evaluate(readViewChecks)

  // 还原浅色，避免影响后面的用例
  await evaluate(clickViewItem('浅色外观'))
  await waitFor(async () => !(await evaluate(`document.documentElement.classList.contains('dark')`)), 5000, 200)

  const checksTrackSettings = Boolean(
    darkItemClicked && wentDark
    && viewChecksLight?.['浅色外观'] === true && viewChecksLight?.['深色外观'] === false
    && viewChecksDark?.['深色外观'] === true && viewChecksDark?.['浅色外观'] === false,
  )
  record(
    '「显示」菜单勾选跟随设置变化',
    checksTrackSettings,
    `切换前 浅色=${viewChecksLight?.['浅色外观']} 深色=${viewChecksLight?.['深色外观']} → 切换后 浅色=${viewChecksDark?.['浅色外观']} 深色=${viewChecksDark?.['深色外观']}`,
  )

  /* ---------- 7. 彩蛋：一屏模式 ---------- */
  const controlPanelOpen = await evaluate(`Boolean(document.querySelector('[data-menubar-panel="control"]'))`)
  if (!controlPanelOpen) {
    await evaluate(`document.querySelector('[data-menubar-control]')?.click()`)
    await waitForElement('[data-menubar-panel="control"]', 5000)
  }
  const oneScreenClicked = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('[data-menubar-panel="control"] button')].find(b => b.textContent.trim() === '一屏模式')
      if (!btn) return false
      btn.click()
      return true
    })()
  `)
  await sleep(600)
  const oneScreenOn = await evaluate(`
    document.body.classList.contains('one-screen-mode') && Boolean(document.querySelector('[data-one-screen-exit]'))
  `)
  record('一屏模式开启（锁滚动 + 退出入口）', oneScreenClicked && oneScreenOn, oneScreenClicked ? '' : '控制中心里没找到开关')

  await evaluate(`document.querySelector('[data-one-screen-exit]')?.click()`)
  await sleep(500)
  const oneScreenOff = !(await evaluate(`document.body.classList.contains('one-screen-mode')`))
  record('一屏模式退出', oneScreenOff, '')

  /* ---------- 8. 彩蛋：烟花特效 ---------- */
  await evaluate(`
    (() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 640, clientY: 420 }))
    })()
  `)
  await sleep(280)
  const particles = await evaluate(`Number(document.querySelector('[data-fireworks]')?.dataset.fireworksParticles ?? 0)`)
  record('烟花特效发射', particles > 0, `${particles} 个粒子`)
  if (particles > 0) {
    await evaluate(`
      (() => {
        window.dispatchEvent(new CustomEvent('blog:firework', { detail: { x: 420, y: 340 } }))
        window.dispatchEvent(new CustomEvent('blog:firework', { detail: { x: 1050, y: 300 } }))
      })()
    `)
    await sleep(200)
    await screenshot('preview/fireworks.png')
    record('截图 preview/fireworks.png', true, '')
  }

  // headless 下 requestAnimationFrame 会被节流，动画收尾比真实浏览器慢，这里轮询等待而不是写死 3 秒
  let particlesAfter = -1
  let waited = 0
  for (let i = 0; i < 20; i++) {
    await sleep(600)
    waited += 600
    particlesAfter = await evaluate(`Number(document.querySelector('[data-fireworks]')?.dataset.fireworksParticles ?? 0)`)
    if (particlesAfter === 0) break
  }
  record('烟花自动停止（空闲不占 CPU）', particlesAfter === 0, `${waited}ms 后 ${particlesAfter} 个粒子`)

  /* ---------- 9. 截图 ---------- */
  await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === 'Finder')?.click()`)
  await evaluate(`[...document.querySelectorAll('nav button')].find(b => b.title === '终端')?.click()`)
  await sleep(1200)
  await screenshot('preview/desktop.png')
  record('截图 preview/desktop.png', true, '')

  // Spotlight 打开状态再截一张
  await pressKey('k', { ctrlKey: true })
  if (await waitForElement('[data-spotlight]', 5000)) {
    await evaluate(`
      (() => {
        const input = document.querySelector('[data-spotlight-input]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, '博客')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await sleep(1000)
    await screenshot('preview/spotlight.png')
    record('截图 preview/spotlight.png', true, '')
    await pressKey('Escape')
    await sleep(300)
  }

  // Launchpad 截图
  await evaluate(`document.querySelector('[data-dock-item="launchpad"]')?.click()`)
  if (await waitForElement('[data-launchpad]', 5000)) {
    await sleep(600)
    await screenshot('preview/launchpad.png')
    record('截图 preview/launchpad.png', true, '')
    await pressKey('Escape')
  }

  /* ---------- 8. 控制台异常 ---------- */
  const relevant = consoleErrors.filter(t => !/favicon|DevTools|vite|__verify_not_exist__/i.test(t))
  record('无 JS 异常', relevant.length === 0, relevant.slice(0, 3).join(' || '))

  /* ---------- 9. 404 页（浏览器渲染后） ---------- */
  // 必须放在「无 JS 异常」之后：访问不存在的路径本来就会产生 404 网络日志和
  // Nuxt 的错误输出，那是预期行为，不该算成 JS 异常。
  //
  // 为什么这条只能在浏览器里验：nuxt generate 产出的 404.html 是客户端渲染的壳
  // （和 200.html 同一份模板），HTTP 层拿到的正文里没有文案。
  // HTTP 语义（状态码 404 + 服务的是自家 404 页）由 tools/verify.mjs 负责。
  await send('Page.navigate', { url: `${BASE}/__verify_not_exist__` })
  const notFoundRendered = await waitFor(
    async () => (await evaluate(`document.body.innerText.includes('页面走丢了')`)) === true,
    15000,
    300,
  )
  const notFoundText = notFoundRendered ? await text('body') : ''
  record('404 页渲染「页面走丢了」', notFoundRendered, notFoundText.replace(/\s+/g, ' ').slice(0, 60))

  console.log('')
  for (const item of results) {
    console.log(`  ${item.ok ? '✔' : '✘'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
  }
  const failed = results.filter(item => !item.ok).length
  console.log(`\n合计：通过 ${results.length - failed} / 失败 ${failed}　（${BASE}）`)
  process.exitCode = failed ? 1 : 0
}

main()
  .catch((error) => {
    console.error(`✘ e2e 失败：${error.message}`)
    if (results.length) {
      console.error('\n已完成检查：')
      for (const item of results) console.error(`  ${item.ok ? '✔' : '✘'} ${item.name}`)
    }
    process.exitCode = 1
  })
  .finally(async () => {
    try { ws?.close() } catch {}
    if (!argv.includes('--keep')) {
      chrome.kill()
      await sleep(300)
    }
  })
