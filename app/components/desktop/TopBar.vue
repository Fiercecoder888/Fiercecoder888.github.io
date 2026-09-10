<template>
  <header class="mac-menubar sticky top-0 z-50 flex h-[1.8rem] w-full items-center" data-topbar @click.stop>
    <!-- 左侧：🍎 菜单 + App 菜单 -->
    <div class="flex h-full items-center">
      <button
        type="button"
        class="mac-menubar-item !px-[0.7rem] !ml-2"
        :data-active="ui.menuBarMenu === 'system'"
        data-menubar-logo
        title="系统菜单"
        @click="openMenu('system', $event)"
        @mouseenter="hoverSwitch('system', $event)"
      >
        <DesktopOsIcon name="apple" class="h-[1rem] w-[1rem]" />
      </button>

      <button
        v-for="menu in appMenus"
        v-show="!narrow || menu.id === 'app'"
        :key="menu.id"
        type="button"
        class="mac-menubar-item"
        :class="menu.id === 'app' ? '!font-semibold mx-1.5' : 'max-sm:hidden'"
        :data-active="ui.menuBarMenu === menu.id"
        :data-menubar-menu="menu.id"
        @click="openMenu(menu.id, $event)"
        @mouseenter="hoverSwitch(menu.id, $event)"
      >
        {{ menu.title }}
      </button>
    </div>

    <div class="flex-1" />

    <!-- 右侧：状态栏 -->
    <div class="flex h-full items-center gap-1">
      <button
        v-if="!narrow"
        type="button"
        class="mac-menubar-item !px-1.5"
        title="Spotlight 搜索"
        data-menubar-search
        @click="ui.toggleSpotlight(true)"
      >
        <DesktopOsIcon name="search" class="h-[0.95rem] w-[0.95rem]" />
      </button>

      <span v-if="!narrow" class="mac-menubar-item !px-1.5 cursor-default" title="WiFi">
        <DesktopOsIcon name="wifi" class="h-[0.9rem] w-[0.9rem]" />
      </span>

      <span v-if="!narrow" class="mac-menubar-item !px-1.5 cursor-default" title="电池">
        <DesktopOsIcon name="battery" class="h-[1rem] w-[1rem]" />
      </span>

      <button
        type="button"
        class="mac-menubar-item !px-1.5"
        :data-active="ui.menuBarMenu === 'control'"
        title="控制中心"
        data-menubar-control
        @click="ui.setMenuBarMenu('control')"
        @mouseenter="hoverSwitch('control')"
      >
        <DesktopOsIcon name="sliders" class="h-[0.95rem] w-[0.95rem]" />
      </button>

      <button
        v-if="settings.menuBarClock"
        type="button"
        class="mac-menubar-item"
        :data-active="ui.menuBarMenu === 'clock'"
        data-menubar-clock
        @click="ui.setMenuBarMenu('clock')"
        @mouseenter="hoverSwitch('clock')"
      >
        <span v-if="narrow">{{ clockFull }}</span>
        <span v-else>{{ clock }}</span>
      </button>
    </div>

    <!-- ============ 下拉面板：文字菜单（对齐到被点的菜单项下方） ============ -->
    <div
      v-if="showTextPanel"
      class="mac-menu absolute top-[1.85rem] z-50 min-w-56"
      :style="{ left: `${menuAnchorX}px` }"
      :data-menubar-panel="ui.menuBarMenu"
    >
      <template v-for="(item, index) in textMenuItems" :key="`${item.label}-${index}`">
        <div v-if="item.separator" class="mac-menu-sep" />
        <button
          v-else
          type="button"
          :disabled="item.disabled"
          class="mac-menu-item"
          @click="runMenu(item)"
        >
          <DesktopOsIcon v-if="item.icon" :name="item.icon" class="h-4 w-4 shrink-0" />
          <span v-else class="w-4 shrink-0" />
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.checked" class="text-[11px]"><DesktopOsIcon name="check" class="h-3 w-3" /></span>
          <span v-if="item.shortcut" class="ml-2 text-[11px] opacity-60">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>

    <!-- 控制中心（macOS Big Sur 风格磁贴） -->
    <div
      v-if="ui.menuBarMenu === 'control'"
      class="mac-menu absolute right-2 top-[1.85rem] z-50 w-[19rem] space-y-2 p-2"
      data-menubar-panel="control"
    >
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="tile in themeTiles"
          :key="tile.value"
          type="button"
          class="flex items-center gap-2 rounded-xl border p-2 text-left text-xs transition"
          :class="settings.theme === tile.value
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10'"
          :data-theme-tile="tile.value"
          @click="setTheme(tile.value)"
        >
          <DesktopOsIcon :name="tile.icon" class="h-4 w-4" />
          <span>{{ tile.label }}</span>
        </button>
      </div>

      <div class="rounded-xl border border-black/10 p-2 dark:border-white/10">
        <p class="mb-1.5 text-[11px] opacity-60">显示</p>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="item in controlToggles"
            :key="item.key"
            type="button"
            class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
            @click="toggle(item.key)"
          >
            <span>{{ item.label }}</span>
            <span class="relative h-3.5 w-6 shrink-0 rounded-full transition" :class="settings[item.key] ? 'bg-[var(--system-color-primary)]' : 'bg-black/20 dark:bg-white/20'">
              <span class="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all" :class="settings[item.key] ? 'left-3' : 'left-0.5'" />
            </span>
          </button>
        </div>
      </div>

      <div class="rounded-xl border border-black/10 p-2 dark:border-white/10">
        <p class="mb-1.5 text-[11px] opacity-60">字体大小</p>
        <div class="flex gap-1">
          <button
            v-for="option in fontOptions"
            :key="option.value"
            type="button"
            class="flex-1 rounded-lg px-2 py-1 text-xs transition"
            :class="settings.fontSize === option.value ? 'bg-[var(--system-color-primary)] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'"
            @click="setFontSize(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="mac-menu-item justify-center rounded-xl border border-black/10 py-1.5 text-xs dark:border-white/10" @click="runMenu({ label: 'Launchpad', action: () => ui.toggleLaunchpad(true) })">
          Launchpad
        </button>
        <button type="button" class="mac-menu-item justify-center rounded-xl border border-black/10 py-1.5 text-xs dark:border-white/10" @click="runMenu({ label: 'Spotlight', action: () => ui.toggleSpotlight(true) })">
          Spotlight
        </button>
      </div>
    </div>

    <!-- 时钟面板 -->
    <div
      v-if="ui.menuBarMenu === 'clock'"
      class="mac-menu absolute right-2 top-[1.85rem] z-50 w-60 p-4 text-center"
      data-menubar-panel="clock"
    >
      <p class="text-2xl font-semibold tabular-nums">{{ clockFull }}</p>
      <p class="mt-1 text-xs opacity-70">{{ today }}</p>
    </div>
  </header>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
