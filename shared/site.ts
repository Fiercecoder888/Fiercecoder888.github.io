/**
 * 站点与作者信息 —— 大部分信息改这里就够了。
 *
 * 但**不是只改这个文件**：下面这些地方的信息是写死在代码里的，改这里不会跟着变，
 * 清单与建议见 `docs/个人信息填充清单.md`：
 *   - 文章页 JSON-LD 的作者、文章页页脚「本文首发于…」（app/pages/blog/[...slug].vue）
 *   - 桌面「关于本站」窗口的头像与文案（app/components/desktop/AboutWindow.vue）
 *   - 终端 whoami / pwd 的输出（app/components/desktop/TerminalWindow.vue）
 *   - 标签页图标里的字（public/favicon.svg）
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
  /** 邮箱：关于页会渲染成可点的 mailto 链接。不想公开就填空串 '' */
  email: 'you@example.com',
  /** GitHub：关于页会渲染成可点的链接（写 github.com/xxx 即可，会自动补 https://）。不想公开就填空串 '' */
  github: 'github.com/yourname',
  /**
   * 其它社交链接（掘金 / 知乎 / X / 个人域名…），按顺序渲染到关于页；
   * 值只要长得像网址或邮箱，就会自动变成可点链接。
   *
   * 注意：**不要把邮箱和 GitHub 再抄一遍放这里** —— 它们有上面的专用字段，
   * 重复放会让关于页出现两遍（这个文件以前就是这样，导致上面两个字段形同虚设）。
   */
  socials: [
    // { label: '掘金', value: 'juejin.cn/user/12345' },
    // { label: 'X', value: 'x.com/yourname' },
  ] as Array<{ label: string, value: string }>,

  /** SEO 默认描述（首页、og:description） */
  description: '记录技术、阅读与生活的个人博客，基于 Nuxt 4 + Nuxt Content 构建的桌面 OS 风格站点。',
  /** 首页 SEO 标题用的关键词 */
  keywords: ['前端', '全栈', 'Nuxt', 'Vue', '博客'],
  /** 部署后换成真实域名（sitemap / RSS 里的绝对地址） */
  url: 'https://fiercecoder888.github.io',
} as const

export type Site = typeof SITE
