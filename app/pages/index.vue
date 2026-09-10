<template>
  <div class="mx-auto w-full max-w-[1400px] p-4 md:p-8">
    <div class="flex flex-col flex-wrap justify-between gap-6 md:flex-row">
      <!-- ================= 左栏 ================= -->
      <div class="w-full space-y-6 md:max-w-xs">
        <!-- 个人名片 -->
        <section class="widget-container">
          <div class="flex items-center gap-4">
            <div class="relative">
              <div class="h-16 w-16 rounded-full border border-white/20 bg-slate-700 p-0.5">
                <div class="grid h-full w-full place-items-center rounded-full bg-slate-900/80 text-xl font-bold text-white">{{ SITE.avatarText }}</div>
              </div>
              <div class="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-slate-900/60 bg-green-500 text-white">
                <DesktopOsIcon name="check" class="h-3 w-3" />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-bold text-white/95">{{ SITE.author }}</h3>
              <p class="truncate text-sm text-white/60">{{ SITE.role }}</p>
            </div>
          </div>

          <p class="mt-4 text-sm leading-relaxed text-white/70">
            {{ SITE.tagline }}<br>{{ SITE.bio }}
          </p>

          <div class="mt-4 flex items-center gap-2 border-t border-white/10 pt-4">
            <a href="/rss.xml" title="RSS" class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white">
              <DesktopOsIcon name="rss" class="h-4 w-4" />
            </a>
            <a href="/llms.txt" title="llms.txt" class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white">
              <DesktopOsIcon name="robot" class="h-4 w-4" />
            </a>
            <a href="/sitemap.xml" title="Sitemap" class="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white">
              <DesktopOsIcon name="sitemap" class="h-4 w-4" />
            </a>
            <NuxtLink to="/about" class="ml-auto text-xs text-white/50 transition-colors hover:text-white/80">了解更多 →</NuxtLink>
          </div>
        </section>

        <!-- 文章列表 -->
        <section class="widget-container">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="widget-badge bg-emerald-500">
                <DesktopOsIcon name="doc" class="h-4 w-4" />
              </span>
              <div class="flex items-center gap-1">
                <button
                  v-for="tab in tabs"
                  :key="tab.key"
                  type="button"
                  class="rounded-md px-1.5 py-0.5 text-sm font-semibold transition"
                  :class="activeTab === tab.key ? 'text-white/95' : 'text-white/40 hover:text-white/70'"
                  @click="activeTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
            <NuxtLink to="/blog" class="text-xs text-white/60 transition-colors hover:text-white/90">查看全部 →</NuxtLink>
          </div>

          <ul class="space-y-2">
            <li v-for="post in visiblePosts" :key="post.path">
              <NuxtLink :to="post.path" class="article-item group">
                <p class="line-clamp-1 text-sm font-medium text-white/90 transition group-hover:text-white">{{ post.title }}</p>
                <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-white/70">{{ post.description }}</p>
                <div class="mt-2 flex items-center gap-2 text-[11px] text-white/65">
                  <span>{{ formatDate(post.date) }}</span>
                  <span v-if="post.category" class="rounded bg-white/15 px-1.5 py-0.5 text-white/80">{{ post.category }}</span>
                  <span class="ml-auto">{{ readingTime(post.body) }}</span>
                </div>
              </NuxtLink>
            </li>
            <li v-if="!visiblePosts.length" class="py-6 text-center text-xs text-white/60">还没有文章</li>
          </ul>
        </section>
      </div>

      <!-- ================= 右栏 ================= -->
      <div class="w-full space-y-6 md:max-w-xs">
        <!-- 站点概览 -->
        <section class="widget-container">
          <div class="mb-5 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="widget-badge bg-blue-500">
                <DesktopOsIcon name="chart" class="h-4 w-4" />
              </span>
              <span class="text-sm font-semibold text-white/95">站点概览</span>
            </div>
            <div class="flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              <span class="text-[10px] font-medium text-green-400">运行中</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div v-for="stat in stats" :key="stat.label" class="stat-card group">
              <div class="flex flex-col">
                <span class="text-[11px] text-white/65">{{ stat.label }}</span>
                <span class="mt-1 text-xl font-semibold text-white/95">
                  {{ stat.value }}<span class="ml-0.5 text-[11px] font-normal text-white/40">{{ stat.unit }}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="mt-4 flex items-center border-t border-white/5 pt-3 text-xs">
            <span class="text-white/50">文章最后更新于</span>
            <span class="ml-auto font-mono text-white/70">{{ lastUpdated }}</span>
          </div>
        </section>

        <!-- 分类 / 标签 -->
        <section class="widget-container">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="widget-badge bg-violet-500">
                <DesktopOsIcon name="tag" class="h-4 w-4" />
              </span>
              <span class="text-sm font-semibold text-white/95">分类 / 标签</span>
            </div>
            <NuxtLink to="/tags" class="text-xs text-white/60 transition-colors hover:text-white/90">全部 →</NuxtLink>
          </div>

          <div class="flex flex-wrap gap-2">
            <NuxtLink
              v-for="cat in categoryList"
              :key="cat.name"
              :to="`/tags/${encodeURIComponent(cat.name)}`"
              class="tag-item group"
            >
              <span class="text-sm text-white/80 transition-colors group-hover:text-white">{{ cat.name }}</span>
              <span class="text-xs text-white/40 transition-colors group-hover:text-white/60">{{ cat.count }}</span>
            </NuxtLink>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <NuxtLink
              v-for="tag in tagList.slice(0, 8)"
              :key="tag.name"
              :to="`/tags/${encodeURIComponent(tag.name)}`"
              class="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] text-white/70 transition hover:border-white/30 hover:text-white"
            >
              #{{ tag.name }}
            </NuxtLink>
          </div>
        </section>

        <!-- 快捷启动（桌面 OS 入口） -->
        <section v-if="settings.desktopIcons" class="widget-container">
          <div class="mb-3 flex items-center gap-2">
            <span class="widget-badge bg-sky-500">
              <DesktopOsIcon name="launchpad" class="h-4 w-4" />
            </span>
            <span class="text-sm font-semibold text-white/95">快捷启动</span>
          </div>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="app in quickApps"
              :key="app.id"
              type="button"
              class="flex flex-col items-center gap-1.5 rounded-xl border border-white/8 bg-white/[.04] px-2 py-3 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[.08]"
              :title="app.label"
              @click="store.toggle(app.id)"
            >
              <DesktopOsIcon :name="app.icon" class="h-5 w-5 text-white/80" />
              <span class="text-[10px] text-white/50">{{ app.label }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'

const store = useWindowsStore()
const { settings } = useBlogSettings()

const quickApps = [
  { id: 'finder', label: 'Finder', icon: 'folder' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
  { id: 'settings', label: '设置', icon: 'gear' },
  { id: 'about', label: '关于', icon: 'user' },
  { id: 'trash', label: '废纸篓', icon: 'trash' },
]

const tabs = [
  { key: 'latest' as const, label: '最新' },
  { key: 'shuffle' as const, label: '随便看看' },
]
const activeTab = ref<'latest' | 'shuffle'>('latest')

const { data: all } = await useAsyncData('home-all-posts', () =>
  queryCollection('blog').where('draft', '=', false).order('date', 'DESC').all(),
)

const shuffledPaths = ref<string[]>([])

function shuffle() {
  const paths = (all.value ?? []).map(post => post.path)
  for (let i = paths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[paths[i], paths[j]] = [paths[j]!, paths[i]!]
  }
  shuffledPaths.value = paths.slice(0, 5)
}

watch(activeTab, (tab) => {
  if (tab === 'shuffle') shuffle()
})

const visiblePosts = computed(() => {
  const list = all.value ?? []
  if (activeTab.value === 'shuffle' && shuffledPaths.value.length) {
    return shuffledPaths.value
      .map(path => list.find(post => post.path === path))
      .filter((post): post is (typeof list)[number] => Boolean(post))
  }
  return list.slice(0, 5)
})

const stats = computed(() => {
  const list = all.value ?? []
  const categories = new Set<string>()
  const tags = new Set<string>()
  let chars = 0
  for (const post of list) {
    if (post.category) categories.add(post.category)
    for (const tag of post.tags ?? []) tags.add(tag)
    chars += JSON.stringify(post.body ?? '').length
  }
  const earliest = list.length ? new Date(list[list.length - 1]!.date).getTime() : Date.now()
  const days = Math.max(1, Math.round((Date.now() - earliest) / 86400000))

  return [
    { label: '文章总数', value: list.length, unit: '篇' },
    { label: '分类', value: categories.size, unit: '个' },
    { label: '标签', value: tags.size, unit: '个' },
    { label: '约', value: `${Math.round(chars / 1000)}k`, unit: '字' },
    { label: '距离首篇', value: days, unit: '天' },
    { label: '运行中', value: '99.9', unit: '%' },
  ]
})

const categoryList = computed(() => {
  const map = new Map<string, number>()
  for (const post of all.value ?? []) {
    if (post.category) map.set(post.category, (map.get(post.category) ?? 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const tagList = computed(() => {
  const map = new Map<string, number>()
  for (const post of all.value ?? []) {
    for (const tag of post.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

const lastUpdated = computed(() => {
  const list = all.value ?? []
  if (!list.length) return '—'
  const diff = Date.now() - new Date(list[0]!.date).getTime()
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
})

useSeoMeta({
  title: '首页',
  description: SITE.description,
})
</script>
