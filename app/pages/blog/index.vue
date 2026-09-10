<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-gray-800">全部文章</h1>
          <p class="mt-2 text-sm text-gray-500">
            共 <span class="font-medium text-gray-700">{{ posts?.length ?? 0 }}</span> 篇 · 按年份归档
          </p>
        </div>
        <NuxtLink
          to="/worklog"
          class="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
        >
          工作日志 →
        </NuxtLink>
      </div>
    </header>

    <div v-if="posts?.length" class="space-y-10">
      <section v-for="group in grouped" :key="group.year">
        <h2 class="mb-3 flex items-center gap-3 text-sm font-semibold text-gray-700">
          <span>{{ group.year }}</span>
          <span class="h-px flex-1 bg-gray-200" />
          <span class="text-xs font-normal text-gray-400">{{ group.items.length }} 篇</span>
        </h2>
        <div class="grid gap-3">
          <PostCard v-for="post in group.items" :key="post.path" :post="post" />
        </div>
      </section>
    </div>

    <p v-else class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
      还没有文章，在 <code class="text-gray-600">content/blog/</code> 下新建 Markdown 即可。
    </p>
  </div>
</template>

<script setup lang="ts">
const { data: posts } = await useAsyncData('all-posts', () =>
  queryCollection('blog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .all(),
)

const grouped = computed(() => {
  const map = new Map<string, NonNullable<typeof posts.value>>()
  for (const post of posts.value ?? []) {
    const year = String(post.date).slice(0, 4)
    if (!map.has(year)) map.set(year, [] as any)
    map.get(year)!.push(post)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, items]) => ({ year, items }))
})

useWindowTitle('文章列表')

useSeoMeta({
  title: '全部文章',
  description: '按年份归档的全部文章列表。',
})
</script>
