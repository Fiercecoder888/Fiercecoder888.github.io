import tailwindcss from '@tailwindcss/vite'
import { SITE } from './shared/site'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  modules: ['@nuxt/content', '@pinia/nuxt', '@nuxt/icon'],

  // 图标：本地集合（Phosphor 主用 + MDI 苹果 logo + Simple Icons 品牌标志 + Lucide 备用），
  // SSR 内联 SVG，不依赖 Iconify 在线 API
  icon: {
    mode: 'svg',
    serverBundle: { collections: ['ph', 'mdi', 'simple-icons', 'lucide'] },
    clientBundle: { scan: true, sizeLimitKb: 256 },
  },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  // 站点信息：部署时用环境变量 NUXT_PUBLIC_SITE_URL 覆盖，本地用 shared/site.ts 的 url
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || SITE.url,
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'author', content: SITE.author },
        // keywords 这个字段以前全站没人引用（填了不生效），现在接到这里
        ...(SITE.keywords.length ? [{ name: 'keywords', content: SITE.keywords.join(', ') }] : []),
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/rss.xml' },
      ],
      // 首屏防闪：在页面渲染前根据本地偏好应用深色模式与字号
      script: [
        {
          innerHTML: `(function(){try{var s=JSON.parse(localStorage.getItem('blog_settings')||'{}');var m=s.theme||'light';var d=m==='dark'||(m==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var el=document.documentElement;if(d){el.classList.add('dark')}el.style.colorScheme=d?'dark':'light';var f=s.fontSize;if(f){el.style.fontSize=f==='small'?'14px':(f==='large'?'18px':'16px')}}catch(e){}})();`,
        },
      ],
    },
  },

  content: {
    build: {
      markdown: {
        toc: { depth: 3, searchDepth: 3 },
      },
    },
  },

  // 静态生成时把 SEO 路由和「没有页面内锚点指向」的页面一起预渲染。
  //
  // 为什么必须显式列出来：`nuxt generate` 只预渲染这里的 routes + **从首页爬 `<a href>`** 发现的页面。
  // 而桌面上的 Dock、顶栏菜单、Launchpad 全是 `<button>`（`DockItem.vue` 只对 `kind:'link'` 渲染 `<a>`），
  // 首页上没有任何指向 /progress、/worklog 的锚点 —— 不写在这里，它们在静态托管上就是 404。
  // 子页面（/worklog/<日期>、/progress/pitfalls 等）由这些页面里的 `<a>` 链到，会被自动爬取。
  nitro: {
    prerender: {
      routes: [
        '/', '/about', '/blog', '/tags',
        '/worklog', '/progress', '/progress/pitfalls', '/progress/stats',
        '/rss.xml', '/sitemap.xml', '/llms.txt', '/robots.txt',
      ],
    },
  },

  devtools: { enabled: false },
})
