<template>
  <div class="p-4">
    <div v-if="drafts?.length" class="space-y-2">
      <div
        v-for="post in drafts"
        :key="post.path"
        class="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.03] px-4 py-3"
      >
        <DesktopOsIcon name="note" class="h-4 w-4 shrink-0 opacity-70" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-slate-200">{{ post.title }}</p>
          <p class="mt-0.5 text-[11px] text-slate-500">{{ post.date }} · 草稿</p>
        </div>
        <span class="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">未发布</span>
      </div>
    </div>

    <div v-else class="grid h-full min-h-56 place-items-center text-center">
      <div>
        <DesktopOsIcon name="trash" class="mx-auto h-10 w-10 text-slate-500" />
        <p class="mt-3 text-sm text-slate-400">废纸篓是空的</p>
        <p class="mt-1 text-[11px] text-slate-600">标记 <code class="text-slate-400">draft: true</code> 的草稿会出现在这里</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { data: drafts } = await useAsyncData('trash-drafts', () =>
  queryCollection('blog').where('draft', '=', true).order('date', 'DESC').all(),
)
</script>
