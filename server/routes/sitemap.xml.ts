export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const site = String(config.public.siteUrl || '').replace(/\/$/, '')
  const posts = await queryCollection(event, 'blog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .all()
  const worklogs = await queryCollection(event, 'worklog')
    .where('draft', '=', false)
    .order('date', 'DESC')
    .all()

  const today = new Date().toISOString().slice(0, 10)
  const staticRoutes = [
    { loc: `${site}/`, priority: '1.0', lastmod: today },
    { loc: `${site}/blog`, priority: '0.9', lastmod: today },
    { loc: `${site}/worklog`, priority: '0.8', lastmod: today },
    { loc: `${site}/progress`, priority: '0.7', lastmod: today },
    { loc: `${site}/progress/pitfalls`, priority: '0.6', lastmod: today },
    { loc: `${site}/tags`, priority: '0.7', lastmod: today },
    { loc: `${site}/about`, priority: '0.8', lastmod: today },
  ]

  const postRoutes = posts.map(post => ({
    loc: `${site}${post.path}`,
    priority: '0.8',
    lastmod: String(post.date).slice(0, 10),
  }))

  const worklogRoutes = worklogs.map(log => ({
    loc: `${site}${log.path}`,
    priority: '0.6',
    lastmod: String(log.date).slice(0, 10),
  }))

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticRoutes, ...postRoutes, ...worklogRoutes]
  .map(item => `  <url>\n    <loc>${escapeXml(item.loc)}</loc>\n    <lastmod>${item.lastmod}</lastmod>\n    <priority>${item.priority}</priority>\n  </url>`)
  .join('\n')}
</urlset>`

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return xml
})

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
