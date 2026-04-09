<template>
  <article class="agent-card" :class="[`tone-${snapshot.summary.tone}`, { 'has-error': message?.error === true }]">
    <header class="agent-card-header">
      <div class="agent-card-title">
        <span class="agent-name">GeoLoom Agent</span>
        <span class="agent-state" :class="`is-${snapshot.summary.tone}`">{{ snapshot.summary.label }}</span>
      </div>
      <span class="agent-time">{{ formattedTime }}</span>
    </header>

    <section class="agent-process">
      <button type="button" class="agent-process-toggle" @click="isProcessExpanded = !isProcessExpanded">
        <span class="process-leading">
          <span class="process-dot" :class="`is-${snapshot.summary.tone}`"></span>
          <span class="process-copy">
            <strong>推理与工具记录</strong>
            <small>{{ processSummaryDetail }}</small>
          </span>
        </span>
        <span class="process-actions">
          <span v-if="snapshot.summary.eventCount > 0" class="process-count">{{ snapshot.summary.eventCount }}</span>
          <svg
            class="process-chevron"
            :class="{ expanded: isProcessExpanded }"
            viewBox="0 0 24 24"
            width="16"
            height="16"
          >
            <path d="M7 10l5 5 5-5z" fill="currentColor" />
          </svg>
        </span>
      </button>

      <div v-if="isProcessExpanded" class="agent-process-panel">
        <div v-if="processPreview" class="reasoning-preview">
          <span class="reasoning-label">{{ processPreviewLabel }}</span>
          <p>{{ processPreview }}</p>
        </div>

        <ol v-if="snapshot.timeline.length > 0" class="agent-process-list">
          <li
            v-for="item in snapshot.timeline"
            :key="item.id"
            class="agent-process-item"
            :class="[`kind-${item.kind}`, `state-${item.state}`]"
          >
            <span class="timeline-rail"></span>
            <div class="timeline-body">
              <div class="timeline-head">
                <div class="timeline-title-row">
                  <strong>{{ item.title }}</strong>
                  <span v-if="item.kind === 'tool'" class="timeline-badge">工具</span>
                </div>
                <span class="timeline-time">{{ item.timeLabel }}</span>
              </div>
              <p v-if="item.detail" class="timeline-detail">{{ item.detail }}</p>
            </div>
          </li>
        </ol>

        <div v-else class="agent-process-empty">
          这一轮还没有更多过程节点，收到事件后会自动记在这里。
        </div>
      </div>
    </section>

    <div
      v-if="hasAnswer"
      class="agent-answer"
      v-html="messageHtml"
    ></div>
    <div v-else class="agent-answer pending-answer">
      回答生成中，过程记录会实时补全。
    </div>

    <EmbeddedTagCloud
      v-if="showTagCloud"
      :pois="message?.pois || []"
      :intent-mode="embeddedIntentMode"
      :intent-meta="message?.intentMeta || null"
      :width="360"
      :height="200"
      @render-to-map="(pois) => emit('render-to-map', pois)"
      @tag-click="(tag) => emit('tag-click', tag)"
    />
  </article>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

import EmbeddedTagCloud from './EmbeddedTagCloud.vue'
import { buildAgentRunSnapshot } from '../utils/agentRunTimeline'

const props = defineProps({
  message: {
    type: Object,
    default: () => ({}),
  },
  messageHtml: {
    type: String,
    default: '',
  },
  formattedTime: {
    type: String,
    default: '',
  },
  embeddedIntentMode: {
    type: String,
    default: 'macro',
  },
  showTagCloud: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['render-to-map', 'tag-click'])

const isProcessExpanded = ref(false)
const snapshot = computed(() => buildAgentRunSnapshot(props.message))

watch(
  () => props.message?.isProcessExpanded,
  (nextValue) => {
    if (typeof nextValue === 'boolean') {
      isProcessExpanded.value = nextValue
    }
  },
  { immediate: true }
)

watch(isProcessExpanded, (nextValue) => {
  if (props.message && typeof props.message === 'object') {
    props.message.isProcessExpanded = nextValue
  }
})

watch(
  () => [
    snapshot.value.timeline.length,
    props.message?.reasoningContent,
    props.message?.isStreaming,
    props.message?.pipelineCompleted,
  ],
  ([eventCount, reasoningContent, isStreaming, pipelineCompleted]) => {
    if (!props.message || typeof props.message !== 'object') return
    if (props.message.processAutofocusDone === true) return

    const hasLiveProcess = Number(eventCount) > 0 && (
      Boolean(String(reasoningContent || '').trim())
      || isStreaming === true
      || pipelineCompleted !== true
    )

    if (!hasLiveProcess) return

    isProcessExpanded.value = true
    props.message.processAutofocusDone = true
  },
  { immediate: true }
)

const hasAnswer = computed(() => Boolean(String(props.messageHtml || '').trim()))
const reasoningPreview = computed(() => {
  const content = String(props.message?.reasoningContent || '').trim()
  if (!content) return ''
  return content.length > 240 ? `${content.slice(0, 240)}...` : content
})
const thinkingPreview = computed(() => {
  const content = String(props.message?.thinkingMessage || '').trim()
  if (!content) return ''
  return content.length > 140 ? `${content.slice(0, 140)}...` : content
})
const processPreview = computed(() => reasoningPreview.value || thinkingPreview.value)
const processPreviewLabel = computed(() => reasoningPreview.value ? '推理摘录' : '阶段摘要')
const processSummaryDetail = computed(() => {
  const content = processPreview.value || snapshot.value.summary.detail
  return content.length > 92 ? `${content.slice(0, 92)}...` : content
})
</script>

<style scoped>
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(20, 24, 32, 0.96), rgba(12, 15, 22, 0.98));
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.agent-card.tone-running {
  border-color: rgba(93, 173, 255, 0.24);
}

