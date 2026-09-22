<template>
  <ClientOnly>
    <!-- 窗口层 -->
    <div class="pointer-events-none fixed inset-0 z-40">
      <DesktopAppWindow
        v-for="win in store.opened"
        :key="win.id"
        :id="win.id"
        class="pointer-events-auto"
      >
        <DesktopFinderWindow v-if="win.id === 'finder'" />
        <DesktopTerminalWindow v-else-if="win.id === 'terminal'" />
        <DesktopSettingsWindow v-else-if="win.id === 'settings'" />
        <DesktopAboutWindow v-else-if="win.id === 'about'" />
        <DesktopTrashWindow v-else-if="win.id === 'trash'" />
        <DesktopWallpaperWindow v-else-if="win.id === 'wallpaper'" />
        <DesktopJevWindow v-else-if="win.id === 'jev'" />
      </DesktopAppWindow>
    </div>

    <!-- 桌面右键菜单 -->
    <DesktopContextMenu :items="contextItems" />

    <!-- Spotlight 搜索 -->
    <DesktopSpotlightOverlay v-if="ui.spotlightOpen" />

    <!-- Launchpad -->
    <DesktopLaunchpadOverlay v-if="ui.launchpadOpen" />

    <!-- 开机 / 登录 -->
    <DesktopBootScreen />
  </ClientOnly>
</template>

<script setup lang="ts">
import type { ContextMenuItem } from './ContextMenu.vue'

const store = useWindowsStore()
const ui = useUiStore()
const router = useRouter()

const contextItems = ref<ContextMenuItem[]>([])

/** 右键：桌面级菜单；若点在某个窗口上，额外插入窗口操作 */
function buildContextItems(windowId: string | null): ContextMenuItem[] {
  const windowItems: ContextMenuItem[] = windowId
    ? [
        { label: '最小化窗口', icon: 'minus', action: () => store.minimize(windowId) },
        { label: '最大化 / 还原', icon: 'expand', action: () => store.toggleMaximize(windowId) },
        { label: '关闭窗口', icon: 'close', danger: true, action: () => store.close(windowId) },
        { label: '', separator: true },
      ]
    : []

  return [
    ...windowItems,
    { label: '打开 Finder', icon: 'folder', action: () => store.open('finder') },
    { label: '打开终端', icon: 'terminal', action: () => store.open('terminal') },
    { label: '', separator: true },
    { label: 'Launchpad', icon: 'launchpad', shortcut: 'F4', action: () => ui.toggleLaunchpad(true) },
    { label: 'Spotlight 搜索', icon: 'search', shortcut: '⌘K', action: () => ui.toggleSpotlight(true) },
    { label: '', separator: true },
    { label: '系统设置', icon: 'gear', action: () => store.open('settings') },
    { label: '更换壁纸', icon: 'wallpaper', action: () => store.open('wallpaper') },
    { label: '回到首页', icon: 'home', action: () => router.push('/') },
    { label: '文章列表', icon: 'doc', action: () => router.push('/blog') },
    { label: '', separator: true },
    { label: '清空桌面（只留壁纸）', icon: 'monitor', action: () => ui.toggleDesktopClean() },
    { label: '复位窗口位置', icon: 'refresh', action: () => store.resetAll() },
    { label: '重新播放开机动画', icon: 'refresh', action: () => ui.replayBoot() },
    { label: '关于本站', icon: 'user', action: () => store.open('about') },
  ]
}

/** 这些区域保留浏览器默认右键（选中/复制文本、打开链接等） */
const DEFAULT_CONTEXT_SELECTOR = 'article, .prose-blog, input, textarea, [contenteditable="true"], a, pre, code, [data-context-menu]'

function onContextMenu(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.closest(DEFAULT_CONTEXT_SELECTOR)) return

  const windowEl = target.closest('[data-window]') as HTMLElement | null
  contextItems.value = buildContextItems(windowEl?.dataset.window ?? null)

  event.preventDefault()
  ui.openContextMenu(event.clientX, event.clientY)
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey

  if (event.key === 'Escape') {
    ui.closeTopLayer()
    return
  }

  // ⌘/Ctrl + K → Spotlight
  if (meta && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    ui.toggleSpotlight(true)
    return
  }

  // F4 → Launchpad
  if (event.key === 'F4') {
    event.preventDefault()
    ui.toggleLaunchpad(true)
  }
}

function onPointerDown(event: PointerEvent) {
  if (!ui.contextMenu.visible) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-context-menu]')) return
  ui.closeContextMenu()
}

onMounted(() => {
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('contextmenu', onContextMenu)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerDown)
})
</script>
