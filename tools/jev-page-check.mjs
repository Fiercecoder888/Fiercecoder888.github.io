/**
 * `/jev`（Jev 聊天助手网页版）的**浏览器端**端到端验证 —— 真 Chrome、真点击、真后端。
 *
 * 跑法：
 *   node tools/jev-page-check.mjs                                  # 默认打线上
 *   node tools/jev-page-check.mjs --base http://localhost:3011     # 打本地 dev
 *
 * 为什么还要有这么一层：`tools/jev-endpoints-check.mjs` 验的是接口本身（用 fetch 直接打），
 * 页面却可能在浏览器里根本跑不起来 —— 没挂载、表单取值取错、渲染分支写反、
 * 点击到请求之间断掉。这些只有真浏览器点一遍才知道。
 * 判断一次会真的调 Jev（约 2 次请求），起草那一次会因为线上 key 无效而失败 —— 都是刻意的：
 * **失败要能在页面上被看见**，而不是被脚本吞掉。
 *
 * 依赖：系统里的 Chrome / Edge（走 `tools/chrome-path.mjs` 解析），CDP 用原生 WebSocket，
 * 不引任何第三方包 —— 和 tools/ 下其它 e2e 脚本同一套做法。
 */

import { spawn } from 'node:child_process'
import { resolveChromeOrExit } from './chrome-path.mjs'

const argv = process.argv.slice(2)
const baseArg = argv[argv.indexOf('--base') + 1]
const BASE = (argv.includes('--base') ? baseArg : 'https://fiercecoder888.github.io/jev/').replace(/\/+$/, '')
const PAGE = `${BASE}/`

const PORT = 9223
const CHROME = resolveChromeOrExit()
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  // 绕开系统代理。这台机器的系统代理是坏的（`Invoke-WebRequest` 全站报
  // 「基础连接已经关闭」就是它），Chrome 默认会走它，于是页面能打开、但页面里
  // 打给后端的那次 fetch 会一直挂着。这个脚本验的是页面，不是用户的代理设置。
  '--no-proxy-server',
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' })

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let ws
let nextId = 0
const pending = new Map()
const pageErrors = []
/** 页面打给后端的那些请求（成败都记），用来把「界面卡住」翻译成具体原因。 */
const apiCalls = []
const apiUrls = new Map()

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    // 这个上限必须**大于**页面里那些轮询循环的时长（最长 90 秒）：
    // 否则轮询还没等出结果，Node 这边先把 CDP 调用判超时了 —— 那不是页面卡住，
    // 是我自己设的闹钟太早。
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }
    }, 120_000)
  })
}

/** 在页面里跑一段代码，返回值取回 Node。 */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`页面里抛错：${result.exceptionDetails.exception?.description ?? '未知'}`)
  }
  return result.result?.value
}

/* ── 起 Chrome 并连上 ─────────────────────────────────── */

let target = null
for (let i = 0; i < 40 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find(t => t.type === 'page') ?? null
  }
  catch {
    // 还没起来
  }
  if (!target) await wait(300)
}
if (!target) {
  console.error('✗ 连不上 Chrome 的调试端口 —— 没找到可用的浏览器？')
  console.error(CHROME)
  chrome.kill()
  process.exit(1)
}

ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description ?? '未知页面异常')
  }
  if (message.method === 'Network.requestWillBeSent') {
    const { requestId, request } = message.params
    if (/\/api\/jev\//.test(request.url)) {
      apiUrls.set(requestId, request.url)
      apiCalls.push({ id: requestId, url: request.url, status: '发出' })
    }
  }
  if (message.method === 'Network.responseReceived') {
    const call = apiCalls.find(c => c.id === message.params.requestId)
    if (call) call.status = `HTTP ${message.params.response.status}`
  }
  if (message.method === 'Network.loadingFailed') {
    const call = apiCalls.find(c => c.id === message.params.requestId)
    if (call) call.status = `失败：${message.params.errorText}${message.params.blockedReason ? `（${message.params.blockedReason}）` : ''}`
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
})

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

const failures = []
function check(ok, label, detail = '') {
  if (!ok) failures.push(label)
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
}

