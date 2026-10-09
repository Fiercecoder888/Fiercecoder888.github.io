<template>
  <div class="space-y-6">
    <header class="border-b border-gray-200 pb-5">
      <h1 class="text-3xl font-bold tracking-tight text-gray-800">Jev 聊天助手</h1>
      <p class="mt-2 text-sm leading-relaxed text-gray-500">
        把一段对话粘进来：先看<strong class="font-medium text-gray-700">对方在做什么</strong>，
        需要的话再让模型起草几条候选回复。候选只是候选 ——
        发不发、怎么改，由你自己定：这个页面上<strong class="font-medium text-gray-700">没有任何发送动作</strong>，只有复制。
      </p>
    </header>

    <!-- 静态站没接后端：照实说，不假装能用、也不用假数据顶（口径与 JevWindow.vue 一致） -->
    <p
      v-if="backendMissing"
      class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800"
      data-jev-static-notice
    >
      还没接上后端：这个站是<strong class="font-medium">静态托管</strong>的，
      而判断必须经过服务端 —— Jev 不接受浏览器直连，key 也不能进前端。
      把仓库里的 <code class="rounded bg-black/5 px-1">netlify/functions/jev-round.ts</code> 与
      <code class="rounded bg-black/5 px-1">jev-draft.ts</code> 部署到 Netlify，
      再把站点地址填进仓库变量 <code class="rounded bg-black/5 px-1">JEV_API_BASE</code> 即可。
      （想临时用就在本地跑 <code class="rounded bg-black/5 px-1">pnpm dev</code>。）
    </p>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- ── 输入 ─────────────────────────────────────────── -->
      <form
        class="space-y-4 self-start rounded-xl border border-gray-200 bg-white p-5"
        data-jev-form
        @submit.prevent="runRound"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-[11px] font-medium tracking-wide text-gray-500">场景</span>
            <select
              v-model="scene"
              class="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none transition focus:border-blue-400"
            >
              <option v-for="item in SCENES" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>

          <label class="block">
            <span class="mb-1 block text-[11px] font-medium tracking-wide text-gray-500">关系</span>
            <select
              v-model="relationship"
              class="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none transition focus:border-blue-400"
            >
              <option v-for="item in relationships" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
        </div>

        <label class="flex items-center gap-2 text-sm text-gray-600">
          <input
            v-model="dispute"
            type="checkbox"
            class="h-4 w-4 rounded border-gray-300 accent-blue-600"
          >
          在争执中
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] font-medium tracking-wide text-gray-500">对话</span>
          <textarea
            v-model="chat"
            rows="8"
            spellcheck="false"
            class="w-full resize-y rounded-md border border-gray-200 bg-white p-2 text-xs leading-relaxed text-gray-700 outline-none transition focus:border-blue-400"
            placeholder="对方：你到底什么时候能给我？&#10;我：这周排满了&#10;对方：上周你也是这么说的"
          />
          <span class="mt-1 block text-[10px] leading-relaxed text-gray-400">
            每行一条：「我：…」/「对方：…」。
            <strong class="font-medium text-gray-500">没有任何前缀时，整段会被当成「对方刚说的话」</strong>
            —— 最常见的用法就是把对方那几句直接粘进来。
          </span>
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] font-medium tracking-wide text-gray-500">我的背景（可选）</span>
          <textarea
            v-model="background"
            rows="3"
            spellcheck="false"
            class="w-full resize-y rounded-md border border-gray-200 bg-white p-2 text-xs leading-relaxed text-gray-700 outline-none transition focus:border-blue-400"
            placeholder="例如：这个客户上周已经延过一次；我周三下午有别的会"
          />
          <span class="mt-1 block text-[10px] leading-relaxed text-gray-400">
            会当成「回复必须与之一致的事实」：候选不许编这里没有的事。
          </span>
        </label>

        <label class="block">
          <span class="mb-1 block text-[11px] font-medium tracking-wide text-gray-500">这一轮想达到什么（可选）</span>
          <input
            v-model="goalNote"
            type="text"
            spellcheck="false"
            class="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 outline-none transition focus:border-blue-400"
            placeholder="例如：把时间往后推，但不承诺具体日子"
          >
        </label>

        <button
          type="submit"
          class="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="analysing || !chat.trim()"
        >
          {{ analysing ? '判断中…' : '判断' }}
        </button>
      </form>

      <!-- ── 结果 ─────────────────────────────────────────── -->
      <div class="space-y-4">
        <p
          v-if="!analysis && !roundError && !analysing"
          class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm leading-relaxed text-gray-400"
        >
          判断结果会出现在这里。<br>
          左边粘好对话，点「判断」。
        </p>

        <p v-if="analysing" class="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
          正在判断…
        </p>

        <p v-if="roundError" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700" data-jev-round-error>
          {{ roundError }}
        </p>

        <!-- 改过输入却还看着旧结果，是最容易误信的一种情况（JevWindow 同款提示） -->
        <p v-if="stale" class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800" data-jev-stale>
          输入已经改过了，下面是<strong class="font-medium">上一次</strong>的结果 —— 点「判断」重新跑。
        </p>

        <!-- 第一段：判断 -->
        <section v-if="analysis" class="space-y-4 rounded-xl border border-gray-200 bg-white p-5" data-jev-analysis>
          <header class="flex flex-wrap items-baseline gap-2">
            <h2 class="text-sm font-semibold text-gray-800">对方在做什么</h2>
            <span class="ml-auto text-[10px] text-gray-400">概率是 Jev 给的是/否原值，不是准确率</span>
          </header>

          <div v-for="group in GROUPS" :key="group.key" class="space-y-1.5">
            <h3 class="text-[11px] font-semibold tracking-wide text-gray-500">{{ group.title }}</h3>
            <ul class="space-y-1.5">
              <li
                v-for="item in analysis[group.key]"
                :key="item.id"
                class="rounded-lg border border-gray-100 bg-gray-50/70 p-2.5"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="VERDICT[item.verdict].cls">
                    {{ VERDICT[item.verdict].text }}
                  </span>
                </div>
                <p class="mt-1.5 text-xs leading-relaxed text-gray-700">{{ item.q }}</p>
                <div class="mt-1.5 flex items-center gap-2">
                  <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <span class="block h-full rounded-full" :class="VERDICT[item.verdict].bar" :style="{ width: barWidth(item.p) }" />
                  </span>
                  <span class="w-12 shrink-0 text-right font-mono text-[11px] text-gray-500">{{ pct(item.p) }}</span>
                </div>
                <p v-if="nextStepOf(item)" class="mt-1.5 rounded bg-white px-2 py-1 text-[11px] leading-relaxed text-sky-800">
                  下一步：{{ nextStepOf(item) }}
                </p>
              </li>
            </ul>
          </div>

          <!-- 概率落在不确定区间的答案：交回给用户，界面不替他拍板 -->
          <div v-if="analysis.mustChoose.length" class="rounded-xl border border-amber-300 bg-amber-50 p-3" data-jev-must-choose>
            <p class="text-xs font-medium text-amber-900">这几个答案它自己也不确定，你自己判断</p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="item in analysis.mustChoose" :key="item.id" class="text-[11px] leading-relaxed text-amber-800">
                · {{ item.q }} <span class="font-mono text-amber-700">{{ pct(item.p) }}</span>
              </li>
            </ul>
          </div>

          <div>
            <h3 class="mb-1.5 text-[11px] font-semibold tracking-wide text-gray-500">立场</h3>
            <p class="text-xs leading-relaxed text-gray-600">
              Jev 选的是<strong class="font-medium text-gray-800">{{ stanceLabel }}</strong>
              <span class="font-mono text-[11px] text-gray-500">
                （{{ analysis.stanceP === null ? '它没给这个立场的概率' : pct(analysis.stanceP) }}）
              </span>
            </p>
            <ul v-if="analysis.stanceSplit.length" class="mt-2 space-y-1.5">
              <li v-for="item in analysis.stanceSplit" :key="item.id" class="flex items-center gap-2">
                <span
                  class="w-24 shrink-0 truncate text-[11px] sm:w-36"
                  :class="item.id === analysis.stanceId ? 'font-medium text-gray-800' : 'text-gray-500'"
                  :title="item.label"
                >
                  {{ item.label }}
                </span>
                <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <span
                    class="block h-full rounded-full"
                    :class="item.id === analysis.stanceId ? 'bg-blue-500' : 'bg-gray-300'"
                    :style="{ width: barWidth(item.p) }"
                  />
                </span>
                <span class="w-12 shrink-0 text-right font-mono text-[11px] text-gray-500">{{ pct(item.p) }}</span>
                <span v-if="item.id === analysis.stanceId" class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                  它选这个
                </span>
              </li>
            </ul>
          </div>

          <div v-if="analysis.nextSteps.length">
            <h3 class="mb-1.5 text-[11px] font-semibold tracking-wide text-gray-500">下一步</h3>
            <ul class="space-y-1">
              <li v-for="step in analysis.nextSteps" :key="step" class="text-xs leading-relaxed text-gray-700">
                · {{ step }}
              </li>
            </ul>
          </div>
        </section>

        <!-- 第二段：候选回复（点了才请求） -->
        <div v-if="analysis" class="space-y-2">
          <button
            type="button"
            class="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="drafting || stale"
            :title="stale ? '输入改过了，先重新判断' : '用 Jev 选的那个立场做目标，起草 3 条候选'"
            data-jev-draft
            @click="runDraft"
          >
            {{ drafting ? '正在起草…' : '起草候选回复' }}
          </button>
          <p class="text-[10px] leading-relaxed text-gray-400">
            服务端没配起草模型的话会说明原因；判断部分照常可用。
          </p>
        </div>

        <section
          v-if="drafting || draftError || candidates.length"
          class="space-y-3 rounded-xl border border-gray-200 bg-white p-5"
          data-jev-candidates
        >
          <header class="flex flex-wrap items-baseline gap-2">
            <h2 class="text-sm font-semibold text-gray-800">候选回复</h2>
            <span class="ml-auto text-[10px] text-gray-400">这里没有发送这个动作，只有复制</span>
          </header>

          <p v-if="drafting" class="text-xs text-gray-500">正在起草，然后逐条检查、打分…</p>

          <p
            v-if="draftError"
            class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800"
            data-jev-draft-error
          >
            起草这一步没跑成：{{ draftError }}<br>
            判断部分不受影响，上面那些结果照常可用。
          </p>

          <p v-if="candidates.length" class="text-[11px] leading-relaxed text-gray-500">
            「首选」只给<strong class="font-medium text-gray-700">状态正常、判断不分裂、且比第二名高 0.2 以上</strong>的那条 ——
            不是最高分就推荐。
          </p>

          <p v-if="copyError" class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
            {{ copyError }}
          </p>

          <article
            v-for="(item, index) in candidates"
            :key="index"
            class="rounded-xl border p-3.5"
            :class="STATE[item.state].card"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="topPick === index" class="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">
                首选
              </span>
              <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="STATE[item.state].cls">
                {{ STATE[item.state].text }}
              </span>
              <span class="font-mono text-xs text-gray-600">
                {{ item.score === null ? '未评分' : `${item.score.toFixed(1)} / 5` }}
              </span>
              <span class="flex gap-1 text-[10px] text-gray-500">
                <span class="rounded bg-gray-100 px-1.5 py-0.5" title="G：目标完成度 0~5">G {{ item.g ?? '—' }}</span>
                <span class="rounded bg-gray-100 px-1.5 py-0.5" title="E：这个关系里的分寸 0~5">E {{ item.e ?? '—' }}</span>
              </span>
              <button
                type="button"
                class="ml-auto rounded-md border px-2 py-1 text-[11px] transition"
                :class="copiedIndex === index
                  ? 'border-emerald-300 text-emerald-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'"
                @click="copy(item.text, index)"
              >
                {{ copiedIndex === index ? '已复制 ✓' : '复制' }}
              </button>
            </div>

            <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{{ item.text }}</p>

            <p v-if="item.split" class="mt-2 text-[11px] leading-relaxed text-amber-700">
              这条的判断是分裂的（有检查落在 0.35~0.65 之间）：<strong class="font-medium">分数别太当真</strong>。
            </p>

            <div v-if="item.blocks.length" class="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
              <p class="text-[11px] font-medium text-rose-800">为什么被拦下（硬检查命中）</p>
              <ul class="mt-1 space-y-0.5">
                <li v-for="block in item.blocks" :key="block.id" class="text-[11px] leading-relaxed text-rose-700">
                  · {{ block.id }} <span class="font-mono">{{ pct(block.p) }}</span>
                </li>
              </ul>
            </div>

            <div v-if="item.confirms.length" class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p class="text-[11px] font-medium text-amber-800">用之前先看一眼</p>
              <ul class="mt-1 space-y-0.5">
                <li v-for="confirm in item.confirms" :key="confirm.id" class="text-[11px] leading-relaxed text-amber-700">
                  · {{ confirm.id }} <span class="font-mono">{{ pct(confirm.p) }}</span>
                </li>
              </ul>
            </div>

            <div v-if="item.missing.length" class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
              <p class="text-[11px] font-medium text-gray-700">目标里没做到的必含项</p>
              <ul class="mt-1 space-y-0.5">
                <li v-for="missing in item.missing" :key="missing" class="text-[11px] leading-relaxed text-gray-600">
                  · {{ missing }}
                </li>
              </ul>
            </div>
          </article>
        </section>

        <!-- 花销与口径：引擎自己说的话原样带出来 -->
        <div
          v-if="roundBudget || notes.length"
          class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-500"
        >
          <p v-if="roundBudget">判断 · {{ budgetLine(roundBudget) }}</p>
          <p v-if="draftBudget">起草与检查 · {{ budgetLine(draftBudget) }}</p>
          <ul v-if="notes.length" class="mt-1.5 space-y-0.5">
            <li v-for="(note, index) in notes" :key="index">· {{ note }}</li>
          </ul>
        </div>
      </div>
    </div>

    <footer class="border-t border-gray-200 pt-4 text-[11px] leading-relaxed text-gray-400">
      逻辑与场景问题集移植自开源项目
      <a
        :href="JEV_SCENES_META.url"
        target="_blank"
        rel="noopener noreferrer"
        class="text-gray-500 underline-offset-2 transition hover:text-blue-600 hover:underline"
      >{{ JEV_SCENES_META.source }}</a>
      （{{ JEV_SCENES_META.license }}，Copyright (c) 2026 Finderchangchang and the jev-chat contributors）。
      本页与原项目没有隶属关系，也不代表其作者的观点。
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * 「Jev 聊天助手」网页版 v0 的界面层。
 *
 * 一条链路，两端都在用户手里：**粘贴对话**进来（网页读不到别的 App，读屏换成粘贴），
 * 判断/起草/检查/打分在服务端跑（`server/utils/jevRound.ts`），结果**复制**出去
 * （填入改成复制）。中间那段是这个产品的价值所在；两端只是适配器。
 *
 * 三条刻意的设计（都跟着引擎走，不是审美）：
 *  1. **不替用户拍板**：概率落在不确定区间的答案（`mustChoose`）摊开给用户，他自己判断。
 *  2. **绝不自动发送**：这个页面没有、也不会有任何发送路径，只有 `navigator.clipboard`。
 *  3. **没接上后端就照实说**：静态站上 base 为空时不假装能用，也不 mock 数据。
 *
 * 后端地址的取法与 `app/components/desktop/JevWindow.vue` 完全一致（见下面两行）。
 */
