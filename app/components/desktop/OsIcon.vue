<template>
  <!-- 语义名 → 图标库图标（全部本地集合，构建期内联 SVG）
       选型原则：UI 字形统一走 Phosphor（与 SF Symbols 的线性/填充语言最接近），
                 品牌标志走 Simple Icons，苹果 logo 用 macos-web 同款 mdi:apple -->
  <Icon :name="resolved" />
</template>

<script setup lang="ts">
const props = defineProps<{ name: string }>()

/** 语义名 → 具体图标。注释里标了来源库，方便替换 */
const ICONS: Record<string, string> = {
  // —— 应用/窗口 ——
  folder: 'ph:folder-simple-bold',        // 目录
  terminal: 'ph:terminal-bold',           // 终端
  gear: 'ph:gear-six-fill',               // 系统设置（填充，贴近 macOS 偏好设置）
  trash: 'ph:trash-bold',                 // 废纸篓（菜单里用线性版本）
  doc: 'ph:article-bold',                 // 文章
  tag: 'ph:tag-bold',                     // 标签
  user: 'ph:user-bold',                   // 关于我
  launchpad: 'ph:squares-four-bold',      // 启动台
  wallpaper: 'ph:image-bold',             // 壁纸
  monitor: 'ph:image-bold',

  // —— 菜单栏状态图标（填充，贴近 SF Symbols）——
  wifi: 'ph:wifi-high-fill',
  battery: 'ph:battery-charging-fill',
  control: 'ph:faders-fill',
  search: 'ph:magnifying-glass-bold',
  apple: 'mdi:apple',                     // macos-web 同款

  // —— 外观 / 主题（用太阳月亮，不用星芒）——
  'theme-light': 'ph:sun-bold',
  'theme-dark': 'ph:moon-bold',
  'theme-auto': 'ph:circle-half-bold',

  // —— 功能 ——
  home: 'ph:house-bold',
  globe: 'ph:globe-bold',
  map: 'ph:map-trifold-bold',
  robot: 'ph:robot-bold',
  note: 'ph:note-pencil-bold',
  image: 'ph:image-bold',
  info: 'ph:info-bold',
  error: 'ph:warning-circle-bold',        // 404 / 错误页
  chart: 'ph:chart-line-up-bold',         // 站点概览（替代原来的星芒）
  clock: 'ph:clock-bold',
  refresh: 'ph:arrow-clockwise-bold',
  power: 'ph:power-bold',
  check: 'ph:check-bold',
  caret: 'ph:caret-right-bold',
  minus: 'ph:minus-bold',
  expand: 'ph:arrows-out-simple-bold',
  close: 'ph:x-bold',

  // —— 品牌标志（Simple Icons）——
  rss: 'simple-icons:rss',
  github: 'simple-icons:github',
  sitemap: 'ph:tree-structure-bold',
}

const resolved = computed(() => ICONS[props.name] ?? ICONS.doc!)
</script>
