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

  // 站点信息：部署时用环境变量覆盖 NUXT_PUBLIC_SITE_URL
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'author', content: SITE.author },
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

  // 静态生成时把 SEO 路由一起预渲染
  nitro: {
    prerender: {
      routes: ['/', '/about', '/blog', '/tags', '/rss.xml', '/sitemap.xml', '/llms.txt', '/robots.txt'],
    },
  },

  devtools: { enabled: false },
})