import type {
  Analysis,
  Behaviour,
  Candidate,
  CandidateState,
  Judged,
  RoundBudgetReport,
  SceneId,
  StageStatus,
} from '~~/server/utils/jevRound'
import { JEV_SCENES, JEV_SCENES_META } from '~~/server/data/jevScenes'

/* ── 后端地址（照抄 JevWindow.vue） ───────────────────── */

/**
 * 本地 `pnpm dev` 走同源的 Nitro 路由，base 为空；
 * 线上静态站走 Netlify 上的函数，base 取仓库变量 JEV_API_BASE
 * （→ deploy.yml 的 NUXT_PUBLIC_JEV_API_BASE → runtimeConfig.public.jevApiBase）。
 * 那个值只是公开的 URL，key 全程在服务端。
 */
const isDev = import.meta.dev
const jevApiBase = String(useRuntimeConfig().public.jevApiBase || '').replace(/\/+$/, '')
const base = isDev ? '' : jevApiBase
/** 线上没配后端地址：页面顶部给一条诚实的提示，而不是等一个 404 */
const backendMissing = computed(() => !isDev && !base)

/* ── 接口 ─────────────────────────────────────────────── */

interface Envelope<T> { code: number, message: string, data: T | null }

/** `POST /api/jev/round` 的 data（`messages` / `turn` 是条数，不是消息本身） */
interface RoundData {
  analysis: Analysis
  messages: number
  turn: number
  budget: RoundBudgetReport
  notes: string[]
  /** 目前服务端把 stage.ok=false 翻成 HTTP 400 + message，这里留成可选，以防它改回原样透传 */
  stage?: StageStatus
}

