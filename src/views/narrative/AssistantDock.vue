<template>
  <!-- 抽屉：由父级控制显示（v-if 位于父级 .main-grid 内、占右面板位置）
       fab 独立于本组件，由 NarrativeMode.vue 直接渲染在 .map-stage 右下角
       不使用 Transition：点击 fab 后立即展开，避免动画前摇与界面抖动 -->
  <aside :class="['assistant-dock', { compact }]" role="dialog" aria-label="AI 助手">
      <!-- Header -->
      <header class="dock-head">
        <div class="dock-title">
          <span class="dock-icon">AI</span>
          <span>AI 助手</span>
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
            <p class="chat-text">{{ msg.text }}</p>
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
          <div class="chat-bubble">
            <p class="chat-thinking">
              <span class="dot" /><span class="dot" /><span class="dot" />
            </p>
          </div>
        </div>
      </section>

      <!-- 输入区：textarea 占满 + 发送按钮内嵌右下，避免与 textarea 重叠 -->
      <footer class="dock-input">
        <div class="dock-input-shell">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="dock-textarea"
            :placeholder="playing ? '打断解说，向 AI 助手提问...' : '向 AI 助手提问...'"
            rows="1"
            @keydown.enter.exact.prevent="sendMessage"
            @input="autoResize"
          />
          <button
            type="button"
            class="dock-send"
            :disabled="!draft.trim() || thinking"
            @click="sendMessage"
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

interface ChapterInfo {
  region_id: string
  display_name: string
  played: boolean
}

interface UIAction {
  action: 'pause' | 'resume' | 'jump_to_chapter' | 'fly_to'
  params: Record<string, unknown>
  reason: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  uiActions?: UIAction[]
}

const props = defineProps<{
  compact?: boolean
  activeStepIndex: number
  playing: boolean
  totalSteps: number
  chapters: ChapterInfo[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pause-request'): void
  (e: 'resume-request'): void
  (e: 'jump-to-step', index: number): void
  (e: 'fly-to-region', regionId: string): void
}>()

// ==========================================================================
// 状态
// ==========================================================================
const contextOpen = ref<boolean>(false)
const draft = ref<string>('')
const thinking = ref<boolean>(false)
const messages = ref<ChatMessage[]>([
  {
    role: 'assistant',
    text: '你好，我是 AI 助手。可以帮助你解答地图中的任何问题，欢迎提问哦~'
  }
])

const chatScrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

// ==========================================================================
// 派生上下文（给用户看 + 给 mock LLM 用）
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

function sendMessage() {
  const text = draft.value.trim()
  if (!text || thinking.value) return
  messages.value.push({ role: 'user', text })
  draft.value = ''
  autoResize()
  scrollChatToBottomNext()
  // mock LLM 响应：阶段 3 替换为真实 /api/narrative/assistant 调用
  thinking.value = true
  setTimeout(() => {
    thinking.value = false
    const reply = mockAssistantReply(text)
    messages.value.push(reply)
    scrollChatToBottomNext()
  }, 700 + Math.random() * 600)
}

function scrollChatToBottomNext() {
  nextTick(scrollChatToBottom)
}

// ==========================================================================
// Mock LLM：仅占位，规则触发不同回复 + ui_actions
// ==========================================================================
function mockAssistantReply(userText: string): ChatMessage {
  const t = userText.toLowerCase()
  if (t.includes('跳过') || t.includes('下一节') || t.includes('下一章')) {
    const next = Math.min(props.activeStepIndex + 1, props.totalSteps - 1)
    return {
      role: 'assistant',
      text: `好的，我帮你跳到下一节「${props.chapters[next]?.display_name ?? ''}」。`,
      uiActions: [
        {
          action: 'jump_to_chapter',
          params: { index: next },
          reason: '用户要求跳过当前章节'
        }
      ]
    }
  }
  if (t.includes('暂停') || t.includes('停一下') || t.includes('打断')) {
    return {
      role: 'assistant',
      text: '已为你暂停解说。你可以继续提问，准备好后我再继续。',
      uiActions: [
        { action: 'pause', params: {}, reason: '用户要求暂停' }
      ]
    }
  }
  if (t.includes('继续')) {
    return {
      role: 'assistant',
      text: '好，恢复解说。',
      uiActions: [
        { action: 'resume', params: {}, reason: '用户要求继续' }
      ]
    }
  }
  if (t.includes('附近') || t.includes('周边') || t.includes('其他')) {
    return {
      role: 'assistant',
      text: `当前在「${currentChapterName.value}」附近。本次 narrative 还会讲到：${pendingNames.value.join('、') || '本章是最后一节'}。如果你想了解其他主题（如美食 / 出行），可以让我帮你搜索。`
    }
  }
  if (t.includes('重点') || t.includes('讲什么')) {
    return {
      role: 'assistant',
      text: `当前章节「${currentChapterName.value}」的重点会围绕这个片区的代表性主体展开，结合周边相关点位串讲。你可以让我深入解读其中某一类（建筑 / 历史 / 周边业态）。`
    }
  }
  return {
    role: 'assistant',
    text: `（mock 阶段）已收到你的提问："${userText}"。阶段 3 会接入真正的 LLM，从 narrative state、解说记忆、搜索、PostGIS 中检索后再回答。`
  }
}

// ==========================================================================
// UI Action 执行（前端决定是否真正应用）
// ==========================================================================
function actionLabel(act: UIAction): string {
  switch (act.action) {
    case 'pause': return '暂停解说'
    case 'resume': return '继续解说'
    case 'jump_to_chapter': return `跳到第 ${(act.params.index as number) + 1} 节`
    case 'fly_to': return '飞到此处'
    default: return '执行'
  }
}

function onActionClick(act: UIAction) {
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
  }
}

// ==========================================================================
// ESC 关闭：only when mounted
// ==========================================================================
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

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
