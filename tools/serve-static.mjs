#!/usr/bin/env node
/**
 * 模拟 GitHub Pages 的静态服务器，用来在本地验收「静态产物」而不是 dev server。
 *
 * 为什么要它：`nuxt generate` 出来的站点和 dev server 的 SSR 行为并不一样
 * （例如 404 页在静态产物里是客户端渲染的），验收必须在静态模式下做。
 *
 * 复刻的 GitHub Pages 语义：
 *   /a/b/      → /a/b/index.html
 *   /a/b       → /a/b.html 或 /a/b/index.html
 *   /          → /index.html
 *   找不到     → 回 404.html，且 HTTP 状态码是 404（不是 200）
 *
 * 用法: node tools/serve-static.mjs [--root .output/public] [--port 4180] [--delay-wasm 9000]
 *
 * --delay-wasm <ms>：人为拖延 .wasm 的响应，用来**受控复现慢网络**。
 * 本站桌面的文章正文、Spotlight、终端 ls、Finder 列表都依赖客户端内容库
 * （`sqlite3.*.wasm` + `sql_dump.txt`）。实测在某条慢链路上这个 wasm 要 8.7 秒才到
 * （844 KB gzip ≈ 97 KB/s），此时线上能观察到 e2e 8 项失败 / qa 文章页 3 条 warn。
 * 加这个开关就能在本地复现同一现象，从而判断那是「慢链路的必然结果」还是「代码缺陷」。
 */
import { createServer } from 'node:http'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const ROOT = resolve(arg('root', '.output/public'))
const PORT = Number(arg('port', '4180'))
const DELAY_WASM = Number(arg('delay-wasm', '0'))

if (!existsSync(ROOT)) {
  console.error(`产物目录不存在: ${ROOT}\n先跑 pnpm generate`)
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  // Shiki 的 oniguruma 引擎要按 application/wasm 取，否则 Chrome 会拒绝流式编译（回退到 ArrayBuffer 并报错）
  '.wasm': 'application/wasm',
  '.cur': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.avif': 'image/avif',
}

const isFile = (p) => existsSync(p) && statSync(p).isFile()

function resolveFile(urlPath) {
  // 防目录穿越
  const safe = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const abs = join(ROOT, safe)
  if (!abs.startsWith(ROOT)) return null
  if (isFile(abs)) return abs
  if (isFile(join(abs, 'index.html'))) return join(abs, 'index.html')
  if (isFile(`${abs}.html`)) return `${abs}.html`
  return null
}

const server = createServer((req, res) => {
  const hit = resolveFile(req.url || '/')
  const four04 = join(ROOT, '404.html')

  if (hit) {
    const body = readFileSync(hit)
    const send = () => {
      res.writeHead(200, {
        'content-type': TYPES[extname(hit).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      })
      res.end(body)
    }
    // 人为拖延 wasm，用来受控复现慢网络（见文件头说明）
    if (DELAY_WASM > 0 && hit.toLowerCase().endsWith('.wasm')) {
      setTimeout(send, DELAY_WASM)
      return
    }
    send()
    return
  }

  // GitHub Pages：找不到就给 404.html，状态码保持 404
  if (isFile(four04)) {
    const body = readFileSync(four04)
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length })
    res.end(body)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('404 Not Found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`静态站点（模拟 GitHub Pages）: http://127.0.0.1:${PORT}`)
  console.log(`根目录: ${ROOT}`)
})
