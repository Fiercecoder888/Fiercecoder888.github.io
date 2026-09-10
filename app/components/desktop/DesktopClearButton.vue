<template>
  <Transition name="clear-fade">
    <button
      type="button"
      class="fixed bottom-24 right-4 z-50 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-[11px] text-white/85 shadow-lg backdrop-blur-md transition hover:border-white/40 hover:bg-black/55 hover:text-white"
      :title="ui.desktopClean ? '恢复显示页面内容' : '隐藏页面内容，只留壁纸（纯净桌面）'"
      data-desktop-clean
      @click="ui.toggleDesktopClean()"
    >
      <DesktopOsIcon :name="ui.desktopClean ? 'monitor' : 'close'" class="h-3 w-3" />
      <span>{{ ui.desktopClean ? '显示内容' : '清空桌面' }}</span>
      <span v-if="!ui.desktopClean && windowCount > 0" class="rounded-full bg-white/20 px-1.5 text-[10px] leading-4">{{ windowCount }}</span>
    </button>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 清空桌面 = 把页面内容整体隐掉，只剩「壁纸 + 菜单栏 + Dock + 已打开的窗口」。
 * 再点一次（或按 Esc、或切换路由）恢复显示。
 */
const ui = useUiStore()
const store = useWindowsStore()

const windowCount = computed(() => Object.values(store.windows).filter(win => win.isOpen).length)
</script>

<style scoped>
.clear-fade-enter-active,
.clear-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.clear-fade-enter-from,
.clear-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