/** `POST /api/jev/draft` 的 data */
interface DraftData {
  candidates: Candidate[]
  topPick: number | null
  stage: StageStatus
  budget: RoundBudgetReport
  notes: string[]
}

type PostResult<T> = { ok: true, data: T } | { ok: false, problem: string }

/** 两个端点都是 `{ code, message, data }` 信封：code !== 200 时只看 message。 */
async function postJev<T>(path: 'round' | 'draft', payload: Record<string, unknown>): Promise<PostResult<T>> {
  try {
    const res = await $fetch<Envelope<T>>(`${base}/api/jev/${path}`, { method: 'POST', body: payload })
    if (res.code !== 200 || !res.data) return { ok: false, problem: res.message || `调用失败（code ${res.code}）` }
    return { ok: true, data: res.data }
  }
  catch (err) {
    const e = err as { statusCode?: number, data?: { message?: string }, message?: string }
    // 线上没配 JEV_API_BASE 时这个路径在静态站上必然 404 —— 给一句能照做的提示
    if (e?.statusCode === 404) {
      return { ok: false, problem: '这个站上没有后端：静态托管没法跑判断，得先把 jev-round / jev-draft 部署好，再把地址填进 JEV_API_BASE' }
    }
    return { ok: false, problem: e?.data?.message || e?.message || '调用失败' }
  }
}

