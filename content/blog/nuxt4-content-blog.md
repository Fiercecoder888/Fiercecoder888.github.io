---
title: 用 Nuxt 4 + Nuxt Content v3 搭一个博客，顺便把 SEO 做全
description: 从零搭一个 Markdown 驱动的个人博客，并补上 sitemap、RSS、robots.txt 与 llms.txt 这四件套——这套做法是参考小贺的博客学的。
date: '2026-09-09'
category: 前端
tags:
  - Nuxt
  - Vue
  - SEO
  - 博客
---

## 为什么是 Nuxt 4 + Nuxt Content

静态博客方案很多：Hexo、Hugo、Astro、VitePress。选 Nuxt 4 的理由很实际：

1. **写文章就是写 Markdown**，不用碰数据库；
2. **以后想加复杂交互（比如桌面式窗口）时不用换框架**，因为 Vue 生态够顺手；
3. **SEO 是 SSR 天然优势**，不像纯前端 SPA 要额外折腾预渲染。

Nuxt Content v3 负责把 `content/blog/**/*.md` 变成一个可查询的集合：

```ts
// content.config.ts
import { defineContentConfig, defineCollection, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    blog: defineCollection({
      type: 'page',
      source: 'blog/**/*.md',
      schema: z.object({
        title: z.string(),
        description: z.string(),
        date: z.string(),
        category: z.string().default('随笔'),
        tags: z.array(z.string()).default([]),
      }),
    }),
  },
})
```

然后在页面里查询：

```ts
const { data: posts } = await useAsyncData('posts', () =>
  queryCollection('blog').where('draft', '=', false).order('date', 'DESC').all(),
)
```

## SEO 四件套

小贺的博客在这块做得挺完整，我照着抄了一遍。区别是他用 Nuxt SEO 模块，我直接手写了四个 server route，少一个依赖。

### 1. sitemap.xml

遍历集合里的文章，输出标准 urlset。搜索引擎提交一次就能持续发现新文章。

### 2. rss.xml

RSS 是"让人真正订阅你"的唯一方式。社交媒体会限流，RSS 不会。

### 3. robots.txt：显式放行 AI 爬虫

这点值得单独说。现在流量有一部分来自 AI 搜索（ChatGPT、Perplexity、Claude），如果 `robots.txt` 把 `GPTBot`、`PerplexityBot`、`ClaudeBot` 拦了，你就等于主动放弃了这部分引用。

```
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: https://example.com/sitemap.xml
```

### 4. llms.txt：给大模型看的站点目录

[llmstxt.org](https://llmstxt.org/) 提的规范：用 Markdown 写一份"站点说明 + 文章清单"，放在根目录。AI 抓取时优先读这个，比让它自己爬一遍 HTML 省事得多。

```md
# 我的博客

> 一句话介绍这个站点

## 文章

- [文章标题](https://example.com/blog/slug): 一句话摘要
```

## 部署

`nuxt generate` 出静态文件，扔到 Cloudflare Pages / Vercel / OSS + CDN 都行，成本几乎为零。

唯一要注意的是：**把 `NUXT_PUBLIC_SITE_URL` 设成真实域名**，否则 sitemap 和 RSS 里全是 `localhost:3000`。

## 小结

技术选型这件事，够用就好。真正决定博客能不能活下来的是：**你有没有持续写**。