console.log(`页面端到端验证 ${PAGE}\n`)
console.log('=== 打开页面 ===')
await send('Page.navigate', { url: PAGE })
await wait(1_200)

/* ── 等挂载 ───────────────────────────────────────────── */

const mounted = await evaluate(`(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-jev-form]') || document.querySelector('textarea')) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
})()`)
check(mounted === true, '页面挂载（找到表单）')
if (!mounted) {
  console.log('  页面没挂载起来，后面的检查没有意义')
  ws.close()
  chrome.kill()
  process.exit(1)
}

const shape = await evaluate(`(() => {
  const boxes = [...document.querySelectorAll('textarea')];
  const selects = [...document.querySelectorAll('select')];
  return {
    textareas: boxes.length,
    selects: selects.length,
    sceneOptions: selects[0] ? selects[0].options.length : 0,
    relationshipOptions: selects[1] ? selects[1].options.length : 0,
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 12),
    hasNotice: Boolean(document.querySelector('[data-jev-static-notice]')),
    chatBox: boxes.some(t => (t.placeholder || '').includes('对方：')),
  };
})()`)
check(shape.selects >= 2, '场景与关系两个下拉都在', `select=${shape.selects}`);
check(shape.sceneOptions === 5, '场景下拉 5 项', `实际 ${shape.sceneOptions}`)
check(shape.chatBox === true, '对话框有说明格式的占位文字')
check(shape.hasNotice === false, '没有「没接上后端」的提示（说明后端地址已配）')
console.log(`    按钮：${shape.buttons.join(' / ')}`)

/* ── 填表并按下「判断」 ───────────────────────────────── */

const CHAT_SAMPLE = [
  '对方：关于上周那个方案',
  '我：嗯，你说',
  '对方：你看今天下班前能不能先把目录定下来',
].join('\n')

console.log('\n=== 点「判断」（真的会调 Jev）===')

/**
 * 往对话框里打字：聚焦 + **真实键盘**（`Input.insertText`），并且**重试到值真的进去为止**。
 *
 * 两个坑都是实测踩出来的：
 *   1. 直接 `el.value = '…'` 再派发 `new Event('input')` 对 Vue 不一定管用 ——
 *      那次赋值被随后的重渲染按空白模型回滚了（长度又变回 0），按钮一直 disabled，
 *      看起来就像「页面点了没反应」。
 *   2. 换成真实键盘之后，第一次通过、第二次却落空：这个页面长在博客的桌面外壳里，
 *      外壳上有个每秒走字的时钟，它重渲染会抢走焦点。
 * 所以判断标准不能是「我执行了输入动作」，只能是「值真的在框里」。
 */
const readChatLength = () => evaluate(`(() => {
  const chat = [...document.querySelectorAll('textarea')].find(t => (t.placeholder || '').includes('对方：'))
    || document.querySelector('textarea');
  return chat ? chat.value.length : -1;
})()`)

let chatLength = 0
for (let attempt = 1; attempt <= 3 && !chatLength; attempt += 1) {
  const focused = await evaluate(`(() => {
    const chat = [...document.querySelectorAll('textarea')].find(t => (t.placeholder || '').includes('对方：'))
      || document.querySelector('textarea');
    if (!chat) return 'no-chat';
    chat.scrollIntoView({ block: 'center' });
    chat.focus();
    chat.setSelectionRange(0, chat.value.length);
    return document.activeElement === chat ? 'ok' : 'focus-failed';
  })()`)
  if (focused !== 'ok') {
    console.log(`    第 ${attempt} 次聚焦没成功：${focused}`)
    continue
  }
  await send('Input.insertText', { text: CHAT_SAMPLE })
  await wait(400)
  chatLength = await readChatLength()
}
check(chatLength > 0, '对话内容真的进了输入框（真实键盘输入）', `长度 ${chatLength}`)

