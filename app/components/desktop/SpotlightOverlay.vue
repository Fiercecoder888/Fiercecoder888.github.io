<template>
  <div
    class="fixed inset-0 z-[60] flex items-start justify-center bg-slate-400/25 pt-[12vh] backdrop-blur-md dark:bg-slate-950/50"
    data-spotlight
    @click.self="close"
  >
    <div class="w-full max-w-2xl px-4" :class="animate ? 'animate-spotlight-in' : ''">
      <div class="overflow-hidden rounded-2xl border border-black/10 bg-white/85 shadow-2xl shadow-black/25 backdrop-blur-2xl dark:border-white/15 dark:bg-slate-900/85 dark:shadow-black/60">
        <!-- 输入 -->
        <div class="flex items-center gap-3 border-b border-white/8 px-4 py-3">
          <DesktopOsIcon name="search" class="h-4 w-4 text-slate-400" />
          <input
            ref="input"
            v-model="query"
            type="text"
            placeholder="搜索文章标题、正文…"
            spellcheck="false"
            data-spotlight-input
            class="flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="openActive"
          >
          <kbd class="rounded border border-black/10 bg-black/5 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-white/10 dark:bg-white/5">esc</kbd>
        </div>

        <!-- 结果 -->
        <div class="max-h-[52vh] overflow-auto p-2">
          <div v-if="loading" class="px-3 py-6 text-center text-sm text-slate-500">正在建立索引…</div>

          <div v-else-if="error" class="px-3 py-6 text-center text-sm text-rose-300">
            {{ error }}
            <button type="button" class="ml-2 underline" @click="reload">重试</button>
          </div>

          <div v-else-if="!query.trim()" class="px-3 py-5">
            <p class="text-[11px] uppercase tracking-widest text-slate-500">最近文章</p>
            <button
              v-for="post in recent"
              :key="post.path"
              type="button"
              class="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/5"
              @click="go(post.path)"
            >
              <DesktopOsIcon name="doc" class="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-slate-700 dark:text-slate-200">{{ post.title }}</span>
                <span class="block truncate text-[11px] text-slate-500">{{ post.date }} · {{ post.category ?? '未分类' }}</span>
              </span>
            </button>
          </div>

          <div v-else-if="!hits.length" class="px-3 py-6 text-center text-sm text-slate-500">
            没有找到「{{ query }}」相关内容
          </div>

          <button
            v-for="(hit, index) in hits"
            :key="hit.id"
            type="button"
            class="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition"
            :class="index === activeIndex ? 'bg-blue-500/20' : 'hover:bg-white/5'"
            @mousemove="activeIndex = index"
            @click="go(hit.path)"
          >
            <DesktopOsIcon name="doc" class="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                <span class="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{ hit.title }}</span>
                <span class="shrink-0 text-[11px] text-slate-500">{{ hit.heading }}</span>
              </span>
              <span class="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400" v-html="hit.snippet" />
            </span>
          </button>
        </div>

        <div class="flex items-center justify-between border-t border-black/8 px-4 py-2 text-[11px] text-slate-500 dark:border-white/8">
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>{{ sections.length }} 个片段已索引</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const ui = useUiStore()
const router = useRouter()
const { sections, loading, error, ensureIndex, search } = useBlogSearch()
const { settings } = useBlogSettings()

const query = ref('')
const activeIndex = ref(0)
const input = ref<HTMLInputElement | null>(null)

const animate = computed(() => settings.value.animations)

const { data: recentPosts } = await useAsyncData('spotlight-recent', () =>
  queryCollection('blog').where('draft', '=', false).select('path', 'title', 'date', 'category').order('date', 'DESC').limit(5).all(),
)

const recent = computed(() => recentPosts.value ?? [])
const hits = computed(() => search(query.value))

watch(hits, () => { activeIndex.value = 0 })

function close() {
  ui.toggleSpotlight(false)
}

function move(delta: number) {
  if (!hits.value.length) return
  activeIndex.value = (activeIndex.value + delta + hits.value.length) % hits.value.length
}

function openActive() {
  const hit = hits.value[activeIndex.value]
  if (hit) go(hit.path)
}

function go(path: string) {
  close()
  router.push(path)
}

async function reload() {
  sections.value = []
  await ensureIndex()
}

onMounted(async () => {
  input.value?.focus()
  await ensureIndex()
  input.value?.focus()
})
</script>

<style scoped>
@keyframes spotlight-in {
  from { opacity: 0; transform: translateY(-12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.animate-spotlight-in {
  animation: spotlight-in 0.18s ease-out;
}
</style>
