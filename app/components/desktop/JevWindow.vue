<template>
  <div class="flex h-full flex-col bg-[#0b0f17]/80 text-[13px] text-slate-300">
    <!-- 工具栏：唯一的两个动作都放这里，输入区保持干净 -->
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-md bg-blue-500/90 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="loading"
        @click="run"
      >
        <DesktopOsIcon v-if="loading" name="refresh" class="h-3 w-3 animate-spin" />
        {{ loading ? '评估中…' : '运行' }}
      </button>

      <button
        type="button"
        class="rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-400 transition hover:border-white/20 hover:text-slate-200"
        @click="loadSample"
      >
        填入示例
      </button>

      <span v-if="elapsed !== null" class="text-[11px] text-slate-500">
        {{ elapsed }} ms
      </span>

      <span v-if="model" class="ml-auto text-[11px] text-slate-500">
        {{ model }} · in {{ usage.input_tokens ?? 0 }} / out {{ usage.output_tokens ?? 0 }} tok · ≈ ${{ cost }}
      </span>
    </div>

    <!-- 错误：外部服务失败是一种结果，占一行说清楚，而不是让界面卡住 -->
    <p v-if="error" class="shrink-0 border-b border-white/5 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
      {{ error }}
    </p>

    <!-- 还没接上后端时才提示。接上之后（jevApiBase 有值）这里不出现，
         线上和本地表现一致 —— 那时 window 就是真能用的。 -->
    <p
      v-if="!isDev && !jevApiBase"
      class="shrink-0 border-b border-white/5 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-200"
      data-jev-static-notice
    >
      还没接上后端：这个站是静态托管的，而 Jev 的 key 不能进浏览器。把
      <code class="rounded bg-black/30 px-1">jev-api.ts</code> 部署到 Deno Deploy，
      再把它的地址填进仓库变量 <code class="rounded bg-black/30 px-1">JEV_API_BASE</code> 即可。
      （想临时用就在本地跑 <code class="rounded bg-black/30 px-1">pnpm dev</code>）
    </p>

    <div class="grid min-h-0 flex-1 grid-cols-1 divide-y divide-white/5 md:grid-cols-2 md:divide-x md:divide-y-0">
      <!-- ── 左：输入 ───────────────────────────────────────── -->
      <div class="min-w-0 min-h-0 space-y-3 overflow-auto p-3">
        <section>
          <label class="mb-1 block text-[11px] font-medium tracking-wide text-slate-400">
            state —— 要评估的内容
          </label>
          <textarea
            v-model="state"
            rows="4"
            spellcheck="false"
            class="w-full resize-y rounded-md border border-white/10 bg-black/30 p-2 text-xs leading-relaxed text-slate-200 outline-none transition focus:border-blue-400/50"
            placeholder="粘贴一段文字；结构化数据（对话记录、订单、日志）也可以"
          />
          <p class="mt-1 text-[10px] text-slate-500">
            {{ state.length }} 字符 · 单请求上上限 64k token（state 单独 32k）
          </p>
        </section>

        <section v-for="(q, index) in questions" :key="q.uid" class="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-[11px] text-slate-500">#{{ index + 1 }}</span>
            <input
              v-model="q.id"
              spellcheck="false"
              class="w-24 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 outline-none focus:border-blue-400/50"
              placeholder="答案键"
            >
            <select
              v-model="q.type"
              class="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-blue-400/50"
            >
              <option value="noul">noul · 是/否</option>
              <option value="choice">choice · 单选</option>
              <option value="score">score · 打分</option>
            </select>
            <button
              type="button"
              class="ml-auto grid h-5 w-5 place-items-center rounded opacity-50 transition hover:bg-white/10 hover:opacity-100"
              title="删掉这个问题"
              @click="removeQuestion(index)"
            >
              <DesktopOsIcon name="close" class="h-2.5 w-2.5" />
            </button>
          </div>

          <textarea
            v-model="q.instructions"
            rows="2"
            spellcheck="false"
            class="w-full resize-y rounded border border-white/10 bg-black/30 p-1.5 text-[11px] leading-relaxed text-slate-200 outline-none focus:border-blue-400/50"
            :placeholder="placeholderFor(q.type)"
          />

          <!-- choice：选项 + 每个选项的判据 -->
          <div v-if="q.type === 'choice'" class="mt-2 space-y-1">
            <div v-for="(opt, oi) in q.options" :key="oi" class="flex items-center gap-1">
              <input
                v-model="opt.key"
                spellcheck="false"
                class="w-20 shrink-0 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 outline-none focus:border-blue-400/50"
                placeholder="选项"
              >
              <input
                v-model="opt.desc"
                spellcheck="false"
                class="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-blue-400/50"
                placeholder="什么时候算这个选项"
              >
              <button
                type="button"
                class="grid h-4 w-4 shrink-0 place-items-center rounded opacity-40 transition hover:bg-white/10 hover:opacity-100"
                title="删掉这个选项"
                @click="q.options.splice(oi, 1)"
              >
                <DesktopOsIcon name="close" class="h-2 w-2" />
              </button>
            </div>
            <button
              type="button"
              class="text-[10px] text-slate-500 transition hover:text-slate-300"
              @click="q.options.push({ key: '', desc: '' })"
            >
              + 加选项
            </button>
          </div>

          <!-- score：有序档位，2~10 个 -->
          <div v-else-if="q.type === 'score'" class="mt-2 space-y-1">
            <div v-for="(level, li) in q.levels" :key="li" class="flex items-center gap-1">
              <span class="w-4 shrink-0 text-center font-mono text-[10px] text-slate-500">{{ li }}</span>
              <input
                v-model="q.levels[li]"
                spellcheck="false"
                class="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-blue-400/50"
                placeholder="这一档长什么样"
              >
              <button
                type="button"
                class="grid h-4 w-4 shrink-0 place-items-center rounded opacity-40 transition hover:bg-white/10 hover:opacity-100"
                title="删掉这一档"
                @click="q.levels.splice(li, 1)"
              >
                <DesktopOsIcon name="close" class="h-2 w-2" />
              </button>
            </div>
            <button
              type="button"
              class="text-[10px] text-slate-500 transition hover:text-slate-300"
              @click="q.levels.length < 10 && q.levels.push('')"
            >
              + 加档位（{{ q.levels.length }}/10）
            </button>
          </div>

          <!-- noul：可选的是/否判据 -->
          <div v-else class="mt-2 grid grid-cols-2 gap-1">
            <input
              v-model="q.criteriaTrue"
              spellcheck="false"
              class="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-blue-400/50"
              placeholder="（可选）算「是」的情形"
            >
            <input
              v-model="q.criteriaFalse"
              spellcheck="false"
              class="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-slate-300 outline-none focus:border-blue-400/50"
              placeholder="（可选）算「否」的情形"
            >
          </div>
        </section>

        <button
          type="button"
          class="w-full rounded-md border border-dashed border-white/15 py-1.5 text-[11px] text-slate-500 transition hover:border-white/25 hover:text-slate-300"
          @click="addQuestion()"
        >
          + 加一个问题
        </button>

        <p class="text-[10px] leading-relaxed text-slate-500">
          所有问题在<strong class="font-medium text-slate-400">同一次请求</strong>里并行评估 —— 官方实测 13 个问题合并调用比逐个调用便宜 12 倍。
        </p>
      </div>

      <!-- ── 右：结果 ───────────────────────────────────────── -->
      <div class="min-w-0 min-h-0 space-y-3 overflow-auto p-3">
        <p v-if="!answers" class="pt-6 text-center text-[11px] text-slate-500">
          结果会出现在这里。<br>
          按「运行」把左边这些问题发给 Jev。
        </p>

        <section v-for="(answer, key) in answers" :key="key" class="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
          <div class="mb-2 flex items-baseline gap-2">
            <span class="font-mono text-[11px] text-slate-400">{{ key }}</span>
            <span class="text-lg font-semibold text-slate-100">{{ headline(answer) }}</span>
            <span
              v-if="answer.confidence !== undefined"
              class="ml-auto rounded-full px-2 py-0.5 text-[10px]"
              :class="confidenceClass(answer.confidence)"
            >
              置信 {{ Number(answer.confidence).toFixed(2) }}
            </span>
          </div>

          <!-- choice：每个选项一条概率条 -->
          <div v-if="answer.probabilities" class="space-y-1">
            <div v-for="(p, name) in sortedProbabilities(answer, key)" :key="name" class="flex items-center gap-2">
              <span class="w-36 shrink-0 truncate text-[11px] text-slate-400" :title="legendOf(answer, name)">
                {{ barLabel(answer, name) }}
              </span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  class="block h-full rounded-full transition-all"
                  :class="answer.choice === name || isTopScoreLevel(answer, name) ? 'bg-blue-400' : 'bg-slate-500'"
                  :style="{ width: `${Math.max(p * 100, p > 0 ? 2 : 0)}%` }"
                />
              </span>
              <span class="w-10 shrink-0 text-right font-mono text-[11px] text-slate-400">{{ p.toFixed(3) }}</span>
            </div>
          </div>

          <!-- noul：一条 0~1 的量尺 -->
          <div v-else class="mt-1">
            <span class="block h-1.5 overflow-hidden rounded-full bg-white/10">
              <span class="block h-full rounded-full bg-emerald-400 transition-all" :style="{ width: `${Number(answer.noul) * 100}%` }" />
            </span>
            <div class="mt-0.5 flex justify-between text-[10px] text-slate-500"><span>否 0</span><span>是 1</span></div>
          </div>

        </section>

        <details v-if="answers" class="text-[10px] text-slate-500">
          <summary class="cursor-pointer select-none hover:text-slate-300">原始 JSON</summary>
          <pre class="mt-1 overflow-auto rounded bg-black/40 p-2 text-[10px] leading-relaxed text-slate-400">{{ raw }}</pre>
        </details>
      </div>
    </div>

    <div class="shrink-0 border-t border-white/5 px-3 py-1.5 text-[10px] text-slate-500">
      只收 input token（$0.042 / 百万，输出免费）· 所有问题合并为一次请求 · key 只在服务端，不进浏览器
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Jev 决策台 —— TypeSafe System One 模型的可视化入口。
 *
 * 三个设计取舍（都是照着 Jev 的性质来的，不是审美）：
 *   1. **永远显示概率分布，不只显示标签**。Jev 的价值在分布和 confidence 上，
 *      只渲染 `choice: "technical"` 等于把信息全扔了。
 *   2. **所有问题一次请求发出去**。Jev 把 state 读一遍并行评估所有问题，
 *      官方实测 13 个问题合并调用比逐个便宜 12.2 倍、快 10 倍，答案不变。
 *   3. **`instructions` / `criteria` 建议用英文写**（state 用中文没关系）。
 *      实测同一段中文内容，中文提问让 Score 置信度从 0.99 掉到 0.84、
 *      分数系统性上漂约 +0.10 —— 按英文调的阈值会被悄悄带偏。
 */

