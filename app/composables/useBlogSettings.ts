/**
 * 站点偏好设置：SSR 安全（useState）+ localStorage 持久化。
 * 同时把两个「桌面彩蛋」开关镜像成 cookie（blog_one_screen_mode / blog_fireworks_effect），
 * 与 xiaohev 那套命名保持一致。
 */
export type FontSize = 'small' | 'medium' | 'large'

/** 外观模式：浅色 / 深色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'auto'

export type ToggleKey =
  | 'dockAutoHide'
  | 'animations'
  | 'desktopIcons'
  | 'bootScreen'
  | 'menuBarClock'
  | 'oneScreen'
  | 'fireworks'

export interface BlogSettings {
  fontSize: FontSize
  theme: ThemeMode
  dockAutoHide: boolean
  animations: boolean
  desktopIcons: boolean
  bootScreen: boolean
  menuBarClock: boolean
  /** 一屏模式：页面不整体滚动，内容区按一屏高度内部滚动 */
  oneScreen: boolean
  /** 点击桌面放烟花 */
  fireworks: boolean
}

const DEFAULTS: BlogSettings = {
  fontSize: 'medium',
  theme: 'light',
  dockAutoHide: false,
  animations: true,
  desktopIcons: true,
  bootScreen: true,
  menuBarClock: true,
  oneScreen: false,
  fireworks: true,
}

const FONT_SCALE: Record<FontSize, string> = {
  small: '14px',
  medium: '16px',
  large: '18px',
}

/** 镜像到 cookie 的字段（沿用 xiaohev 的 cookie 名） */
const COOKIE_MIRROR: Partial<Record<keyof BlogSettings, string>> = {
  oneScreen: 'blog_one_screen_mode',
  fireworks: 'blog_fireworks_effect',
}

const COOKIE_MAX_AGE = 31536000

export function useBlogSettings() {
  const settings = useState<BlogSettings>('blog-settings', () => ({ ...DEFAULTS }))

  function applyFontSize(size: FontSize) {
    if (import.meta.server) return
    document.documentElement.style.fontSize = FONT_SCALE[size] ?? FONT_SCALE.medium
  }

  /** 应用外观：给 <html> 加/去 dark 类（auto 跟随系统） */
  function applyTheme(mode: ThemeMode) {
    if (import.meta.server) return
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    const dark = mode === 'dark' || (mode === 'auto' && prefersDark)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  function writeCookies() {
    if (import.meta.server) return
    for (const [key, cookieName] of Object.entries(COOKIE_MIRROR)) {
      if (!cookieName) continue
      const value = settings.value[key as keyof BlogSettings]
      document.cookie = `${cookieName}=${value};path=/;max-age=${COOKIE_MAX_AGE}`
    }
  }

  function persist() {
    if (import.meta.server) return
    try {
      localStorage.setItem('blog_settings', JSON.stringify(settings.value))
    }
    catch {
      // localStorage 不可用（隐私模式）时静默忽略
    }
    writeCookies()
  }

  function setFontSize(size: FontSize) {
    settings.value.fontSize = size
    applyFontSize(size)
    persist()
  }

  function setTheme(mode: ThemeMode) {
    settings.value.theme = mode
    applyTheme(mode)
    persist()
  }

  function toggle(key: ToggleKey) {
    settings.value[key] = !settings.value[key]
    persist()
  }

  function reset() {
    settings.value = { ...DEFAULTS }
    applyFontSize(DEFAULTS.fontSize)
    applyTheme(DEFAULTS.theme)
    persist()
  }

  /** 客户端挂载后调用：读取持久化值并应用 */
  function hydrate() {
    if (import.meta.server) return
    try {
      const raw = localStorage.getItem('blog_settings')
      if (raw) settings.value = { ...DEFAULTS, ...JSON.parse(raw) }
    }
    catch {
      settings.value = { ...DEFAULTS }
    }
    applyFontSize(settings.value.fontSize)
    applyTheme(settings.value.theme)
    writeCookies()

    // 跟随系统时监听系统外观变化
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (settings.value.theme === 'auto') applyTheme('auto')
    })
  }

  return { settings, setFontSize, setTheme, toggle, reset, hydrate }
}
