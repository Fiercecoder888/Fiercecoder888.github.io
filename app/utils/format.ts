export function formatDate(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return String(input)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function readingTime(body?: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  const chars = text.replace(/\s/g, '').length
  return `${Math.max(1, Math.round(chars / 400))} 分钟`
}
