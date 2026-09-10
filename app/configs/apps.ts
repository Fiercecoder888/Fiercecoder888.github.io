/**
 * 桌面应用注册表（图标来自 macos-web 的 public/app-icons，已拷到本项目 public/app-icons/）。
 * Dock、Launchpad、右键菜单、🍎 菜单都从这一份注册表读取，新增应用只改这里。
 */
export interface AppDef {
  id: string
  /** 显示名（Dock 悬浮标签 / Launchpad 标题 / 菜单文案） */
  name: string
  /** 图标路径 */
  icon: string
  kind: 'window' | 'route' | 'link' | 'action'
  /** kind = route / link 时的目标 */
  to?: string
  /** 是否出现在 Dock（Launchpad 会显示全部） */
  inDock?: boolean
  /** 该应用在 Dock 中是否需要前置分隔线 */
  dockBreakBefore?: boolean
}

export const APPS: AppDef[] = [
  {
    id: 'finder',
    name: 'Finder',
    icon: '/app-icons/finder/128.png',
    kind: 'window',
    inDock: true,
  },
  {
    id: 'launchpad',
    name: 'Launchpad',
    icon: '/app-icons/launchpad/128.png',
    kind: 'action',
    inDock: true,
  },
  {
    id: 'blog',
    name: '文章列表',
    icon: '/app-icons/safari/128.png',
    kind: 'route',
    to: '/blog',
    inDock: true,
  },
  {
    id: 'tags',
    name: '标签',
    icon: '/app-icons/notes/128.png',
    kind: 'route',
    to: '/tags',
    inDock: true,
  },
  {
    id: 'about-page',
    name: '关于我',
    icon: '/app-icons/contacts/128.png',
    kind: 'route',
    to: '/about',
    inDock: true,
  },
  {
    id: 'terminal',
    name: '终端',
    icon: '/app-icons/terminal/128.png',
    kind: 'window',
    inDock: true,
    dockBreakBefore: true,
  },
  {
    id: 'settings',
    name: '系统设置',
    icon: '/app-icons/system-preferences/128.png',
    kind: 'window',
    inDock: true,
  },
  {
    id: 'wallpaper',
    name: '壁纸',
    icon: '/app-icons/wallpapers/128.png',
    kind: 'window',
    inDock: true,
  },
  {
    id: 'news',
    name: 'RSS 订阅',
    icon: '/app-icons/news/128.png',
    kind: 'link',
    to: '/rss.xml',
    inDock: true,
  },
  {
    id: 'trash',
    name: '废纸篓',
    icon: '/app-icons/trash/128.svg',
    kind: 'window',
    inDock: true,
    dockBreakBefore: true,
  },
]

export const DOCK_APPS = APPS.filter(app => app.inDock)

export function findApp(id: string): AppDef | undefined {
  return APPS.find(app => app.id === id)
}
