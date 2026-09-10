<template>
  <div class="flex h-full flex-col bg-[#0b0f17]/80 font-mono text-[13px] leading-relaxed">
    <div ref="scroller" class="min-h-0 flex-1 overflow-auto px-4 py-3" @click="focusInput">
      <div v-for="(line, i) in lines" :key="i" :class="lineClass(line.type)">
        <DesktopOsIcon v-if="line.type === 'input'" name="caret" class="mr-1 inline-block h-3 w-3 text-emerald-400" />
        <span v-if="line.type === 'input'" class="mr-1.5 text-blue-400">~</span>
        <span class="whitespace-pre-wrap break-words">{{ line.text }}</span>
      </div>

      <form class="flex items-center gap-1.5" @submit.prevent="run">
        <DesktopOsIcon name="caret" class="h-3 w-3 text-emerald-400" />
        <span class="text-blue-400">~</span>
        <input
          ref="input"
          v-model="command"
          type="text"
          spellcheck="false"
          autocomplete="off"
          class="flex-1 bg-transparent text-slate-100 caret-emerald-400 outline-none"
          placeholder="输入 help 查看可用命令"
        >
      </form>
    </div>

    <div class="shrink-0 border-t border-white/5 px-4 py-1.5 text-[11px] text-slate-500">
      help · ls · cat &lt;slug&gt; · open &lt;路径&gt; · whoami · date · clear
    </div>
  </div>
</template>

<script setup lang="ts">
interface Line {
  type: 'input' | 'output' | 'error' | 'muted'
  text: string
}

const router = useRouter()
const store = useWindowsStore()

const { data: posts } = await useAsyncData('terminal-posts', () =>
  queryCollection('blog').where('draft', '=', false).select('title', 'path', 'date', 'description', 'category', 'tags').order('date', 'DESC').all(),
)

const lines = ref<Line[]>([
  { type: 'muted', text: 'XiaoHe-Style Blog Terminal · 输入 help 查看命令' },
])
const command = ref('')
const history = ref<string[]>([])
const historyIndex = ref(-1)
const input = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)

function print(text: string, type: Line['type'] = 'output') {
  lines.value.push({ type, text })
}

function lineClass(type: Line['type']) {
  if (type === 'input') return 'text-slate-200'
  if (type === 'error') return 'text-rose-400'
  if (type === 'muted') return 'text-slate-500'
  return 'text-slate-300'
}

function focusInput() {
  input.value?.focus()
}

function slugOf(path: string) {
  return path.replace(/^\/blog\//, '')
}

function run() {
  const raw = command.value.trim()
  command.value = ''
  if (!raw) return

  lines.value.push({ type: 'input', text: raw })
  history.value.push(raw)
  historyIndex.value = -1

  const [cmd, ...args] = raw.split(/\s+/)
  const arg = args.join(' ')

  switch (cmd) {
    case 'help':
      print('可用命令：')
      print('  help              显示帮助')
      print('  ls                列出全部文章')
      print('  ls tags           列出全部标签')
      print('  cat <slug>        查看文章摘要')
      print('  open <路径>       跳转到页面，如 open /blog')
      print('  whoami            显示当前访客')
      print('  date              显示当前时间')
      print('  pwd               显示当前路径')
      print('  echo <文本>       原样输出')
      print('  clear             清屏')
      break

    case 'ls': {
      const list = posts.value ?? []
      if (args[0] === 'tags') {
        const tags = new Map<string, number>()
        for (const post of list) for (const tag of post.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1)
        if (!tags.size) { print('还没有标签', 'muted'); break }
        for (const [tag, count] of [...tags.entries()].sort((a, b) => b[1] - a[1])) {
          print(`  #${tag}  (${count})`)
        }
        break
      }
      if (!list.length) { print('还没有文章', 'muted'); break }
      for (const post of list) {
        print(`  ${post.date}  ${slugOf(post.path).padEnd(30, ' ')}  ${post.title}`)
      }
      print(`共 ${list.length} 篇`, 'muted')
      break
    }

    case 'cat': {
      if (!arg) { print('用法：cat <slug>，slug 可用 ls 查看', 'error'); break }
      const target = (posts.value ?? []).find(post => slugOf(post.path) === arg || post.title.includes(arg))
      if (!target) { print(`没有找到：${arg}`, 'error'); break }
      print(`# ${target.title}`)
      print(`  分类：${target.category ?? '未分类'}`)
      print(`  日期：${target.date}`)
      if (target.tags?.length) print(`  标签：${target.tags.map(t => `#${t}`).join(' ')}`)
      print('')
      print(`  ${target.description ?? '（无摘要）'}`)
      break
    }

    case 'open': {
      if (!arg) { print('用法：open <路径>，如 open /blog', 'error'); break }
      const path = arg.startsWith('/') ? arg : `/${arg}`
      print(`正在打开 ${path} …`, 'muted')
      store.close('terminal')
      router.push(path)
      break
    }

    case 'whoami':
      print('guest@xiaoehve-blog（一位路过的访客）')
      break

    case 'date':
      print(new Date().toLocaleString('zh-CN'))
      break

    case 'pwd':
      print('/home/guest/blog')
      break

    case 'echo':
      print(arg || '')
      break

    case 'clear':
      lines.value = []
      break

    default:
      print(`command not found: ${cmd}`, 'error')
      print('输入 help 查看可用命令', 'muted')
  }

  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!history.value.length) return
    historyIndex.value = historyIndex.value < 0 ? history.value.length - 1 : Math.max(0, historyIndex.value - 1)
    command.value = history.value[historyIndex.value] ?? ''
  }
  else if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (historyIndex.value < 0) return
    historyIndex.value += 1
    if (historyIndex.value >= history.value.length) {
      historyIndex.value = -1
      command.value = ''
    }
    else {
      command.value = history.value[historyIndex.value] ?? ''
    }
  }
}

onMounted(() => {
  input.value?.addEventListener('keydown', onKeydown)
  focusInput()
})

onUnmounted(() => {
  input.value?.removeEventListener('keydown', onKeydown)
})
</script>
