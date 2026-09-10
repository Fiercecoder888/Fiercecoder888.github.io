<template>
  <NuxtLink
    :to="post.path"
    class="group block rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
  >
    <div class="flex items-center gap-2 text-xs text-gray-500">
      <time :datetime="post.date">{{ formatDate(post.date) }}</time>
      <span v-if="post.category" class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600">{{ post.category }}</span>
    </div>
    <h3 class="mt-2 line-clamp-1 text-base font-semibold text-gray-800 transition group-hover:text-gray-900">
      {{ post.title }}
    </h3>
    <p v-if="post.description" class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">
      {{ post.description }}
    </p>
    <div v-if="post.tags?.length" class="mt-3 flex flex-wrap gap-1.5">
      <span
        v-for="tag in post.tags"
        :key="tag"
        class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-500"
      >
        #{{ tag }}
      </span>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
defineProps<{
  post: {
    path: string
    title: string
    description?: string
    date: string
    category?: string
    tags?: string[]
  }
}>()
</script>
