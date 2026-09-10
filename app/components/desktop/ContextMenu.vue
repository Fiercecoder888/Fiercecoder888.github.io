<template>
  <div
    v-if="ui.contextMenu.visible"
    class="mac-menu fixed z-[60] min-w-52 py-1.5"
    data-context-menu
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    @contextmenu.prevent
  >
    <template v-for="(item, index) in items" :key="`${item.label}-${index}`">
      <div v-if="item.separator" class="mac-menu-sep" />
      <button
        v-else
        type="button"
        class="mac-menu-item disabled:opacity-40"
        :class="item.danger ? 'text-rose-500 dark:text-rose-400' : ''"
        :disabled="item.disabled"
        :data-context-item="item.label"
        @click="run(item)"
      >
        <DesktopOsIcon v-if="item.icon" :name="item.icon" class="h-3.5 w-3.5 shrink-0 opacity-80" />
        <span v-else class="w-3.5 shrink-0" />
        <span class="flex-1">{{ item.label }}</span>
        <span v-if="item.shortcut" class="text-[11px] text-slate-500">{{ item.shortcut }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
export interface ContextMenuItem {
  label: string
  icon?: string
  shortcut?: string
  separator?: boolean
  disabled?: boolean
  danger?: boolean
  action?: () => void | Promise<void>
}

const props = defineProps<{ items: ContextMenuItem[] }>()

const ui = useUiStore()

/** 夹取到视口内，避免菜单溢出 */
const position = computed(() => {
  if (import.meta.server) return { x: ui.contextMenu.x, y: ui.contextMenu.y }
  const width = 230
  const height = Math.min(props.items.length * 34 + 20, 400)
  return {
    x: Math.max(8, Math.min(ui.contextMenu.x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(ui.contextMenu.y, window.innerHeight - height - 8)),
  }
})

async function run(item: ContextMenuItem) {
  ui.closeContextMenu()
  await item.action?.()
}
</script>