/* ── 状态 ─────────────────────────────────────────────── */

const SCENES = (Object.keys(JEV_SCENES) as SceneId[]).map(id => ({ id, label: JEV_SCENES[id].label }))

const scene = ref<SceneId>('work')
const relationship = ref('')
const dispute = ref(false)
const chat = ref('')
const background = ref('')
const goalNote = ref('')

const roundData = ref<RoundData | null>(null)
const draftData = ref<DraftData | null>(null)
const roundError = ref('')
const draftError = ref('')
const copyError = ref('')
const analysing = ref(false)
const drafting = ref(false)
const copiedIndex = ref<number | null>(null)

/** 换场景时关系必须跟着换，否则会发一个不属于该场景的关系出去（服务端会 400） */
const relationships = computed(() => JEV_SCENES[scene.value].relationships)
watch(scene, () => { relationship.value = relationships.value[0] ?? '' }, { immediate: true })

const analysis = computed(() => roundData.value?.analysis ?? null)
const candidates = computed(() => draftData.value?.candidates ?? [])
const topPick = computed(() => draftData.value?.topPick ?? null)
const roundBudget = computed(() => roundData.value?.budget ?? null)
const draftBudget = computed(() => draftData.value?.budget ?? null)
const notes = computed(() => [...(roundData.value?.notes ?? []), ...(draftData.value?.notes ?? [])])
const stanceLabel = computed(() => {
  const a = analysis.value
  if (!a) return '—'
  return a.stanceSplit.find(s => s.id === a.stanceId)?.label ?? a.stanceId ?? '没选出来'
})

