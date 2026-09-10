<template>
  <div class="p-5">
    <div class="flex items-center justify-between">
      <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">壁纸</p>
      <button type="button" class="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/5" @click="reset">
        恢复默认
      </button>
    </div>

    <!-- 内置壁纸 -->
    <div class="mt-3 grid grid-cols-3 gap-3">
      <button
        v-for="item in wallpapers"
        :key="item.id"
        type="button"
        class="group overflow-hidden rounded-xl border transition"
        :class="state.id === item.id ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-white/10 hover:border-white/30'"
        :data-wallpaper-option="item.id"
        :title="item.name"
        @click="setWallpaper(item.id)"
      >
        <span class="block h-20 w-full" :style="{ background: item.background, backgroundColor: '#0a0f1e' }" />
        <span class="block bg-white/5 px-2 py-1 text-left text-[11px] text-slate-300">{{ item.name }}</span>
      </button>
    </div>

    <!-- 自定义图片 -->
    <p class="mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">自定义图片</p>
    <div class="mt-2 flex gap-2">
      <input
        v-model="customUrl"
        type="text"
        placeholder="https://… 或 /wallpapers/your.jpg"
        data-wallpaper-input
        class="flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/50"
        @keydown.enter.prevent="applyCustom"
      >
      <button
        type="button"
        class="rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-400"
        data-wallpaper-apply
        @click="applyCustom"
      >
        应用
      </button>
    </div>

    <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
      想用本地图片：把文件放进项目里的
      <code class="rounded bg-white/10 px-1 text-slate-300">public/wallpapers/</code>，
      然后填 <code class="rounded bg-white/10 px-1 text-slate-300">/wallpapers/文件名.jpg</code>。
    </p>

    <p class="mt-3 text-[11px] text-slate-500">
      当前：<span class="text-slate-300">{{ current.name }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
const { state, current, wallpapers, setWallpaper, setCustomUrl, reset } = useWallpaper()

const customUrl = ref(state.value.customUrl)

function applyCustom() {
  setCustomUrl(customUrl.value)
}
</script>
