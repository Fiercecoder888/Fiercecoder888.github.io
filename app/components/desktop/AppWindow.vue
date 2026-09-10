<template>
  <div
    v-if="win && win.isOpen && !win.isMinimize"
    ref="root"
    :data-window="props.id"
    class="fixed overflow-hidden rounded-xl border border-white/10 bg-slate-900/85 shadow-2xl shadow-black/60 backdrop-blur-2xl"
    :class="win.isMaximized ? 'inset-2 !w-auto !h-auto' : ''"
    :style="win.isMaximized ? { zIndex: win.zIndex } : { left: `${win.x ?? 0}px`, top: `${win.y ?? 0}px`, width: `${win.width}px`, height: `${win.height}px`, zIndex: win.zIndex }"
    @pointerdown="store.focus(props.id)"
  >
    <!-- 标题栏 -->
    <div
      class="flex h-10 select-none items-center gap-2 border-b border-white/5 bg-white/5 px-3"
      data-window-titlebar
      :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
      @pointerdown="startDrag"
      @dblclick="store.toggleMaximize(props.id)"
    >
      <div class="mac-traffic flex items-center gap-2.5" data-no-drag>
        <button
          type="button"
          data-action="close"
          class="mac-btn btn-close grid place-items-center"
          :title="`关闭 ${win.title}`"
          @click.stop="store.close(props.id)"
        >
          <DesktopOsIcon name="close" class="h-2 w-2 text-black/70" />
        </button>
        <button
          type="button"
          data-action="minimize"
          class="mac-btn btn-minimize grid place-items-center"
          :title="`最小化 ${win.title}`"
          @click.stop="store.minimize(props.id)"
        >
          <DesktopOsIcon name="minus" class="h-2 w-2 text-black/70" />
        </button>
        <button
          type="button"
          data-action="maximize"
          class="mac-btn btn-maximize grid place-items-center"
          :title="win.isMaximized ? '还原' : '最大化'"
          @click.stop="store.toggleMaximize(props.id)"
        >
          <DesktopOsIcon name="square" class="h-1.5 w-1.5 text-black/70" />
        </button>
      </div>

      <div class="pointer-events-none flex flex-1 items-center justify-center gap-1.5 text-xs font-medium text-slate-300">
        <span>{{ win.title }}</span>
      </div>

      <div class="w-14" data-no-drag />
    </div>

    <!-- 内容 -->
    <div class="h-[calc(100%-2.5rem)] overflow-auto">
      <slot />
    </div>

    <!-- resize 手柄 -->
    <template v-if="!win.isMaximized">
      <div
        data-resize="e"
        class="absolute bottom-3 right-0 top-10 w-1.5 cursor-ew-resize transition hover:bg-blue-400/30"
        @pointerdown.stop="startResize($event, 'e')"
      />
      <div
        data-resize="s"
        class="absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize transition hover:bg-blue-400/30"
        @pointerdown.stop="startResize($event, 's')"
      />
      <div
        data-resize="se"
        class="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        @pointerdown.stop="startResize($event, 'se')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ id: string }>()

const store = useWindowsStore()
const win = computed(() => store.windows[props.id])

const root = ref<HTMLElement | null>(null)
const dragging = ref(false)

let start = { pointerX: 0, pointerY: 0, winX: 0, winY: 0 }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function startDrag(event: PointerEvent) {
  if (!win.value || win.value.isMaximized) return
  if (event.button !== 0) return

  dragging.value = true
  start = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    winX: win.value.x ?? 0,
    winY: win.value.y ?? 0,
  }

  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', stopDrag)
}

function onDrag(event: PointerEvent) {
  if (!dragging.value || !win.value) return
  // 移动端不做拖拽，避免和滑动手势冲突
  if (window.innerWidth < 640) return

  const nextX = start.winX + (event.clientX - start.pointerX)
  const nextY = start.winY + (event.clientY - start.pointerY)

  const maxX = Math.max(0, window.innerWidth - win.value.width)
  const maxY = Math.max(0, window.innerHeight - 60)

  store.move(props.id, clamp(nextX, 0, maxX), clamp(nextY, 0, maxY))
}

function stopDrag() {
  dragging.value = false
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', stopDrag)
}

/* ---------- 尺寸拖拽 ---------- */
type ResizeDirection = 'e' | 's' | 'se'

const resizing = ref<ResizeDirection | null>(null)
let resizeStart = { pointerX: 0, pointerY: 0, width: 0, height: 0 }

function startResize(event: PointerEvent, direction: ResizeDirection) {
  if (!win.value || win.value.isMaximized || event.button !== 0) return
  event.preventDefault()
  store.focus(props.id)
  resizing.value = direction
  resizeStart = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    width: win.value.width,
    height: win.value.height,
  }
  window.addEventListener('pointermove', onResize)
  window.addEventListener('pointerup', stopResize)
}

function onResize(event: PointerEvent) {
  if (!resizing.value || !win.value) return
  const dx = event.clientX - resizeStart.pointerX
  const dy = event.clientY - resizeStart.pointerY
  const width = resizing.value === 's' ? resizeStart.width : resizeStart.width + dx
  const height = resizing.value === 'e' ? resizeStart.height : resizeStart.height + dy
  store.resize(props.id, width, height)
}

function stopResize() {
  resizing.value = null
  window.removeEventListener('pointermove', onResize)
  window.removeEventListener('pointerup', stopResize)
}

onMounted(() => {
  store.ensurePosition(props.id, window.innerWidth, window.innerHeight)
})

onUnmounted(() => {
  stopDrag()
  stopResize()
})
</script>