import type { FontSize, ThemeMode, ToggleKey } from '~/composables/useBlogSettings'
import type { MenuBarMenu } from '~/stores/ui'

interface MenuItem {
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  action?: () => void
}

const ui = useUiStore()
const windows = useWindowsStore()
const { settings, setFontSize, setTheme, toggle } = useBlogSettings()

const clock = ref('')
const clockFull = ref('')
const today = ref('')
let timer: ReturnType<typeof setInterval> | undefined

const fontOptions: { value: FontSize, label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
]

const themeTiles: { value: ThemeMode, label: string, icon: string }[] = [
  { value: 'light', label: '浅色', icon: 'theme-light' },
  { value: 'dark', label: '深色', icon: 'theme-dark' },
]

const controlToggles: { key: ToggleKey, label: string }[] = [
  { key: 'dockAutoHide', label: 'Dock 自动隐藏' },
  { key: 'animations', label: '界面动效' },
  { key: 'desktopIcons', label: '首页快捷启动' },
  { key: 'bootScreen', label: '开机动画' },
  { key: 'menuBarClock', label: '显示时钟' },
  { key: 'oneScreen', label: '一屏模式' },
  { key: 'fireworks', label: '烟花特效' },
]

const appMenus: { id: 'app' | 'file' | 'edit' | 'view' | 'go' | 'window' | 'help', title: string }[] = [
  { id: 'app', title: SITE.name },
  { id: 'file', title: '文件' },
  { id: 'edit', title: '编辑' },
  { id: 'view', title: '显示' },
  { id: 'go', title: '前往' },
  { id: 'window', title: '窗口' },
  { id: 'help', title: '帮助' },
]

