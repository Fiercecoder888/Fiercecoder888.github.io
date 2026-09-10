import { deleteComment } from '../../utils/comments-db'

export default defineEventHandler((event) => {
  const token = getHeader(event, 'x-admin-token')
  const expected = process.env.NUXT_COMMENTS_ADMIN_TOKEN || 'dev-admin-token'

  if (!token || token !== expected) {
    setResponseStatus(event, 401)
    return { code: 401, message: '无权操作：x-admin-token 不正确', data: null }
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    setResponseStatus(event, 400)
    return { code: 400, message: '评论 id 不合法', data: null }
  }

  if (!deleteComment(id)) {
    setResponseStatus(event, 404)
    return { code: 404, message: '评论不存在', data: null }
  }

  return { code: 200, message: '删除成功', data: { id } }
})
