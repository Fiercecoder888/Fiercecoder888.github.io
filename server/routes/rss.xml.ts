import { SITE } from '#shared/site'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const site = String(config.public.siteUrl || '').replace(/\/$/, '')
  const posts = await queryCollection(event, 'blog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .limit(20)
    .all()

  // 刻意只包含 blog 集合，**不包含 worklog**（工作日志）：RSS 是给订阅者推送更新的，
  // 一天一条的工作日志会把订阅列表刷屏，订阅者很快就会退订。这是决定，不是漏掉了。
  // 工作日志仍然进 sitemap.xml 与 llms.txt，供搜索引擎 / AI 代理收录。

  const items = posts.map(post => `    <item>
      <title><![CDATA[${post.title}]]></title>
      <description><![CDATA[${post.description ?? ''}]]></description>
      <link>${site}${post.path}</link>
      <guid isPermaLink="true">${site}${post.path}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>`).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE.name}</title>
    <link>${site}</link>
    <description>${SITE.description}</description>
    <language>zh-cn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return xml
})