type QType = 'noul' | 'choice' | 'score'

interface Option { key: string, desc: string }

interface Question {
  uid: number
  id: string
  type: QType
  instructions: string
  options: Option[]
  levels: string[]
  criteriaTrue: string
  criteriaFalse: string
}

interface Answer {
  type: string
  noul?: number
  choice?: string
  score?: number
  probabilities?: Record<string, number>
  legend?: Record<string, string>
  confidence?: number
}

interface AskResponse {
  model: string
  answers: Record<string, Answer>
  usage: { input_tokens?: number, output_tokens?: number }
}

/* ── 状态 ─────────────────────────────────────────────── */

const STORAGE_KEY = 'jev_console'

/**
 * 打开的是哪个后端。两种情况，路径都写 `/api/jev/ask`，只有 base 不同：
 *
 * - **本地 `pnpm dev`**：走同源的 Nitro 路由 `server/api/jev/ask.post.ts`，base 为空。
 * - **线上静态站**：走 Deno Deploy 上的 `jev-api.ts`，base 取 `JEV_API_BASE`
 *   （仓库变量 → `deploy.yml` 的 `NUXT_PUBLIC_JEV_API_BASE` → `nuxt.config.ts` 的
 *   `runtimeConfig.public.jevApiBase`）。那个 worker 不校验路径，所以带上
 *   `/api/jev/ask` 只是为了让两种环境的代码路径长得一样。
 *
 * 这个值是**公开**的（只是个 URL，不是密钥），所以放 `public` 里被烤进产物是正确的；
 * key 全程只在服务端。`isDev` 也仍然有用：本地优先用同一个进程里的 Nitro 路由，
 * 不必为了调试去连线上 worker。
 */
