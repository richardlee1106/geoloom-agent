<template>
  <!-- 抽屉：由父级控制显示（v-if 位于父级 .main-grid 内、占右面板位置）
       fab 独立于本组件，由 NarrativeMode.vue 直接渲染在 .map-stage 右下角
       不使用 Transition：点击 fab 后立即展开，避免动画前摇与界面抖动 -->
  <aside :class="['assistant-dock', { compact }]" role="dialog" aria-label="AI 助手">
      <!-- Header -->
      <header class="dock-head">
        <div class="dock-title">
          <span class="dock-icon">AI</span>
          <span class="dock-title-copy">
            <strong>AI 导览副驾</strong>
            <small>{{ assistantCapabilityLine }}</small>
          </span>
          <span class="dock-status" :class="{ active: playing }">
            {{ playing ? '解说中' : '已暂停' }}
          </span>
        </div>
        <button type="button" class="dock-close" title="关闭" @click="$emit('close')">
          <span v-html="ICON_CLOSE" />
        </button>
      </header>

      <!-- 上下文折叠面板：让用户看到 LLM 知道什么 -->
      <section class="dock-context" :class="{ collapsed: !contextOpen }">
        <button
          type="button"
          class="dock-context-head"
          @click="contextOpen = !contextOpen"
        >
          <span v-html="contextOpen ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT" />
          <span>当前上下文</span>
          <span class="dock-context-tag">
            {{ totalSteps ? activeStepIndex + 1 : 0 }} / {{ totalSteps }}
          </span>
        </button>
        <div v-show="contextOpen" class="dock-context-body">
          <ul class="dock-context-list">
            <li>
              <span class="ctx-key">当前章节</span>
              <span class="ctx-val">{{ currentChapterName }}</span>
            </li>
            <li>
              <span class="ctx-key">已讲过</span>
              <span class="ctx-val">{{ playedNames.join(' · ') || '（无）' }}</span>
            </li>
            <li>
              <span class="ctx-key">还没讲</span>
              <span class="ctx-val">{{ pendingNames.join(' · ') || '（已讲完）' }}</span>
            </li>
          </ul>
          <p class="dock-context-hint">
            AI 助手已知道你在哪一章 / 已浏览过哪些片区，可以为你解读、追问、搜索补充信息。
          </p>
        </div>
      </section>

      <!-- Chat 历史区 -->
      <section ref="chatScrollEl" class="dock-chat">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['chat-msg', `chat-msg-${msg.role}`]"
        >
          <div class="chat-bubble">
            <p class="chat-text">
              <template v-for="(part, pidx) in messageParts(msg.text)" :key="i + '-' + pidx + '-' + part.text">
                <button
                  v-if="part.regionId"
                  type="button"
                  class="entity-token"
                  @click="onEntityTokenClick(part.regionId)"
                >
                  {{ part.text }}
                </button>
                <span v-else>{{ part.text }}</span>
              </template>
            </p>
            <ul v-if="msg.citations && msg.citations.length" class="chat-citations">
              <li v-for="(citation, cidx) in msg.citations" :key="cidx">
                <a
                  v-if="citation.kind === 'web'"
                  class="citation-card"
                  :href="citation.ref"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="citation-kind">{{ citationLabel(citation.kind) }}</span>
                  <strong>{{ citationTitle(citation) }}</strong>
                  <small>{{ citationDetail(citation) }}</small>
                </a>
                <div v-else class="citation-card">
                  <span class="citation-kind">{{ citationLabel(citation.kind) }}</span>
                  <strong>{{ citationTitle(citation) }}</strong>
                  <small>{{ citationDetail(citation) }}</small>
                </div>
              </li>
            </ul>
            <ul v-if="msg.uiActions && msg.uiActions.length" class="chat-actions">
              <li v-for="(act, j) in msg.uiActions" :key="j">
                <button
                  type="button"
                  class="chat-action-btn"
                  :title="act.reason"
                  @click="onActionClick(act)"
                >
                  {{ actionLabel(act) }}
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div v-if="thinking" class="chat-msg chat-msg-assistant">
          <div class="chat-bubble thinking-bubble">
            <p class="chat-thinking-title">AI 副驾正在组织回答</p>
            <ol class="thinking-steps">
              <li
                v-for="(stage, sidx) in thinkingStages"
                :key="stage"
                :class="{ active: sidx === thinkingStageIndex, done: sidx < thinkingStageIndex }"
              >
                <span class="thinking-step-dot" />
                <span>{{ stage }}</span>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <!-- 输入区：textarea 占满 + 发送按钮内嵌右下，避免与 textarea 重叠 -->
      <footer class="dock-input">
        <div v-if="pendingReplanAction" class="replan-confirm">
          <div>
            <strong>准备重新分析当前视野</strong>
            <span>{{ pendingReplanAction.reason }}</span>
            <ul class="replan-params">
              <li v-for="item in replanPreviewItems" :key="item.label">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </li>
            </ul>
          </div>
          <div class="replan-confirm-actions">
            <button type="button" @click="confirmReplan">确认重讲</button>
            <button type="button" @click="cancelReplan">取消</button>
          </div>
        </div>
        <div v-if="suggestionGroups.length" class="dock-suggestion-groups">
          <section v-for="group in suggestionGroups" :key="group.title" class="suggestion-group">
            <span class="suggestion-group-title">{{ group.title }}</span>
            <div class="dock-suggestions">
              <button
                v-for="suggestion in group.items"
                :key="suggestion"
                type="button"
                class="suggestion-chip"
                :disabled="thinking"
                @click="useSuggestion(suggestion)"
              >
                {{ suggestion }}
              </button>
            </div>
          </section>
        </div>
        <div class="dock-input-shell">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="dock-textarea"
            :placeholder="playing ? '打断解说，向 AI 助手提问...' : '向 AI 助手提问...'"
            rows="1"
            @keydown.enter.exact.prevent="() => sendMessage()"
            @input="autoResize"
          />
          <button
            type="button"
            class="dock-send"
            :disabled="!draft.trim() || thinking"
            @click="() => sendMessage()"
          >
            <span v-html="ICON_SEND" />
          </button>
        </div>
        <div class="dock-shortcut-row">
          <button
            v-if="playing"
            type="button"
            class="shortcut-btn"
            @click="$emit('pause-request')"
          >
            打断解说
          </button>
          <button
            v-else
            type="button"
            class="shortcut-btn"
            @click="$emit('resume-request')"
          >
            继续解说
          </button>
          <span class="dock-input-hint">Enter 发送 · Shift+Enter 换行</span>
        </div>
      </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { sendNarrativeAssistantMessage } from './narrativeApi'
