import { defineStore } from 'pinia'

export interface WindowState {
  id: string
  title: string
  width: number
  height: number
  isOpen: boolean
  isMinimize: boolean
  isMaximized: boolean
  zIndex: number
  /** null 表示交给组件首次打开时居中 */
  x: number | null
  y: number | null
}

/** 窗口最小尺寸 */
const MIN_WIDTH = 320
const MIN_HEIGHT = 200

/** 窗口注册表：新增一个窗口只需要在这里加一行 + 在 DesktopLayer 里挂上内容组件
    （标题栏不显示图标 —— macOS 的窗口标题栏本来就只有三色按钮 + 标题） */
const REGISTRY: Omit<WindowState, 'isOpen' | 'isMinimize' | 'isMaximized' | 'zIndex' | 'x' | 'y'>[] = [
  { id: 'finder', title: 'Finder', width: 900, height: 560 },
  { id: 'terminal', title: '终端', width: 720, height: 430 },
  { id: 'settings', title: '系统设置', width: 520, height: 470 },
  { id: 'about', title: '关于本站', width: 460, height: 420 },
  { id: 'trash', title: '废纸篓', width: 620, height: 420 },
  { id: 'wallpaper', title: '壁纸', width: 660, height: 560 },
  // Jev 决策台：左右两栏，所以默认开得比别的窗口宽一些
  { id: 'jev', title: 'Jev 决策台', width: 880, height: 700 },
]

function createWindows(): Record<string, WindowState> {
  const map: Record<string, WindowState> = {}
  for (const item of REGISTRY) {
    map[item.id] = {
      ...item,
      isOpen: false,
      isMinimize: false,
      isMaximized: false,
      zIndex: 1000,
      x: null,
      y: null,
    }
  }
  return map
}

export const useWindowsStore = defineStore('windows', {
  state: () => ({
    globalZIndex: 1000,
    windows: createWindows(),
  }),

  getters: {
    /** 打开且未最小化，按层级升序 */
    opened(state): WindowState[] {
      return Object.values(state.windows)
        .filter(w => w.isOpen && !w.isMinimize)
        .sort((a, b) => a.zIndex - b.zIndex)
    },
    minimized(state): WindowState[] {
      return Object.values(state.windows).filter(w => w.isOpen && w.isMinimize)
    },
    isOpen(state) {
      return (id: string) => Boolean(state.windows[id]?.isOpen)
    },
    isMinimized(state) {
      return (id: string) => Boolean(state.windows[id]?.isMinimize)
    },
  },

  actions: {
    focus(id: string) {
      const win = this.windows[id]
      if (!win) return
      this.globalZIndex += 1
      win.zIndex = this.globalZIndex
      win.isMinimize = false
    },
    open(id: string) {
      const win = this.windows[id]
      if (!win) return
      win.isOpen = true
      this.focus(id)
    },
    close(id: string) {
      const win = this.windows[id]
      if (!win) return
      win.isOpen = false
      win.isMinimize = false
      win.isMaximized = false
    },
    minimize(id: string) {
      const win = this.windows[id]
      if (!win) return
      win.isMinimize = true
    },
    toggle(id: string) {
      const win = this.windows[id]
      if (!win) return
      if (win.isOpen && !win.isMinimize) this.minimize(id)
      else this.open(id)
    },
    toggleMaximize(id: string) {
      const win = this.windows[id]
      if (!win) return
      win.isMaximized = !win.isMaximized
      this.focus(id)
    },
    move(id: string, x: number, y: number) {
      const win = this.windows[id]
      if (!win) return
      win.x = Math.round(x)
      win.y = Math.round(y)
    },
    /** 拖拽边缘/右下角改变窗口尺寸（已夹取最小值） */
    resize(id: string, width: number, height: number) {
      const win = this.windows[id]
      if (!win) return
      win.width = Math.round(Math.max(MIN_WIDTH, Math.min(width, 2400)))
      win.height = Math.round(Math.max(MIN_HEIGHT, Math.min(height, 1600)))
    },
    resetSize(id: string) {
      const win = this.windows[id]
      const preset = REGISTRY.find(item => item.id === id)
      if (!win || !preset) return
      win.width = preset.width
      win.height = preset.height
    },
    /** 首次打开时居中；已拖过的窗口保持原位 */
    ensurePosition(id: string, viewportWidth: number, viewportHeight: number) {
      const win = this.windows[id]
      if (!win || win.x !== null) return
      win.x = Math.max(12, Math.round((viewportWidth - win.width) / 2))
      win.y = Math.max(12, Math.round((viewportHeight - win.height) / 2) - 20)
    },
    closeAll() {
      for (const win of Object.values(this.windows)) {
        win.isOpen = false
        win.isMinimize = false
        win.isMaximized = false
      }
    },
    /** 清空桌面：关闭全部窗口，并把位置/尺寸复位到注册表默认值 */
    resetAll() {
      const preset = createWindows()
      for (const [id, win] of Object.entries(this.windows)) {
        win.isOpen = false
        win.isMinimize = false
        win.isMaximized = false
        const base = preset[id]
        if (base) {
          win.width = base.width
          win.height = base.height
        }
        win.x = null
        win.y = null
      }
      this.globalZIndex = 1000
    },
  },
})
