import { SITE } from '#shared/site'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const site = String(config.public.siteUrl || '').replace(/\/$/, '')
  const posts = await queryCollection(event, 'blog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .limit(20)
    .all()

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
