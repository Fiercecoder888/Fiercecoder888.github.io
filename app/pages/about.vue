<template>
  <div>
    <header class="article-header mb-8">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">关于我</h1>
      <p class="mt-2 text-sm text-gray-500">这里写你自己的故事：怎么开始写代码的、现在在做什么、这个博客想记录什么。</p>
    </header>

    <section class="rounded-xl border border-gray-200 bg-white p-6">
      <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div v-for="item in profile" :key="item.label">
          <dt class="text-xs text-gray-400">{{ item.label }}</dt>
          <dd class="mt-1 text-sm text-gray-700">{{ item.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="mt-8 space-y-4 text-sm leading-relaxed text-gray-600">
      <h2 class="text-lg font-semibold text-gray-800">为什么写博客</h2>
      <p>把踩过的坑、读过的书、做过的项目写下来。写作是最好的复习，也是给未来的自己留一份索引。</p>

      <h2 class="pt-2 text-lg font-semibold text-gray-800">这个站点怎么搭的</h2>
      <ul class="list-disc space-y-1.5 pl-5 text-gray-500">
        <li><span class="text-gray-700">框架</span>：Nuxt 4（Vue 3 SSR）</li>
        <li><span class="text-gray-700">内容</span>：Nuxt Content v3，Markdown 写文章</li>
        <li><span class="text-gray-700">样式</span>：TailwindCSS v4</li>
        <li><span class="text-gray-700">桌面 OS</span>：Pinia 窗口管理器 + Dock（抄自 macos-web，视觉按 xiaohev 博客）</li>
        <li><span class="text-gray-700">评论</span>：自建 Nitro API + SQLite</li>
        <li><span class="text-gray-700">SEO</span>：sitemap.xml、rss.xml、robots.txt（放行 AI 爬虫）、llms.txt</li>
      </ul>
      <p class="text-gray-500">
        想改这些信息？编辑 <code class="rounded bg-gray-100 px-1 py-0.5 text-gray-700">shared/site.ts</code> 就行，全站都会跟着变。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'

const profile = [
  { label: '昵称', value: SITE.author },
  { label: '坐标', value: SITE.location },
  { label: '方向', value: SITE.role },
  ...SITE.socials,
]

useWindowTitle('关于我')

useSeoMeta({
  title: '关于我',
  description: `关于${SITE.author}的自我介绍、技术方向与这个博客的技术栈。`,
})
</script>
