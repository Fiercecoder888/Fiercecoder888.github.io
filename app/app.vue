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

useHead({
  titleTemplate: (title?: string) => (title ? `${title} - ${SITE.name}` : SITE.name),
})

useSeoMeta({
  description: SITE.description,
  ogType: 'website',
  ogSiteName: SITE.name,
  twitterCard: 'summary_large_image',
})

// 便于部署到自定义域名时不出错
useHead({
  link: [{ rel: 'canonical', href: config.public.siteUrl }],
})
</script>
