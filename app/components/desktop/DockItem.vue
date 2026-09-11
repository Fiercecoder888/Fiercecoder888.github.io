<template>
  <component
    :is="href ? 'a' : 'button'"
    ref="root"
    :href="href"
    :type="href ? undefined : 'button'"
    :title="label"
    :data-dock-item="itemKey"
    class="group relative flex shrink-0 items-end justify-center"
    :style="{ width: `${width}px`, height: `${width}px` }"
    @click="onClick"
  >
    <img
      :src="iconSrc"
      :alt="label"
      draggable="false"
      class="h-full w-full select-none object-contain"
      :style="{ transform: `translateY(${bounce}px)`, filter: 'drop-shadow(0 4px 7px rgba(0,0,0,.35))' }"
    >

    <!-- 运行中指示点（macOS 是图标下方的小圆点） -->
    <span
      v-if="active"
      class="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current opacity-70"
      data-dock-active
    />

    <!-- macOS 悬浮标签 -->
    <span
      class="pointer-events-none absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-neutral-700/90 px-2 py-0.5 text-xs text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-100 group-hover:opacity-100"
    >
      {{ label }}
    </span>
  </component>
</template>

<script setup lang="ts">
/**
 * Dock 图标：图标用真实 macOS App 图标（macos-web 资源），
 * 放大算法照搬 macos-web 的 DockItem.svelte（距离插值 + 弹簧）。
 */
const props = withDefaults(defineProps<{
  itemKey: string
  label: string
  iconSrc: string
  active?: boolean
  href?: string
  mouseX: number | null
  mouseY?: number | null
  animate?: boolean
  baseWidth?: number
}>(), {
  active: false,
  mouseY: null,
  animate: true,
  baseWidth: 52,
})

const emit = defineEmits<{ (event: 'select'): void }>()

const root = ref<HTMLElement | null>(null)

/* ---------- 距离插值（照搬 macos-web） ---------- */
const base = computed(() => props.baseWidth)
const distanceLimit = computed(() => base.value * 6)

const distanceInput = computed(() => [
  -distanceLimit.value,
  -distanceLimit.value / 1.25,
  -distanceLimit.value / 2,
  0,
  distanceLimit.value / 2,
  distanceLimit.value / 1.25,
  distanceLimit.value,
])

const widthOutput = computed(() => [
  base.value,
  base.value * 1.1,
  base.value * 1.414,
  base.value * 2,
  base.value * 1.414,
  base.value * 1.1,
  base.value,
])

function interpolate(x: number) {
  const xs = distanceInput.value
  const ys = widthOutput.value
  if (x <= xs[0]!) return ys[0]!
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i]! && x <= xs[i + 1]!) {
      const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!)
      return ys[i]! + t * (ys[i + 1]! - ys[i]!)
    }
  }
  return base.value
}

/* ---------- 弹簧（阻尼 0.47 / 刚度 0.12，同 macos-web 的 spring 参数） ---------- */
const width = ref(props.baseWidth)
const targetWidth = ref(props.baseWidth)
const bounce = ref(0)

let velocity = 0
let raf = 0
let running = false

const DAMPING = 0.47
const STIFFNESS = 0.12

function tick() {
  const delta = targetWidth.value - width.value
  velocity = (velocity + delta * STIFFNESS) * DAMPING
  width.value += velocity

  if (Math.abs(delta) < 0.05 && Math.abs(velocity) < 0.05) {
    width.value = targetWidth.value
    velocity = 0
    running = false
    return
  }
  raf = requestAnimationFrame(tick)
}

function start() {
  if (running) return
  running = true
  raf = requestAnimationFrame(tick)
}

watch(targetWidth, () => {
  if (!props.animate) {
    width.value = targetWidth.value
    return
  }
  start()
})

/**
 * 基座尺寸会随视口跨越 640px 断点变化（窄屏 48 / 宽屏 52，见 AppDock）。
 * 之前的实现只在 mount 和指针移动时读取 base，改了 base 也不会重排；
 * 这里直接同步，尺寸切换时要的是立刻到位（弹簧只负责 hover 放大）。
 */
watch(base, (value) => {
  velocity = 0
  width.value = value
  targetWidth.value = value
})

/** 鼠标离 Dock 的垂直距离超过这个值就不放大（避免页面中部误触发放大） */
const VERTICAL_GATE = 56

function updateFromPointer() {
  if (!props.animate || props.mouseX === null || !root.value) {
    targetWidth.value = base.value
    return
  }
  const rect = root.value.getBoundingClientRect()

  if (props.mouseY !== null && props.mouseY < rect.top - VERTICAL_GATE) {
    targetWidth.value = base.value
    return
  }

  const centerX = rect.left + rect.width / 2
  targetWidth.value = interpolate(props.mouseX - centerX)
}

watch(() => [props.mouseX, props.mouseY], updateFromPointer)
onMounted(updateFromPointer)
onUnmounted(() => cancelAnimationFrame(raf))

function onClick(event: MouseEvent) {
  if (props.animate) {
    bounce.value = -12
    setTimeout(() => { bounce.value = 0 }, 90)
  }
  if (!props.href) emit('select')
  else event.stopPropagation()
}
</script>
