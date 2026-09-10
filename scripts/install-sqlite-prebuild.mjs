/**
 * 为 better-sqlite3 安装与当前 Node ABI 匹配的预编译二进制。
 *
 * 背景：
 *  1. pnpm 10 默认拦截依赖的 install 脚本（better-sqlite3 因此不会自动编译）；
 *  2. 本机没有 Visual Studio C++ 工具链，node-gyp 编译不可行；
 *  3. GitHub Releases 在部分网络（如国内）不可达，官方 prebuild-install 会失败。
 *
 * 因此这里直接用 Node 内置 fetch + zlib 从镜像下载预编译包，解出
 * build/Release/better_sqlite3.node。幂等：已存在则跳过。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'

const pkgDir = join(process.cwd(), 'node_modules', 'better-sqlite3')

if (!existsSync(pkgDir)) {
  console.log('[sqlite-prebuild] 未找到 better-sqlite3，跳过。')
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const version = pkg.version
const abi = process.versions.modules
const { platform, arch } = process
const target = join(pkgDir, 'build', 'Release', 'better_sqlite3.node')

if (existsSync(target)) {
  console.log(`[sqlite-prebuild] 已存在 ${target}，跳过。`)
  process.exit(0)
}

const asset = `better-sqlite3-v${version}-node-v${abi}-${platform}-${arch}.tar.gz`
const mirrors = [
  `https://registry.npmmirror.com/-/binary/better-sqlite3/v${version}/${asset}`,
  `https://ghfast.top/https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`,
  `https://gh-proxy.com/https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`,
  `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`,
]

/** 极简 tar 解析：只取目标文件，避免引入额外依赖 */
function extractFileFromTar(buf, suffix) {
  let offset = 0
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const dataStart = offset + 512
    if (name.endsWith(suffix)) return buf.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return null
}

let installed = false
for (const url of mirrors) {
  try {
    console.log(`[sqlite-prebuild] 尝试：${url}`)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const tar = gunzipSync(Buffer.from(await res.arrayBuffer()))
    const binary = extractFileFromTar(tar, 'build/Release/better_sqlite3.node')
    if (!binary) throw new Error('压缩包内未找到 better_sqlite3.node')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, binary)
    console.log(`[sqlite-prebuild] 完成：${target}（${binary.length} bytes）`)
    installed = true
    break
  }
  catch (error) {
    console.warn(`[sqlite-prebuild] 失败：${error.message}`)
  }
}

if (!installed) {
  console.error(
    '[sqlite-prebuild] 所有镜像均下载失败。\n'
    + `  手动方案：下载 ${asset}\n`
    + '  解压后把 build/Release/better_sqlite3.node 放到 '
    + 'node_modules/better-sqlite3/build/Release/ 目录下。',
  )
  process.exit(1)
}
