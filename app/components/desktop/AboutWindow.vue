<template>
  <div class="p-5">
    <div class="flex items-center gap-3">
      <span class="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/10 text-xl font-bold text-white">
        我
      </span>
      <div>
        <p class="text-base font-semibold text-white">{{ SITE.name }}</p>
        <p class="text-[11px] text-slate-500">复刻 xiaohev.com 的桌面 OS 风格</p>
      </div>
    </div>

    <dl class="mt-5 space-y-2 text-sm">
      <div v-for="item in facts" :key="item.label" class="flex items-center justify-between rounded-xl border border-white/8 bg-white/[.03] px-3.5 py-2">
        <dt class="text-slate-500">{{ item.label }}</dt>
        <dd class="text-slate-200">{{ item.value }}</dd>
      </div>
    </dl>

    <p class="mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">站点索引</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <a v-for="link in links" :key="link.href" :href="link.href" class="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/5">
        {{ link.label }}
      </a>
    </div>

    <p class="mt-5 text-[11px] leading-relaxed text-slate-500">
      基于 Nuxt 4 + Nuxt Content v3 + Tailwind v4 + Pinia 构建；评论使用自建 Nitro API + SQLite。
    </p>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const facts = [
  { label: '框架', value: 'Nuxt 4 / Vue 3' },
  { label: '内容', value: 'Nuxt Content v3' },
  { label: '样式', value: 'Tailwind v4' },
  { label: '状态', value: 'Pinia 4' },
  { label: '评论', value: 'Nitro + SQLite' },
  { label: '部署', value: '静态生成 + 任意托管' },
]

const links = [
  { label: '文章', href: '/blog' },
  { label: '标签', href: '/tags' },
  { label: '关于', href: '/about' },
  { label: 'RSS', href: '/rss.xml' },
  { label: 'Sitemap', href: '/sitemap.xml' },
  { label: 'llms.txt', href: '/llms.txt' },
]
</script>
