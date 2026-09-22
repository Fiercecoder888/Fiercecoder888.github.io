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

    // ── Windows 上 dev server 被 EBUSY 打死的那道防护 ──────────────────────
    // 症状（已实测复现）：用 AI 编码工具改 `app/` 下的文件时，工具会在被改文件**旁边**
    // 生成一个临时目录 `.<name>.<pid>.<uuid>.tmpdir/`，里面放 `.tmp` 文件。Windows 上
    // chokidar 的原生 fs 监听会把这个瞬时目录当成待监听文件，抛出
    //   ERROR [unhandledRejection] EBUSY: resource busy or locked, watch '...tmpdir\xxx.tmp'
    // **整个 dev server 当场终止** —— 不是某个请求失败，是进程没了。
    //
    // 同一个坑在 FactoryBrain 仓库已经踩过并修好（那边 vite.config.ts 有同样的注释）。
    // 那边额外上了 `usePolling: true, interval: 300`；这里先只做「排除」，因为轮询会让
    // 监听成本明显上升。若哪天 EBUSY 仍然复现，再加 usePolling 那两行。
    //
    // 注意：给 `ignored` 传数组会**覆盖** Vite 的默认排除项，所以默认的几项必须自己写回来，
    // 否则 node_modules 会被纳入监听 —— 那比 EBUSY 更糟。
    server: {
      watch: {
        ignored: [
          '**/.git/**',
          '**/node_modules/**',
          '**/.nuxt/**',
          '**/.output/**',
          '**/*.tmpdir/**',
          '**/*.tmp',
        ],
      },
    },
  },

  // 站点信息：部署时用环境变量 NUXT_PUBLIC_SITE_URL 覆盖，本地用 shared/site.ts 的 url
  //
  // 这里**故意不声明** Jev（TypeSafe）那组配置，尽管声明成私有 runtimeConfig 看起来更「Nuxt」。
  // 理由是实测出来的：`nuxt dev` 里 dotenv 加载 `.env` 的时机晚于 Nitro 应用 `NUXT_*`
  // 运行时覆盖，于是 `process.env.NUXT_TYPESAFE_API_KEY` 有值、而
  // `useRuntimeConfig(event).typesafeApiKey` 是空串 —— 接口报「没读到 key」，
  // 但你去查环境变量明明有，很难归因。所以 server/utils/jev.ts::readJevConfig()
  // 在**请求时**直接读 process.env，顺带保证 key 不会被烤进任何产物。
  //
  // 三个变量名（都只在服务端用，**都不要加 NUXT_PUBLIC_ 前缀**）：
  //   NUXT_TYPESAFE_API_KEY   Jev 的 API key（放站点根目录 .env，已被 .gitignore 忽略）
  //   NUXT_TYPESAFE_BASE_URL  默认 https://api.typesafe.ai
  //   NUXT_TYPESAFE_MODEL     默认 jev-latest
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
