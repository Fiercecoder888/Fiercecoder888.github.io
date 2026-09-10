<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <div class="pointer-events-none fixed inset-0 -z-10 opacity-60"
         style="background: radial-gradient(60rem 40rem at 50% -10%, rgba(91,140,255,.18), transparent 60%);" />

    <div class="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <DesktopOsIcon name="error" class="mx-auto h-16 w-16 text-slate-600" />
      <h1 class="mt-6 text-3xl font-bold tracking-tight text-white">
        {{ is404 ? '页面走丢了' : '出了点问题' }}
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-slate-400">
        {{ is404 ? '你要找的页面不存在，可能已经被移动或删除了。' : (error?.statusMessage || '服务器开小差了，稍后再试试。') }}
      </p>
      <p v-if="is404 && route" class="mt-2 break-all font-mono text-xs text-slate-600">{{ route }}</p>

      <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          class="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400"
          @click="handleError"
        >
          回到首页
        </button>
        <NuxtLink
          to="/blog"
          class="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
        >
          看看文章
        </NuxtLink>
        <NuxtLink
          to="/tags"
          class="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
        >
          标签
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const is404 = computed(() => props.error?.statusCode === 404)
const route = computed(() => (props.error as { data?: { path?: string } })?.data?.path ?? '')

useSeoMeta({
  title: is404.value ? '404 - 页面不存在' : '出错了',
  robots: 'noindex',
})

function handleError() {
  clearError({ redirect: '/' })
}
</script>
