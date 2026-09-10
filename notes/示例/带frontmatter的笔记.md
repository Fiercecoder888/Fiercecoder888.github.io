---
title: 已有 frontmatter 的笔记示例
description: 这个文件本身就带 frontmatter，迁移脚本会保留原有字段，只补齐缺失的。
date: '2026-08-20'
category: 工具
tags:
  - 迁移
  - 示例
---

# 已有 frontmatter 的笔记示例

这份笔记在源文件里已经写好了 frontmatter，迁移脚本应该**保留** `title`、`description`、`date`、`category`、`tags`，只补充缺失字段。

## 正文照旧

正文内容不做任何改写，原样搬过去。所以笔记里怎么写，博客里就是什么样。

```ts
// 代码块也会原样保留
const migrate = (notes: string[]) => notes.map(n => n.trim())
```

> 引用块同理。

结尾再写一段，用来验证多段落是否正常。
