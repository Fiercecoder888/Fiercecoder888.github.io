import { SITE } from '#shared/site'

/**
 * 遵循 llmstxt.org 规范：给 LLM / AI 搜索代理提供一份高信息密度的站点索引。
 */
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

  const lines = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.description}`,
    '',
    '## 站点信息',
    '',
    `- 首页：${site}/`,
    `- 文章归档：${site}/blog`,
    `- 工作日志：${site}/worklog`,
    `- 标签：${site}/tags`,
    `- 关于：${site}/about`,
    `- RSS：${site}/rss.xml`,
    `- Sitemap：${site}/sitemap.xml`,
    '',
    '## 文章',
    '',
    ...posts.map(post => `- [${post.title}](${site}${post.path}): ${post.description ?? ''}`),
    '',
    '## 工作日志',
    '',
    ...worklogs.map(log => `- [${log.title}](${site}${log.path}): ${log.summary ?? ''}`),
    '',
  ]

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
