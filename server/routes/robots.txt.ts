/**
 * robots.txt：放行常规爬虫，同时显式放行 AI / LLM 爬虫（GEO 做法，参考 xiaohev.com）。
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const site = String(config.public.siteUrl || '').replace(/\/$/, '')

  const aiBots = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'PerplexityBot',
    'ClaudeBot',
    'anthropic-ai',
    'Google-Extended',
    'Applebot-Extended',
    'Bytespider',
    'CCBot',
  ]

  const text = `# 常规爬虫
User-agent: *
Allow: /

# AI / LLM 爬虫（用于 AI 搜索与引用）
${aiBots.map(bot => `User-agent: ${bot}\nAllow: /`).join('\n')}

# 站点索引
Sitemap: ${site}/sitemap.xml
LLMs: ${site}/llms.txt
`

  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return text
})