.agent-card.tone-success {
  border-color: rgba(73, 201, 176, 0.2);
}

.agent-card.tone-warning,
.agent-card.has-error {
  border-color: rgba(255, 174, 89, 0.28);
}

.agent-card-header,
.agent-card-title,
.process-leading,
.process-actions,
.timeline-head,
.timeline-title-row {
  display: flex;
  align-items: center;
}

.agent-card-header,
.timeline-head {
  justify-content: space-between;
}

.agent-card-title {
  gap: 10px;
}

.agent-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(244, 247, 255, 0.96);
}

.agent-state,
.timeline-badge,
.process-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.agent-state {
  min-height: 24px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(227, 232, 243, 0.86);
}

.agent-state.is-running {
  background: rgba(79, 151, 255, 0.16);
  color: #8dc7ff;
}

.agent-state.is-success {
  background: rgba(73, 201, 176, 0.14);
  color: #70e5cc;
}

.agent-state.is-warning,
.agent-state.is-error {
  background: rgba(255, 174, 89, 0.14);
  color: #ffc882;
}

.agent-time {
  font-size: 12px;
  color: rgba(182, 189, 203, 0.74);
}

.agent-answer {
  padding: 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(239, 243, 252, 0.94);
  line-height: 1.75;
  font-size: 14px;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.agent-answer :deep(p:first-child) {
  margin-top: 0;
}

.agent-answer :deep(p:last-child) {
  margin-bottom: 0;
}

.pending-answer {
  color: rgba(189, 198, 215, 0.82);
}

.agent-process {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-process-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  padding: 11px 13px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.025);
  color: inherit;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.agent-process-toggle:hover {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  transform: translateY(-1px);
}

.process-leading {
  gap: 12px;
  min-width: 0;
}

.process-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.process-copy strong {
  font-size: 13px;
  color: rgba(245, 247, 251, 0.96);
}

.process-copy small {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(189, 198, 215, 0.78);
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.process-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: rgba(156, 166, 186, 0.6);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.process-dot.is-running {
  background: #72b6ff;
  box-shadow: 0 0 0 5px rgba(79, 151, 255, 0.12);
}

.process-dot.is-success {
  background: #57d9bc;
  box-shadow: 0 0 0 5px rgba(73, 201, 176, 0.12);
}

.process-dot.is-warning,
.process-dot.is-error {
  background: #ffb55a;
  box-shadow: 0 0 0 5px rgba(255, 174, 89, 0.12);
}

.process-actions {
  gap: 10px;
  flex-shrink: 0;
}

.process-count {
  min-width: 24px;
  min-height: 24px;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(232, 236, 245, 0.86);
}

.process-chevron {
  color: rgba(201, 208, 221, 0.78);
  transition: transform 0.18s ease;
}

.process-chevron.expanded {
  transform: rotate(180deg);
}

.agent-process-panel {
  padding: 12px 12px 8px;
  border-radius: 14px;
  background: rgba(8, 10, 15, 0.46);
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow-x: hidden;
}

.reasoning-preview {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.reasoning-label {
  display: inline-block;
  margin-bottom: 8px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(143, 155, 176, 0.82);
}

.reasoning-preview p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(218, 224, 236, 0.86);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
}

.agent-process-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.agent-process-item {
  position: relative;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 12px;
  padding: 0 0 14px;
}

.agent-process-item:last-child {
  padding-bottom: 0;
}

.timeline-rail {
  position: relative;
  display: block;
  width: 10px;
  height: 10px;
  margin-top: 7px;
  border-radius: 999px;
  background: rgba(152, 164, 184, 0.6);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.035);
}

.agent-process-item:not(:last-child) .timeline-rail::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 4px;
  width: 1px;
  height: calc(100% + 14px);
  background: rgba(255, 255, 255, 0.08);
}

.agent-process-item.state-running .timeline-rail {
  background: #72b6ff;
}

.agent-process-item.state-success .timeline-rail {
  background: #57d9bc;
}

.agent-process-item.state-warning .timeline-rail,
.agent-process-item.state-error .timeline-rail {
  background: #ffb55a;
}

.timeline-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.timeline-head {
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.timeline-title-row {
  gap: 8px;
  min-width: 0;
}

.timeline-title-row strong {
  font-size: 13px;
  color: rgba(242, 246, 252, 0.94);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.timeline-badge {
  min-height: 20px;
  padding: 0 8px;
  background: rgba(79, 151, 255, 0.12);
  color: #8dc7ff;
}

.timeline-time {
  font-size: 11px;
  color: rgba(165, 176, 194, 0.7);
  flex-shrink: 0;
}

.timeline-detail {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(193, 201, 216, 0.78);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.agent-process-empty {
  padding: 8px 2px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(173, 182, 197, 0.72);
}

@media (max-width: 640px) {
  .agent-card {
    padding: 14px;
  }

  .agent-card-header,
  .timeline-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .agent-process-toggle {
    align-items: flex-start;
  }

  .process-actions {
    margin-left: 22px;
  }
}
</style>
