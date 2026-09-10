# 我的博客

基于 **Nuxt 4 + Nuxt Content v3 + TailwindCSS v4 + Pinia** 的 Markdown 个人博客，复刻了 [xiaohev.com](https://xiaohev.com) 那套「仿 macOS 桌面 OS」交互。

已具备：

- 📝 **Markdown 写文章**：`content/blog/*.md` 丢进去就发布
- 🖥️ **桌面 OS 交互**：32px 菜单栏、74px 玻璃 Dock（macOS 距离放大）、可拖动/缩放窗口、Finder、终端、系统设置、废纸篓
- 🔍 **Spotlight 全文搜索**（⌘/Ctrl+K）、**Launchpad**（F4）、**桌面右键菜单**、**开机/登录动画**
- 🎆 **两个彩蛋**：一屏模式、烟花特效（点击任意位置放烟花）
- 💬 **自建评论系统**：Nitro API + SQLite，含蜜罐、限流、后台删除接口
- 🔍 **SEO 四件套**：sitemap / RSS / robots（放行 AI 爬虫）/ llms.txt
- 📥 **笔记批量迁移**：一条命令把散落的笔记转成文章
- ✅ **自带验收脚本**：页面 + API + 桌面交互的自动化检查

> **设计与实现来源**：前端页面设计直接复刻开源项目 [PuruVJ/macos-web](https://github.com/PuruVJ/macos-web) ——
> 真实 macOS 壁纸（Big Sur / Monterey）、真·App 图标 Dock（`public/app-icons`）、原生菜单栏（🍎 菜单 + 文件/编辑/显示/前往/窗口/帮助 + 状态栏 + 时钟）、
> 浅/深色外观、Dock 距离放大与弹簧动画、三色按钮；博客内容页则装进 macOS 窗口里。
> 参考源码已下载到工作区 `../reference-repos/`（macos-web / playground-macos / vuejs-os-template / creaytic-webos / awesome-web-desktops）。
> 图标：`@nuxt/icon` + 本地图标库集合（**Phosphor** 主力 / **MDI** 苹果 logo / **Simple Icons** 品牌标志 / **Lucide** 备用），
> 全部构建期内联 SVG，不依赖 Iconify 在线 API；调用方只写语义名（`name="terminal"`），换库只改 `app/components/desktop/OsIcon.vue` 一处。
> 界面里**不含任何 emoji**（QA 有 emoji 残留扫描守着）。

---

## 环境要求

- Node ≥ 20（本机实测 Node 24.16）
- pnpm ≥ 9（本机实测 pnpm 10.6.4）
- 首次安装会执行 `scripts/install-sqlite-prebuild.mjs`：Nuxt Content 依赖 `better-sqlite3`，
  而 pnpm 10 默认拦截依赖构建脚本、GitHub Releases 在国内又常常不可达，
  所以该脚本会从**国内镜像**（npmmirror / ghfast / gh-proxy）自动下载与当前 Node ABI 匹配的
  预编译二进制并放到 `node_modules/better-sqlite3/build/Release/`。已存在则跳过。

## 快速开始

```bash
pnpm install          # 安装依赖（自动补 better-sqlite3 预编译包 + nuxt prepare）
pnpm dev              # 开发服务器 http://localhost:3000
pnpm dev --port 3123  # 端口被占用时换一个
pnpm build            # 生产构建（SSR，带评论 API）
pnpm generate         # 静态生成到 .output/public（纯静态，评论 API 不可用）
pnpm preview          # 预览构建产物
```

> 如果 `pnpm install` 卡在 better-sqlite3：手动下载
> `https://registry.npmmirror.com/-/binary/better-sqlite3/v<版本>/better-sqlite3-v<版本>-node-v<ABI>-win32-x64.tar.gz`
> 解压后把 `build/Release/better_sqlite3.node` 放到 `node_modules/better-sqlite3/build/Release/`。
> ABI 用 `node -p "process.versions.modules"` 查。
>
> 内存较小的机器上，别同时跑 `pnpm dev` 和 `pnpm generate`（构建会因内存不足崩掉）。

## 写一篇文章

在 `content/blog/` 下新建 `.md`，frontmatter 如下：

```md
---
title: 文章标题
description: 一句话摘要（会出现在列表、SEO description、RSS、llms.txt）
date: '2026-09-09'
category: 前端
tags:
  - Nuxt
  - 笔记
draft: false
---
```

文件名就是 URL：`content/blog/my-post.md` → `/blog/my-post`。

> ⚠️ **中文文件名必须显式写 `path`**：Nuxt Content 默认 slugify 会把非 ASCII 整段剥掉
> （`学习笔记-网络基础.md` 会塌成 `/blog`）。用 `scripts/import-notes.mjs` 导入会自动补上 `path`；
> 手写文章的话建议用英文文件名。

## 桌面 OS 交互

**首页＝桌面**：壁纸 + 三栏 widget（个人名片 / 文章列表 / 站点概览 / 分类标签 / 快捷启动）。
**其他页面＝白色 mac 窗口**：灰标题栏 + 三色按钮（关・折・展）+ 顶部阅读进度条。

| 入口 | 作用 |
| --- | --- |
| 🍎 顶栏菜单 | macOS 原生菜单栏：🍎 系统菜单 + 我的博客 / 文件 / 编辑 / 显示 / 前往 / 窗口 / 帮助 |
| ⚙️ 控制中心 | 外观（浅色/深色）、字体大小、7 个开关（Dock 隐藏 / 动效 / 快捷启动 / 开机动画 / 时钟 / 一屏模式 / 烟花） |
| 🕐 顶栏时钟 | 「周三 9月10日 09:25」格式，点击展开完整时间 |
| 🖼️ 壁纸 | 11 张内置（8 张真实 macOS 壁纸 + 3 组渐变），支持自定义图片 URL 或 `/wallpapers/xxx.jpg` |
| 🔍 Spotlight | **⌘/Ctrl + K**，全文搜索文章（标题/正文打分 + 关键词高亮 + ↑↓ Enter） |
| 🚀 Launchpad | **F4**，全屏应用网格，可搜索应用 |
| 🖱️ 右键菜单 | 桌面任意空白处右键；点在窗口上会多出最小化/最大化/关闭 |
| ⏻ 开机动画 | 首次进入播放（🍎 进度条 → 登录页），会话内只播一次，可关闭 |
| 🖥️ 一屏模式 | 页面不整体滚动，内容区按一屏高度内部滚动，右上角一键退出 |
| 🎆 烟花特效 | 点击页面任意位置放一朵烟花（粒子清空后自动停 rAF，空闲不占 CPU） |
| 🗂️ Finder | 浏览文章 / 标签 / 站点页面 |
| ⌨️ 终端 | `help` `ls` `cat <slug>` `open <路径>` `whoami` `clear`，支持 ↑↓ 历史 |
| ⚙️ 系统设置 | 字体大小、Dock 自动隐藏、动效、桌面图标、开机动画、时钟 |
| 👤 关于本站 | 技术栈与站点索引 |
| 🗑️ 废纸篓 | 列出 `draft: true` 的草稿 |

窗口支持拖动标题栏移动、拖右/下/右下角缩放、三色按钮、双击标题栏最大化、点击置顶。

实现细节见 [`docs/桌面OS化.md`](docs/桌面OS化.md)。

## 评论系统

自建，零外部服务：Nitro API + SQLite（`better-sqlite3`）。

- `GET /api/comments?path=/blog/xxx` 列表
- `POST /api/comments` 发表（蜜罐 + 限流：同 IP 10 秒 1 条、1 小时 20 条）
- `DELETE /api/comments/:id` 删除（需要 `x-admin-token`，默认 `dev-admin-token`）

完整 API 与部署说明见 [`docs/评论系统.md`](docs/评论系统.md)。

## 笔记批量迁移

```bash
node scripts/import-notes.mjs --src notes --dry-run          # 先看会生成什么
node scripts/import-notes.mjs --src notes --category 笔记 --tag 旧文
```

自动补 frontmatter、识别分类标签、中文 slug 保留、已存在不覆盖。详见 [`docs/内容迁移.md`](docs/内容迁移.md)。

## 验收脚本

```bash
node tools/verify.mjs          # 页面 + SEO + 评论 API + macOS 外观体检，共 31 项
node tools/e2e-desktop.mjs     # 桌面交互端到端，共 41 项（开机动画/菜单栏/控制中心/Spotlight/Launchpad/右键菜单/窗口/终端/拖拽/resize/层级/壁纸/主题/一屏模式/烟花）
node tools/qa.mjs              # 体验 QA：命中测试 + 裁剪 + 横向溢出 + 文本对比度（截图采样），加 --dark 测深色
node tools/screenshots.mjs     # 先跳过登录动画再截图 preview/*.png
```

`verify.mjs` 会自动清理自己造的测试评论；`e2e-desktop.mjs` 会输出 `preview/desktop.png`、`spotlight.png`、`launchpad.png`。
两个脚本都用退出码表示结果（0 通过、1 失败），可直接接 CI。

## 目录结构

```
my-blog/
├─ app/
│  ├─ app.vue                       # 根组件（全局 SEO 默认值）
│  ├─ error.vue                     # 自定义 404 / 错误页
│  ├─ layouts/default.vue           # 顶栏 + 窗口层 + Dock + 页脚
│  ├─ components/
│  │  ├─ AppDock.vue                # 底部 Dock（打开窗口 / 跳转路由）
│  │  ├─ BlogComments.vue           # 评论区（客户端拉取）
│  │  ├─ PostCard.vue               # 文章卡片
│  │  └─ desktop/                   # 桌面 OS（注意：组件名自动带 Desktop 前缀）
│  │     ├─ DesktopLayer.vue        # 窗口层 + 右键菜单 + Spotlight + Launchpad + 开机动画
│  │     ├─ AppWindow.vue           # 桌面窗口外壳（拖动 / resize / 三色按钮 / 层级）
│  │     ├─ MacWindow.vue           # 页面级白色窗口（标题栏 + 阅读进度 + 折叠展开）
│  │     ├─ TopBar.vue              # 32px 菜单栏（系统菜单 / 控制中心 / 时钟）
│  │     ├─ DockItem.vue            # Dock 图标（距离插值放大 + 弹簧 + 弹跳）
│  │     ├─ ContextMenu.vue         # 桌面右键菜单
│  │     ├─ SpotlightOverlay.vue    # Spotlight 搜索
│  │     ├─ LaunchpadOverlay.vue    # Launchpad 应用网格
│  │     ├─ BootScreen.vue          # 开机 / 登录动画
│  │     ├─ OsIcon.vue              # 线性图标集（20+）
│  │     ├─ FinderWindow.vue
│  │     ├─ TerminalWindow.vue
│  │     ├─ SettingsWindow.vue
│  │     ├─ AboutWindow.vue
│  │     └─ TrashWindow.vue
│  ├─ composables/useBlogSettings.ts # 站点偏好（localStorage 持久化）
│  ├─ stores/windows.ts              # Pinia 窗口管理器
│  ├─ pages/                         # 首页 / 关于 / 文章列表 / 详情 / 标签
│  ├─ utils/format.ts                # 日期格式化、阅读时长
│  └─ assets/css/main.css            # Tailwind + 文章排版
├─ content/blog/*.md                 # 文章
├─ notes/                            # 待迁移笔记的投放目录（含示例）
├─ server/
│  ├─ api/comments/                  # 评论 API（get / post / delete）
│  ├─ utils/comments-db.ts           # SQLite 封装 + 限流
│  └─ routes/                        # sitemap.xml / rss.xml / robots.txt / llms.txt
├─ scripts/
│  ├─ import-notes.mjs               # 笔记批量迁移
│  └─ install-sqlite-prebuild.mjs    # better-sqlite3 预编译包安装
├─ tools/
│  ├─ verify.mjs                     # 页面 + API 验收
│  └─ e2e-desktop.mjs                # 桌面交互 e2e
├─ docs/                             # 各模块详细文档
├─ preview/                          # 截图产物
├─ content.config.ts                 # Nuxt Content 集合定义
└─ nuxt.config.ts
```

## 部署到 GitHub Pages（免费域名）

本站已配好 GitHub Actions 工作流 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：**推送到 `main` 就自动构建并发布**。

### 首次部署（用户站，推荐）

仓库名必须是 `<你的用户名>.github.io`，网址就是 `https://<你的用户名>.github.io/`，**本项目不需要改任何代码**（当前已配置为 `https://fiercecoder.github.io`）。

```powershell
git push -u origin main
```

推完后去仓库 **Settings → Pages → Build and deployment → Source 选 “GitHub Actions”**，等 Actions 跑完（首次 2-4 分钟）即可访问。

### 更新站点

```powershell
git add -A
git commit -m "update"
git push
```

### 三个注意点

1. **评论在 GitHub Pages 上不可用**（`/api/comments` 需要 Node 常驻服务）。前端已做优雅降级，会显示「当前是静态部署…」的说明，不是 bug。
2. **`.nojekyll` 不能少**：GitHub Pages 默认跑 Jekyll，会忽略 `_nuxt/` 这类下划线开头的目录，导致样式和脚本 404。工作流里已自动 `touch .output/public/.nojekyll`。
3. **`NUXT_PUBLIC_SITE_URL` 决定 sitemap / RSS / llms.txt 里的绝对地址**：工作流会自动注入 Pages 地址；本地生成时用 `shared/site.ts` 的 `url` 兜底。

> 完整步骤、自定义域名、以及「项目站（带子路径）」的坑，见 [`docs/部署.md`](docs/部署.md)。

## 其他部署方式

### 纯静态（评论不可用）

1. 设环境变量 `NUXT_PUBLIC_SITE_URL=https://你的域名`（否则 sitemap/RSS 里是 localhost）
2. `pnpm generate`，把 `.output/public` 上传到 Cloudflare Pages / Vercel / 阿里云 OSS + CDN
3. 在 Google Search Console / Bing 提交 `https://你的域名/sitemap.xml`

### 带评论（需要 Node 常驻）

```bash
pnpm build
NUXT_PUBLIC_SITE_URL=https://你的域名 \
NUXT_COMMENTS_ADMIN_TOKEN=你的强口令 \
node .output/server/index.mjs
```

再用 Nginx / Caddy 反代，记得透传 `X-Forwarded-For`（限流按它取 IP）。

## 下一步可做

- [ ] 全文搜索（Nuxt Content 自带 `queryCollectionSearchSections`）
- [ ] 窗口 resize、Spotlight 搜索、桌面右键菜单、一屏模式
- [ ] 评论楼中楼 / 邮件通知
- [ ] 图片托管（图床 / OSS）
- [ ] 深色 / 浅色主题切换