// 必须是 computed：下面每一项的 checked 都跟着 settings 走。
// 写成普通对象会在 setup 时求值一次就被冻结，之后从控制中心改主题/字体/一屏模式，
// 菜单里的勾选标记会永远停在初始状态（假 UI）。
const menus = computed<Record<string, MenuItem[]>>(() => ({
  system: [
    { label: '关于本站', icon: 'user', action: () => windows.open('about') },
    { label: '分隔', shortcut: '' },
    { label: '系统设置…', icon: 'gear', shortcut: '⌘,', action: () => windows.open('settings') },
    { label: '更换壁纸…', icon: 'wallpaper', action: () => windows.open('wallpaper') },
    { label: 'Launchpad', icon: 'launchpad', action: () => ui.toggleLaunchpad(true) },
    { label: 'Spotlight 搜索', icon: 'search', shortcut: '⌘K', action: () => ui.toggleSpotlight(true) },
    { label: '分隔' },
    { label: '重新播放开机动画', icon: 'refresh', action: () => ui.replayBoot() },
    { label: '关闭所有窗口', icon: 'window', action: () => windows.closeAll() },
    { label: '清空桌面（只留壁纸）', icon: 'monitor', action: () => ui.toggleDesktopClean() },
    { label: '复位窗口位置', icon: 'refresh', action: () => windows.resetAll() },
  ],
  app: [
    { label: '关于本站', action: () => windows.open('about') },
    { label: '分隔' },
    { label: '偏好设置…', shortcut: '⌘,', action: () => windows.open('settings') },
    { label: '显示 Dock', checked: !settings.value.dockAutoHide, action: () => toggle('dockAutoHide') },
    { label: '分隔' },
    { label: '回到首页', action: () => navigate('/') },
  ],
  file: [
    { label: '打开文章列表', shortcut: '⌘1', action: () => navigate('/blog') },
    { label: '打开标签页', shortcut: '⌘2', action: () => navigate('/tags') },
    { label: '打开关于我', shortcut: '⌘3', action: () => navigate('/about') },
    { label: '分隔' },
    { label: '关闭窗口', shortcut: '⌘W', action: () => windows.closeAll() },
    { label: '打印…', shortcut: '⌘P', disabled: true },
  ],
  edit: [
    { label: '撤销', shortcut: '⌘Z', disabled: true },
    { label: '重做', shortcut: '⇧⌘Z', disabled: true },
    { label: '分隔' },
    { label: '剪切', shortcut: '⌘X', disabled: true },
    { label: '拷贝', shortcut: '⌘C', disabled: true },
    { label: '粘贴', shortcut: '⌘V', disabled: true },
    { label: '全选', shortcut: '⌘A', disabled: true },
  ],
  view: [
    { label: '浅色外观', checked: settings.value.theme === 'light', action: () => setTheme('light') },
    { label: '深色外观', checked: settings.value.theme === 'dark', action: () => setTheme('dark') },
    { label: '跟随系统', checked: settings.value.theme === 'auto', action: () => setTheme('auto') },
    { label: '分隔' },
    { label: '字体 小', checked: settings.value.fontSize === 'small', action: () => setFontSize('small') },
    { label: '字体 中', checked: settings.value.fontSize === 'medium', action: () => setFontSize('medium') },
    { label: '字体 大', checked: settings.value.fontSize === 'large', action: () => setFontSize('large') },
    { label: '分隔' },
    { label: '一屏模式', checked: settings.value.oneScreen, action: () => toggle('oneScreen') },
    { label: '烟花特效', checked: settings.value.fireworks, action: () => toggle('fireworks') },
    { label: 'Dock 自动隐藏', checked: settings.value.dockAutoHide, action: () => toggle('dockAutoHide') },
  ],
  go: [
    { label: '首页', shortcut: '⌘⇧H', action: () => navigate('/') },
    { label: '文章列表', action: () => navigate('/blog') },
    { label: '标签', action: () => navigate('/tags') },
    { label: '关于我', action: () => navigate('/about') },
    { label: '无限进步', icon: 'chart', action: () => navigate('/progress') },
    { label: '分隔' },
    { label: 'RSS 订阅', action: () => openExternal('/rss.xml') },
    { label: 'Sitemap', action: () => openExternal('/sitemap.xml') },
    { label: 'llms.txt', action: () => openExternal('/llms.txt') },
  ],
  window: [
    { label: 'Finder', action: () => windows.open('finder') },
    { label: '终端', action: () => windows.open('terminal') },
    { label: '系统设置', action: () => windows.open('settings') },
    { label: '壁纸', action: () => windows.open('wallpaper') },
    { label: '分隔' },
    { label: '最小化所有窗口', action: () => minimizeAll() },
    { label: '关闭所有窗口', action: () => windows.closeAll() },
  ],
  help: [
    { label: '关于本站', action: () => windows.open('about') },
    { label: 'llms.txt（给 AI 看的站点索引）', action: () => openExternal('/llms.txt') },
    { label: 'RSS 订阅', action: () => openExternal('/rss.xml') },
  ],
  clock: [],
}))

