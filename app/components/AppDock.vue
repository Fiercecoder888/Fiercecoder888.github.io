<template>
  <!-- 外层只负责定位：pointer-events-none，不拦截页面点击、不做大面积 hover 判定 -->
  <!-- 窄屏 Dock 换成两行（底部锚定 + 高度自适应），宽屏仍锁死 5.2rem，外观/行为不变 -->
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex h-auto justify-center p-2 pb-3 sm:h-[5.2rem]">
    <nav
      class="mac-dock pointer-events-auto flex max-w-full flex-wrap items-end justify-center gap-1 overflow-visible p-2 transition-transform duration-300 sm:flex-nowrap sm:justify-start sm:gap-2"
      data-dock
      :class="hidden ? 'translate-y-[200%]' : 'translate-y-0'"
      @mouseenter="dockHover = true"
      @mouseleave="dockHover = false"
    >
      <template v-for="app in apps" :key="app.id">
        <span v-if="app.dockBreakBefore" class="mac-dock-divider max-sm:hidden self-stretch" />
        <DesktopDockItem
          :item-key="app.id"
          :label="app.name"
          :icon-src="app.icon"
          :href="app.kind === 'link' ? app.to : undefined"
          :active="isActive(app)"
          :mouse-x="mouseX"
          :mouse-y="mouseY"
          :animate="animate"
          :base-width="narrow ? NARROW_BASE : WIDE_BASE"
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

/**
 * Dock 图标基座尺寸（= DockItem 的正方形边长，也就是最小可点区域）。
 *
 * 宽屏（>= 640px）保持原来的 52px 与 8px 间距，外观/放大行为完全不变。
 * 窄屏必须换行成两行才不用横滑，11 个图标按 6 + 5 排，算术：
 *   390px 视口 → 可用宽度 390 - 2*8(外层 p-2) - 2*8(nav p-2) = 358px
 *   第一行 6 个 = 6*48 + 5*4(gap-1) = 308px  <= 358px ✓（第二行 5 个 = 256px）
 *   375px 视口也有 343px，308 依然放得下（若沿用 52px 基座则一行只放得下 5 个，
 *   375px 会退化成 3 行、Dock 高 208px）
 * 48px 仍高于 Apple 44pt 的最小点击目标，图标肉眼清晰。
 */
const WIDE_BASE = 52
const NARROW_BASE = 48

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

/**
 * 窄屏（< 640px）Dock 换行成两行、不再横滑，同时禁用放大：
 * 放大算法（距离插值）假设所有图标在同一行，换行后鼠标的 x 距离会算串行；
 * 而且触屏本来也没有 hover。宽屏（≥ 640px）行为完全不变。
 */
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
