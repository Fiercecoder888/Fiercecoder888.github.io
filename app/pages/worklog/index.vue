<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-gray-800">工作日志</h1>
          <p class="mt-2 text-sm text-gray-500">
            共 <span class="font-medium text-gray-700">{{ logs?.length ?? 0 }}</span> 天 · 今天干了什么、踩了什么坑、学到什么
          </p>
        </div>
        <NuxtLink
          to="/blog"
          class="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
        >
          看文章 →
        </NuxtLink>
      </div>
    </header>

    <div v-if="logs?.length" class="space-y-10">
      <section v-for="group in grouped" :key="group.key">
        <h2 class="mb-3 flex items-center gap-3 text-sm font-semibold text-gray-700">
          <span>{{ group.label }}</span>
          <span class="h-px flex-1 bg-gray-200" />
          <span class="text-xs font-normal text-gray-400">{{ group.items.length }} 天</span>
        </h2>
        <div class="grid gap-3">
          <NuxtLink
            v-for="log in group.items"
            :key="log.path"
            :to="log.path"
            class="group block rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
          >
            <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <time :datetime="log.date">{{ formatDate(log.date) }}</time>
              <span v-if="log.project" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{{ log.project }}</span>
              <span
                v-if="pitfallCount(log)"
                class="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200"
              >
                {{ pitfallCount(log) }} 个坑
              </span>
              <span
                v-else
                class="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600 ring-1 ring-emerald-200"
              >
                没踩坑
              </span>
            </div>

            <h3 class="mt-2 text-base font-semibold text-gray-800 transition group-hover:text-gray-900">
              {{ log.title }}
            </h3>
            <p v-if="log.summary" class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">
              {{ log.summary }}
            </p>

            <div v-if="log.tags?.length" class="mt-3 flex flex-wrap gap-1.5">
              <span
                v-for="tag in log.tags"
                :key="tag"
                class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500"
              >
                #{{ tag }}
              </span>
            </div>
          </NuxtLink>
        </div>
      </section>
    </div>

    <p v-else class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
      还没有日志，今天就开始记吧 —— 在 <code class="text-gray-600">content/worklog/</code> 下新建 Markdown 即可。
    </p>
  </div>
</template>

<script setup lang="ts">
// key 用固定的字符串（不含路径），与 blog 列表页保持一致：
// 这样预渲染出的 payload key 在任何路径/尾斜杠形态下都能命中。
const { data: logs } = await useAsyncData('all-worklogs', () =>
  queryCollection('worklog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .all(),
)

function pitfallCount(log: { pitfalls?: unknown[] }) {
  return log.pitfalls?.length ?? 0
}

// 一天一条，数量涨得快，按「年-月」分组比按年分组更好翻。
const grouped = computed(() => {
  const map = new Map<string, NonNullable<typeof logs.value>>()
  for (const log of logs.value ?? []) {
    const key = String(log.date).slice(0, 7)
    if (!map.has(key)) map.set(key, [] as any)
    map.get(key)!.push(log)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const [year, month] = key.split('-')
      return { key, label: `${year} 年 ${Number(month)} 月`, items }
    })
})

useWindowTitle('工作日志')

useSeoMeta({
  title: '工作日志',
  description: '每天一条工作日志：今天干了什么、踩了什么坑、怎么解决的、学到什么。',
})
</script>
