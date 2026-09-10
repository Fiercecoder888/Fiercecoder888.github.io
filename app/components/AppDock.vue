<template>
  <!-- 外层只负责定位：pointer-events-none，不拦截页面点击、不做大面积 hover 判定 -->
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-[5.2rem] justify-center p-2 pb-3">
    <nav
      class="mac-dock pointer-events-auto flex max-w-full items-end gap-2 overflow-visible p-2 transition-transform duration-300 max-sm:overflow-x-auto"
      data-dock
      :class="hidden ? 'translate-y-[200%]' : 'translate-y-0'"
      @mouseenter="dockHover = true"
      @mouseleave="dockHover = false"
    >
      <template v-for="app in apps" :key="app.id">
        <span v-if="app.dockBreakBefore" class="mac-dock-divider self-stretch" />
        <DesktopDockItem
          :item-key="app.id"
          :label="app.name"
          :icon-src="app.icon"
          :href="app.kind === 'link' ? app.to : undefined"
          :active="isActive(app)"
          :mouse-x="mouseX"
          :mouse-y="mouseY"
          :animate="animate"
          :base-width="52"
          @select="onSelect(app)"
        />
      </template>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { DOCK_APPS, type AppDef } from '~/configs/apps'

const store = useWindowsStore()
const ui = useUiStore()
const router = useRouter()
const { settings } = useBlogSettings()

const apps = DOCK_APPS

const dockHover = ref(false)
const nearEdge = ref(false)
const mouseX = ref<number | null>(null)
const mouseY = ref<number | null>(null)

let viewportHeight = 0
/** 只有进入屏幕最底部这一小段才唤出 Dock（对应 macos-web 的 30px 阈值） */
const REVEAL_BAND = 30

function updateNearEdge(y: number) {
  nearEdge.value = viewportHeight - y <= REVEAL_BAND
}

const hidden = computed(() => settings.value.dockAutoHide && !dockHover.value && !nearEdge.value)

/** 窄屏 Dock 需要横向滚动（overflow-x-auto 会让竖向也裁剪），所以窄屏不做放大 */
const narrow = ref(false)
const animate = computed(() => settings.value.animations && !narrow.value)

const route = useRoute()

function isActive(app: AppDef) {
  if (app.kind === 'window') return Boolean(store.windows[app.id]?.isOpen)
  if (app.kind === 'route' && app.to) {
    return route.path === app.to || (app.to !== '/' && route.path.startsWith(app.to))
  }
  return false
}

function onSelect(app: AppDef) {
  if (app.kind === 'window') return store.toggle(app.id)
  if (app.kind === 'action') return ui.toggleLaunchpad(true)
  if (app.kind === 'route' && app.to) return void router.push(app.to)
}

function onPointerMove(event: PointerEvent) {
  mouseX.value = event.clientX
  mouseY.value = event.clientY
  updateNearEdge(event.clientY)
}

function syncViewport() {
  viewportHeight = window.innerHeight
  narrow.value = window.innerWidth < 640
  if (mouseY.value !== null) updateNearEdge(mouseY.value)
}

onMounted(() => {
  syncViewport()
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('resize', syncViewport)
})
</script>