const TEXT_MENUS = ['system', 'app', 'file', 'edit', 'view', 'go', 'window', 'help'] as const

/** 下拉面板的左偏移：对齐到被点击的菜单项 */
const menuAnchorX = ref(8)

function anchorFrom(event?: MouseEvent) {
  const el = event?.currentTarget as HTMLElement | undefined
  if (el) menuAnchorX.value = Math.round(el.getBoundingClientRect().left)
}

function openMenu(id: string, event?: MouseEvent) {
  anchorFrom(event)
  ui.setMenuBarMenu(id as MenuBarMenu)
}

/** 窄屏（<640px）：菜单栏只保留 🍎 + App 名 + 控制中心 + 时间 */
const narrow = ref(false)
function syncNarrow() {
  narrow.value = window.innerWidth < 640
}

const showTextPanel = computed(() => TEXT_MENUS.includes(ui.menuBarMenu as typeof TEXT_MENUS[number]))

const textMenuItems = computed<MenuItem[]>(() => {
  const raw = menus.value[ui.menuBarMenu as string] ?? []
  return raw.map(item => (item.label.trim() === '分隔' ? { separator: true, label: '' } : item))
})

function runMenu(item: MenuItem) {
  ui.setMenuBarMenu('')
  item.action?.()
}

function hoverSwitch(id: string, event?: MouseEvent) {
  // macOS 行为：已经打开某个菜单时，滑过其它菜单直接切换
  if (ui.menuBarMenu && ui.menuBarMenu !== id) openMenu(id, event)
}

function navigate(path: string) {
  ui.setMenuBarMenu('')
  useRouter().push(path)
}

function openExternal(path: string) {
  ui.setMenuBarMenu('')
  if (import.meta.client) window.open(path, '_blank')
}

function minimizeAll() {
  ui.setMenuBarMenu('')
  for (const win of Object.values(windows.windows)) {
    if (win.isOpen) windows.minimize(win.id)
  }
}

function updateClock() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  clock.value = `${week} ${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`
  clockFull.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  today.value = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function onDocumentClick(event: MouseEvent) {
  if (!ui.menuBarMenu) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-topbar]')) return
  ui.setMenuBarMenu('')
}

onMounted(() => {
  updateClock()
  syncNarrow()
  timer = setInterval(updateClock, 10000)
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('resize', syncNarrow)
})

onUnmounted(() => {
  clearInterval(timer)
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('resize', syncNarrow)
})
</script>
