#!/usr/bin/env node
/**
 * 光标热点分析：算出每个自定义光标资源的「可见锚点」应该在哪，并给出建议的 hotspot 坐标。
 *
 * 为什么需要它：CSS 里写 `cursor: url('/cursors/x.svg')` **不带坐标**时，
 * 浏览器把热点定在图片的左上角 (0,0)。而 macOS 那套光标图形并不是从左上角起笔的
 * （箭头与手型的指尖都在图形内部几像素处）—— 于是「看得见的指尖」与「真正的触发点」
 * 错开几个像素，手感就是「切换不灵敏、点不准」。
 *
 * 修法：在 CSS 里补上热点坐标 —— `cursor: url('/cursors/x.svg') 4 1, auto`。
 * 本工具把坐标量出来，避免靠猜。
 *
 * 资源是 SVG 包了一张 base64 PNG（macos-web 的做法），所以这里解 PNG 的 alpha 通道：
 *   - 找 alpha 包围盒
 *   - 找「最上面那一行的最左不透明像素」= 箭头/手型的指尖（锚点的直觉位置）
 *   - 同时给出包围盒中心（移动/缩放类光标用得上）
 *
 * 用法: node scripts/cursor-hotspots.mjs [--json] [--art]
 *   --art 额外把图形画成 ASCII 轮廓。**定热点前必须看轮廓**：
 *   箭头类热点在「笔尖」，手型在「食指指尖」，而 I 型/十字/缩放/禁止类热点在**图形中心**——
 *   只看「最上不透明像素」会把 I 型的竖条顶端误当成热点。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const DIR = 'public/cursors'
const JSON_OUT = process.argv.includes('--json')
const ART = process.argv.includes('--art')
/** --render 用浏览器真实渲染后再量一遍（能反映 SVG 的 transform） */
const RENDER = process.argv.includes('--render')
/** --only=a,b 只画匹配到的文件，避免一次输出几百行被终端截断 */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)

/** 最小 PNG 解码：8 位、非隔行。统一输出 RGBA，后面只看 alpha。
 *  要支持调色板（colorType=3）：macos-web 的缩放类光标就是索引色 + tRNS 决定透明。 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let pos = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
  let palette = null, trns = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4)
      bitDepth = body[8]; colorType = body[9]; interlace = body[12]
    }
    else if (type === 'PLTE') palette = Buffer.from(body)
    else if (type === 'tRNS') trns = Buffer.from(body)
    else if (type === 'IDAT') idat.push(Buffer.from(body))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`暂不支持 bitDepth=${bitDepth} interlace=${interlace}`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`暂不支持 colorType=${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const px = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[i] = v & 0xff
    }
    cur.copy(px, y * stride)
    prev = cur
  }
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    let r = 0, g = 0, b = 0, a = 255
    if (colorType === 0) { r = g = b = px[i] }
    else if (colorType === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2] }
    else if (colorType === 3) {
      const idx = px[i]
      r = palette ? palette[idx * 3] : 0
      g = palette ? palette[idx * 3 + 1] : 0
      b = palette ? palette[idx * 3 + 2] : 0
      a = trns && idx < trns.length ? trns[idx] : 255
    }
    else if (colorType === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1] }
    else if (colorType === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3] }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a
  }
  return { w, h, rgba }
}

const alphaAt = (img, x, y) => img.rgba[(y * img.w + x) * 4 + 3]

/** 量出「看的见的锚点」：包围盒、最上不透明像素（≈箭头/手指尖）、包围盒中心。
 *  注意：这里看的是 **内嵌位图**。若 SVG 自己套了 transform（如派生的水平缩放光标），
 *  位图坐标 ≠ 渲染结果 —— 那种情况要用 --render 让浏览器画出来再量。 */
