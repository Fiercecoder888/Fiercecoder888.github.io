import { defineStore } from 'pinia'

export type MenuBarMenu =
  | ''
  | 'system'
  | 'app'
  | 'file'
  | 'edit'
  | 'view'
  | 'go'
  | 'window'
  | 'help'
  | 'control'
  | 'clock'
export type BootStage = 'boot' | 'login' | 'done'

/**
 * 桌面 UI 状态：Spotlight / Launchpad / 右键菜单 / 顶栏菜单 / 开机动画。
 * 窗口本身的状态在 stores/windows.ts。
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    spotlightOpen: false,
    launchpadOpen: false,
    /** 清空桌面：整页内容隐藏，只剩壁纸 + 菜单栏 + Dock + 窗口 */
    desktopClean: false,
    menuBarMenu: '' as MenuBarMenu,
    contextMenu: { visible: false, x: 0, y: 0 },
    bootStage: 'boot' as BootStage,
    bootEnabled: true,
  }),

  getters: {
    anyOverlayOpen(state): boolean {
      return state.spotlightOpen || state.launchpadOpen
    },
  },

  actions: {
    toggleSpotlight(force?: boolean) {
      const next = force ?? !this.spotlightOpen
      this.spotlightOpen = next
      if (next) {
        this.launchpadOpen = false
        this.menuBarMenu = ''
        this.closeContextMenu()
      }
    },

    toggleLaunchpad(force?: boolean) {
      const next = force ?? !this.launchpadOpen
      this.launchpadOpen = next
      if (next) {
        this.spotlightOpen = false
        this.menuBarMenu = ''
        this.closeContextMenu()
      }
    },

    /** 清空桌面：只留壁纸的那种纯净桌面 */
    setDesktopClean(value: boolean) {
      this.desktopClean = value
      if (value) {
        this.spotlightOpen = false
        this.launchpadOpen = false
        this.menuBarMenu = ''
        this.closeContextMenu()
      }
    },

    toggleDesktopClean(force?: boolean) {
      this.setDesktopClean(force ?? !this.desktopClean)
    },

    setMenuBarMenu(menu: MenuBarMenu) {
      this.menuBarMenu = this.menuBarMenu === menu ? '' : menu
      if (this.menuBarMenu) {
        this.spotlightOpen = false
        this.launchpadOpen = false
      }
    },

    openContextMenu(x: number, y: number) {
      this.contextMenu.visible = true
      this.contextMenu.x = x
      this.contextMenu.y = y
      this.menuBarMenu = ''
    },

    closeContextMenu() {
      this.contextMenu.visible = false
    },

    /** Esc：逐层关闭 */
    closeTopLayer() {
      if (this.contextMenu.visible) return this.closeContextMenu()
      if (this.menuBarMenu) return void (this.menuBarMenu = '')
      if (this.spotlightOpen) return void (this.spotlightOpen = false)
      if (this.launchpadOpen) return void (this.launchpadOpen = false)
      // 最后才退出纯净桌面，避免误触
      if (this.desktopClean) return this.setDesktopClean(false)
    },

    setBootStage(stage: BootStage) {
      this.bootStage = stage
    },

    /** 重新播放开机动画：清掉会话标记后刷新 */
    replayBoot() {
      if (import.meta.client) sessionStorage.removeItem('blog_boot_done')
      window.location.reload()
    },
  },
})
