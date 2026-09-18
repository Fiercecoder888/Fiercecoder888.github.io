<template>
  <div>
    <header class="mb-8 border-b border-gray-200 pb-6">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">记录统计</h1>
      <p class="mt-2 text-sm text-gray-500">
        全部数字都是打开页面时按 <code class="text-gray-600">date</code> 现算的 · 坚持这件事，看得见
      </p>

      <nav class="mt-4 flex flex-wrap gap-2">
        <NuxtLink
          v-for="tab in TABS"
          :key="tab.to"
          :to="tab.to"
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="tab.to === '/progress/stats'
            ? 'border-transparent bg-[var(--system-color-primary)] text-white'
            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'"
        >
          {{ tab.label }}
        </NuxtLink>
        <!-- 这里是聚合视图，原文在 /worklog —— 不给个出口，访客只能看到汇总、进不去具体某一天 -->
        <span class="mx-1 h-5 w-px self-center bg-gray-200" />
        <NuxtLink
          to="/worklog"
          class="self-center text-xs text-gray-500 underline-offset-2 transition hover:text-blue-600 hover:underline"
          data-progress-to-worklog
        >
          看日志原文 →
        </NuxtLink>
      </nav>
    </header>

    <!-- 数字卡片 -->
    <section class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div v-for="card in cards" :key="card.label" class="rounded-xl border border-gray-200 bg-white p-4" :data-progress-stat="card.label">
        <p class="text-xs text-gray-500">{{ card.label }}</p>
        <p class="mt-1 text-2xl font-semibold text-gray-800">
          {{ card.value }}<span class="ml-1 text-xs font-normal text-gray-400">{{ card.unit }}</span>
        </p>
        <p v-if="card.hint" class="mt-1 text-[11px] leading-relaxed text-gray-400">{{ card.hint }}</p>
      </div>
    </section>

    <!-- 最近一次记录 -->
    <p
      class="mt-6 rounded-xl border border-dashed p-4 text-sm leading-relaxed"
      :class="stale ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-gray-300 text-gray-500'"
    >
      {{ lastHint }}
    </p>

    <!-- 踩坑最多的标签 Top 5 -->
    <section class="mt-8">
      <h2 class="mb-3 flex items-center gap-3 text-sm font-semibold text-gray-700">
        <span>踩坑最多的标签</span>
        <span class="h-px flex-1 bg-gray-200" />
        <span class="text-xs font-normal text-gray-400">Top {{ topTags.length || 5 }}</span>
      </h2>

      <div v-if="topTags.length" class="space-y-3.5 rounded-xl border border-gray-200 bg-white p-5">
        <div v-for="tag in topTags" :key="tag.name" :data-progress-top-tag="tag.name">
          <div class="flex items-center justify-between text-xs">
            <span class="text-gray-600">#{{ tag.name }}</span>
            <span class="text-gray-400">{{ tag.count }} 个坑</span>
          </div>
          <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full bg-[var(--system-color-primary)] transition-all duration-300"
              :style="{ width: `${tag.percent}%` }"
            />
          </div>
        </div>
      </div>

      <p v-else class="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        还没有踩坑记录，一切顺利。
      </p>
    </section>

    <!-- Agent 参与分布：按日志级 agents 统计（所有日志都没填 agents 时整块不显示） -->
    <section v-if="agentParticipation.length" class="mt-8">
      <h2 class="mb-3 flex items-center gap-3 text-sm font-semibold text-gray-700">
        <span>Agent 参与分布</span>
        <span class="h-px flex-1 bg-gray-200" />
        <span class="text-xs font-normal text-gray-400">{{ agentParticipation.length }} 个 Agent</span>
      </h2>

      <div class="space-y-3.5 rounded-xl border border-gray-200 bg-white p-5">
        <div v-for="agent in agentParticipation" :key="agent.key" :data-progress-agent="agent.key">
          <div class="flex items-center justify-between text-xs">
            <span
              class="rounded border px-1.5 py-0.5 text-[11px] font-medium"
              :class="agentTone(agent.key)"
            >
              {{ agent.label }}
            </span>
            <span class="text-gray-400">参与 {{ agent.count }} 天</span>
          </div>
          <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              class="h-full rounded-full bg-[var(--system-color-primary)] transition-all duration-300"
              :style="{ width: `${agent.percent}%` }"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 统计页：全部数字用纯前端计算（不引图表库），数据源只有 worklog 集合本身。
 * 「连续记录天数」= 把每篇日志的 date 归一成「天」的下标后找最长/末尾连续递增段。
 */

const TABS = [
  { to: '/progress', label: '时间轴' },
  { to: '/progress/pitfalls', label: '坑库' },
  { to: '/progress/stats', label: '统计' },
]

const loadFailed = ref(false)

