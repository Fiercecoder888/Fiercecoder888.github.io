<template>
  <article v-if="post">
    <header class="article-header mb-8">
      <h1 class="mb-4 text-4xl font-bold leading-tight text-gray-800">{{ post.title }}</h1>

      <div class="flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span class="flex items-center gap-1.5">
          <DesktopOsIcon name="clock" class="h-4 w-4" />
          <time :datetime="post.date">{{ formatDate(post.date) }}</time>
        </span>
        <span v-if="post.category" class="flex items-center gap-1.5">
          <DesktopOsIcon name="folder" class="h-4 w-4" />
          {{ post.category }}
        </span>
        <span class="flex items-center gap-1.5">约 {{ readingTime(post.body) }}阅读</span>
      </div>

      <div v-if="post.tags?.length" class="mt-4 flex flex-wrap gap-2">
        <NuxtLink
          v-for="tag in post.tags"
          :key="tag"
          :to="`/tags/${encodeURIComponent(tag)}`"
          class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
        >
          #{{ tag }}
        </NuxtLink>
      </div>
    </header>

    <div v-if="post.description" class="mb-8 border-l-4 border-blue-400 bg-blue-50 p-4">
      <p class="leading-relaxed text-blue-800">{{ post.description }}</p>
    </div>

    <article class="prose-article max-w-none">
      <ContentRenderer :value="post" />
    </article>

    <BlogComments :post-path="route.path" />

    <footer class="mt-12 border-t border-gray-200 pt-6">
      <div class="grid gap-4 md:grid-cols-2">
        <NuxtLink
          v-if="prev"
          :to="prev.path"
          class="group rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
        >
          <div class="text-xs text-gray-400">← 上一篇</div>
          <div class="mt-1 line-clamp-1 text-sm font-medium text-gray-700 group-hover:text-gray-900">{{ prev.title }}</div>
        </NuxtLink>
        <div v-else />

        <NuxtLink
          v-if="next"
          :to="next.path"
          class="group rounded-xl border border-gray-200 bg-white p-4 text-right transition hover:border-gray-300 hover:shadow-sm md:col-start-2"
        >
          <div class="text-xs text-gray-400">下一篇 →</div>
          <div class="mt-1 line-clamp-1 text-sm font-medium text-gray-700 group-hover:text-gray-900">{{ next.title }}</div>
        </NuxtLink>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <span>本文首发于「我的博客」，转载请注明出处。</span>
        <NuxtLink to="/blog" class="text-blue-600 transition hover:text-blue-700">返回文章列表 →</NuxtLink>
      </div>
    </footer>
  </article>

  <!-- 客户端上 post 暂时为空 = 内容库还没就绪（见 script 里的长注释），不能当成 404 -->
  <div v-else class="py-16 text-center">
    <p class="text-sm text-gray-500">正在加载文章…</p>
    <p class="mt-2 text-xs text-gray-400">
      如果长时间停在这里，说明这篇文章不存在，或者内容库还没加载完。
    </p>
    <NuxtLink to="/blog" class="mt-4 inline-block text-sm text-blue-600 transition hover:text-blue-700">
      返回文章列表 →
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()

// route.path 是 URL 编码后的（中文 slug 会被编码），Content 里存的是解码后的 path，这里统一解码。
//
// 同时必须**去掉尾斜杠**：GitHub Pages 会把 `/blog/xxx` 301 到 `/blog/xxx/`，
// 于是客户端 route.path 带尾斜杠、而预渲染时是 `post-/blog/xxx`（无尾斜杠）。
// 这个值被拼进下面 useAsyncData 的 key，一旦不一致就复用不到预渲染 payload
// （实测线上 `_payload.json` 里的 key 原文是 `post-\u002Fblog\u002Fhello-blog`），
// 客户端只能重新查内容库 —— 那是 844 KB 的 WASM SQLite，慢链路上要 25～35 秒，
// 期间文章正文根本出不来。归一化之后客户端能直接命中 payload，正文立刻就有。
const contentPath = computed(() => {
  try {
    const decoded = decodeURIComponent(route.path)
    return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
  }
  catch {
    return route.path.replace(/\/+$/, '') || '/'
  }
})

const { data: post } = await useAsyncData(`post-${contentPath.value}`, () =>
  queryCollection('blog').path(contentPath.value).first(),
)

// 只有「服务端预渲染时查不到」才判定 404 —— 这时 HTTP 状态码也是 404，SEO 语义正确。
//
// 客户端**绝对不能**这么判：静态托管下内容库是 844 KB 的 WASM SQLite，
// 线上实测（2026-09-10）它到 24.8 秒才开始下载、35.6 秒才装好；这期间任何一次
// 路由数据解析（hydration 出现 mismatch、Vue 丢掉预渲染结果重新渲染时就会触发）
// 都必然拿到空值。过去这里直接抛 fatal 404，于是正常文章页会出现
// 「文章正常显示 → 15.3 秒假 404『页面走丢了』→ 文章才恢复」。
// 客户端的「暂时没数据」交给模板的 v-if / v-else 处理，不当作 404。
if (import.meta.server && !post.value) {
  throw createError({ statusCode: 404, statusMessage: '文章不存在', fatal: true })
}

useWindowTitle(computed(() => post.value?.title ?? '文章'))

const { data: siblings } = await useAsyncData('post-siblings', () =>
  queryCollection('blog')
    .where('draft', '=', false)
    .select('path', 'title', 'date')
    .order('date', 'DESC')
    .all(),
)

const index = computed(() => (siblings.value ?? []).findIndex(item => item.path === contentPath.value))
const prev = computed(() => (index.value > 0 ? (siblings.value ?? [])[index.value - 1] : null))
const next = computed(() => {
  const list = siblings.value ?? []
  return index.value >= 0 && index.value < list.length - 1 ? list[index.value + 1] : null
})

useSeoMeta({
  title: () => post.value?.title,
  description: () => post.value?.description,
  ogType: 'article',
  articlePublishedTime: () => post.value?.date,
  articleTag: () => post.value?.tags ?? [],
})

useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: () => JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.value?.title,
        description: post.value?.description,
        datePublished: post.value?.date,
        author: { '@type': 'Person', name: '站长' },
      }),
    },
  ],
})
</script>
