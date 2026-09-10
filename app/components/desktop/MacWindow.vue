<template>
  <!-- 阅读进度条（xiaohev 是 fixed 顶部渐变条） -->
  <div v-if="!collapsed" class="fixed inset-x-0 top-0 z-[60] h-[3px] bg-transparent">
    <div
      class="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-[width] duration-150"
      :style="{ width: `${progress}%` }"
      data-read-progress
    />
  </div>

  <div class="flex h-full w-full justify-center py-2" data-mac-window-wrap>
    <section
      class="mac-window flex flex-col overflow-hidden rounded-lg"
      :class="expanded ? 'w-full' : 'w-[98%]'"
      data-mac-window
    >
      <!-- 标题栏（macOS 风格：半透明 + 三色按钮） -->
      <div class="mac-titlebar flex h-[2.1rem] w-full shrink-0 items-center justify-between border-b border-black/5 px-4 dark:border-white/10">
        <div class="mac-traffic flex items-center gap-2.5">
          <button type="button" class="mac-btn btn-close grid place-items-center" data-mac-close title="关闭" @click="onClose">
            <DesktopOsIcon name="close" class="h-2 w-2 text-black/70" />
          </button>
          <button type="button" class="mac-btn btn-minimize grid place-items-center" data-mac-minimize title="折叠" @click="collapsed = !collapsed">
            <DesktopOsIcon name="minus" class="h-2 w-2 text-black/70" />
          </button>
          <button type="button" class="mac-btn btn-maximize grid place-items-center" data-mac-maximize title="展开 / 收起" @click="expanded = !expanded">
            <DesktopOsIcon name="square" class="h-1.5 w-1.5 text-black/70" />
          </button>
        </div>

        <span class="max-w-[60%] truncate text-xs opacity-60">{{ displayTitle }}</span>
        <span class="w-12" />
      </div>

      <!-- Safari 风格工具栏（文章详情页用） -->
      <div
        v-if="chrome === 'safari'"
        class="flex h-[2.4rem] shrink-0 items-center gap-2 border-b border-black/5 px-3 dark:border-white/10"
        data-safari-toolbar
      >
        <button type="button" class="grid h-6 w-6 place-items-center rounded opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" title="后退" data-safari-back @click="goBack">
          <DesktopOsIcon name="close" class="h-3 w-3 rotate-45" />
        </button>
        <button type="button" class="grid h-6 w-6 place-items-center rounded opacity-40 transition hover:bg-black/5 dark:hover:bg-white/10" title="前进" data-safari-forward @click="goForward">
          <DesktopOsIcon name="close" class="h-3 w-3 -rotate-135" />
        </button>

        <div class="mx-1 flex h-6 flex-1 items-center gap-1.5 rounded-md bg-black/5 px-2.5 text-[11px] opacity-80 dark:bg-white/10">
          <DesktopOsIcon name="search" class="h-3 w-3 shrink-0 opacity-60" />
          <span class="truncate" data-safari-url>{{ route.fullPath }}</span>
        </div>

        <button type="button" class="grid h-6 w-6 place-items-center rounded opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" title="重新载入" data-safari-reload @click="reload">
          <DesktopOsIcon name="refresh" class="h-3 w-3" />
        </button>
      </div>

      <!-- 内容 -->
      <div
        v-show="!collapsed"
        ref="scroller"
        class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        :style="{ height: collapsed ? '0px' : 'var(--window-body-height, auto)' }"
        @scroll="onScroll"
      >
        <div class="min-h-full">
          <div class="relative mx-auto max-w-4xl p-6 md:p-8">
            <slot />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const props = withDefaults(defineProps<{ title?: string, closeTo?: string, chrome?: 'default' | 'safari' }>(), {
  title: '',
  closeTo: '/',
  chrome: 'default',
})

const router = useRouter()
const route = useRoute()
const stateTitle = useState<string>('window-title', () => SITE.name)

function goBack() {
  router.back()
}

function goForward() {
  router.forward()
}

function reload() {
  if (import.meta.client) window.location.reload()
}

const collapsed = ref(false)
const expanded = ref(false)
const progress = ref(0)
const scroller = ref<HTMLElement | null>(null)

const displayTitle = computed(() => props.title || stateTitle.value)

function onScroll() {
  const el = scroller.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  progress.value = max > 0 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0
}

function onClose() {
  router.push(props.closeTo)
}

// 内容高度：屏幕高度 - 菜单栏 1.8rem(29px) - 窗口标题栏 34px - 留白（一屏模式下再扣掉 Dock 区）
const { settings } = useBlogSettings()

function setHeight() {
  if (import.meta.server) return
  const dockArea = settings.value.oneScreen ? 92 : 24
  const avail = window.innerHeight - 29 - dockArea - 34
  document.documentElement.style.setProperty('--window-body-height', `${Math.max(280, avail)}px`)
  onScroll()
}

onMounted(() => {
  setHeight()
  window.addEventListener('resize', setHeight)
  onUnmounted(() => window.removeEventListener('resize', setHeight))
})

watch(() => settings.value.oneScreen, () => nextTick(setHeight))

defineExpose({ scroller })
</script>
