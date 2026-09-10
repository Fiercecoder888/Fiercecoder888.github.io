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

    // 工作日志：一天一条，当天收尾时写。
    // 「踩坑点 + 解决方案」用结构化字段存，方便列表页统计与以后做成长曲线。
    // 注意：草稿写在仓库根目录的 drafts/ 下（与 content/ 平级），写好后再**移动**进来才算发布；
    // 这里的 draft 字段只是为了与 blog 集合保持一致，content/ 里不放 draft: true 的隐藏草稿。
    worklog: defineCollection({
      type: 'page',
      source: 'worklog/**/*.md',
      schema: z.object({
        title: z.string(),
        date: z.string(),
        summary: z.string(),
        tags: z.array(z.string()).default([]),
        project: z.string().optional(),
        pitfalls: z.array(z.object({
          problem: z.string(),
          solution: z.string(),
          time: z.string().optional(),
        })).default([]),
        learned: z.array(z.string()).default([]),
        mood: z.number().min(1).max(5).optional(),
        draft: z.boolean().default(false),
      }),
    }),
  },
})
