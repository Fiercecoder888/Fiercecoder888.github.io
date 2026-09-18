#!/usr/bin/env node
/**
 * 派生光标资源：macos-web 的 public/cursors 里只有「↕ 垂直缩放」（vertical-resize.svg），
 * 没有「↔ 水平缩放」。而窗口的东/西边框要用 ↔ —— 直接拿垂直图当水平图用，
 * 拖横向边框时会看到一个方向不对的箭头（实测：原 CSS 甚至把 ↖↘ 斜箭头用在了横向边框上）。
 *
 * 这里把垂直图绕画布中心 (16,16) 旋转 90° 生成 horizontal-resize.svg。
 * 因为是绕中心旋转，图形仍然居中，热点保持 (16,16)。
 *
 * 用法: node scripts/derive-cursors.mjs        （幂等，可重复执行）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const SRC = 'public/cursors/vertical-resize.svg'
const OUT = 'public/cursors/horizontal-resize.svg'
/* 用 -90（逆时针）：渲染后包围盒是 x2..30，索引中心正好落在 16，和热点 (16,16) 对齐。
 * （+90 会得到 x1..29。两者在连续坐标上都还差半像素 —— 源图本身就不是严格居中的，
 *  这是 SVG 光栅化的取样问题，0.5px 对光标手感没有影响。）
 * 复核方式：node scripts/cursor-hotspots.mjs --render --only=horizontal */
const ROTATE = 'transform="rotate(-90 16 16)"'

if (!existsSync(SRC)) {
  console.error(`✗ 找不到源文件 ${SRC}`)
  process.exit(1)
}

const svg = readFileSync(SRC, 'utf8')
const out = svg.replace(/<image\s/, `<image ${ROTATE} `)

if (out === svg) {
  console.error('✗ vertical-resize.svg 里没找到 <image> 元素（结构变了？），拒绝生成')
  process.exit(1)
}

writeFileSync(OUT, out)
console.log(`✓ ${OUT} 已生成（${SRC} 绕 (16,16) 旋转 90°，热点仍为 16 16）`)
