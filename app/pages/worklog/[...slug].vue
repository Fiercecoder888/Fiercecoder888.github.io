<template>
  <article v-if="post">
    <header class="mb-8">
      <h1 class="mb-4 text-4xl font-bold leading-tight text-gray-800">{{ post.title }}</h1>

      <div class="flex flex-wrap items-center gap-4 text-sm text-gray-500">
        <span class="flex items-center gap-1.5">
          <DesktopOsIcon name="clock" class="h-4 w-4" />
          <time :datetime="post.date">{{ formatDate(post.date) }}</time>
        </span>
        <span v-if="post.project" class="flex items-center gap-1.5">
          <DesktopOsIcon name="folder" class="h-4 w-4" />
          {{ post.project }}
        </span>
        <span v-if="post.mood" class="flex items-center gap-1.5">
          <span>精力</span>
          <span class="flex items-center gap-0.5">
            <span
              v-for="i in 5"
              :key="i"
              class="h-3 w-1.5 rounded-sm"
              :class="i <= (post.mood ?? 0) ? 'bg-amber-400' : 'bg-gray-200'"
            />
          </span>
          <span class="text-gray-400">{{ post.mood }}/5</span>
        </span>
      </div>

      <div v-if="post.tags?.length" class="mt-4 flex flex-wrap gap-2">
        <span
          v-for="tag in post.tags"
          :key="tag"
          class="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600"
        >
          #{{ tag }}
        </span>
      </div>
    </header>

    <div v-if="post.summary" class="mb-8 border-l-4 border-blue-400 bg-blue-50 p-4">
      <p class="leading-relaxed text-blue-800">{{ post.summary }}</p>
    </div>

    <!-- 踩的坑：这一栏是这个栏目的核心，问题与解决必须分开显示 -->
    <section v-if="post.pitfalls?.length" class="mb-10 rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
      <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-amber-900">
        <span>今天踩的坑</span>
        <span class="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
          {{ post.pitfalls.length }} 个
        </span>
      </h2>

      <div class="space-y-3">
        <div
          v-for="(pitfall, i) in post.pitfalls"
          :key="i"
          class="rounded-xl border border-amber-200 bg-white p-4"
        >
          <div class="mb-3 flex items-center gap-2 text-xs text-amber-700">
            <span class="font-semibold">坑 {{ i + 1 }}</span>
            <span class="h-px flex-1 bg-amber-100" />
            <span v-if="pitfall.time" class="text-gray-400">花了 {{ pitfall.time }}</span>
          </div>

          <div class="flex items-start gap-2">
            <span class="mt-0.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">问题</span>
            <p class="text-sm leading-relaxed text-gray-700">{{ pitfall.problem }}</p>
          </div>

          <div class="mt-3 flex items-start gap-2">
            <span class="mt-0.5 shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">解决</span>
            <p class="text-sm leading-relaxed text-gray-700">{{ pitfall.solution }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 今天学到 -->
    <section v-if="post.learned?.length" class="mb-10 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
      <h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-900">
        <span>今天学到</span>
        <span class="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-900">
          {{ post.learned.length }} 条
        </span>
      </h2>
      <ul class="space-y-2">
        <li v-for="(item, i) in post.learned" :key="i" class="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
          <DesktopOsIcon name="check" class="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
          <span>{{ item }}</span>
        </li>
      </ul>
    </section>

    <!-- 当天经过 -->
    <section>
      <h2 class="mb-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-800">今天的经过</h2>
      <article class="prose-article max-w-none">
        <ContentRenderer :value="post" />
      </article>
    </section>

    <footer class="mt-12 border-t border-gray-200 pt-6">
      <div class="grid gap-4 md:grid-cols-2">
        <NuxtLink
          v-if="prev"
          :to="prev.path"
          class="group rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
        >
          <div class="text-xs text-gray-400">← 前一天</div>
          <div class="mt-1 line-clamp-1 text-sm font-medium text-gray-700 group-hover:text-gray-900">{{ prev.title }}</div>
        </NuxtLink>
        <div v-else />

        <NuxtLink
          v-if="next"
          :to="next.path"
          class="group rounded-xl border border-gray-200 bg-white p-4 text-right transition hover:border-gray-300 hover:shadow-sm md:col-start-2"
        >
          <div class="text-xs text-gray-400">后一天 →</div>
          <div class="mt-1 line-clamp-1 text-sm font-medium text-gray-700 group-hover:text-gray-900">{{ next.title }}</div>
        </NuxtLink>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <span>工作日志 · 记录踩过的坑，才不会再踩第二遍。</span>
        <NuxtLink to="/worklog" class="text-blue-600 transition hover:text-blue-700">返回日志列表 →</NuxtLink>
      </div>
    </footer>
  </article>

  <!-- 客户端上 post 暂时为空 = 内容库还没就绪（见 script 里的长注释），不能当成 404 -->
  <div v-else class="py-16 text-center">
    <p class="text-sm text-gray-500">正在加载日志…</p>
    <p class="mt-2 text-xs text-gray-400">
      如果长时间停在这里，说明这篇日志不存在，或者内容库还没加载完。
    </p>
    <NuxtLink to="/worklog" class="mt-4 inline-block text-sm text-blue-600 transition hover:text-blue-700">
      返回日志列表 →
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'

const route = useRoute()

// route.path 是 URL 编码后的（中文 slug 会被编码），Content 里存的是解码后的 path，这里统一解码。
//
// 同时必须**去掉尾斜杠**：GitHub Pages 会把 `/worklog/xxx` 301 到 `/worklog/xxx/`，
// 于是客户端 route.path 带尾斜杠、而预渲染时是 `worklog-/worklog/xxx`（无尾斜杠）。
// 这个值被拼进下面 useAsyncData 的 key，一旦不一致就复用不到预渲染 payload，
// 客户端只能重新查内容库 —— 那是 844 KB 的 WASM SQLite，慢链路上要 25～35 秒，
// 期间日志正文根本出不来。归一化之后客户端能直接命中 payload，正文立刻就有。
const contentPath = computed(() => {
  try {
    const decoded = decodeURIComponent(route.path)
    return decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
  }
  catch {
    return route.path.replace(/\/+$/, '') || '/'
  }
})

const { data: post } = await useAsyncData(`worklog-${contentPath.value}`, () =>
  queryCollection('worklog').path(contentPath.value).first(),
)

// 只有「服务端预渲染时查不到」才判定 404 —— 这时 HTTP 状态码也是 404，SEO 语义正确。
//
// 客户端**绝对不能**这么判：静态托管下内容库是 844 KB 的 WASM SQLite，
// 线上实测（2026-09-10）它到 24.8 秒才开始下载、35.6 秒才装好；这期间任何一次
// 路由数据解析（hydration 出现 mismatch、Vue 丢掉预渲染结果重新渲染时就会触发）
// 都必然拿到空值。blog 详情页过去就是这样出现「正文正常显示 → 15.3 秒假 404 → 才恢复」。
// 客户端的「暂时没数据」交给模板的 v-if / v-else 处理，不当作 404。
if (import.meta.server && !post.value) {
  throw createError({ statusCode: 404, statusMessage: '日志不存在', fatal: true })
}

useWindowTitle(computed(() => post.value?.title ?? '工作日志'))

const { data: siblings } = await useAsyncData('worklog-siblings', () =>
  queryCollection('worklog')
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
  description: () => post.value?.summary,
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
        description: post.value?.summary,
        datePublished: post.value?.date,
        author: { '@type': 'Person', name: SITE.author },
      }),
    },
  ],
})
</script>
