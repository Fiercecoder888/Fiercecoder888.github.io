<template>
  <div class="flex h-full min-h-0">
    <!-- 侧栏 -->
    <aside class="w-44 shrink-0 border-r border-white/5 bg-white/[.02] p-3">
      <p class="px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">位置</p>
      <nav class="mt-2 space-y-0.5">
        <button
          v-for="item in sections"
          :key="item.key"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition"
          :class="active === item.key ? 'bg-blue-500/20 text-blue-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
          @click="active = item.key"
        >
          <DesktopOsIcon :name="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <p class="mt-5 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">标签</p>
      <div class="mt-2 flex flex-wrap gap-1 px-1">
        <button
          v-for="tag in topTags"
          :key="tag.name"
          type="button"
          class="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-300 transition hover:text-white"
          @click="goTag(tag.name)"
        >
          #{{ tag.name }}
        </button>
      </div>
    </aside>

    <!-- 主区 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-white/5 px-3 text-xs text-slate-400">
        <span class="text-slate-500">{{ SITE.name }}</span>
        <DesktopOsIcon name="caret" class="h-3 w-3 opacity-60" />
        <span class="text-slate-200">{{ currentSection.label }}</span>
        <span class="ml-auto">{{ rows.length }} 项</span>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-2">
        <div v-if="!rows.length" class="grid h-full place-items-center text-sm text-slate-500">
          这里还是空的
        </div>
        <ul v-else class="space-y-0.5">
          <li v-for="row in rows" :key="row.key">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
              @click="row.action"
            >
              <DesktopOsIcon :name="row.icon" class="h-4 w-4 shrink-0 opacity-80" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-slate-200">{{ row.title }}</span>
                <span class="mt-0.5 block truncate text-[11px] text-slate-500">{{ row.subtitle }}</span>
              </span>
              <span v-if="row.badge" class="rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">{{ row.badge }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const router = useRouter()
const store = useWindowsStore()

const active = ref<'posts' | 'tags' | 'pages'>('posts')

const sections = [
  { key: 'posts' as const, label: '文章列表', icon: 'doc' },
  { key: 'tags' as const, label: '标签', icon: 'tag' },
  { key: 'pages' as const, label: '站点页面', icon: 'globe' },
]

const currentSection = computed(() => sections.find(s => s.key === active.value)!)

const { data: posts } = await useAsyncData('finder-posts', () =>
  queryCollection('blog').where('draft', '=', false).order('date', 'DESC').all(),
)

const { data: draftPosts } = await useAsyncData('finder-drafts', () =>
  queryCollection('blog').where('draft', '=', true).all(),
)

interface Row {
  key: string
  icon: string
  title: string
  subtitle: string
  badge?: string
  action: () => void
}

function close() {
  store.close('finder')
}

const postRows = computed<Row[]>(() => (posts.value ?? []).map(post => ({
  key: post.path,
  icon: 'doc',
  title: post.title,
  subtitle: `${post.date} · ${post.category ?? '未分类'}`,
  badge: post.tags?.[0],
  action: () => {
    close()
    router.push(post.path)
  },
})))

const tagRows = computed<Row[]>(() => {
  const map = new Map<string, number>()
  for (const post of posts.value ?? []) {
    for (const tag of post.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      key: name,
      icon: 'tag',
      title: name,
      subtitle: `${count} 篇文章`,
      action: () => {
        close()
        router.push(`/tags/${encodeURIComponent(name)}`)
      },
    }))
})

const pageRows: Row[] = [
  { key: '/', icon: 'home', title: '首页', subtitle: '/', action: () => { close(); router.push('/') } },
  { key: '/blog', icon: 'doc', title: '全部文章', subtitle: '/blog', action: () => { close(); router.push('/blog') } },
  { key: '/tags', icon: 'tag', title: '标签云', subtitle: '/tags', action: () => { close(); router.push('/tags') } },
  { key: '/about', icon: 'user', title: '关于我', subtitle: '/about', action: () => { close(); router.push('/about') } },
  { key: '/rss.xml', icon: 'rss', title: 'RSS 订阅', subtitle: '/rss.xml', action: () => window.open('/rss.xml', '_blank') },
  { key: '/sitemap.xml', icon: 'sitemap', title: 'Sitemap', subtitle: '/sitemap.xml', action: () => window.open('/sitemap.xml', '_blank') },
  { key: '/llms.txt', icon: 'robot', title: 'llms.txt', subtitle: '/llms.txt', action: () => window.open('/llms.txt', '_blank') },
]

const rows = computed(() => {
  if (active.value === 'tags') return tagRows.value
  if (active.value === 'pages') return pageRows
  return postRows.value
})

const topTags = computed(() => tagRows.value.slice(0, 8).map(row => ({ name: row.title })))

// 草稿数量用于标题栏提示（保持与废纸篓一致）
const draftCount = computed(() => (draftPosts.value ?? []).length)
void draftCount

function goTag(name: string) {
  close()
  router.push(`/tags/${encodeURIComponent(name)}`)
}
</script>