function measure(img) {
  let minX = img.w, minY = img.h, maxX = -1, maxY = -1, tipX = -1, tipY = -1
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (alphaAt(img, x, y) > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (tipY === -1) { tipY = y; tipX = x }   // 最上面一行里最左的不透明像素
      }
    }
  }
  if (maxX < 0) return { bbox: null, tip: null, center: null }
  return {
    bbox: { minX, minY, maxX, maxY },
    tip: { x: tipX, y: tipY },
    center: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) },
  }
}

/** 从 SVG 里抠出内嵌的 base64 PNG（**base64 在 SVG 里是跨行的，必须允许换行再去掉空白**，否则解码会 unexpected end of file） */
function embeddedPng(svgText) {
  const m = /data:image\/png;base64,([\s\S]*?)(?=["'])/.exec(svgText)
  if (!m) return null
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64')
}

const files = (existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.svg')).sort() : [])
  .filter(f => !ONLY.length || ONLY.some(p => f.includes(p)))
if (!files.length) { console.log(`· ${DIR} 里没有 svg 光标`); process.exit(0) }

const results = []
for (const f of files) {
  const svg = readFileSync(join(DIR, f), 'utf8')
  const png = embeddedPng(svg)
  if (!png) { results.push({ file: f, note: 'SVG 里没有内嵌 PNG（可能是矢量路径，热点需人工定）' }); continue }
  let img
  try { img = decodePng(png) } catch (e) { results.push({ file: f, note: `PNG 解码失败：${e.message}` }); continue }

  const m = measure(img)
  if (!m.bbox) { results.push({ file: f, note: '整张图都是透明的？' }); continue }
  results.push({
    file: f, w: img.w, h: img.h,
    bbox: m.bbox, tip: m.tip, center: m.center,
    // SVG 自己套了 transform 时，下面这些位图坐标与浏览器实际渲染结果不一致，输出里会标注
    hasTransform: /transform\s*=/.test(svg),
    art: ART ? renderArt(img, m.tip.x, m.tip.y, m.center.x, m.center.y) : null,
  })
}

/** 把 alpha 画成 ASCII：'#' 实心 / '+' 半透明 / '.' 极淡。
 *  叠加 'T' = 最上不透明像素、'C' = 包围盒中心，方便一眼判断哪个才是真热点。 */
function renderArt(img, tipX, tipY, cx, cy) {
  const rows = []
  const ruler = '    ' + Array.from({ length: img.w }, (_, x) => x % 10 === 0 ? String((x / 10) % 10) : '·').join('')
  rows.push(ruler)
  for (let y = 0; y < img.h; y++) {
    let line = ''
    for (let x = 0; x < img.w; x++) {
      const a = alphaAt(img, x, y)
      line += a > 200 ? '#' : a > 100 ? '+' : a > 8 ? '.' : ' '
    }
    if (tipY === y && tipX >= 0) {
      const chars = [...line]
      chars[tipX] = 'T'
      if (cx >= 0 && cx !== tipX) chars[cx] = 'C'
      line = chars.join('')
    }
    else if (cy === y && cx >= 0) {
      const chars = [...line]
      chars[cx] = 'C'
      line = chars.join('')
    }
    rows.push(String(y).padStart(3) + ' ' + line)
  }
  return rows
}

/* ---- 可选：真实渲染校验 ----------------------------------------------------
 * 位图分析看不见 SVG 自己的 transform（派生的 horizontal-resize.svg 就靠 transform 旋转）。
 * --render 让浏览器真的把 SVG 画到 canvas 上再取像素量一遍 —— 这才是「用户看到的形状」。
 * 沿用本仓库工具链的做法：裸 CDP，零第三方依赖；只有需要时才动态加载。
 * -------------------------------------------------------------------------- */
if (RENDER) {
  const { spawn } = await import('node:child_process')
  const { resolveChromeOrExit } = await import('../tools/chrome-path.mjs')
  const PORT = Number((process.argv.find(a => a.startsWith('--port=')) || '').slice(7)) || 9486
  const sleep = ms => new Promise(s => setTimeout(s, ms))
  const chrome = spawn(resolveChromeOrExit(), [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--hide-scrollbars', '--window-size=200,200', 'about:blank',
  ], { stdio: 'ignore' })

  let ws
  let msgId = 0
  const pending = new Map()
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch { /* 等浏览器起来 */ }
      await sleep(250)
    }
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? rej(new Error(m.error.message)) : res(m)
      }
    })
    const send = (method, params = {}) => {
      const id = ++msgId
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((res, rej) => {
        pending.set(id, { res, rej })
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP 超时 ${method}`)) } }, 20000)
      })
    }
    await send('Runtime.enable')

    for (const r of results) {
      if (r.note) continue
      const dataUrl = `data:image/svg+xml;base64,${readFileSync(join(DIR, r.file)).toString('base64')}`
      // data URL 是同源的，canvas 不会被污染，getImageData 拿得到真实 alpha
      const expression = `(async () => {
        const img = new Image()
        img.src = ${JSON.stringify(dataUrl)}
        await img.decode()
        const c = document.createElement('canvas')
        c.width = 32; c.height = 32
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0, 32, 32)
        return Array.from(g.getImageData(0, 0, 32, 32).data)
      })()`
      const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      const px = out.result?.result?.value
      if (!px) { r.rendered = { error: '渲染取像素失败' }; continue }
      const rim = { w: 32, h: 32, rgba: Buffer.from(px) }
      const rm = measure(rim)
      r.rendered = {
        w: 32, h: 32, bbox: rm.bbox, tip: rm.tip, center: rm.center,
        art: rm.bbox ? renderArt(rim, rm.tip.x, rm.tip.y, rm.center.x, rm.center.y) : null,
      }
    }
  }
  finally {
    try { ws?.close() } catch { /* 忽略 */ }
    chrome.kill()
    await sleep(200)
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2))
}
else {
  console.log(`分析 ${results.length} 个光标资源（${DIR}）${RENDER ? '｜已含浏览器渲染校验' : ''}\n`)
  for (const r of results) {
    if (r.note) { console.log(`  ? ${r.file.padEnd(24)} ${r.note}`); continue }
    console.log(`  ${r.file.padEnd(24)} ${r.w}×${r.h}  图形包围盒 x${r.bbox.minX}..${r.bbox.maxX} y${r.bbox.minY}..${r.bbox.maxY}`)
    console.log(`      ${' '.repeat(24)} 最上不透明像素（≈指尖）= (${r.tip.x}, ${r.tip.y})   包围盒中心 = (${r.center.x}, ${r.center.y})`)
    console.log(`      ${' '.repeat(24)} 若 CSS 不写坐标 → 热点被当成 (0,0)，指尖偏移约 ${Math.round(Math.hypot(r.tip.x, r.tip.y))} px`)
    if (r.hasTransform) {
      console.log(`      ${' '.repeat(24)} ⚠ SVG 自带 transform：以上是**内嵌位图**坐标，与渲染结果不同`)
    }
    if (r.rendered?.error) {
      console.log(`      ${' '.repeat(24)} ✗ ${r.rendered.error}`)
    }
    else if (r.rendered) {
      const t = r.rendered.tip
      const same = r.hasTransform ? '' : '（与位图一致）'
      console.log(`      ${' '.repeat(24)} 渲染后包围盒 x${r.rendered.bbox.minX}..${r.rendered.bbox.maxX} y${r.rendered.bbox.minY}..${r.rendered.bbox.maxY} 最上像素 (${t.x}, ${t.y})${same}`)
      if (r.rendered.art) console.log('\n' + r.rendered.art.map(l => '      ' + l).join('\n') + '\n')
    }
    else if (r.art) {
      console.log('\n' + r.art.map(l => '      ' + l).join('\n') + '\n')
    }
  }
}
