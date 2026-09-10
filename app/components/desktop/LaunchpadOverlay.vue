<template>
  <div
    class="fixed inset-0 z-[60] flex flex-col items-center bg-slate-900/35 backdrop-blur-2xl dark:bg-slate-950/60"
    data-launchpad
    @click.self="close"
  >
    <!-- 搜索 -->
    <div class="mt-16 w-full max-w-sm px-4" @click.stop>
      <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/20 px-3 py-2 backdrop-blur-xl">
        <DesktopOsIcon name="search" class="h-4 w-4 text-slate-400" />
        <input
          ref="input"
          v-model="query"
          type="text"
          placeholder="搜索应用"
          data-launchpad-input
          class="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/60"
          @keydown.esc.prevent="close"
        >
      </div>
    </div>

    <!-- 应用网格 -->
    <div class="mt-10 w-full max-w-4xl flex-1 overflow-auto px-8 pb-24" @click.self="close">
      <div class="grid grid-cols-3 gap-6 sm:grid-cols-4 md:grid-cols-6">
        <button
          v-for="app in filtered"
          :key="app.key"
          type="button"
          class="group flex flex-col items-center gap-2 rounded-2xl p-2 transition"
          :class="animate ? 'hover:scale-105' : ''"
          :data-launchpad-app="app.key"
          @click="launch(app)"
        >
          <img
            v-if="app.src"
            :src="app.src"
            :alt="app.label"
            draggable="false"
            class="h-16 w-16 select-none object-contain drop-shadow-lg"
          >
          <span v-else class="grid h-16 w-16 place-items-center rounded-2xl border border-white/12 bg-white/10">
            <DesktopOsIcon :name="app.glyph!" class="h-7 w-7 text-white/85" />
          </span>
          <span class="text-xs text-white/90 drop-shadow">{{ app.label }}</span>
        </button>
      </div>

      <p v-if="!filtered.length" class="mt-16 text-center text-sm text-slate-500">
        没有匹配的应用
      </p>
    </div>

    <!-- 分页点（装饰） -->
    <div class="pointer-events-none absolute bottom-8 flex gap-1.5">
      <span class="h-1.5 w-1.5 rounded-full bg-white/70" />
      <span class="h-1.5 w-1.5 rounded-full bg-white/25" />
      <span class="h-1.5 w-1.5 rounded-full bg-white/25" />
    </div>
  </div>
</template>

<script setup lang="ts">
const ui = useUiStore()
const router = useRouter()
const windows = useWindowsStore()
const { settings } = useBlogSettings()

const query = ref('')
const input = ref<HTMLInputElement | null>(null)

const animate = computed(() => settings.value.animations)

/** 应用图标一律用真·macOS App 图标（和 Dock 同一套资源）；没有对应 App 的入口用单色线性图标 */
const apps = [
  { key: 'finder', kind: 'window' as const, label: 'Finder', src: '/app-icons/finder/128.png' },
  { key: 'launchpad', kind: 'action' as const, label: 'Launchpad', src: '/app-icons/launchpad/128.png' },
  { key: 'blog', kind: 'route' as const, to: '/blog', label: '文章列表', src: '/app-icons/safari/128.png' },
  { key: 'tags', kind: 'route' as const, to: '/tags', label: '标签', src: '/app-icons/notes/128.png' },
  { key: 'about-page', kind: 'route' as const, to: '/about', label: '关于我', src: '/app-icons/contacts/128.png' },
  { key: 'progress', kind: 'route' as const, to: '/progress', label: '无限进步', src: '/app-icons/calendar/128.png' },
  { key: 'terminal', kind: 'window' as const, label: '终端', src: '/app-icons/terminal/128.png' },
  { key: 'settings', kind: 'window' as const, label: '系统设置', src: '/app-icons/system-preferences/128.png' },
  { key: 'wallpaper', kind: 'window' as const, label: '壁纸', src: '/app-icons/wallpapers/128.png' },
  { key: 'about', kind: 'window' as const, label: '关于本站', src: '/app-icons/contacts/128.png' },
  { key: 'news', kind: 'link' as const, to: '/rss.xml', label: 'RSS 订阅', src: '/app-icons/news/128.png' },
  { key: 'trash', kind: 'window' as const, label: '废纸篓', src: '/app-icons/trash/128.svg' },
  { key: 'spotlight', kind: 'action' as const, label: 'Spotlight 搜索', glyph: 'search' },
  { key: 'home', kind: 'route' as const, to: '/', label: '首页', glyph: 'home' },
  { key: 'sitemap', kind: 'link' as const, to: '/sitemap.xml', label: 'Sitemap', glyph: 'sitemap' },
]

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return apps
  return apps.filter(app => app.label.toLowerCase().includes(q) || app.key.includes(q))
})

function close() {
  ui.toggleLaunchpad(false)
}

function launch(app: (typeof apps)[number]) {
  close()
  if (app.kind === 'window') return windows.open(app.key)
  if (app.kind === 'action') return ui.toggleSpotlight(true)
  if (app.kind === 'link') return void window.open(app.to, '_blank')
  router.push(app.to!)
}

onMounted(() => input.value?.focus())
</script>
