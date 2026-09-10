<template>
  <div>
    <header class="article-header mb-8">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">关于我</h1>
      <p class="mt-2 text-sm text-gray-500">{{ SITE.bio }}</p>
    </header>

    <section class="rounded-xl border border-gray-200 bg-white p-6">
      <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <div v-for="item in profile" :key="item.label">
          <dt class="text-xs text-gray-400">{{ item.label }}</dt>
          <dd class="mt-1 text-sm text-gray-700">
            <!-- 以前这里是纯文本：读者看到 github.com/xxx 却点不了。现在能识别网址/邮箱就渲染成链接 -->
            <a
              v-if="item.href"
              :href="item.href"
              :target="item.href.startsWith('mailto:') ? undefined : '_blank'"
              rel="noopener noreferrer"
              class="text-blue-600 transition hover:text-blue-700 hover:underline"
            >{{ item.value }}</a>
            <span v-else>{{ item.value }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <section class="mt-8 space-y-4 text-sm leading-relaxed text-gray-600">
      <h2 class="text-lg font-semibold text-gray-800">为什么写博客</h2>
      <p>{{ SITE.about }}</p>

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
        想换成本人信息？大部分字段在
        <code class="rounded bg-gray-100 px-1 py-0.5 text-gray-700">shared/site.ts</code>，
        但有几处（文章页作者、页脚署名、终端 whoami、关于窗口、favicon）是硬编码在代码里的，
        完整清单见 <code class="rounded bg-gray-100 px-1 py-0.5 text-gray-700">docs/个人信息填充清单.md</code>。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'

type Row = { label: string, value: string, href?: string }

/** 值长得像网址或邮箱就生成可点链接；否则返回 undefined（渲染成纯文本） */
function toHref(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `mailto:${v}`
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+\//.test(v)) return `https://${v}` // github.com/xxx
  return undefined
}

/**
 * 关于页的资料表。
 * email / github 以前全站没人引用（填了不生效），现在接到这里；
 * socials 只用来放**其它**链接，不要再抄一遍邮箱与 GitHub。
 */
function buildProfile(): Row[] {
  const rows: Row[] = [
    { label: '昵称', value: SITE.author },
    { label: '坐标', value: SITE.location },
    { label: '方向', value: SITE.role },
  ]
  if (SITE.email) rows.push({ label: '邮箱', value: SITE.email, href: toHref(SITE.email) })
  if (SITE.github) rows.push({ label: 'GitHub', value: SITE.github, href: toHref(SITE.github) })
  for (const s of SITE.socials) rows.push({ label: s.label, value: s.value, href: toHref(s.value) })
  return rows.filter(row => Boolean(row.value))
}

const profile = buildProfile()

useWindowTitle('关于我')

useSeoMeta({
  title: '关于我',
  description: `关于${SITE.author}的自我介绍、技术方向与这个博客的技术栈。`,
})
</script>
