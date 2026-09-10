<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <NuxtLink to="/tags" class="text-xs text-gray-400 transition hover:text-blue-600">← 全部标签</NuxtLink>
      <h1 class="mt-3 text-3xl font-bold tracking-tight text-gray-800">#{{ tag }}</h1>
      <p class="mt-2 text-sm text-gray-500">{{ posts?.length ?? 0 }} 篇文章</p>
    </header>

    <div v-if="posts?.length" class="grid gap-3">
      <PostCard v-for="post in posts" :key="post.path" :post="post" />
    </div>
    <p v-else class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
      这个标签下还没有文章。
    </p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const tag = computed(() => decodeURIComponent(String(route.params.tag)))

const { data: posts } = await useAsyncData(`tag-${tag.value}`, () =>
  queryCollection('blog')
    .where('draft', '=', false)
    .where('tags', 'LIKE', `%${tag.value}%`)
    .order('date', 'DESC')
    .all(),
)

useWindowTitle(computed(() => `标签：${tag.value}`))

useSeoMeta({
  title: () => `标签：${tag.value}`,
  description: () => `标签 ${tag.value} 下的全部文章。`,
})
</script>
