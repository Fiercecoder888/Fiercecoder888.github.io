import { DEFAULT_WALLPAPER_ID, WALLPAPERS, type Wallpaper } from '~/configs/wallpapers'

const STORAGE_KEY = 'blog_wallpaper'

interface WallpaperState {
  /** 当前选中的壁纸 id（WALLPAPERS 里的 id，或 'custom'） */
  id: string
  /** 自定义图片地址（本地 /wallpapers/xxx.jpg 或外链） */
  customUrl: string
}

const GRAY_FALLBACK = '#0a0f1e'

export function useWallpaper() {
  const state = useState<WallpaperState>('blog-wallpaper', () => ({
    id: DEFAULT_WALLPAPER_ID,
    customUrl: '',
  }))

  const current = computed<Wallpaper>(() => {
    if (state.value.id === 'custom' && state.value.customUrl) {
      return {
        id: 'custom',
        name: '自定义图片',
        kind: 'image',
        background: `url("${state.value.customUrl}") center / cover no-repeat fixed`,
      }
    }
    return WALLPAPERS.find(item => item.id === state.value.id) ?? WALLPAPERS[0]!
  })

  const style = computed(() => ({
    background: current.value.background,
    backgroundColor: GRAY_FALLBACK,
  }))

  function persist() {
    if (import.meta.server) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
    }
    catch {
      // 忽略隐私模式下的写入失败
    }
  }

  function setWallpaper(id: string) {
    state.value.id = id
    persist()
  }

  function setCustomUrl(url: string) {
    const trimmed = url.trim()
    state.value.customUrl = trimmed
    state.value.id = trimmed ? 'custom' : DEFAULT_WALLPAPER_ID
    persist()
  }

  function reset() {
    state.value = { id: DEFAULT_WALLPAPER_ID, customUrl: '' }
    persist()
  }

  function hydrate() {
    if (import.meta.server) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WallpaperState>
        state.value = {
          id: parsed.id || DEFAULT_WALLPAPER_ID,
          customUrl: parsed.customUrl || '',
        }
      }
    }
    catch {
      state.value = { id: DEFAULT_WALLPAPER_ID, customUrl: '' }
    }
  }

  return { state, current, style, wallpapers: WALLPAPERS, setWallpaper, setCustomUrl, reset, hydrate }
}
