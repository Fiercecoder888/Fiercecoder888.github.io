<template>
  <div class="relative min-h-screen">
    <!-- 桌面壁纸：固定全屏，内容在上面滚动 -->
    <DesktopWallpaperLayer />

    <DesktopTopBar />

    <div v-show="!ui.desktopClean" class="relative z-10">
      <main class="w-full" data-desktop-surface>
        <template v-if="isDesktop">
          <slot />
        </template>
        <DesktopMacWindow v-else :chrome="isArticle ? 'safari' : 'default'">
          <slot />
        </DesktopMacWindow>
      </main>

      <footer class="pb-28 pt-6 text-center text-[11px] text-white/40">
        <p>© {{ new Date().getFullYear() }} {{ SITE.name }} · Nuxt 4 + Nuxt Content</p>
        <p class="mt-1">
          <a href="/sitemap.xml" class="transition hover:text-white/70">Sitemap</a>
          <span class="mx-1.5">·</span>
          <a href="/llms.txt" class="transition hover:text-white/70">llms.txt</a>
          <span class="mx-1.5">·</span>
          <a href="/rss.xml" class="transition hover:text-white/70">RSS</a>
        </p>
      </footer>
    </div>

    <DesktopLayer />

    <ClientOnly>
      <!-- 点击放烟花 -->
      <DesktopFireworksCanvas />

      <!-- 清空桌面 / 显示内容（只留壁纸的纯净桌面） -->
      <DesktopClearButton />

      <!-- 一屏模式的退出入口 -->
      <button
        v-if="settings.oneScreen"
        type="button"
        class="fixed right-4 top-10 z-50 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[11px] text-white/80 backdrop-blur-md transition hover:border-white/35 hover:text-white"
        data-one-screen-exit
        @click="toggle('oneScreen')"
      >
        一屏模式 · 点此退出
      </button>
    </ClientOnly>

    <AppDock />
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const { settings, toggle, hydrate } = useBlogSettings()
const { hydrate: hydrateWallpaper } = useWallpaper()

const route = useRoute()
const ui = useUiStore()
// 首页 = 桌面；其余页面装进白色 mac 窗口
const isDesktop = computed(() => route.path === '/')
// 文章详情页用 Safari 风格窗口壳（带地址栏与前进后退）
const isArticle = computed(() => route.path.startsWith('/blog/'))

// 清空桌面（纯净桌面）时，页面内容整体隐藏，只剩壁纸 + 菜单栏 + Dock + 窗口
// 切换路由自动恢复显示，避免点 Dock 后什么都看不到
watch(() => route.path, () => {
  ui.setDesktopClean(false)
})

// 一屏模式：给 body 加类，锁页面滚动
watchEffect(() => {
  if (import.meta.server) return
  document.body.classList.toggle('one-screen-mode', settings.value.oneScreen)
})

// 客户端挂载后读取 localStorage 偏好（字体大小、Dock 自动隐藏、动效开关、彩蛋开关、壁纸）
onMounted(() => {
  hydrate()
  hydrateWallpaper()
})
</script>
