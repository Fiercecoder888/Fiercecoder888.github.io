import { defineContentConfig, defineCollection, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    blog: defineCollection({
      type: 'page',
      source: 'blog/**/*.md',
      schema: z.object({
        title: z.string(),
        description: z.string(),
        date: z.string(),
        category: z.string().default('随笔'),
        tags: z.array(z.string()).default([]),
        cover: z.string().optional(),
        draft: z.boolean().default(false),
      }),
    }),
  },
})