/**
 * 「下面这份结果是不是上一次的」。判据是点按钮那一刻的快照（照 JevWindow 的做法）：
 * 请求发出后用户继续打字，那份结果对应的仍是发出时的那份输入，标成过期是对的。
 */
const inputSnapshot = computed(() => JSON.stringify({
  chat: chat.value,
  scene: scene.value,
  relationship: relationship.value,
  dispute: dispute.value,
  background: background.value,
  goalNote: goalNote.value,
}))
const ranSnapshot = ref<string | null>(null)
const stale = computed(() => roundData.value !== null && ranSnapshot.value !== null
  && ranSnapshot.value !== inputSnapshot.value)

/* ── 两个动作 ─────────────────────────────────────────── */

function payload(): Record<string, unknown> {
  return {
    chat: chat.value,
    scene: scene.value,
    relationship: relationship.value,
    dispute: dispute.value,
    background: background.value,
    goalNote: goalNote.value,
  }
}

async function runRound() {
  roundError.value = ''
  copyError.value = ''
  // 输入换了，上一轮候选不该再挂在下面冒充这一轮的结果
  draftData.value = null
  draftError.value = ''
  analysing.value = true
  const sent = inputSnapshot.value

  const res = await postJev<RoundData>('round', payload())
  analysing.value = false
  if (!res.ok) {
    roundError.value = res.problem
    return
  }
  roundData.value = res.data
  ranSnapshot.value = sent
  if (res.data.stage && !res.data.stage.ok) roundError.value = res.data.stage.reason ?? '判断没有完成'
}