const { data: logs } = await useAsyncData('progress-stats', async () => {
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

const DAY_MS = 86400000

/** 'YYYY-MM-DD' → 以「天」为单位的下标（按 UTC 解析，避免时区/夏令时把相邻两天算成 1.04 天） */
function dayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

/** 本地「今天」的天下标 */
function todayDayIndex(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS)
}

/** 归一化后的日期字符串（升序、去重）——同一天写两篇只算一天 */
const dates = computed(() => {
  const set = new Set<string>()
  for (const log of logs.value ?? []) set.add(formatDate(log.date))
  return [...set].sort()
})

const dayNumbers = computed(() => dates.value.map(dayIndex).filter(n => !Number.isNaN(n)))

/** 历史最长连续：扫一遍，遇到「前一条 +1」就续上，否则重开一段 */
const longestStreak = computed(() => {
  const list = dayNumbers.value
  let best = 0
  let run = 0
  for (let i = 0; i < list.length; i++) {
    run = i > 0 && list[i] === list[i - 1]! + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
})

/** 当前连续：从最后一条往前数；最后一条不在今天/昨天，说明已经断了，算 0 */
const currentStreak = computed(() => {
  const list = dayNumbers.value
  if (!list.length) return 0
  if (todayDayIndex() - list[list.length - 1]! > 1) return 0
  let run = 1
  for (let i = list.length - 1; i > 0; i--) {
    if (list[i - 1] === list[i]! - 1) run++
    else break
  }
  return run
})

const pitfallTotal = computed(() =>
  (logs.value ?? []).reduce((sum, log) => sum + (log.pitfalls ?? []).length, 0))

const learnedTotal = computed(() =>
  (logs.value ?? []).reduce((sum, log) => sum + (log.learned ?? []).length, 0))

/** 距今多少天没记录了（没有任何日志时返回 null） */
const daysSinceLast = computed(() => {
  const list = dayNumbers.value
  if (!list.length) return null
  return Math.max(0, todayDayIndex() - list[list.length - 1]!)
})

const stale = computed(() => {
  const since = daysSinceLast.value
  return since !== null && since >= 7
})

const lastHint = computed(() => {
  if (loadFailed.value) return '工作日志的内容集合还没准备好，稍后再来看看。'
  const since = daysSinceLast.value
  if (since === null) {
    return '还没有工作日志。写第一条吧 —— 从今天开始，连续记录的天数就是 1。'
  }
  if (since === 0) return '今天已经记过了，保持这个节奏。'
  if (since === 1) return '上次记录是昨天，今天再来一条？'
  if (since < 7) return `上次记录在 ${since} 天前，顺手补上最近的收获吧。`
  return `已经 ${since} 天没有记录了 —— 今天写一条，连续记录就从现在重新开始。`
})

interface StatCard {
  label: string
  value: number
  unit: string
  hint?: string
}

const cards = computed<StatCard[]>(() => [
  { label: '累计日志', value: (logs.value ?? []).length, unit: '条' },
  { label: '涉及天数', value: dates.value.length, unit: '天' },
  {
    label: '当前连续',
    value: currentStreak.value,
    unit: '天',
    hint: currentStreak.value ? '别断更' : '从今天重新开始',
  },
  { label: '历史最长连续', value: longestStreak.value, unit: '天' },
  { label: '累计踩坑', value: pitfallTotal.value, unit: '个' },
  { label: '累计收获', value: learnedTotal.value, unit: '条' },
])

/** 踩坑最多的标签 Top 5：按坑计数（同一篇日志里的多个坑各算一次） */
const topTags = computed(() => {
  const map = new Map<string, number>()
  for (const log of logs.value ?? []) {
    const count = (log.pitfalls ?? []).length
    if (!count) continue
    for (const tag of log.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + count)
  }
  const list = [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5)
  const max = list[0]?.count ?? 1
  // 最小 8% 保证条形可见
  return list.map(item => ({ ...item, percent: Math.max(8, Math.round((item.count / max) * 100)) }))
})

/**
 * Agent 参与分布：按日志级 `agents` 统计，单位是「天」。
 * 同一天写两篇日志只算一天；同一条日志里重复写同一个 Agent 也只算一次。
 * 没有任何日志填过 agents → 返回空数组，模板整块不显示（不显示空图）。
 */
const agentParticipation = computed<{ key: string, label: string, count: number, percent: number }[]>(() => {
  const map = new Map<string, { label: string, dates: Set<string> }>()
  for (const log of logs.value ?? []) {
    const date = formatDate(log.date)
    const seen = new Set<string>()
    for (const raw of log.agents ?? []) {
      const key = agentKey(raw)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const item = map.get(key) ?? { label: agentLabel(key), dates: new Set<string>() }
      item.dates.add(date)
      map.set(key, item)
    }
  }
  const list = [...map.entries()]
    .map(([key, item]) => ({ key, label: item.label, count: item.dates.size }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  if (!list.length) return []
  const max = list[0]?.count ?? 1
  // 与 Top 5 标签同一种进度条：最小 8% 保证条形可见
  return list.map(item => ({ ...item, percent: Math.max(8, Math.round((item.count / max) * 100)) }))
})

useWindowTitle(computed(() => '无限进步 · 统计'))

useSeoMeta({
  title: '统计 · 无限进步',
  description: '工作日志的累计条数、连续记录天数、踩坑与收获统计。',
})
</script>
