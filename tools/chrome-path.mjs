#!/usr/bin/env node
/**
 * Chrome / chromium-headless-shell 可执行文件解析器（无第三方依赖）
 *
 * 为什么要单独一个模块：
 *   原先 tools/e2e-desktop.mjs、tools/qa.mjs、tools/screenshots.mjs 各自把一份
 *   **写死用户名**的绝对路径当 fallback，tools/live-probe.mjs 又抄了第三份 candidates
 *   列表 —— 多份副本必然漂移；而且本仓库是 public 的，写死真实用户名等于把用户真名公开。
 *   这里统一成一份、且**不依赖任何用户名**的解析逻辑，四个工具共用。
 *
 * 解析顺序（取第一个「真实存在的文件」，不是第一个写在纸面上的路径）：
 *   1. 环境变量 CHROME_PATH
 *   2. Playwright 缓存里的 chromium_headless_shell-*（版本号不写死，多个时取版本号最大）
 *   3. Playwright 缓存里的 chromium-*（完整版 chrome，同上取最大版本）
 *   4. 平台常见安装路径（Program Files / Program Files (x86) / %LOCALAPPDATA%\Google\Chrome ...）
 *   5. 由 %PROGRAMFILES% / %PROGRAMFILES(X86)% 环境变量拼出来的路径
 *
 * 用户名从不出现在源码里：本地 AppData / 家目录一律由 %LOCALAPPDATA%、%XDG_CACHE_HOME%
 * 或 os.homedir() 在运行时推导。
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 只在「确实是个文件」时才认这条候选（目录、坏路径、权限错误都算不存在）。 */
function isFile(path) {
  if (!path || typeof path !== 'string') return false
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

/** `chromium_headless_shell-1228` / `chromium-1228` → 1228；解析不出来当 -1（排最后）。 */
function versionOf(dirName) {
  const m = String(dirName).match(/(\d+)\s*$/)
  return m ? Number(m[1]) : -1
}

/** Playwright 的浏览器缓存根目录：优先显式环境变量，其次按平台给默认位置。 */
function browserRoots() {
  const roots = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  if (process.platform === 'win32') {
    roots.push(join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright'))
  }
  else if (process.platform === 'darwin') {
    roots.push(join(homedir(), 'Library', 'Caches', 'ms-playwright'))
  }
  else {
    roots.push(join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'))
  }
  return [...new Set(roots.filter(Boolean))]
}

/**
 * 在 `<root>/<dirPrefix><版本号>` 这类目录里找可执行文件：
 * 按目录名结尾的版本号从大到小排序（`-1228` 这种会随 Playwright 升级变化，不写死），
 * 再在该目录及其一级子目录（chrome-headless-shell-win64 / chrome-win64 / ...）里找 exeNames。
 */
function findInBrowserDir(root, dirPrefix, exeNames) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  }
  catch {
    return null
  }
  const versions = entries
    .filter(e => e.isDirectory() && e.name.startsWith(dirPrefix))
    .map(e => e.name)
    .sort((a, b) => versionOf(b) - versionOf(a))

  for (const name of versions) {
    const base = join(root, name)
    const dirs = [base]
    try {
      for (const sub of readdirSync(base, { withFileTypes: true })) {
        if (sub.isDirectory()) dirs.push(join(base, sub.name))
      }
    }
    catch { /* 读不到子目录就只看目录本身 */ }
    for (const dir of dirs) {
      for (const exe of exeNames) {
        const candidate = join(dir, exe)
        if (isFile(candidate)) return candidate
      }
    }
  }
  return null
}

/** 第 4、5 步：常见安装路径。Windows 侧用 %PROGRAMFILES% 系环境变量拼，绝不写用户名。 */
function commonInstallPaths() {
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files'
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

  const list = [
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge 也是 Chromium，CDP 用法一致，作为兜底
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]

  if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    )
  }
  else if (process.platform === 'linux') {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    )
  }
  return list
}

/** 完整候选列表（含不存在的），按优先级排列。调试时可以直接打印出来看。 */
export function chromeCandidates() {
  const list = []
  // 1. 显式指定优先
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH)

  const roots = browserRoots()
  // 2. headless shell 家族整体先于 3. 完整版 chromium
  for (const root of roots) {
    const shell = findInBrowserDir(root, 'chromium_headless_shell-', ['chrome-headless-shell.exe', 'chrome-headless-shell'])
    if (shell) list.push(shell)
  }
  for (const root of roots) {
    const full = findInBrowserDir(root, 'chromium-', ['chrome.exe', 'chrome'])
    if (full) list.push(full)
  }

  // 4 + 5. 常见安装路径
  list.push(...commonInstallPaths())
  return list
}

/** 找不到时的报错文案：告诉用户唯一需要做的一件事 —— 设 CHROME_PATH。 */
export function chromeNotFoundMessage() {
  return [
    '找不到可用的 Chrome / chromium-headless-shell。',
    '',
    '已按顺序查找：',
    '  1. 环境变量 CHROME_PATH' + (process.env.CHROME_PATH ? `（已设置但文件不存在：${process.env.CHROME_PATH}）` : '（未设置）'),
    '  2. %LOCALAPPDATA%\\ms-playwright\\chromium_headless_shell-*\\chrome-headless-shell-win64\\chrome-headless-shell.exe',
    '  3. %LOCALAPPDATA%\\ms-playwright\\chromium-*\\chrome-win64\\chrome.exe',
    '  4. C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe 等常见安装路径',
    '  5. %PROGRAMFILES%\\... 拼出来的路径',
    '',
    '解决办法：设置环境变量 CHROME_PATH 指向你的浏览器可执行文件，例如',
    '  PowerShell:  $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    '  cmd:         set CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].join('\n')
}

/** 解析出一个真实存在的 Chrome 路径；找不到就抛错（错误信息可直接展示给用户）。 */
export function resolveChrome() {
  const found = chromeCandidates().find(isFile)
  if (found) return found
  throw new Error(chromeNotFoundMessage())
}

/** 工具脚本入口用的包装：找不到时打印友好报错并 exit(1)，不抛堆栈。 */
export function resolveChromeOrExit() {
  try {
    return resolveChrome()
  }
  catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
