<template>
  <div class="p-5">
    <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">外观</p>

    <div class="mt-3 rounded-2xl border border-white/8 bg-white/[.03] p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-slate-200">外观模式</p>
          <p class="mt-0.5 text-[11px] text-slate-500">浅色 / 深色 / 跟随系统</p>
        </div>
        <div class="flex gap-1 rounded-xl border border-white/10 p-1">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            class="rounded-lg px-3 py-1 text-xs transition"
            :class="settings.theme === option.value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-white/5'"
            :data-theme-option="option.value"
            @click="setTheme(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="mt-3 rounded-2xl border border-white/8 bg-white/[.03] p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-slate-200">字体大小</p>
          <p class="mt-0.5 text-[11px] text-slate-500">影响全站正文（根字号）</p>
        </div>
        <div class="flex gap-1 rounded-xl border border-white/10 p-1">
          <button
            v-for="option in fontOptions"
            :key="option.value"
            type="button"
            class="rounded-lg px-3 py-1 text-xs transition"
            :class="settings.fontSize === option.value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-white/5'"
            @click="setFontSize(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </div>

    <p class="mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Dock</p>

    <div class="mt-3 space-y-2">
      <button
        v-for="item in toggles"
        :key="item.key"
        type="button"
        class="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[.03] px-4 py-3 text-left transition hover:border-white/15"
        @click="toggle(item.key)"
      >
        <span>
          <span class="block text-sm text-slate-200">{{ item.label }}</span>
          <span class="mt-0.5 block text-[11px] text-slate-500">{{ item.hint }}</span>
        </span>
        <span
          class="relative h-5 w-9 shrink-0 rounded-full transition"
          :class="settings[item.key] ? 'bg-blue-500' : 'bg-white/15'"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
            :class="settings[item.key] ? 'left-4.5' : 'left-0.5'"
          />
        </span>
      </button>
    </div>

    <div class="mt-5 flex items-center justify-between">
      <button type="button" class="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5" @click="reset">
        恢复默认
      </button>
      <button type="button" class="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5" @click="store.closeAll()">
        关闭所有窗口
      </button>
    </div>

    <p class="mt-4 text-[11px] text-slate-500">
      设置保存在浏览器 <code class="text-slate-400">localStorage</code>，key 前缀 <code class="text-slate-400">blog_</code>。
    </p>
  </div>
</template>

<script setup lang="ts">
import type { FontSize, ThemeMode } from '~/composables/useBlogSettings'

const store = useWindowsStore()
const { settings, setFontSize, setTheme, toggle, reset } = useBlogSettings()

const themeOptions: { value: ThemeMode, label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'auto', label: '跟随系统' },
]

const fontOptions: { value: FontSize; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
]

const toggles: { key: 'dockAutoHide' | 'animations' | 'desktopIcons' | 'bootScreen' | 'menuBarClock' | 'oneScreen' | 'fireworks'; label: string; hint: string }[] = [
  { key: 'dockAutoHide', label: 'Dock 自动隐藏', hint: '鼠标移到底部才显示' },
  { key: 'animations', label: '界面动效', hint: '关闭后 Dock 放大、烟花等全部停用' },
  { key: 'desktopIcons', label: '首页快捷启动', hint: '在首页显示可点击的应用图标' },
  { key: 'bootScreen', label: '开机 / 登录动画', hint: '每次会话首次进入时播放' },
  { key: 'menuBarClock', label: '顶栏时钟', hint: '在菜单栏右侧显示时间' },
  { key: 'oneScreen', label: '一屏模式', hint: '页面不整体滚动，内容区内部滚动' },
  { key: 'fireworks', label: '烟花特效', hint: '点击页面任意位置放一朵烟花' },
]
</script>
