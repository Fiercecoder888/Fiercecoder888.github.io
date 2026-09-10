/**
 * 页面级窗口标题：页面调用 useWindowTitle('文章列表')，MacWindow 读取并显示在标题栏中间。
 */
export function useWindowTitle(title: MaybeRefOrGetter<string | undefined>) {
  const state = useState<string>('window-title', () => SITE.name)
  watchEffect(() => {
    const value = toValue(title)
    if (value) state.value = value
  })
  return state
}
