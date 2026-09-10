<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">标签</h1>
      <p class="mt-2 text-sm text-gray-500">共 {{ tagList.length }} 个标签</p>
    </header>

    <div v-if="tagList.length" class="flex flex-wrap gap-2">
      <NuxtLink
        v-for="tag in tagList"
        :key="tag.name"
        :to="`/tags/${encodeURIComponent(tag.name)}`"
        class="group inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-600 hover:shadow-sm"
      >
        #{{ tag.name }}
        <span class="text-xs text-gray-400">{{ tag.count }}</span>
      </NuxtLink>
    </div>
    <p v-else class="text-sm text-gray-400">还没有标签。</p>
  </div>
</template>

<script setup lang="ts">
const { data: posts } = await useAsyncData('tags-posts', () =>
  queryCollection('blog').where('draft', '=', false).select('tags').all(),
)

const tagList = computed(() => {
  const map = new Map<string, number>()
  for (const post of posts.value ?? []) {
    for (const tag of post.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})

useWindowTitle('标签')

useSeoMeta({ title: '标签', description: '按标签浏览文章。' })
</script>
