/**
 * 站点与作者信息 —— 想换成自己的信息，**只改这个文件**。
 * 全站引用它：首页名片、关于页、页脚、菜单栏、开机页、Finder、关于本站窗口、
 * RSS / llms.txt / sitemap 的站点名、SEO 默认标题与描述。
 */
export const SITE = {
  /** 站点名（出现在标题栏、菜单栏、RSS、llms.txt、页脚） */
  name: '我的博客',
  /** 作者昵称 */
  author: '站长',
  /** 头像里显示的字（一个字最好看） */
  avatarText: '我',
  /** 一句话身份，例如「前端 / 全栈开发者」 */
  role: '前端 / 全栈开发者',
  /** 首页名片上的一句话 */
  tagline: '用代码构建美好世界',
  /** 首页名片下的简介 */
  bio: '记录技术、阅读与生活，把踩过的坑写下来。',
  /** 关于页的第一段（可以写长一点） */
  about: '把踩过的坑、读过的书、做过的项目写下来。写作是最好的复习，也是给未来的自己留一份索引。',

  /** 以下信息会出现在「关于我」页面 */
  location: '中国',
  email: 'you@example.com',
  github: 'github.com/yourname',
  /** 可以随便加，会按顺序渲染到关于页 */
  socials: [
    { label: '邮箱', value: 'you@example.com' },
    { label: 'GitHub', value: 'github.com/yourname' },
  ],

  /** SEO 默认描述（首页、og:description） */
  description: '记录技术、阅读与生活的个人博客，基于 Nuxt 4 + Nuxt Content 构建的桌面 OS 风格站点。',
  /** 首页 SEO 标题用的关键词 */
  keywords: ['前端', '全栈', 'Nuxt', 'Vue', '博客'],
  /** 部署后换成真实域名（sitemap / RSS 里的绝对地址） */
  url: 'http://localhost:3000',
} as const

export type Site = typeof SITE
