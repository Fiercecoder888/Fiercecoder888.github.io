<template>
  <Transition name="boot-fade">
    <div
      v-if="ui.bootStage !== 'done'"
      class="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      data-boot-screen
      :class="ui.bootStage === 'boot' ? 'bg-black' : 'bg-slate-950/55 backdrop-blur-2xl'"
    >
      <!-- 开机：苹果 logo + 滑动进度条（规格照搬 macos-web 的 BootupScreen.svelte） -->
      <template v-if="ui.bootStage === 'boot'">
        <DesktopOsIcon name="apple" class="h-[100px] w-[100px] text-white" data-boot-logo />
        <div class="mt-8 h-1 w-[150px] overflow-hidden rounded-full" style="background-color: #424242">
          <div
            data-boot-progress
            class="h-full w-full rounded-full"
            :style="{
              backgroundColor: '#f5f5f5',
              transform: `translateX(-${progress}%)`,
              transition: `transform 3000ms cubic-bezier(0.86, 0, 0.07, 1)`,
            }"
          />
        </div>
      </template>

      <!-- 登录页 -->
      <template v-else>
        <div class="grid h-24 w-24 place-items-center rounded-full border border-white/15 bg-white/10 text-4xl font-bold text-white">
          {{ SITE.avatarText }}
        </div>
        <p class="mt-5 text-lg font-semibold text-white">{{ SITE.name }}</p>
        <p class="mt-1 text-xs text-slate-500">Nuxt 4 · 桌面 OS 风格</p>

        <form class="mt-8 flex flex-col items-center gap-3" @submit.prevent="enter">
          <input
            v-model="password"
            type="password"
            placeholder="密码（留空直接回车进入）"
            data-login-input
            class="w-64 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/50"
          >
          <button
            type="submit"
            data-login-enter
            class="rounded-xl bg-blue-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-400"
          >
            进入桌面
          </button>
        </form>

        <p class="mt-6 text-[11px] text-slate-600">提示：这是演示登录页，不校验密码</p>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { SITE } from '#shared/site'
const ui = useUiStore()
const { settings } = useBlogSettings()

/** 进度条用 translateX(-N%) 滑动（macos-web 的做法），不是填充宽度 */
const progress = ref(0)
const password = ref('')

let timer: ReturnType<typeof setTimeout> | undefined

function enter() {
  ui.setBootStage('done')
  if (import.meta.client) sessionStorage.setItem('blog_boot_done', '1')
}

function skip() {
  ui.setBootStage('done')
}

onMounted(() => {
  // 设置里关掉开机动画，或本次会话已经看过 → 直接进入
  const seen = sessionStorage.getItem('blog_boot_done') === '1'
  if (!settings.value.bootScreen || seen) return skip()

  ui.setBootStage('boot')
  progress.value = 0
  // 下一帧再推到 100，触发 3s 的滑出动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { progress.value = 100 })
  })
  timer = setTimeout(() => ui.setBootStage('login'), 3200)
})

onUnmounted(() => clearTimeout(timer))
</script>

<style scoped>
.boot-fade-leave-active {
  transition: opacity 0.5s ease;
}
.boot-fade-leave-to {
  opacity: 0;
}
</style>
