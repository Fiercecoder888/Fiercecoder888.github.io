<template>
  <section class="mt-12 border-t border-gray-200 pt-8">
    <header class="mb-5 flex items-baseline justify-between">
      <h2 class="text-lg font-semibold text-gray-800">
        评论
        <span v-if="!loading && !error" class="ml-1.5 text-sm font-normal text-gray-400">{{ comments.length }}</span>
      </h2>
      <span class="text-[11px] text-gray-400">支持换行的纯文本</span>
    </header>

    <!-- 加载骨架 -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 2" :key="i" class="animate-pulse rounded-xl border border-gray-200 bg-white p-4">
        <div class="h-3 w-24 rounded bg-gray-200" />
        <div class="mt-3 h-3 w-full rounded bg-gray-100" />
        <div class="mt-2 h-3 w-2/3 rounded bg-gray-100" />
      </div>
    </div>

    <!-- 静态部署下没有后端 API：给说明，而不是报错 -->
    <div v-else-if="apiUnavailable" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-comments-static>
      <p>当前是<strong>静态部署</strong>（如 GitHub Pages），评论需要 Node 常驻服务，所以这里暂时不可用。</p>
      <p class="mt-1 text-xs text-amber-700">
        想启用评论：用 <code class="rounded bg-amber-100 px-1">pnpm build</code> + <code class="rounded bg-amber-100 px-1">node .output/server/index.mjs</code> 部署到支持 Node 的地方，或改用 Waline / Supabase。
      </p>
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <p>{{ error }}</p>
      <button type="button" class="mt-2 rounded-lg border border-rose-300 px-3 py-1 text-xs transition hover:bg-rose-100" @click="load">
        重试
      </button>
    </div>

    <!-- 列表 -->
    <div v-else-if="comments.length" class="space-y-3">
      <article v-for="comment in comments" :key="comment.id" class="rounded-xl border border-gray-200 bg-white p-4">
        <div class="flex items-center gap-2 text-xs">
          <span class="grid h-6 w-6 place-items-center rounded-full bg-slate-500 text-[11px] font-semibold text-white">
            {{ comment.author.slice(0, 1).toUpperCase() }}
          </span>
          <span class="font-medium text-gray-700">{{ comment.author }}</span>
          <time class="text-gray-400" :datetime="comment.createdAt">{{ relativeTime(comment.createdAt) }}</time>
        </div>
        <p class="mt-2.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">{{ comment.content }}</p>
      </article>
    </div>

    <p v-else class="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
      还没有评论，来说点什么吧
    </p>

    <!-- 表单（静态部署下隐藏） -->
    <form v-if="!apiUnavailable" class="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5" @submit.prevent="submit">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs text-gray-500">昵称 <span class="text-rose-500">*</span></span>
          <input
            v-model="form.author"
            type="text"
            maxlength="30"
            required
            placeholder="怎么称呼你"
            class="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400"
          >
        </label>
        <label class="block">
          <span class="text-xs text-gray-500">邮箱（可选，不会公开）</span>
          <input
            v-model="form.email"
            type="email"
            placeholder="you@example.com"
            class="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400"
          >
        </label>
      </div>

      <!-- 蜜罐：对真人不可见 -->
      <div class="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label>
          website
          <input v-model="form.website" type="text" tabindex="-1" autocomplete="off">
        </label>
      </div>

      <label class="mt-3 block">
        <span class="text-xs text-gray-500">内容 <span class="text-rose-500">*</span></span>
        <textarea
          v-model="form.content"
          rows="4"
          maxlength="500"
          required
          placeholder="友善交流，说说你的想法…"
          class="mt-1.5 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400"
        />
      </label>

      <div class="mt-3 flex items-center justify-between gap-3">
        <span class="text-[11px] text-gray-400">
          <span :class="form.content.length > 480 ? 'text-rose-500' : ''">{{ form.content.length }}</span>/500
        </span>
        <div class="flex items-center gap-3">
          <span v-if="feedback" class="text-xs" :class="feedbackType === 'error' ? 'text-rose-600' : 'text-emerald-600'">
            {{ feedback }}
          </span>
          <button
            type="submit"
            :disabled="submitting || !form.author.trim() || !form.content.trim()"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {{ submitting ? '提交中…' : '发表评论' }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
interface PublicComment {
  id: number
  author: string
  content: string
  createdAt: string
}

const props = defineProps<{ postPath: string }>()

const comments = ref<PublicComment[]>([])
const loading = ref(false)
const error = ref('')
/** 静态部署时后端 API 不存在，降级为说明文案 */
const apiUnavailable = ref(false)
const submitting = ref(false)
const feedback = ref('')
const feedbackType = ref<'ok' | 'error'>('ok')

const form = reactive({ author: '', email: '', content: '', website: '' })

let feedbackTimer: ReturnType<typeof setTimeout> | undefined

function setFeedback(message: string, type: 'ok' | 'error' = 'ok') {
  feedback.value = message
  feedbackType.value = type
  clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { feedback.value = '' }, 3000)
}

/**
 * 只在客户端拉取：保证 `nuxt generate` 预渲染阶段不会请求 API。
 */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ code: number, data: PublicComment[] | null }>('/api/comments', {
      query: { path: props.postPath },
    })
    comments.value = res.data ?? []
  }
  catch (err: any) {
    const status = err?.statusCode ?? err?.status ?? err?.response?.status
    // 404/405 = 这台服务器上没有评论接口（静态托管），属于预期情况
    if (status === 404 || status === 405 || /not found|method not allowed/i.test(String(err?.message ?? ''))) {
      apiUnavailable.value = true
      return
    }
    error.value = err?.data?.message || err?.message || '评论加载失败'
  }
  finally {
    loading.value = false
  }
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await $fetch<{ code: number, message: string, data: PublicComment | null }>('/api/comments', {
      method: 'POST',
      body: {
        path: props.postPath,
        author: form.author.trim(),
        email: form.email.trim(),
        content: form.content.trim(),
        website: form.website,
      },
    })
    if (res.data) comments.value.push(res.data)
    form.content = ''
    setFeedback('评论成功')
  }
  catch (err: any) {
    setFeedback(err?.data?.message || err?.message || '提交失败，请稍后再试', 'error')
  }
  finally {
    submitting.value = false
  }
}

function relativeTime(input: string) {
  const then = new Date(input).getTime()
  if (Number.isNaN(then)) return input
  const diff = Date.now() - then
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(then).toISOString().slice(0, 10)
}

onMounted(load)
onUnmounted(() => clearTimeout(feedbackTimer))
</script>