const isDev = import.meta.dev
const jevApiBase = String(useRuntimeConfig().public.jevApiBase || '').replace(/\/+$/, '')
const endpoint = `${isDev ? '' : jevApiBase}/api/jev/ask`

let uidSeed = 0
function nextUid() {
  uidSeed += 1
  return uidSeed
}

function makeQuestion(type: QType = 'noul', id = ''): Question {
  return {
    uid: nextUid(),
    id: id || `q${uidSeed}`,
    type,
    instructions: '',
    options: type === 'choice' ? [{ key: '', desc: '' }, { key: '', desc: '' }] : [],
    levels: type === 'score' ? ['', '', ''] : [],
    criteriaTrue: '',
    criteriaFalse: '',
  }
}

const state = ref('')
const questions = ref<Question[]>([makeQuestion('noul', 'is_urgent')])
const answers = ref<Record<string, Answer> | null>(null)
const raw = ref('')
const model = ref('')
const usage = ref<{ input_tokens?: number, output_tokens?: number }>({})
const error = ref('')
const loading = ref(false)
const elapsed = ref<number | null>(null)

const cost = computed(() => ((usage.value.input_tokens ?? 0) / 1_000_000 * 0.042).toFixed(6))

/** 草稿持久化：窗口关闭会卸载组件，不存盘就等于每次重打一遍 */
function persist() {
  if (import.meta.server) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: state.value, questions: questions.value }))
  }
  catch { /* 隐私模式下 localStorage 会抛，不该因此打断使用 */ }
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.state) state.value = saved.state
    if (Array.isArray(saved?.questions) && saved.questions.length) {
      // uid 重新发一遍，避免和本次会话新建的问题撞号
      questions.value = saved.questions.map((q: Question) => ({ ...makeQuestion(q.type), ...q, uid: nextUid() }))
    }
  }
  catch { /* 存的内容坏了就当没有 */ }
})

