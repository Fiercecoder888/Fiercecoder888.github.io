/**
 * 全文搜索索引：文章用 Nuxt Content 的 queryCollectionSearchSections（按正文小标题切片），
 * 工作日志**另外合成**切片 —— 日志的坑与收获写在 frontmatter 里，不在正文里，
 * 单靠 queryCollectionSearchSections 搜「光标」是搜不到那天的（这是实测确认过的差别）。
 * 索引在客户端懒加载并缓存，避免每次打开 Spotlight 都重新查库。
 */
export interface SearchSection {
  id: string
  title: string
  titles?: string[]
  content: string
  level?: number
  path?: string
  /** 结果列表里用来选图标，也用于「最近日志」分组 */
  kind?: 'blog' | 'worklog'
}

export interface SearchHit {
  id: string
  title: string
  path: string
  heading: string
  snippet: string
  score: number
  kind?: 'blog' | 'worklog'
}

/** 工作日志文档里搜索会用到的字段（与 content.config.ts 的 worklog 集合对齐） */
interface WorklogDay {
  path: string
  title: string
  date: string
  summary?: string
  project?: string
  tags?: string[]
  pitfalls?: { problem: string, solution: string, time?: string, agent?: string }[]
  learned?: string[]
}

const MAX_RESULTS = 12

/** 把长文本压成一行，用作结果里的小标题 */
function clip(text: unknown, max = 46) {
  const plain = String(text ?? '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

/** 剥掉 "路径/标题" 形态的前缀，其余原样返回 */
function cleanTitle(raw: string) {
  return raw.startsWith('/') ? raw.replace(/^.*?\//, '') : raw
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string))
}

/** 把命中片段包上 <mark>，其余部分转义 */
function highlight(text: string, terms: string[]) {
  let html = escapeHtml(text)
  for (const term of terms) {
    if (!term) continue
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    html = html.replace(new RegExp(safe, 'gi'), match => `<mark class="rounded bg-amber-400/30 px-0.5 text-amber-100">${match}</mark>`)
  }
  return html
}

function scoreSection(section: SearchSection, terms: string[]) {
  const title = (section.title ?? '').toLowerCase()
  const headings = (section.titles ?? []).join(' ').toLowerCase()
  const content = (section.content ?? '').toLowerCase()

  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 12
    if (headings.includes(term)) score += 6
    const occurrences = content.split(term).length - 1
    if (occurrences > 0) score += Math.min(occurrences, 5) * 2
    // 整体短语命中额外加分
  }
  const phrase = terms.join(' ')
  if (phrase && title.includes(phrase)) score += 15
  if (phrase && content.includes(phrase)) score += 8
  return score
}

/**
 * 把工作日志合成可搜索的切片。
 * 每天的日志产出三类切片：
 *   1. 每条「坑」一片（problem + solution）—— 这样搜「光标」「多帧 zstd」能直接命中那一天；
 *   2. 每条「收获」一片；
 *   3. 整天一片（摘要 + 项目 + 标签）—— 保证搜站名、项目名、标签也有结果。
 * 结果行的「标题」用日期+当天标题（titles[0]），「小标题」用切片自身的 title。
 */
function buildWorklogSections(days: WorklogDay[]): SearchSection[] {
  const out: SearchSection[] = []
  for (const day of days) {
    const label = `${day.date} · ${day.title}`
    const base = day.path

    for (const [i, pitfall] of (day.pitfalls ?? []).entries()) {
      out.push({
        id: `${base}#pitfall-${i}`,
        title: `坑 · ${clip(pitfall.problem)}`,
        titles: [label],
        content: [pitfall.problem, pitfall.solution, pitfall.time ? `耗时 ${pitfall.time}` : '', pitfall.agent ? `Agent ${pitfall.agent}` : '']
          .filter(Boolean)
          .join(' '),
        level: 2,
        path: base,
        kind: 'worklog',
      })
    }

    for (const [i, item] of (day.learned ?? []).entries()) {
      out.push({
        id: `${base}#learned-${i}`,
        title: `收获 · ${clip(item)}`,
        titles: [label],
        content: `${item}（来自 ${day.date} 的日志：${day.title}）`,
        level: 2,
        path: base,
        kind: 'worklog',
      })
    }

    out.push({
      id: base,
      title: label,
      titles: [label],
      content: [day.summary, day.project, (day.tags ?? []).map(tag => `#${tag}`).join(' ')].filter(Boolean).join(' '),
      level: 1,
      path: base,
      kind: 'worklog',
    })
  }
  return out
}

function buildSnippet(content: string, terms: string[], length = 110) {
  const plain = (content ?? '').replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  const lower = plain.toLowerCase()
  let index = -1
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0 && (index < 0 || found < index)) index = found
  }
  if (index < 0) return plain.slice(0, length) + (plain.length > length ? '…' : '')
  const start = Math.max(0, index - 30)
  const end = Math.min(plain.length, start + length)
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '')
}

export function useBlogSearch() {
  const sections = useState<SearchSection[]>('blog-search-sections', () => [])
  const loading = useState<boolean>('blog-search-loading', () => false)
  const error = useState<string>('blog-search-error', () => '')

  async function ensureIndex() {
    if (sections.value.length || loading.value) return
    loading.value = true
    error.value = ''
    try {
      const [blogSections, days] = await Promise.all([
        queryCollectionSearchSections('blog'),
        // 日志的坑/收获在 frontmatter 里，search sections 覆盖不到，所以在这里补上
        queryCollection('worklog').where('draft', '=', false).order('date', 'DESC').all(),
      ])
      sections.value = [
        ...((blogSections ?? []) as SearchSection[]).map(section => ({ ...section, kind: 'blog' as const })),
        ...buildWorklogSections(days as unknown as WorklogDay[]),
      ]
    }
    catch (err: unknown) {
      error.value = err instanceof Error ? err.message : '搜索索引加载失败'
    }
    finally {
      loading.value = false
    }
  }

  function search(rawQuery: string): SearchHit[] {
    const query = rawQuery.trim().toLowerCase()
    if (!query) return []
    const terms = query.split(/\s+/).filter(Boolean)

    return (sections.value as SearchSection[])
      .map((section) => {
        const score = scoreSection(section, terms)
        return { section, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map(({ section, score }) => ({
        id: section.id,
        // 只在标题**确实是一条以 / 开头的路径**时才剥掉前缀：
        // 早先的 `/^.*?\//` 会把「采集 / 去噪 / 归属」这类正常标题砍掉前半截
        title: cleanTitle(section.titles?.[0] ?? section.title ?? '未命名'),
        // 优先用切片自带的 path（合成切片都带）；没有时再按老办法从 id 里切掉 #fragment，
        // 注意用 || 而不是 ??：空字符串也要走兜底
        path: section.path || ((section.id ?? '').split('#')[0] || '/blog'),
        heading: section.title || '正文',
        snippet: highlight(buildSnippet(section.content, terms), terms),
        score,
        kind: section.kind,
      }))
  }

  /** 「最近日志」：索引里每天只有一条「整天」切片（id 就是路径，不含 # 片段） */
  const recentLogs = computed(() => (sections.value as SearchSection[])
    .filter(section => section.kind === 'worklog' && !section.id.includes('#'))
    .slice(0, 5))

  return { sections, loading, error, ensureIndex, search, recentLogs }
}
