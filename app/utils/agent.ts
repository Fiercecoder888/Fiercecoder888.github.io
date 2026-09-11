/**
 * Agent 徽章：把 worklog 里的 `agents` / `pitfall.agent` 这类**自由文本**值
 * 映射成稳定的显示名与配色。
 *
 * 数据约定（content.config.ts 的 worklog 集合）：
 *   - 日志级 `agents: string[]` —— 今天有哪些 Agent 参与
 *   - 每条坑 `agent?: string`  —— 这一条坑是谁踩的
 * 实际值可能是 'dsh' / 'codex' / 'claude' / '我'，也可能**整个字段没填**，
 * 或者是空串 / 纯空格。所以：
 *   - 未知值原样显示、走中性配色，不报错、也不显示「未知」之类的噪音；
 *   - 空值一律得到 ''，三处渲染都拿它做 `v-if`，不会渲染出 `undefined`。
 */

/** 已知 Agent 的显示名（键是小写） */
const AGENT_LABELS: Record<string, string> = {
  dsh: 'DSH',
  codex: 'Codex',
  claude: 'Claude Code',
}

/**
 * 每个已知 Agent 一个**固定**配色类（映射表，不用随机色）：
 * 同一个 Agent 在任何页面、任何时候都是同一个颜色。
 *
 * 深色模式：main.css 里 `.dark .mac-window .*` 是**写在 @import "tailwindcss" 之后的
 * 无 layer 规则**，层级高于 Tailwind 的 `dark:` 工具类（无 layer 胜过分层）。所以这里
 * 刻意避开它的重映射名单（bg-blue-50 / text-blue-700 / border-gray-200 …），改用
 * sky / violet / amber 这组**不在名单里**的颜色，并**显式给每个类加 dark: 变体**——
 * 只有不在名单里，这些 dark: 变体才真的生效。
 */
const AGENT_TONES: Record<string, string> = {
  dsh: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300',
  codex: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
  claude: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300',
}

/**
 * 未知 Agent 的兜底色。这里**故意**用 main.css 已经重映射过的中性色
 * （border-gray-200 / bg-gray-50 / text-gray-600 都在名单里），
 * 深色模式交给 main.css 处理，不需要也没有 dark: 变体。
 */
const FALLBACK_TONE = 'border-gray-200 bg-gray-50 text-gray-600'

/**
 * 归一化：`undefined` / `null` / 空串 / 纯空格 → `''`，其余去掉首尾空格后原样返回。
 * 三处渲染都用它做 `v-if`，所以「没填 agent」既不显示徽章、也不显示 `undefined`。
 */
export function normalizeAgent(agent?: string | null): string {
  return typeof agent === 'string' ? agent.trim() : ''
}

/** 显示名：`dsh` → `DSH`、`codex` → `Codex`、`claude` → `Claude Code`，其它原样返回；空值返回 `''` */
export function agentLabel(agent?: string | null): string {
  const raw = normalizeAgent(agent)
  if (!raw) return ''
  return AGENT_LABELS[raw.toLowerCase()] ?? raw
}

/** 稳定的徽章配色类；空值返回 `''`（调用方可以直接拿它当 `v-if` 用） */
export function agentTone(agent?: string | null): string {
  const raw = normalizeAgent(agent)
  if (!raw) return ''
  return AGENT_TONES[raw.toLowerCase()] ?? FALLBACK_TONE
}

/** 统计/筛选用的稳定键：小写，保证 'DSH' 与 'dsh' 归到一起；空值返回 `''` */
export function agentKey(agent?: string | null): string {
  return normalizeAgent(agent).toLowerCase()
}