watch([state, questions], persist, { deep: true })

/* ── 编辑动作 ─────────────────────────────────────────── */

function addQuestion(type: QType = 'noul') {
  questions.value.push(makeQuestion(type))
}

function removeQuestion(index: number) {
  questions.value.splice(index, 1)
}

function placeholderFor(type: QType) {
  if (type === 'choice') return 'Which team should handle this?（建议用英文写）'
  if (type === 'score') return 'How frustrated does the customer appear?'
  return 'Does this message convey urgency?'
}

function loadSample() {
  state.value = "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP."
  questions.value = [
    {
      ...makeQuestion('choice', 'department'),
      instructions: 'Which team should handle this?',
      options: [
        { key: 'billing', desc: 'Payment or subscription issues' },
        { key: 'technical', desc: 'Bugs or integration problems' },
        { key: 'sales', desc: 'Pricing or account questions' },
      ],
    },
    {
      ...makeQuestion('score', 'frustration'),
      instructions: 'How frustrated does the customer appear?',
      levels: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
    },
    {
      ...makeQuestion('noul', 'is_urgent'),
      instructions: 'The message conveys urgency or time-sensitivity',
    },
  ]
}

/* ── 请求 ─────────────────────────────────────────────── */

function buildQuestions(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const q of questions.value) {
    const id = q.id.trim() || `q${q.uid}`
    const entry: Record<string, unknown> = { type: q.type, instructions: q.instructions.trim() }

    if (q.type === 'choice') {
      const criteria: Record<string, string | null> = {}
      for (const opt of q.options) {
        const key = opt.key.trim()
        if (key) criteria[key] = opt.desc.trim() || null
      }
      entry.criteria = criteria
    }
    else if (q.type === 'score') {
      entry.criteria = q.levels.map(level => level.trim()).filter(Boolean)
    }
    else if (q.criteriaTrue.trim() || q.criteriaFalse.trim()) {
      entry.criteria = { true: q.criteriaTrue.trim() || null, false: q.criteriaFalse.trim() || null }
    }

    out[id] = entry
  }
  return out
}

