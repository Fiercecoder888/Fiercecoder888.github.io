<template>
  <!-- 默认壁纸参与 SSR（避免首屏闪白）；用户改过之后由 onMounted 的 hydrate 更新 -->
  <Transition name="wp">
    <div
      :key="current.id + ':' + current.background"
      class="pointer-events-none fixed inset-0 z-0 bg-center bg-cover"
      :style="style"
      data-wallpaper
      :data-wallpaper-id="current.id"
    />
  </Transition>
</template>

<script setup lang="ts">
const { current, style } = useWallpaper()
</script>

<style scoped>
.wp-enter-active,
.wp-leave-active {
  transition: opacity 0.6s ease;
}
.wp-enter-from,
.wp-leave-to {
  opacity: 0;
}
</style>
