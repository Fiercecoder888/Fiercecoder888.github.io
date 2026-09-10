<template>
  <canvas
    ref="canvas"
    class="pointer-events-none fixed inset-0 z-[55]"
    data-fireworks
    :data-fireworks-particles="particleCount"
  />
</template>

<script setup lang="ts">
/**
 * 烟花特效（xiaohev 的 blog_fireworks_effect）：
 * 点击页面任意位置发射一朵烟花 —— 粒子带初速度、重力与摩擦，寿命耗尽后自动清理；
 * 没有粒子时停止 rAF，不占 CPU。
 */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
}

const { settings } = useBlogSettings()

const canvas = ref<HTMLCanvasElement | null>(null)
const particleCount = ref(0)

let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let raf = 0
let running = false

const PALETTE = ['#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171', '#ffffff']

function resize() {
  const el = canvas.value
  if (!el) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.floor(window.innerWidth * dpr)
  el.height = Math.floor(window.innerHeight * dpr)
  el.style.width = `${window.innerWidth}px`
  el.style.height = `${window.innerHeight}px`
  ctx = el.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** 在 (x, y) 放一朵烟花 */
function burst(x: number, y: number, count = 42) {
  if (import.meta.server || !ctx) return
  const baseColor = PALETTE[Math.floor(Math.random() * PALETTE.length)]!

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.25
    const speed = 1.8 + Math.random() * 4.6
    const life = 48 + Math.random() * 34
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 1.2 + Math.random() * 1.9,
      color: Math.random() > 0.55 ? baseColor : PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
    })
  }
  particleCount.value = particles.length
  start()
}

function frame() {
  const el = canvas.value
  if (!el || !ctx) return

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  ctx.globalCompositeOperation = 'lighter'

  const next: Particle[] = []
  for (const p of particles) {
    p.vy += 0.055          // 重力
    p.vx *= 0.985          // 空气阻力
    p.vy *= 0.985
    p.x += p.vx
    p.y += p.vy
    p.life -= 1

    if (p.life > 0) {
      const alpha = Math.max(0, p.life / p.maxLife)
      ctx.globalAlpha = alpha
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.4 + alpha * 0.8), 0, Math.PI * 2)
      ctx.fill()
      next.push(p)
    }
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  particles = next
  particleCount.value = particles.length

  if (particles.length) {
    raf = requestAnimationFrame(frame)
  }
  else {
    running = false
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  }
}

function start() {
  if (running) return
  running = true
  raf = requestAnimationFrame(frame)
}

function onPointerDown(event: PointerEvent) {
  if (!settings.value.fireworks || !settings.value.animations) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [data-no-fireworks]')) return
  burst(event.clientX, event.clientY)
}

/** 供菜单/快捷键主动放烟花：window.dispatchEvent(new CustomEvent('blog:firework')) */
function onFireworkEvent(event: Event) {
  if (!settings.value.animations) return
  const detail = (event as CustomEvent<{ x?: number, y?: number }>).detail ?? {}
  burst(detail.x ?? window.innerWidth / 2, detail.y ?? window.innerHeight / 3)
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('blog:firework', onFireworkEvent)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('blog:firework', onFireworkEvent)
})

defineExpose({ burst })
</script>
