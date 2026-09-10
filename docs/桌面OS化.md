# 桌面 OS 化

复刻 xiaohev.com 那套「仿 macOS 桌面」交互：Dock、可拖动窗口、终端、Finder、系统设置、废纸篓。

> **实现来源**：交互实现移植自开源项目 [PuruVJ/macos-web](https://github.com/PuruVJ/macos-web)（Dock 距离放大、三色按钮、弹簧动画）；
> **视觉与页面布局**按 [xiaohev.com](https://xiaohev.com)（用户指定的设计稿）还原：32px 菜单栏、74px 玻璃 Dock、三栏 widget 桌面、白色 mac 文章窗口。
> 参考源码已下载到工作区 `reference-repos/`，可直接对照。

## 设计规范（直接复刻 macos-web）

> 下面这套规格全部来自 [PuruVJ/macos-web](https://github.com/PuruVJ/macos-web) 的源码（`src/components/TopBar`、`src/components/Dock`、`src/css/theme.css`），参考代码在 `../reference-repos/macos-web/`。

### 系统色令牌（`app/assets/css/main.css`）

```css
--system-color-light-hsl: 240, 24%, 100%;   /* 白 */
--system-color-dark-hsl: 240, 3%, 11%;      /* 近黑 */
--system-color-light-contrast: hsl(0, 0%, 11%);
--menubar-bg: hsla(var(--system-color-light-hsl), 0.3);   /* 浅色模式 */
--dock-bg:    hsla(var(--system-color-light-hsl), 0.4);
.dark 下换成 hsla(dark-hsl, .45)
```

### 菜单栏（`TopBar.vue`）

| 项 | 规格（照搬 macos-web） |
| --- | --- |
| 高度 | `1.8rem`（28.8px） |
| 背景 | `hsla(light-hsl, .3)`，`backdrop-filter: blur(12px) saturate(180%)` |
| 文字 | `font-weight 500`、`font-size .8rem`、`letter-spacing .3px`、`text-shadow: 0 0 1px rgba(0,0,0,.1)` |
| 菜单项 | `border-radius .25rem`、`padding 0 .5rem`、hover/active 背景 `hsla(dark-hsl, .2)` |
| 🍎 按钮 | `padding 0 .7rem`、图标 `1rem` |
| 默认菜单 | 「我的博客」`font-weight 600`、`margin 0 6px` |
| 结构 | 🍎 ｜ 我的博客 · 文件 · 编辑 · 显示 · 前往 · 窗口 · 帮助 ｜ …spacer… ｜ 搜索 · WiFi · 电池 · 控制中心 · 时钟 |

菜单内容用同一套 `.mac-menu` / `.mac-menu-item` 样式（半透明模糊面板 + 悬停蓝色高亮 + 分隔线 + 快捷键右对齐 + `✓` 勾选态）。

### Dock（`AppDock.vue` + `DockItem.vue`）

| 项 | 规格 |
| --- | --- |
| 容器 | 高 `5.2rem`、`padding .4rem`、底部留 `0.7rem`，flex 居中 |
| 底板 | `border-radius 1.2rem`、`padding .3rem`、`backdrop-filter: blur(10px)` |
| 阴影 | `inset 0 0 0 .2px hsla(grey-100,.7)`、`0 0 0 .2px hsla(grey-900,.7)`、`hsla(0,0%,0%,.3) 2px 5px 19px 7px` |
| 图标 | **真实 macOS App 图标**（`public/app-icons/<app>/128.png`，取自 macos-web），基准 52px、悬停放大到 104px |
| 分隔线 | `width .2px`、`margin 0 4px`、`hsla(dark-hsl,.3)` |
| 自动隐藏 | 鼠标进入屏幕底部 **30px** 才唤出（对齐 macos-web 的 `HIDDEN_DOCK_THRESHOLD`），隐藏时 `translate3d(0,200%,0)` |
| 放大算法 | 距离插值表 `[52, 57.2, 73.5, 104, 73.5, 57.2, 52]` + 弹簧（阻尼 `0.47` / 刚度 `0.12`），垂直方向 56px 门控避免页面中部误触发 |

### 应用注册表（`app/configs/apps.ts`）

Dock、Launchpad、菜单都从 `APPS` 读取：`{ id, name, icon, kind, to?, inDock?, dockBreakBefore? }`。
当前 10 个应用：Finder ｜ Launchpad · 文章列表(Safari) · 标签(Notes) · 关于我(Contacts) ｜ 终端 · 系统设置 · 壁纸 · RSS(News) ｜ 废纸篓。
新增一个 Dock 应用 = 在 `APPS` 里加一条。

### 外观（浅色 / 深色 / 跟随系统）

- `useBlogSettings().setTheme()` 给 `<html>` 加 `.dark` 类；
- `nuxt.config.ts` 里注入了**首屏防闪脚本**，页面渲染前就按 localStorage 应用外观与字号；
- Tailwind v4 用 `@custom-variant dark (&:where(.dark, .dark *))` 让 `dark:` 跟随类而不是系统偏好；
- 内容页按浅色纸张书写，深色模式通过 `.dark .mac-window .text-gray-*` 一类的**集中重映射**处理，无需逐页加变体。

### 壁纸（`app/configs/wallpapers.ts` + `WallpaperWindow.vue`）

- 8 张真实 macOS 壁纸（Big Sur 1–4、Big Sur 图形、Monterey 1–3，来自 macos-web 的 `src/assets/wallpapers`，已拷进 `public/wallpapers/`，共 2.3MB）；
- 3 组纯 CSS 渐变（不依赖图片）；
- 默认 `big-sur-1`；支持填自定义图片 URL 或 `/wallpapers/xxx.jpg`（`public/wallpapers/README.md` 有说明）；
- 切换有 0.6s 淡入淡出（`WallpaperLayer.vue` 的 `<Transition>`），默认壁纸参与 SSR 避免首屏闪白。

### 页面窗口

内容页（文章列表 / 详情 / 标签 / 关于）装在 `.mac-window` 里：`2.1rem` 高的 `.mac-titlebar` + 三色按钮 + 顶部渐变阅读进度条；
标题栏与窗口底色跟随浅/深色令牌。

## 桌面窗口（Dock 打开的应用）

| 窗口 | 说明 |
| --- | --- |
| Finder | 侧栏（文章/标签/站点页面）+ 列表 |
| 终端 | 假终端，真实读取文章数据 |
| 系统设置 | 外观模式、字体大小、7 个开关 |
| 壁纸 | 内置壁纸网格 + 自定义图片 |
| 关于本站 / 废纸篓 | 站点信息 / `draft: true` 草稿 |

桌面窗口统一使用深色玻璃（`bg-slate-900/85` + `backdrop-blur-2xl`），与 macOS 深色 App 一致。

## 架构

```
app/stores/windows.ts                  # Pinia 窗口管理器（唯一状态源）
app/stores/ui.ts                       # Spotlight / Launchpad / 右键菜单 / 顶栏菜单 / 开机阶段
app/composables/useBlogSettings.ts     # 站点偏好（字体/Dock/动效/开机动画/时钟），localStorage 持久化
app/composables/useBlogSearch.ts       # Spotlight 全文搜索索引 + 打分
app/composables/useWindowTitle.ts      # 页面级窗口标题
app/components/desktop/
├─ DesktopLayer.vue                    # 窗口层 + 右键菜单 + Spotlight + Launchpad + 开机动画
├─ AppWindow.vue                       # 桌面窗口外壳（拖动 / resize / 三色按钮 / 层级）
├─ MacWindow.vue                       # 页面级白色窗口（标题栏 + 进度条 + 折叠/展开）
├─ TopBar.vue                          # 32px 菜单栏（系统菜单 / 控制中心 / 时钟）
├─ DockItem.vue                        # Dock 图标（距离插值放大 + 弹簧 + 弹跳）
├─ ContextMenu.vue                     # 桌面右键菜单
├─ SpotlightOverlay.vue                # Spotlight 搜索面板
├─ LaunchpadOverlay.vue                # Launchpad 应用网格
├─ BootScreen.vue                      # 开机 / 登录动画
├─ OsIcon.vue                          # 线性图标集（20+ 个，替代 iconify）
├─ FinderWindow.vue / TerminalWindow.vue / SettingsWindow.vue / AboutWindow.vue / TrashWindow.vue
app/components/AppDock.vue             # 74px 玻璃 Dock
app/layouts/default.vue                # 壁纸 + 顶栏 + （首页=桌面 / 其他页=MacWindow）+ 窗口层 + Dock
```

## 六个桌面能力

### 1. Spotlight 搜索（⌘/Ctrl + K）
`useBlogSearch` 懒加载 `queryCollectionSearchSections('blog')` 建立索引并缓存；查询按「标题命中 12 分 / 小标题 6 分 / 正文出现次数 2 分 / 整句命中 15 分」打分，取前 12 条，命中词用 `<mark>` 高亮。支持 ↑↓ 选择、Enter 打开、Esc 关闭。

### 2. 桌面右键菜单
`document` 级 `contextmenu` 监听 + 白名单守卫：`article / .prose-blog / input / textarea / a / pre / code` 内保留浏览器默认菜单，其余区域弹出自定义菜单。点在窗口上时会额外插入「最小化 / 最大化 / 关闭窗口」。坐标会夹取到视口内。

### 3. 开机 / 登录动画
`BootScreen`：开机阶段（🍎 + 进度条，随机步进到 100%）→ 登录阶段（头像 + 密码框 + 进入按钮）→ 桌面。用 `sessionStorage.blog_boot_done` 保证一个会话只播一次；系统设置/控制中心可关闭；Logo 菜单里有「重新播放开机动画」。

### 4. Launchpad（F4）
全屏毛玻璃网格，12 个应用（5 个窗口 + 4 个路由 + 2 个外链 + Spotlight），带实时过滤搜索框、悬停放大，Esc / 点击背景关闭。

### 5. 顶栏菜单
🍎 系统菜单（关于本站 / 系统设置 / Finder / Launchpad / Spotlight / 关闭所有窗口 / 重播开机动画）、控制中心（Launchpad·Spotlight 快捷块 + 字体大小 + 5 个开关）、时钟（时:分 + 完整日期）。点击外部自动收起。

### 6. 窗口 resize
`AppWindow` 提供右边缘 / 下边缘 / 右下角三个拖拽手柄，`store.resize()` 夹取最小 320×200、最大 2400×1600；最大化时禁用手柄；双击标题栏切换最大化。

## 窗口管理器

`useWindowsStore` 是唯一状态源：

```ts
interface WindowState {
  id: string            // 窗口标识，如 'terminal'
  title: string         // 标题栏文字
  icon: string          // Dock / 标题栏图标
  width: number
  height: number
  isOpen: boolean
  isMinimize: boolean
  isMaximized: boolean
  zIndex: number        // 层级
  x: number | null      // null = 首次打开自动居中
  y: number | null
}
```

主要 action：

| action | 作用 |
| --- | --- |
| `open(id)` / `toggle(id)` | 打开（并置顶）/ 打开或最小化 |
| `close(id)` | 关闭并复位 |
| `minimize(id)` | 最小化（Dock 图标保留圆点） |
| `focus(id)` | 置顶：`globalZIndex += 1` 后赋给该窗口 |
| `move(id, x, y)` | 拖动时更新坐标（已夹取在视口内） |
| `resize(id, w, h)` | 拖拽手柄改变尺寸（夹取最小/最大） |
| `toggleMaximize(id)` | 最大化 / 还原（双击标题栏也可） |
| `ensurePosition(id, vw, vh)` | 首次打开居中，拖过之后保持原位 |

getter：`opened`（已打开未最小化，按层级升序）、`minimized`、`isOpen(id)`、`isMinimized(id)`。

## Dock 放大算法（移植自 macos-web）

`DockItem.vue` 照搬了 macos-web `Dock/DockItem.svelte` 的核心：

```ts
const base = 48                       // 原版 57.6，这里按 xiaohev 的 48px 图标
const distanceLimit = base * 6
const distanceInput = [-limit, -limit/1.25, -limit/2, 0, limit/2, limit/1.25, limit]
const widthOutput   = [base, base*1.1, base*1.414, base*2, base*1.414, base*1.1, base]
// distance = 鼠标 X − 图标中心 X，分段线性插值得到目标宽度
```

再用弹簧积分逼近目标宽度（阻尼 `0.47` / 刚度 `0.12`，与原版 `spring()` 参数一致），点击时图标先 `translateY(-14px)` 再回落（原版是 -40，按 48px 图标等比缩小）。

## 新增一个窗口

1. `app/stores/windows.ts` 的 `REGISTRY` 里加一行：
   ```ts
   { id: 'music', title: '音乐', icon: '🎵', width: 520, height: 400 },
   ```
2. 新建 `app/components/desktop/MusicWindow.vue`。
3. `DesktopLayer.vue` 里挂上：
   ```vue
   <DesktopMusicWindow v-else-if="win.id === 'music'" />
   ```
   > 注意：`app/components/desktop/` 下的组件会被 Nuxt 自动加上目录前缀，所以文件名 `MusicWindow.vue` 的组件名是 **`DesktopMusicWindow`**。
4. 需要的话在 `AppDock.vue` 的 `items` 里加一个 `kind: 'window'` 的条目。

## 拖拽与 resize 实现

- 拖动只响应标题栏左键按下（`pointerdown`），`pointermove` / `pointerup` 挂在 `window` 上，组件卸载时移除。
- resize 由三个手柄触发，`store.resize()` 回写宽高；同样用视口夹取。
- 坐标与尺寸全部由 store 驱动渲染，不直接改 DOM 样式。
- 移动端（`innerWidth < 640`）禁用拖拽/resize，避免与滑动手势冲突。
- 测试钩子：窗口根 `data-window="<id>"`、标题栏 `data-window-titlebar`、三色按钮 `data-action="close|minimize|maximize"`、resize 手柄 `data-resize="e|s|se"`、Dock 图标 `data-dock-item="<id>"`、mac 窗口 `data-mac-window`。

## 终端命令

| 命令 | 说明 |
| --- | --- |
| `help` | 帮助 |
| `ls` / `ls tags` | 列出文章 / 标签（真实读 `queryCollection('blog')`） |
| `cat <slug>` | 查看文章摘要（支持按标题模糊匹配） |
| `open <路径>` | 跳转，如 `open /blog` |
| `whoami` / `date` / `pwd` / `echo` | 小玩具 |
| `clear` | 清屏 |

支持 ↑ / ↓ 翻历史命令。

## 站点偏好

`useBlogSettings()` 用 `useState` 做 SSR 安全共享状态，客户端挂载后从 `localStorage` 的 `blog_settings` 读取；其中两个彩蛋开关会**同时镜像成 cookie**（`blog_one_screen_mode` / `blog_fireworks_effect`，命名沿用 xiaohev）：

| 设置 | 作用 |
| --- | --- |
| 字体大小 | 改 `document.documentElement.style.fontSize`（小 14 / 中 16 / 大 18） |
| Dock 自动隐藏 | 鼠标不靠近底部时 Dock 滑出屏幕 |
| 界面动效 | 关闭后 Dock 放大、Launchpad 悬停、烟花等停用 |
| 首页快捷启动 | 控制首页「快捷启动」卡片是否显示 |
| 开机动画 | 控制是否播放开机 / 登录页 |
| 顶栏时钟 | 控制菜单栏右侧是否显示时间 |
| **一屏模式** | 页面不整体滚动，内容区按一屏高度内部滚动 |
| **烟花特效** | 点击页面任意位置放一朵烟花 |

## 两个彩蛋

### 一屏模式（`blog_one_screen_mode`）

给 `<body>` 加 `one-screen-mode` 类，CSS 接管布局：

```css
body.one-screen-mode { overflow: hidden; }
body.one-screen-mode [data-desktop-surface] {
  height: calc(100vh - 32px - 92px);   /* 扣掉 32px 菜单栏 + Dock 区 */
  overflow-y: auto;
  overscroll-behavior: contain;
}
body.one-screen-mode footer { display: none; }
```

- 页面本身不再滚动，滚动条只出现在内容区内部；
- `MacWindow` 监听该开关，把 `--window-body-height` 从「视口 − 顶栏 − 窗口标题栏 − 24」改成再扣掉 Dock 区，保证窗口在一屏内完整放下；
- 开启后右上角出现「一屏模式 · 点此退出」胶囊按钮（`data-one-screen-exit`）。

### 烟花特效（`blog_fireworks_effect`）

`FireworksCanvas.vue`：固定在 `z-[55]` 的全屏 canvas（`pointer-events-none`，`data-fireworks`）。

- 触发：`window` 上的 `pointerdown`（输入框内不触发），或 `window.dispatchEvent(new CustomEvent('blog:firework', { detail: { x, y } }))` —— 顶栏 🍎 菜单里的「放一朵烟花」用的就是后者；
- 每次发射 42 个粒子，随机角度/速度（1.8–6.4），重力 `0.055`、空气阻力 `0.985`，寿命 48–82 帧，用 `lighter` 混合模式叠加发光；
- 粒子清空后自动 `cancelAnimationFrame` 并清屏（**空闲不占 CPU**），canvas 跟随窗口尺寸并按 DPR 缩放（上限 2）；
- `data-fireworks-particles` 暴露实时粒子数，供 e2e 断言。

## SSR / 水合注意事项

1. 窗口层必须包在 `<ClientOnly>` 里 —— 窗口状态、`localStorage`、`window` 都只存在于客户端。
2. store 的初始 state 里**不要**读 `window.innerWidth`；居中逻辑放在 `onMounted` 的 `ensurePosition`。
3. 偏好设置先渲染默认值，`onMounted` 后再 hydrate，避免水合不匹配。
4. Dock/顶栏里的 `/rss.xml`、`/sitemap.xml`、`/llms.txt` 必须是原生 `<a>`，用 `NuxtLink` 会触发 Vue Router 警告（这些不是 Vue 路由）。
5. 首页「随便看看」标签页只在用户点击后才打乱，避免 SSR 与客户端顺序不一致。

## 验收

```bash
node tools/e2e-desktop.mjs     # CDP 端到端 32 项：开机动画/顶栏/控制中心/Spotlight/Launchpad/右键菜单/窗口/终端/拖拽/resize/层级/一屏模式/烟花/截图/无异常
node tools/verify.mjs          # 页面 + SEO + 评论 API 共 29 项
node tools/screenshots.mjs     # 会先跳过登录动画再截图 preview/*.png
```

截图产物：`preview/home.png`、`blog-list.png`、`post.png`、`about.png`、`desktop.png`、`spotlight.png`、`launchpad.png`、`fireworks.png`。

## 后续可做

- Spotlight 支持搜索历史与快捷动作（> 前缀命令）
- 桌面右键菜单的子菜单（macos-web 的 `ContextMenu.svelte` 有实现）
- 窗口位置/尺寸持久化（存 localStorage）
- 壁纸切换器（macos-web 的 `WallpaperSelectorApp`）
- Dock 最小化时的「genie 效果」


