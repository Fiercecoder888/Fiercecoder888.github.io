<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">坑库</h1>
      <p class="mt-2 text-sm text-gray-500">
        把每篇日志里的「踩过的坑」摊平到一起 · 共
        <span class="font-medium text-gray-700">{{ entries.length }}</span> 个坑，涉及
        <span class="font-medium text-gray-700">{{ tagStats.length }}</span> 个标签
        <template v-if="filtering">
          · 当前筛出 <span class="font-medium text-gray-700">{{ filtered.length }}</span> 个
        </template>
      </p>

      <nav class="mt-4 flex flex-wrap gap-2">
        <NuxtLink
          v-for="tab in TABS"
          :key="tab.to"
          :to="tab.to"
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="tab.to === '/progress/pitfalls'
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'"
        >
          {{ tab.label }}
        </NuxtLink>
      </nav>
    </header>

    <!-- 筛选区：搜索 + 标签 -->
    <section class="mb-6 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <DesktopOsIcon name="search" class="h-4 w-4 shrink-0 text-gray-400" />
        <input
          v-model="keyword"
          type="search"
          placeholder="搜问题关键字，例如「Nuxt」「hydration」「构建」"
          class="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
          data-pitfall-search
        >
        <button
          v-if="keyword"
          type="button"
          class="shrink-0 text-xs text-gray-400 transition hover:text-gray-600"
          @click="keyword = ''"
        >
          清除
        </button>
      </div>

      <div v-if="tagStats.length" class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] transition"
          :class="activeTag === ''
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'"
          @click="activeTag = ''"
        >
          全部 <span class="opacity-70">{{ entries.length }}</span>
        </button>
        <button
          v-for="tag in tagStats"
          :key="tag.name"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] transition"
          :class="activeTag === tag.name
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'"
          :data-pitfall-tag="tag.name"
          @click="toggleTag(tag.name)"
        >
          #{{ tag.name }} <span class="opacity-70">{{ tag.count }}</span>
        </button>
      </div>
    </section>

    <div v-if="filtered.length" class="space-y-3">
      <article
        v-for="entry in filtered"
        :key="entry.key"
        class="rounded-xl border border-gray-200 bg-white p-5"
        data-pitfall-item
      >
        <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <NuxtLink
            :to="entry.path"
            class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 transition hover:text-blue-600"
          >
            {{ entry.date }}
          </NuxtLink>
          <NuxtLink :to="entry.path" class="line-clamp-1 transition hover:text-blue-600">
            {{ entry.logTitle }}
          </NuxtLink>
          <span
            v-if="entry.time"
            class="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-gray-500"
          >
            耗时 {{ entry.time }}
          </span>
        </div>

        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p class="text-[11px] font-semibold tracking-wide text-rose-500">问题</p>
            <p class="mt-1 text-sm leading-relaxed text-gray-700">{{ entry.problem }}</p>
          </div>
          <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <p class="text-[11px] font-semibold tracking-wide text-emerald-600">当时怎么解的</p>
            <p class="mt-1 text-sm leading-relaxed text-gray-700">{{ entry.solution }}</p>
          </div>
        </div>

        <div v-if="entry.tags.length" class="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            v-for="tag in entry.tags"
            :key="tag"
            type="button"
            class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500 transition hover:border-blue-300 hover:text-blue-600"
            @click="toggleTag(tag)"
          >
            #{{ tag }}
          </button>
          <NuxtLink :to="entry.path" class="ml-auto text-[11px] text-gray-400 transition hover:text-blue-600">
            回到当天日志 →
          </NuxtLink>
        </div>
      </article>
    </div>

    <p
      v-else
      class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm leading-relaxed text-gray-400"
    >
      <template v-if="loadFailed">
        工作日志的内容集合还没准备好，稍后再来看看。
      </template>
      <template v-else-if="entries.length">
        没有匹配的坑，换个关键字或者点「全部」看看。
      </template>
      <template v-else>
        坑库还是空的 —— 说明目前一切顺利 🎉<br>
        日志里写了 <code class="text-gray-600">pitfalls</code> 之后，这里会自动汇总。
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 坑库：把 worklog 集合里每篇日志的 pitfalls[] 摊平成一张可检索的表。
 * 目标是「回头查：Nuxt 我踩过哪些坑」一页看完，所以按来源日志的 tags 聚合 + 问题关键字前端搜索。
 */

const TABS = [
  { to: '/progress', label: '时间轴' },
  { to: '/progress/pitfalls', label: '坑库' },
  { to: '/progress/stats', label: '统计' },
]

const loadFailed = ref(false)

const { data: logs } = await useAsyncData('progress-pitfalls', async () => {
  try {
    return await queryCollection('worklog').where('draft', '=', false).order('date', 'DESC').all()
  }
  catch (err) {
    // 集合尚未注册时不要让整站预渲染失败（详见 pages/progress/index.vue 的同名注释）
    loadFailed.value = true
    console.warn('[progress] 读取 worklog 集合失败：', err)
    return []
  }
})

interface PitfallEntry {
  /** 稳定 key：来源路径 + 在该日志里的序号 */
  key: string
  problem: string
  solution: string
  time?: string
  /** 来源日志的日期（YYYY-MM-DD）与标题，用来链回详情 */
  date: string
  logTitle: string
  path: string
  /** 来源日志的标签（坑本身没有标签字段，按日志标签归档） */
  tags: string[]
}

const entries = computed<PitfallEntry[]>(() => {
  const list: PitfallEntry[] = []
  for (const log of logs.value ?? []) {
    const date = formatDate(log.date)
    const tags = log.tags ?? []
    ;(log.pitfalls ?? []).forEach((pitfall, index) => {
      list.push({
        key: `${log.path}#${index}`,
        problem: pitfall.problem,
        solution: pitfall.solution,
        time: pitfall.time,
        date,
        logTitle: log.title,
        path: log.path,
        tags,
      })
    })
  }
  // 新的坑排在前面
  return list.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))
})

/** 标签聚合：统计每个标签下有多少个坑，按频次倒序 */
const tagStats = computed(() => {
  const map = new Map<string, number>()
  for (const entry of entries.value) {
    for (const tag of entry.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
})

const activeTag = ref('')
const keyword = ref('')

function toggleTag(name: string) {
  activeTag.value = activeTag.value === name ? '' : name
}

const filtering = computed(() => Boolean(activeTag.value) || Boolean(keyword.value.trim()))

/** 纯前端过滤：标签 + 问题/解决方案/标题/日期的关键字匹配 */
const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return entries.value.filter((entry) => {
    if (activeTag.value && !entry.tags.includes(activeTag.value)) return false
    if (!query) return true
    const haystack = [
      entry.problem,
      entry.solution,
      entry.logTitle,
      entry.date,
      entry.time ?? '',
      entry.tags.join(' '),
    ].join(' ').toLowerCase()
    return haystack.includes(query)
  })
})

useWindowTitle(computed(() => '无限进步 · 坑库'))

useSeoMeta({
  title: '坑库 · 无限进步',
  description: '按标签聚合与关键字检索的工作日志踩坑记录：问题 + 当时的解决方案。',
})
</script>
