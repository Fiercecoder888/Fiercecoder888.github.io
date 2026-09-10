// better-sqlite3 不随包提供类型声明，这里用 any 化的默认导入
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- 缺少类型声明
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface CommentRow {
  id: number
  post_path: string
  author: string
  email: string | null
  content: string
  created_at: string
  status: string
  ip: string | null
  ua: string | null
}

export interface PublicComment {
  id: number
  author: string
  content: string
  createdAt: string
}

let db: any = null

/**
 * 惰性打开数据库：避免在构建/预渲染阶段（模块被导入但未调用）就创建文件。
 */
function getDb() {
  if (db) return db

  const file = process.env.COMMENTS_DB_PATH
    ? resolve(process.env.COMMENTS_DB_PATH)
    : resolve(process.cwd(), '.data', 'comments.sqlite')

  mkdirSync(dirname(file), { recursive: true })
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_path TEXT NOT NULL,
      author TEXT NOT NULL,
      email TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      ip TEXT,
      ua TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post_path ON comments (post_path);
  `)
  return db
}

function toPublic(row: CommentRow): PublicComment {
  return {
    id: row.id,
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
  }
}

export function listComments(postPath: string): PublicComment[] {
  const rows = getDb()
    .prepare(`SELECT * FROM comments WHERE post_path = ? AND status = 'approved' ORDER BY created_at ASC, id ASC LIMIT 200`)
    .all(postPath) as CommentRow[]
  return rows.map(toPublic)
}

export function countComments(postPath: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM comments WHERE post_path = ? AND status = 'approved'`)
    .get(postPath) as { n: number } | undefined
  return row?.n ?? 0
}

export function createComment(input: {
  postPath: string
  author: string
  email?: string | null
  content: string
  ip?: string | null
  ua?: string | null
}): PublicComment {
  const info = getDb()
    .prepare(
      `INSERT INTO comments (post_path, author, email, content, created_at, status, ip, ua)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)`,
    )
    .run(
      input.postPath,
      input.author,
      input.email ?? null,
      input.content,
      new Date().toISOString(),
      input.ip ?? null,
      input.ua ?? null,
    )

  const row = getDb().prepare(`SELECT * FROM comments WHERE id = ?`).get(info.lastInsertRowid) as CommentRow
  return toPublic(row)
}

export function deleteComment(id: number): boolean {
  const info = getDb().prepare(`DELETE FROM comments WHERE id = ?`).run(id)
  return info.changes > 0
}

/** 内存级限流：同 IP 10 秒内只能发一次，1 小时最多 20 条 */
const rateMap = new Map<string, number[]>()
const WINDOW_MS = 60 * 60 * 1000
const MIN_INTERVAL_MS = 10 * 1000
const MAX_PER_HOUR = 20

export function checkRateLimit(ip: string): { ok: true } | { ok: false; reason: 'too-fast' | 'too-many' } {
  const now = Date.now()
  const hits = (rateMap.get(ip) ?? []).filter(time => now - time < WINDOW_MS)
  const last = hits[hits.length - 1] ?? 0

  if (last && now - last < MIN_INTERVAL_MS) return { ok: false, reason: 'too-fast' }
  if (hits.length >= MAX_PER_HOUR) return { ok: false, reason: 'too-many' }

  hits.push(now)
  rateMap.set(ip, hits)

  // 顺手清理过期条目，避免 Map 无限增长
  if (rateMap.size > 5000) {
    for (const [key, times] of rateMap) {
      if (!times.some(time => now - time < WINDOW_MS)) rateMap.delete(key)
    }
  }

  return { ok: true }
}

export function getClientIp(event: any): string {
  const forwarded = event.node?.req?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim()
  return event.node?.req?.socket?.remoteAddress ?? 'unknown'
}
