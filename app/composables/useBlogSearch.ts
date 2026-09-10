/**
 * 博客全文搜索：基于 Nuxt Content 的 queryCollectionSearchSections 构建索引，
 * 客户端懒加载并缓存，避免每次打开 Spotlight 都重新查库。
 */
export interface SearchSection {
  id: string
  title: string
  titles?: string[]
  content: string
  level?: number
  path?: string
}

export interface SearchHit {
  id: string
  title: string
  path: string
  heading: string
  snippet: string
  score: number
}

const MAX_RESULTS = 12

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
      const data = await queryCollectionSearchSections('blog')
      sections.value = (data ?? []) as SearchSection[]
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
        title: (section.titles?.[0] ?? section.title ?? '未命名').replace(/^.*?\//, ''),
        path: (section.id ?? '').split('#')[0] || '/blog',
        heading: section.title || '正文',
        snippet: highlight(buildSnippet(section.content, terms), terms),
        score,
      }))
  }

  return { sections, loading, error, ensureIndex, search }
}
