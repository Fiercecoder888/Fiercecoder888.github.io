<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const config = useRuntimeConfig()
const route = useRoute()

useHead({
  titleTemplate: (title?: string) => (title ? `${title} - ${SITE.name}` : SITE.name),
})

/**
 * 本页的规范化绝对地址（canonical / og:url 共用）。
 *
 * 以前这里是 `href: config.public.siteUrl` —— **无条件等于首页地址**，
 * 于是文章页 / 关于页 / 标签页全都声明自己是首页，搜索引擎会把它们当成首页的重复内容。
 *
 * 归一化为「目录式路径带尾斜杠」是刻意的：GitHub Pages 会把 `/blog` 301 成 `/blog/`，
 * 实际被服务的地址就是后者。如果直接用 `route.path`，预渲染时是 `/blog`、客户端是 `/blog/`，
 * 两边算出的 canonical 不一致，还会造成 head 层面的 hydration 不一致（同类坑今天已踩过一次）。
 */
const canonicalUrl = computed(() => {
  const base = String(config.public.siteUrl || '').replace(/\/+$/, '')
  const path = (route.path || '/').replace(/\/+$/, '')
  return path === '' ? base : `${base}${path}/`
})

useSeoMeta({
  description: SITE.description,
  ogType: 'website',
  ogSiteName: SITE.name,
  twitterCard: 'summary_large_image',
  // og:url 以前全站都没有，分享出去没有规范链接
  ogUrl: canonicalUrl,
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
})
</script>
