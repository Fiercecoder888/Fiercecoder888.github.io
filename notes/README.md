# notes —— 待迁移笔记的投放目录

把散落的笔记（`.md` / `.markdown` / `.txt`）扔进这个目录，然后跑一条命令就能批量转成博客文章。

```bash
# 1. 先看会生成什么（不写任何文件）
node scripts/import-notes.mjs --src notes --dry-run

# 2. 确认没问题再真正导入
node scripts/import-notes.mjs --src notes --category 笔记 --tag 旧文

# 3. 用文件名里的日期作为发布时间
node scripts/import-notes.mjs --src notes --date-from filename
```

## 脚本会自动做什么

| frontmatter 字段 | 来源 |
| --- | --- |
| `title` | 原 frontmatter → 正文第一个 `# 标题` → 文件名 |
| `description` | 原 frontmatter → 正文第一段（截断 80 字） |
| `date` | 原 frontmatter → 文件名日期（`--date-from filename`）→ 文件修改时间 |
| `category` | 原 frontmatter → `--category` 参数 → 所在子目录名 → 「随笔」 |
| `tags` | 原 frontmatter + `--tag` 参数 + 子目录名 + 正文里识别到的技术词 |
| `draft` | 原 frontmatter（默认 `false`） |

- 已有 frontmatter 的文件：**保留原有字段**，只补齐缺的。
- 文件名 → URL slug：空格/下划线转 `-`，去掉非法字符，**中文保留**。
- 目标文件已存在时自动加 `-2`、`-3` 后缀，**不会静默覆盖**（要覆盖加 `--overwrite`）。
- 详细说明见 [`docs/内容迁移.md`](../docs/内容迁移.md)。

## 示例

`示例/` 目录里有三个样例文件，覆盖三种情况：

- `带frontmatter的笔记.md` —— 已有 frontmatter
- `学习笔记 网络基础.txt` —— 纯文本 + 中文空格文件名
- `2024-03-15-vue3响应式踩坑.md` —— 文件名带日期，配 `--date-from filename` 使用

导入示例产生的文章可以直接删掉（`content/blog/` 下对应文件），不影响工具本身。
