/**
 * 壁纸库：默认全部是 CSS 渐变（不需要图片资源），
 * 另外支持把图片放进 public/wallpapers/ 或直接填自定义图片 URL。
 */
export interface Wallpaper {
  id: string
  name: string
  /** 直接用于 CSS background 的值 */
  background: string
  kind: 'gradient' | 'image'
}

export const WALLPAPERS: Wallpaper[] = [
  // —— 真实 macOS 壁纸（来自 PuruVJ/macos-web 的 src/assets/wallpapers） ——
  {
    id: 'big-sur-1',
    name: 'Big Sur',
    kind: 'image',
    background: 'url("/wallpapers/big-sur-1.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'big-sur-2',
    name: 'Big Sur 日暮',
    kind: 'image',
    background: 'url("/wallpapers/big-sur-2.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'big-sur-3',
    name: 'Big Sur 山脊',
    kind: 'image',
    background: 'url("/wallpapers/big-sur-3.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'big-sur-4',
    name: 'Big Sur 夜',
    kind: 'image',
    background: 'url("/wallpapers/big-sur-4.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'big-sur-graphic-1',
    name: 'Big Sur 图形',
    kind: 'image',
    background: 'url("/wallpapers/big-sur-graphic-1.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'monterey-1',
    name: 'Monterey',
    kind: 'image',
    background: 'url("/wallpapers/monterey-1.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'monterey-2',
    name: 'Monterey 抽象',
    kind: 'image',
    background: 'url("/wallpapers/monterey-2.jpg") center / cover no-repeat fixed',
  },
  {
    id: 'monterey-3',
    name: 'Monterey 深色',
    kind: 'image',
    background: 'url("/wallpapers/monterey-3.jpg") center / cover no-repeat fixed',
  },

  // —— 纯 CSS 渐变（不依赖图片资源） ——
  {
    id: 'graphite',
    name: '石墨渐变',
    kind: 'gradient',
    background: [
      'radial-gradient(100% 80% at 20% 10%, rgba(148, 163, 184, 0.28), transparent 60%)',
      'linear-gradient(160deg, #0b0d12 0%, #171b24 55%, #232936 100%)',
    ].join(','),
  },
  {
    id: 'aurora',
    name: '极光渐变',
    kind: 'gradient',
    background: [
      'radial-gradient(120% 95% at 12% 6%, rgba(88, 101, 242, 0.45), transparent 58%)',
      'radial-gradient(95% 80% at 88% 12%, rgba(236, 72, 153, 0.32), transparent 60%)',
      'radial-gradient(130% 95% at 50% 104%, rgba(56, 189, 248, 0.30), transparent 62%)',
      'linear-gradient(158deg, #0a0f1e 0%, #141b36 46%, #1c1533 100%)',
    ].join(','),
  },
  {
    id: 'forest',
    name: '深林渐变',
    kind: 'gradient',
    background: [
      'radial-gradient(95% 75% at 25% 20%, rgba(52, 211, 153, 0.35), transparent 60%)',
      'radial-gradient(90% 70% at 80% 60%, rgba(16, 185, 129, 0.28), transparent 62%)',
      'linear-gradient(155deg, #05130f 0%, #0c2a22 55%, #123a2e 100%)',
    ].join(','),
  },
]

export const DEFAULT_WALLPAPER_ID = 'big-sur-1'
