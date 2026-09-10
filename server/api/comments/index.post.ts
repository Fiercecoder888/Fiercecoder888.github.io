import { checkRateLimit, createComment, getClientIp } from '../../utils/comments-db'

interface CommentBody {
  path?: string
  author?: string
  content?: string
  email?: string
  /** 蜜罐字段：正常用户不会填，机器人往往照填 */
  website?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CommentBody>(event).catch(() => ({} as CommentBody))

  const postPath = String(body?.path ?? '').trim()
  const author = String(body?.author ?? '').trim()
  const content = String(body?.content ?? '').trim()
  const email = String(body?.email ?? '').trim()
  const honeypot = String(body?.website ?? '').trim()

  const bad = (message: string) => {
    setResponseStatus(event, 400)
    return { code: 400, message, data: null }
  }

  if (!postPath.startsWith('/blog/')) return bad('文章路径不合法')
  if (author.length < 1 || author.length > 30) return bad('昵称需为 1-30 个字符')
  if (content.length < 1 || content.length > 500) return bad('评论内容需为 1-500 个字符')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('邮箱格式不正确')

  // 蜜罐命中：假装成功，但不落库
  if (honeypot) return { code: 200, message: '评论成功', data: null }

  const ip = getClientIp(event)
  const limit = checkRateLimit(ip)
  if (!limit.ok) {
    setResponseStatus(event, 429)
    return {
      code: 429,
      message: limit.reason === 'too-fast' ? '评论太快了，请 10 秒后再试' : '一小时内评论过多，请稍后再试',
      data: null,
    }
  }

  const comment = createComment({
    postPath,
    author,
    email: email || null,
    content,
    ip,
    ua: getHeader(event, 'user-agent') ?? null,
  })

  return { code: 200, message: '评论成功', data: comment }
})