import type { NarrativeAssistantResponse, NarrativeAssistantUiAction, NarrativeResponse } from './types'

interface ChapterInfo {
  region_id: string
  display_name: string
  played: boolean
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  uiActions?: NarrativeAssistantUiAction[]
  citations?: NarrativeAssistantResponse['citations']
  followUpSuggestions?: string[]
}

interface MessageTextPart {
  text: string
  regionId?: string
}

const props = defineProps<{
  compact?: boolean
  activeStepIndex: number
  playing: boolean
  totalSteps: number
  chapters: ChapterInfo[]
  narrative: NarrativeResponse
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pause-request'): void
  (e: 'resume-request'): void
  (e: 'jump-to-step', index: number): void
  (e: 'fly-to-region', regionId: string): void
  (e: 'highlight-region', regionId: string): void
  (e: 'request-replan', params: Record<string, unknown>): void
}>()

// ==========================================================================
// 状态
// ==========================================================================
const contextOpen = ref<boolean>(false)
const draft = ref<string>('')
const thinking = ref<boolean>(false)
const thinkingStageIndex = ref(0)
const pendingReplanAction = ref<NarrativeAssistantUiAction | null>(null)
let requestController: AbortController | null = null
let thinkingStageTimer: number | null = null
const thinkingStages = ['读取当前章节', '检查空间证据', '整理网页来源', '生成可执行动作']
const messages = ref<ChatMessage[]>([
  {
    role: 'assistant',
    text: '你好，我是 AI 导览助手。你可以问我当前片区为什么被选中、有哪些网页来源，或者让我换一个主题重新组织路线。',
    followUpSuggestions: ['当前片区为什么被选中？', '这章有哪些网页来源？', '按本地人视角重讲']
  }
])

const chatScrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

// ==========================================================================
// 派生上下文（给用户看 + 给后端助手用）
// ==========================================================================
const currentChapterName = computed(() => {
  const c = props.chapters[props.activeStepIndex]
  return c ? c.display_name : '（未开始）'
})
const playedNames = computed(() =>
  props.chapters.filter((c) => c.played).map((c) => c.display_name)
)
const pendingNames = computed(() =>
  props.chapters
    .filter((c, i) => !c.played && i !== props.activeStepIndex)
    .map((c) => c.display_name)
)
const entityMatchers = computed(() =>
  props.chapters
    .filter((chapter) => chapter.region_id && chapter.display_name)
    .sort((a, b) => b.display_name.length - a.display_name.length)
)
const assistantCapabilityLine = computed(() => {
  const sourceCount = props.narrative.enrichment?.source_count ?? 0
  if (sourceCount > 0) return `懂路线 · 懂空间证据 · ${sourceCount} 条网页来源`
  if (props.totalSteps > 0) return '懂路线 · 懂空间证据 · 可控制播放'
  return '分析当前视野后可解读路线和片区'
})
const suggestionGroups = computed(() => {
  const lastAssistant = [...messages.value].reverse().find((msg) => msg.role === 'assistant')
  const suggestions = lastAssistant?.followUpSuggestions?.filter(Boolean) ?? []
  const currentItems = uniqueStrings([
    ...suggestions,
    `${currentChapterName.value}为什么被选中？`,
    `${currentChapterName.value}有什么业态特点？`
  ]).slice(0, 3)
  return [
    { title: '问当前片区', items: currentItems },
    { title: '证据来源', items: ['这章有哪些网页来源？', '解释哪些内容来自本地数据'] },
    { title: '换个讲法', items: ['按本地人视角重讲', '按美食路线重讲'] },
    { title: '控制播放', items: [props.playing ? '暂停解说' : '继续解说', '下一站讲哪里？'] },
  ].filter((group) => group.items.length > 0)
})
const replanPreviewItems = computed(() => {
  const action = pendingReplanAction.value
  if (!action) return []
  const theme = String(action.params.theme || '')
  const themeLabel: Record<string, string> = {
    comprehensive: '综合观察',
    commerce: '商业活力',
    nightlife: '夜生活',
    heritage: '历史人文',
    food: '美食路线',
    local: '本地生活'
  }
  return [
    { label: '讲述主题', value: theme ? themeLabel[theme] || theme : '沿用当前主题' },
    { label: '资料模式', value: '完整网页来源' },
    { label: '分析范围', value: '当前地图视野' },
    { label: '执行方式', value: '确认后重新生成路线' }
  ]
})

// ==========================================================================
// 行为
// ==========================================================================
onMounted(() => {
  // 抽屉刚渲染完自动 focus 输入框
  nextTick(() => {
    inputEl.value?.focus()
    scrollChatToBottom()
  })
})