const submitted = await evaluate(`(async () => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '判断');
  if (!button) return '没找到「判断」按钮';

  // v-model 是异步更新 DOM 的：给完值那一刻按钮还是 disabled，
  // 而 .click() 在禁用的按钮上会静默地什么都不做。等它解禁，别抢跑。
  for (let i = 0; i < 40 && button.disabled; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (button.disabled) return '等了四秒按钮仍然禁用';
  button.click();
  return 'ok';
})()`)
check(submitted === 'ok', '按下「判断」', submitted === 'ok' ? '' : String(submitted))

const roundOutcome = await evaluate(`(async () => {
  for (let i = 0; i < 90; i++) {
    if (document.querySelector('[data-jev-analysis]')) return { kind: 'ok' };
    const err = document.querySelector('[data-jev-round-error]');
    if (err) return { kind: 'error', text: err.textContent.trim().slice(0, 240) };
    await new Promise(r => setTimeout(r, 1000));
  }
  return { kind: 'timeout' };
})()`)

if (roundOutcome?.kind === 'ok') {
  check(true, '判断结果渲染出来了')
  const rendered = await evaluate(`(() => {
    const box = document.querySelector('[data-jev-analysis]');
    const text = (box.innerText || '').replace(/\\n{2,}/g, '\\n').trim();
    return {
      length: text.length,
      excerpts: text.split('\\n').filter(l => l.trim()).slice(0, 12),
      hasPercent: /\\d+(\\.\\d+)?%/.test(text),
      mustChoose: Boolean(document.querySelector('[data-jev-must-choose]')),
      percentCount: (text.match(/\\d+(\\.\\d+)?%/g) || []).length,
    };
  })()`)
  check(rendered.hasPercent === true, '结果里有概率数字', `共 ${rendered.percentCount} 个百分比`)
  check(rendered.length > 200, '结果有实际内容', `${rendered.length} 字符`)
  console.log('    渲染出来的前几行：')
  for (const line of rendered.excerpts) console.log(`      ${line.slice(0, 76)}`)

  console.log('\n=== 点「起草候选回复」（线上 key 无效，预期看到如实报错）===')
  const drafted = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('起草'));
    if (!button) return { kind: 'nobutton' };
    button.click();
    for (let i = 0; i < 90; i++) {
      const err = document.querySelector('[data-jev-draft-error]');
      if (err) return { kind: 'error', text: err.textContent.trim().slice(0, 260) };
      // 「正在起草…」的加载容器不算结局：它还是中间态。
      // 真结局要么是错误，要么是带分数的候选卡。
      const cards = document.querySelector('[data-jev-candidates]');
      const text = cards ? (cards.innerText || '') : '';
      if (cards && /\\d(\\.\\d)?\\s*\\/\\s*5/.test(text)) return { kind: 'candidates', text: text.slice(0, 300) };
      await new Promise(r => setTimeout(r, 1000));
    }
    return { kind: 'timeout' };
  })()`)
  const draftAcceptable = ['candidates', 'error'].includes(drafted?.kind)
  check(draftAcceptable, '起草这一步给出了明确结局（有候选，或如实说明为什么没有）',
    drafted?.kind === 'error' ? '（如实报错）' : `（${drafted?.kind}）`)
  if (drafted?.text) console.log(`      ${drafted.text.replace(/\s+/g, ' ').slice(0, 200)}`)
}
else if (roundOutcome?.kind === 'error') {
  check(false, '判断结果渲染出来了', `页面报错：${roundOutcome.text}`)
}
else {
  check(false, '判断结果渲染出来了', '90 秒内既没有结果也没有错误 —— 界面卡在中间态')
  console.log('    这次页面发出去的后端请求：')
  if (!apiCalls.length) console.log('      （一次都没发出去 —— 点「判断」没触发请求）')
  for (const call of apiCalls) console.log(`      ${call.status}  ${call.url}`)
}

/* ── 收尾 ─────────────────────────────────────────────── */

check(pageErrors.length === 0, '页面没有未捕获的异常',
  pageErrors.length ? `(${pageErrors.length} 条，第一条：${pageErrors[0].slice(0, 120)})` : '')

ws.close()
chrome.kill()

console.log(`\n${failures.length ? '✗' : '✓'} ${failures.length ? `${failures.length} 项没过：${failures.join('；')}` : '全部通过'}`)
process.exit(failures.length ? 1 : 0)