async function runDraft() {
  draftError.value = ''
  copyError.value = ''
  drafting.value = true

  // 立场由判断阶段给出；它没选出来时交给服务端退回该场景的第一个立场
  const res = await postJev<DraftData>('draft', { ...payload(), stanceId: roundData.value?.analysis.stanceId ?? '' })
  drafting.value = false
  if (!res.ok) {
    // 这一轮没出候选，就别把上一次的候选留在报错下面装作是它的结果
    draftData.value = null
    draftError.value = res.problem
    return
  }
  draftData.value = res.data
  if (!res.data.stage.ok) draftError.value = res.data.stage.reason ?? '起草没有完成'
}

/* ── 复制：唯一的「带走」动作，没有发送 ───────────────── */

async function copy(text: string, index: number) {
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(text)
    copiedIndex.value = index
    setTimeout(() => { if (copiedIndex.value === index) copiedIndex.value = null }, 1600)
  }
  catch {
    // 剪贴板要 https 或用户授权；失败时说一句人话，别静默什么都不发生
    copyError.value = '复制失败：浏览器没允许访问剪贴板（需要 https 或手动授权）'
  }
}

/* ── 渲染小工具 ───────────────────────────────────────── */

const GROUPS = [
  { key: 'behaviours', title: '行为' },
  { key: 'tone', title: '语气' },
  { key: 'friction', title: '摩擦 / 风险' },
] as const

/** 三态各自的颜色：检测到（有信号）用蓝，不确定用琥珀，没有用灰 —— 都不带惊吓 */
const VERDICT: Record<Judged['verdict'], { text: string, cls: string, bar: string }> = {
  detected: { text: '检测到', cls: 'border-sky-200 bg-sky-50 text-sky-700', bar: 'bg-sky-400' },
  unsure: { text: '不确定', cls: 'border-amber-200 bg-amber-50 text-amber-700', bar: 'bg-amber-400' },
  absent: { text: '没有', cls: 'border-gray-200 bg-gray-50 text-gray-400', bar: 'bg-gray-300' },
}

const STATE: Record<CandidateState, { text: string, cls: string, card: string }> = {
  eligible: { text: '可用', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', card: 'border-gray-200 bg-white' },
  confirm: { text: '需你确认', cls: 'border-amber-200 bg-amber-50 text-amber-700', card: 'border-amber-200 bg-amber-50/40' },
  failed: { text: '被拦下', cls: 'border-rose-200 bg-rose-50 text-rose-700', card: 'border-rose-200 bg-rose-50/40' },
  unscored: { text: '未评分', cls: 'border-gray-200 bg-gray-50 text-gray-500', card: 'border-gray-200 bg-white' },
}

/**
 * 行为那条在运行时是带着 nextStep 的（引擎里 `judgeList` 做的是 `{ ...item, p, verdict }`），
 * 只是 `Judged` 这个类型按 `SceneQuestion` 收窄过、没把它写进来 —— 这里按行为取一次。
 */
function nextStepOf(item: Judged): string {
  return (item as Judged & Partial<Behaviour>).nextStep ?? ''
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

/** 概率条宽度：0 就是 0，非 0 至少给 2%，否则「有一点」在界面上看不见 */
function barWidth(p: number): string {
  return `${Math.max(p * 100, p > 0 ? 2 : 0)}%`
}

/** 一轮的花销。capped 时明说没跑完 —— 少给几条不是「就这样」 */
function budgetLine(budget: RoundBudgetReport): string {
  return `${budget.requests} 次请求 · ${(budget.elapsedMs / 1000).toFixed(1)} 秒`
    + (budget.capped ? ' · 到了本轮上限，后面的没跑完' : '')
}

useWindowTitle('Jev 聊天助手')

useSeoMeta({
  title: 'Jev 聊天助手',
  description: '粘贴一段对话，先看对方在做什么（Jev 判断行为、语气、摩擦与立场），再起草几条候选回复；发送永远由你自己做。',
})
</script>