function scrollChatToBottom() {
  const el = chatScrollEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function autoResize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function startThinkingStages() {
  thinkingStageIndex.value = 0
  if (thinkingStageTimer !== null) window.clearInterval(thinkingStageTimer)
  thinkingStageTimer = window.setInterval(() => {
    thinkingStageIndex.value = Math.min(thinkingStageIndex.value + 1, thinkingStages.length - 1)
  }, 850)
}

function stopThinkingStages() {
  if (thinkingStageTimer !== null) {
    window.clearInterval(thinkingStageTimer)
    thinkingStageTimer = null
  }
  thinkingStageIndex.value = 0
}

async function sendMessage(textOverride?: string) {
  const text = (textOverride ?? draft.value).trim()
  if (!text || thinking.value) return
  pendingReplanAction.value = null
  messages.value.push({ role: 'user', text })
  draft.value = ''
  autoResize()
  scrollChatToBottomNext()
  thinking.value = true
  startThinkingStages()
  requestController?.abort()
  requestController = new AbortController()
  try {
    const response = await sendNarrativeAssistantMessage({
      session_id: props.narrative.session_id,
      state_version: props.narrative.state_version,
      message: text,
      client_state: {
        active_chapter_index: props.activeStepIndex,
        playing: props.playing,
        visible_region_ids: props.chapters.map((chapter) => chapter.region_id)
      },
      narrative_state: props.narrative
    }, { signal: requestController.signal })
    messages.value.push({
      role: 'assistant',
      text: response.text,
      uiActions: response.ui_actions,
      citations: response.citations,
      followUpSuggestions: response.follow_up_suggestions
    })
  } catch (error) {
    if (isAbortError(error)) return
    messages.value.push({
      role: 'assistant',
      text: error instanceof Error ? `AI 助手暂时没连上：${error.message}` : 'AI 助手暂时没连上，请稍后再试。',
      followUpSuggestions: ['当前片区为什么被选中？', '这章有哪些网页来源？', '暂停解说']
    })
  } finally {
    stopThinkingStages()
    thinking.value = false
    requestController = null
    scrollChatToBottomNext()
  }
}

function scrollChatToBottomNext() {
  nextTick(scrollChatToBottom)
}

function useSuggestion(suggestion: string) {
  void sendMessage(suggestion)
}

defineExpose({
  sendMessage
})

function onEntityTokenClick(regionId: string) {
  emit('highlight-region', regionId)
}

function messageParts(text: string): MessageTextPart[] {
  if (!text || entityMatchers.value.length === 0) return [{ text }]
  const names = uniqueStrings(entityMatchers.value.map((matcher) => matcher.display_name)).filter(Boolean)
  if (names.length === 0) return [{ text }]
  const nameToRegion = new Map(entityMatchers.value.map((matcher) => [matcher.display_name, matcher.region_id]))
  const pattern = new RegExp(names.map(escapeRegExp).join('|'), 'gu')
  const parts: MessageTextPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const token = match[0]
    if (index > cursor) parts.push({ text: text.slice(cursor, index) })
    parts.push({ text: token, regionId: nameToRegion.get(token) })
    cursor = index + token.length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts.length ? parts : [{ text }]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function citationLabel(kind: NarrativeAssistantResponse['citations'][number]['kind']): string {
  if (kind === 'web') return '网页'
  if (kind === 'postgis') return '空间'
  return '解说'
}

function citationTitle(citation: NarrativeAssistantResponse['citations'][number]): string {
  if (citation.kind === 'web') return citation.snippet || sourceDomain(citation.ref)
  if (citation.kind === 'postgis') return citation.snippet || '本地空间证据'
  return citation.snippet || currentChapterName.value
}

function citationDetail(citation: NarrativeAssistantResponse['citations'][number]): string {
  if (citation.kind === 'web') return sourceDomain(citation.ref)
  if (citation.kind === 'postgis') return `PostGIS · ${citation.ref}`
  return `Narrative · ${citation.ref}`
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return url
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function actionLabel(act: NarrativeAssistantUiAction): string {
  switch (act.action) {
    case 'pause': return '暂停解说'
    case 'resume': return '继续解说'
    case 'jump_to_chapter': return `跳到第 ${(act.params.index as number) + 1} 节`
    case 'fly_to': return '飞到此处'
    case 'highlight': return '高亮片区'
    case 'request_replan': return '预览重讲'
    default: return '执行'
  }
}

function onActionClick(act: NarrativeAssistantUiAction) {
  switch (act.action) {
    case 'pause':
      emit('pause-request')
      break
    case 'resume':
      emit('resume-request')
      break
    case 'jump_to_chapter': {
      const idx = act.params.index as number
      if (typeof idx === 'number') emit('jump-to-step', idx)
      break
    }
    case 'fly_to': {
      const rid = act.params.region_id as string
      if (typeof rid === 'string') emit('fly-to-region', rid)
      break
    }
    case 'highlight': {
      const rid = act.params.region_id as string
      if (typeof rid === 'string') emit('highlight-region', rid)
      break
    }
    case 'request_replan':
      pendingReplanAction.value = act
      break
  }
}

function confirmReplan() {
  if (!pendingReplanAction.value) return
  emit('request-replan', pendingReplanAction.value.params)
  messages.value.push({
    role: 'assistant',
    text: '已确认，我会按这个建议重新分析当前视野并更新导览路线。',
    followUpSuggestions: ['重讲完成后先讲重点', '只看新路线来源']
  })
  pendingReplanAction.value = null
  scrollChatToBottomNext()
}

function cancelReplan() {
  pendingReplanAction.value = null
}

// ==========================================================================
// ESC 关闭：only when mounted
// ==========================================================================
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  requestController?.abort()
  stopThinkingStages()
  window.removeEventListener('keydown', onKeydown)
})

// ==========================================================================
// 内联 SVG 图标（保持与 NarrativeMode 风格一致）
// ==========================================================================
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`
const ICON_SEND = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor"/></svg>`
const ICON_CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
const ICON_CHEVRON_DOWN = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`
</script>

<style scoped>
/* ============================================================================
   扁平化色板（与 NarrativeMode.vue 同源；本组件挂在 narrative-shell 内可继承变量）
   独立挂载场景下，下面变量用作 fallback
   ============================================================================ */
.assistant-dock {
  --bg-base: #0a0e1a;
  --bg-panel: #131927;
  --bg-card: #1a2236;
  --bg-elevated: #232c45;
  --bd: #2a3348;
  --bd-strong: #3a455e;
  --bd-accent: #3b82f6;
  --txt: #e6eaf6;
  --txt-mute: #8a93b6;
  --txt-faint: #5a6386;
  --primary: #3b82f6;
}

/* ============================================================================
   抽屉：在父级 .main-grid 内占据右面板位置（grid-area）
   宽度 = 右面板宽度、高度 = canvas 高度（不覆盖底栏）
   ============================================================================ */
.assistant-dock {
  /* 定位：.main-grid 为 'left center right' x 'left bottom right'，
     抽屉占第 3 列 (right)，只占顶部一行（不延伸到底栏） */
  grid-column: 3 / 4;
  grid-row: 1 / 2;
  /* 建立独立 stacking context，避免 .right-panel 子元素（如自动解说 toggle）穿透 */
  position: relative;
  z-index: 10;
  isolation: isolate;
  background: var(--bg-panel);
  border: 1px solid var(--bd-strong);
  border-radius: 12px; /* 与 .map-stage 圆角一致 */
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  color: var(--txt);
  font-size: 13px;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.assistant-dock.compact {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: min(380px, calc(100% - 36px));
  height: min(520px, calc(100% - 36px));
  z-index: 40;
  border-color: rgba(96, 165, 250, 0.34);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.9)),
    radial-gradient(circle at 85% 0%, rgba(59, 130, 246, 0.22), transparent 36%);
  box-shadow: 0 24px 58px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(18px);
}

.assistant-dock.compact .dock-head {
  padding: 12px 14px;
}

.assistant-dock.compact .dock-context-head {
  padding: 9px 14px;
}

.assistant-dock.compact .dock-context-body {
  padding: 4px 14px 10px;
}

.assistant-dock.compact .dock-chat {
  padding: 12px 14px;
}

.assistant-dock.compact .dock-input {
  padding: 10px 14px 12px;
}

/* ============================================================================
   Header
   ============================================================================ */
.dock-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--bd);
}
.dock-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 600;
  min-width: 0;
}
.dock-title-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.dock-title-copy strong {
  font-size: 13.5px;
  line-height: 1.15;
}
.dock-title-copy small {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--txt-mute);
  font-weight: 500;
}
.dock-icon {
  display: inline-flex;
  width: 24px; height: 24px;
  align-items: center; justify-content: center;
  background: var(--primary); color: #fff;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
}
.dock-status {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--txt-mute);
  border: 1px solid var(--bd);
}
.dock-status.active {
  color: var(--primary);
  border-color: var(--bd-accent);
}
.dock-close {
  width: 28px; height: 28px;
  background: transparent;
  border: 1px solid var(--bd);
  color: var(--txt-mute);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.dock-close:hover {
  color: #fff;
  background: var(--bg-card);
}

/* ============================================================================
   上下文折叠面板
   ============================================================================ */
.dock-context {
  border-bottom: 1px solid var(--bd);
}
.dock-context-head {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  background: transparent;
  border: 0;
  color: var(--txt-mute);
  cursor: pointer;
  font-size: 12.5px;
  font-family: inherit;
}
.dock-context-head:hover { color: var(--txt); background: var(--bg-card); }
.dock-context-tag {
  margin-left: auto;
  padding: 1px 7px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 4px;
  color: var(--txt-mute);
  font-feature-settings: 'tnum';
  font-size: 11px;
}
.dock-context-body {
  padding: 4px 16px 12px;
}
.dock-context-list {
  list-style: none; padding: 0; margin: 0;
}
.dock-context-list li {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 1.55;
}
.ctx-key { color: var(--txt-faint); }
.ctx-val { color: var(--txt); word-break: break-all; }
.dock-context-hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--txt-mute);
  line-height: 1.55;
}

/* ============================================================================
   Chat 历史
   ============================================================================ */
.dock-chat {
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dock-chat::-webkit-scrollbar { width: 6px; }
.dock-chat::-webkit-scrollbar-thumb {
  background: var(--bd);
  border-radius: 3px;
}

.chat-msg {
  display: flex;
}
.chat-msg-user { justify-content: flex-end; }
.chat-msg-assistant { justify-content: flex-start; }

.chat-bubble {
  max-width: 86%;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--bd);
  background: var(--bg-card);
  line-height: 1.6;
}
.chat-msg-user .chat-bubble {
  background: var(--primary);
  border-color: var(--bd-accent);
  color: #fff;
}
.chat-text {
  margin: 0;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
.entity-token {
  display: inline;
  padding: 0 3px;
  border: 0;
  border-radius: 4px;
  background: rgba(96, 165, 250, 0.16);
  color: #bfdbfe;
  font: inherit;
  cursor: pointer;
}
.entity-token:hover {
  background: rgba(96, 165, 250, 0.28);
  color: #eff6ff;
}

.chat-citations {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  gap: 4px;
}

.chat-citations li {
  font-size: 11px;
  color: var(--txt-mute);
}

.citation-card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 8px;
  align-items: center;
  padding: 7px 8px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.34);
  color: inherit;
  text-decoration: none;
}

.citation-card:hover {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(59, 130, 246, 0.12);
}

.citation-kind {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.26);
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.12);
}

.citation-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--txt);
}

.citation-card small {
  grid-column: 2 / 3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--txt-faint);
}

.chat-actions {
  list-style: none; padding: 0;
  margin: 8px 0 0;
  display: flex; flex-wrap: wrap; gap: 6px;
}
.chat-action-btn {
  padding: 4px 10px;
  background: var(--bg-elevated);
  color: var(--txt);
  border: 1px solid var(--bd-strong);
  border-radius: 4px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.chat-action-btn:hover {
  background: var(--primary);
  border-color: var(--bd-accent);
  color: #fff;
}

.thinking-bubble {
  min-width: 210px;
}
.chat-thinking-title {
  margin: 0 0 8px;
  color: #dbeafe;
  font-size: 12px;
  font-weight: 600;
}
.thinking-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}
.thinking-steps li {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--txt-faint);
  font-size: 11.5px;
}
.thinking-steps li.active {
  color: #bfdbfe;
}
.thinking-steps li.done {
  color: var(--txt-mute);
}
.thinking-step-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.7);
}
.thinking-steps li.active .thinking-step-dot {
  background: #60a5fa;
  box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.16);
}
.thinking-steps li.done .thinking-step-dot {
  background: #22c55e;
}
.chat-thinking {
  display: inline-flex; gap: 4px; align-items: center;
  margin: 4px 0;
}
.chat-thinking .dot {
  width: 6px; height: 6px;
  background: var(--txt-faint);
  border-radius: 50%;
  animation: dock-dot 1.2s infinite ease-in-out;
}
.chat-thinking .dot:nth-child(2) { animation-delay: 0.2s; }
.chat-thinking .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes dock-dot {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.9); }
  30% { opacity: 1; transform: scale(1.1); }
}

/* ============================================================================
   输入区：textarea 全宽 + 发送按钮 absolute 嵌入右下，避免重叠
   ============================================================================ */
.dock-input {
  padding: 12px 16px 14px;
  border-top: 1px solid var(--bd);
  background: var(--bg-panel);
}
.replan-confirm {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.34);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.16), rgba(15, 23, 42, 0.4));
}
.replan-confirm strong,
.replan-confirm span {
  display: block;
}
.replan-confirm strong {
  font-size: 12px;
  color: #dbeafe;
}
.replan-confirm span {
  margin-top: 2px;
  font-size: 11px;
  color: var(--txt-mute);
}
.replan-params {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: grid;
  gap: 5px;
}
.replan-params li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 7px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.32);
}
.replan-params strong {
  font-size: 11px;
  color: #dbeafe;
  font-weight: 600;
}
.replan-confirm-actions {
  display: flex;
  gap: 6px;
}
.replan-confirm-actions button {
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid rgba(96, 165, 250, 0.32);
  background: rgba(59, 130, 246, 0.18);
  color: var(--txt);
  cursor: pointer;
  font-family: inherit;
  font-size: 11.5px;
}
.replan-confirm-actions button + button {
  background: transparent;
  color: var(--txt-mute);
}
.dock-suggestion-groups {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}
.suggestion-group {
  display: grid;
  gap: 5px;
}
.suggestion-group-title {
  font-size: 10.5px;
  color: var(--txt-faint);
}
.dock-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.suggestion-chip {
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  background: rgba(59, 130, 246, 0.1);
  color: #bfdbfe;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.suggestion-chip:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(96, 165, 250, 0.5);
}
.suggestion-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dock-input-shell {
  position: relative;
}
.dock-textarea {
  width: 100%;
  display: block;
  resize: none;
  min-height: 44px;
  max-height: 140px;
  /* 右侧 padding 留出 send 按钮空间，确保不重叠 */
  padding: 10px 50px 10px 12px;
  background: var(--bg-card);
  color: var(--txt);
  border: 1px solid var(--bd);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  line-height: 1.5;
  box-sizing: border-box;
}
.dock-textarea::placeholder { color: var(--txt-faint); }
.dock-textarea:focus { border-color: var(--bd-accent); }
.dock-send {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  background: var(--primary);
  color: #fff;
  border: 1px solid var(--bd-accent);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0;
}
.dock-send:hover:not(:disabled) { background: #2563eb; }
.dock-send:disabled { opacity: 0.4; cursor: not-allowed; }

.dock-shortcut-row {
  display: flex; align-items: center; gap: 8px;
  margin-top: 8px;
}
.shortcut-btn {
  padding: 4px 10px;
  background: transparent;
  color: var(--txt-mute);
  border: 1px solid var(--bd);
  border-radius: 4px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.shortcut-btn:hover {
  color: var(--txt);
  background: var(--bg-card);
  border-color: var(--bd-accent);
}
.dock-input-hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--txt-faint);
}

</style>
