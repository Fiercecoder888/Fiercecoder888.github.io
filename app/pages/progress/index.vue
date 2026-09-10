<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">无限进步</h1>
      <p class="mt-2 text-sm text-gray-500">
        工作日志按「年-月」倒序归档 · 共
        <span class="font-medium text-gray-700">{{ rows.length }}</span> 条 ·
        <span class="font-medium text-gray-700">{{ groups.length }}</span> 个月 ·
        踩坑 <span class="font-medium text-gray-700">{{ pitfallTotal }}</span> 个
      </p>

      <nav class="mt-4 flex flex-wrap gap-2">
        <NuxtLink
          v-for="tab in TABS"
          :key="tab.to"
          :to="tab.to"
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="tab.to === '/progress'
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'"
        >
          {{ tab.label }}
        </NuxtLink>
      </nav>
    </header>

    <div v-if="groups.length" class="space-y-10" data-progress-timeline>
      <section v-for="group in groups" :key="group.key" :data-progress-month="group.key">
        <h2 class="mb-3 flex items-center gap-3 text-sm font-semibold text-gray-700">
          <span>{{ group.label }}</span>
          <span class="h-px flex-1 bg-gray-200" />
          <span class="text-xs font-normal text-gray-400">{{ group.items.length }} 条</span>
        </h2>

        <div class="grid gap-3">
          <NuxtLink
            v-for="log in group.items"
            :key="log.path"
            :to="log.path"
            class="group block rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
            data-progress-log
          >
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <time :datetime="log.date" class="font-mono">{{ log.date }}</time>
              <span
                class="ml-auto rounded px-1.5 py-0.5"
                :class="log.pitfallCount ? 'bg-rose-50 text-rose-600' : 'bg-gray-100 text-gray-400'"
              >
                {{ log.pitfallCount ? `${log.pitfallCount} 个坑` : '顺利的一天' }}
              </span>
            </div>

            <h3 class="mt-2 line-clamp-1 text-base font-semibold text-gray-800 transition group-hover:text-gray-900">
              {{ log.title }}
            </h3>
            <p v-if="log.summary" class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">
              {{ log.summary }}
            </p>

            <div v-if="log.tags.length" class="mt-3 flex flex-wrap gap-1.5">
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

    <p
      v-else
      class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm leading-relaxed text-gray-400"
    >
      <template v-if="loadFailed">
        工作日志的内容集合还没准备好，稍后再来看看。
      </template>
      <template v-else>
        还没有工作日志。<br>
        在 <code class="text-gray-600">content/worklog/</code> 下新建
        <code class="text-gray-600">2026-09-10.md</code> 这样的 Markdown，这里就会自动长出时间轴。
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 「无限进步」时间轴：worklog 集合按「年-月」分组的聚合视图。
 *
 * worklog 集合由另一个子任务在 content.config.ts 里注册，这里只依赖字段契约：
 * title / date / summary / tags / project / pitfalls[{problem,solution,time?}] / learned[] / mood? / draft
 */

const TABS = [
  { to: '/progress', label: '时间轴' },
  { to: '/progress/pitfalls', label: '坑库' },
  { to: '/progress/stats', label: '统计' },
]

const loadFailed = ref(false)

const { data: logs } = await useAsyncData('progress-timeline', async () => {
  try {
    return await queryCollection('worklog').where('draft', '=', false).order('date', 'DESC').all()
  }
  catch (err) {
    // 集合尚未注册时（并行开发 / 集合名写错）不要让整站预渲染直接失败，退化成空列表 + 友好提示
    loadFailed.value = true
    console.warn('[progress] 读取 worklog 集合失败：', err)
    return []
  }
})

interface LogRow {
  path: string
  title: string
  date: string
  summary: string
  tags: string[]
  pitfallCount: number
}

/** 归一化成「展示用」的行数据：日期统一成 YYYY-MM-DD，坑的条数先算好 */
const rows = computed<LogRow[]>(() => (logs.value ?? [])
  .map(log => ({
    path: log.path,
    title: log.title,
    date: formatDate(log.date),
    summary: log.summary ?? '',
    tags: log.tags ?? [],
    pitfallCount: (log.pitfalls ?? []).length,
  }))
  .sort((a, b) => b.date.localeCompare(a.date)))

/** 按 YYYY-MM 分组，组内已是倒序 */
const groups = computed(() => {
  const map = new Map<string, LogRow[]>()
  for (const row of rows.value) {
    const key = row.date.slice(0, 7)
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({ key, label: monthLabel(key), items }))
})

function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  return `${year} 年 ${Number(month)} 月`
}

const pitfallTotal = computed(() => rows.value.reduce((sum, row) => sum + row.pitfallCount, 0))

useWindowTitle(computed(() => '无限进步'))

useSeoMeta({
  title: '无限进步',
  description: '工作日志时间轴：按年月归档的记录、标签与每天踩过的坑。',
})
</script>