async function run() {
  error.value = ''
  loading.value = true
  elapsed.value = null
  const startedAt = Date.now()

  try {
    const res = await $fetch<{ code: number, message: string, data: AskResponse }>(endpoint, {
      method: 'POST',
      body: { state: state.value, questions: buildQuestions() },
    })
    model.value = res.data.model
    usage.value = res.data.usage ?? {}
    answers.value = res.data.answers
    raw.value = JSON.stringify(res.data, null, 2)
    elapsed.value = Date.now() - startedAt
  }
  catch (err) {
    const e = err as { statusCode?: number, data?: { message?: string } }
    // 线上还没配 JEV_API_BASE 时 endpoint 是 '/api/jev/ask'，静态站上必然 404。
    // 给一句能照做的提示，而不是把框架的报错直接甩出来。
    error.value = e?.statusCode === 404
      ? '这个站上还没有后端：把 jev-api.ts 部署到 Deno Deploy，并把地址填进仓库变量 JEV_API_BASE（详见 docs/工作日志.md 旁的交接说明）'
      : (e?.data?.message || (err as Error).message || '调用失败')
  }
  finally {
    loading.value = false
  }
}

/* ── 结果渲染 ─────────────────────────────────────────── */

function headline(answer: Answer): string {
  if (answer.type === 'noul') return Number(answer.noul).toFixed(3)
  if (answer.type === 'choice') return answer.choice ?? '—'
  if (answer.type === 'score') return `${answer.score} / ${(Object.keys(answer.legend ?? {}).length - 1) || '?'}`
  return '—'
}

/** 概率从高到低 —— 排序本身就是信息，比 API 返回的键序好读 */
function sortedProbabilities(answer: Answer, _key: string): Record<string, number> {
  const entries = Object.entries(answer.probabilities ?? {})
  if (answer.type === 'score') return Object.fromEntries(entries)
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]))
}

function isTopScoreLevel(answer: Answer, name: string): boolean {
  if (answer.type !== 'score') return false
  const top = (answer.probabilities?.[name] ?? 0) === Math.max(...Object.values(answer.probabilities ?? { 0: 0 }))
  return top
}

function legendOf(answer: Answer, name: string): string {
  return answer.legend?.[name] ?? name
}

/**
 * Score 的 probabilities 键是档位序号（"0"/"1"/"2"），旁边那列直接显示档位描述 ——
 * 只显示序号会逼着人来回对照 legend，白多一跳。Choice 的键本身就是选项名。
 */
function barLabel(answer: Answer, name: string): string {
  return answer.type === 'score' ? legendOf(answer, name) : name
}

/**
 * confidence 是「该不该信这个答案」的第二根轴（官方 confidence-gated routing 模式）。
 * 0.9 以上可以自动处置，往下就该转人工 —— 所以这里用颜色把分界线画出来。
 */
function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) return 'bg-emerald-500/15 text-emerald-300'
  if (confidence >= 0.7) return 'bg-amber-500/15 text-amber-300'
  return 'bg-rose-500/15 text-rose-300'
}
</script>
