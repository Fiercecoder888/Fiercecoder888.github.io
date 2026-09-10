import { listComments } from '../../utils/comments-db'

export default defineEventHandler((event) => {
  const { path } = getQuery(event)

  if (typeof path !== 'string' || !path.startsWith('/blog/')) {
    setResponseStatus(event, 400)
    return { code: 400, message: 'path 参数必须以 /blog/ 开头', data: null }
  }

  return { code: 200, message: '请求成功', data: listComments(path) }
})
