<template>
  <article class="agent-card" :class="[`tone-${snapshot.summary.tone}`, { 'has-error': message?.error === true }]">
    <header class="agent-card-header">
      <div class="agent-card-title">
        <span class="agent-name">GeoLoom Agent</span>
        <div class="agent-card-badges">
          <span class="agent-state" :class="`is-${snapshot.summary.tone}`">{{ snapshot.summary.label }}</span>
          <span v-if="webSearchBadge" class="agent-web-badge" :class="`is-${webSearchBadge.tone}`">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
            <span>{{ webSearchBadge.label }}</span>
          </span>
          <span v-if="snapshot.summary.elapsedLabel" class="agent-elapsed">{{ snapshot.summary.elapsedLabel }}</span>
        </div>
      </div>
      <span v-if="formattedTime" class="agent-time">{{ formattedTime }}</span>
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

    <section v-if="debugCards.length > 0" class="agent-debug-grid">
      <article
        v-for="card in debugCards"
        :key="card.key"
        class="agent-debug-card"
      >
        <span class="agent-debug-card-title">{{ card.title }}</span>
        <p
          v-for="(line, lineIndex) in card.lines"
          :key="`${card.key}-${lineIndex}`"
          class="agent-debug-line"
        >
          {{ line }}
        </p>
      </article>
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

function pickText(...candidates) {
  for (const candidate of candidates) {
    const text = String(candidate || '').trim()
    if (text) return text
  }
  return ''
}

function truncateText(value, maxLength = 48) {
  const text = pickText(value)
  if (!text || text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function formatIntentSource(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'embedding') return 'Embedding'
  if (normalized === 'llm') return 'LLM'
  if (normalized === 'rule' || normalized === 'fallback') return '规则'
  return pickText(value)
}

function formatQueryType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'nearby_poi') return '附近检索'
  if (normalized === 'nearest_station') return '最近地铁站'
  if (normalized === 'area_overview') return '区域解读'
  if (normalized === 'similar_regions') return '相似片区'
  if (normalized === 'compare_places') return '双地点比较'
  return pickText(value)
}

function formatWebSource(value) {
  if (value === 'tavily') return 'Tavily'
  if (value === 'multi_search') return '多引擎'
  if (value === 'poi_discovery') return 'POI发现'
  return pickText(value)
}

function formatWebSearchStrategy(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'hybrid') return 'Hybrid'
  if (normalized === 'hybrid_with_discovery') return 'Hybrid+发现'
  if (normalized === 'local_first') return '本地优先'
  return formatWebSource(value)
}

function formatWebRequirementLabel(intent = {}) {
  const normalized = String(intent.webRequirementMode || '').trim().toLowerCase()
  if (normalized === 'required') return '强依赖'
  if (normalized === 'default_on') return '默认开启'
  if (normalized === 'local_first') return '本地优先'
  if (intent.needsWebSearch === true) return '需要'
  if (intent.webEvidencePlanned === true) return '默认开启'
  return '非必需'
}

function summarizeSpatialEncoderTrace(call) {
  if (!call || typeof call !== 'object') return ''
  const action = pickText(call.action)
  const result = call.result && typeof call.result === 'object' ? call.result : {}
  const semanticEvidence = result.semantic_evidence && typeof result.semantic_evidence === 'object'
    ? result.semantic_evidence
    : {}
  const modelRoute = pickText(result.model_route, semanticEvidence.mode)
  const modelsUsed = Array.isArray(result.models_used)
    ? result.models_used.map((item) => pickText(item)).filter(Boolean).join('+')
    : ''
  const routeParts = []
  if (modelRoute) routeParts.push(`路由：${modelRoute}`)
  if (modelsUsed) routeParts.push(`模型：${modelsUsed}`)
  const routeLabel = routeParts.join(' · ')

  if (action === 'inspect_anchor_cell') {
    const context = result.context && typeof result.context === 'object' ? result.context : {}
    const cellLabel = pickText(context.cell_id, context.cellId, context.name, context.label, context.town_name, context.scene_label)
    return `锚点格网：${cellLabel || '已读取'}${routeLabel ? ` · ${routeLabel}` : ''}`
  }

  if (action === 'search_anchor_cells') {
    const cellCount = Array.isArray(result.cells) ? result.cells.length : 0
    const sceneTags = Array.isArray(result.scene_tags)
      ? result.scene_tags.map((item) => pickText(item)).filter(Boolean).slice(0, 2).join('、')
      : ''
    const buckets = Array.isArray(result.dominant_buckets)
      ? result.dominant_buckets.map((item) => pickText(item)).filter(Boolean).slice(0, 2).join('、')
      : ''
    const parts = [`邻域格网：${cellCount} 个`]
    if (sceneTags) parts.push(`场景 ${sceneTags}`)
    if (buckets) parts.push(`桶 ${buckets}`)
    if (routeLabel) parts.push(routeLabel)
    return parts.join(' · ')
  }

  if (action === 'annotate_poi_cells') {
    const results = Array.isArray(result.results) ? result.results : []
    const annotatedCount = results.filter((item) => item && typeof item === 'object' && item.cell_context).length
    const parts = [`POI格网标注：${annotatedCount || results.length} 个`]
    if (routeLabel) parts.push(routeLabel)
    return parts.join(' · ')
  }

  return ''
}

const debugCards = computed(() => {
  const msg = props.message
  if (!msg || typeof msg !== 'object') return []

  const cards = []
  const intent = msg.intentPreview && typeof msg.intentPreview === 'object' ? msg.intentPreview : null
  if (intent) {
    const lines = []
    const queryTypeLabel = formatQueryType(intent.queryType)
    if (queryTypeLabel) {
      lines.push(`类型：${queryTypeLabel}`)
    }
    const sourceLabel = formatIntentSource(intent.intentSource || intent.parserProvider)
    const sourceConfidence = Number(intent.sourceConfidence ?? intent.confidence)
    const sourceLatencyMs = Number(intent.sourceLatencyMs)
    if (sourceLabel) {
      const sourceParts = [`来源：${sourceLabel}`]
      if (Number.isFinite(sourceConfidence) && sourceConfidence > 0) {
        sourceParts.push(`${Math.round((sourceConfidence <= 1 ? sourceConfidence : sourceConfidence / 100) * 100)}%`)
      }
      if (Number.isFinite(sourceLatencyMs) && sourceLatencyMs > 0) {
        sourceParts.push(`${Math.round(sourceLatencyMs)}ms`)
      }
      lines.push(sourceParts.join(' · '))
    }
    const anchorLabel = pickText(intent.displayAnchor, intent.placeName)
    if (anchorLabel) {
      lines.push(`锚点：${anchorLabel}`)
    }
    const categoryLabel = intent.categoryResolved === true && pickText(intent.categoryMain)
      ? `${intent.categoryMain}${intent.categorySub && intent.categorySub !== intent.categoryMain ? `·${intent.categorySub}` : ''}`
      : pickText(intent.targetCategory)
    if (categoryLabel) {
      lines.push(`类别：${categoryLabel}`)
    }
    const webRequirementLabel = formatWebRequirementLabel(intent)
    const webStrategyLabel = formatWebSearchStrategy(intent.webSearchStrategy)
    lines.push(`联网：${webRequirementLabel}${webStrategyLabel ? ` · ${webStrategyLabel}` : ''}`)
    cards.push({ key: 'intent', title: 'NL 理解', lines: lines.slice(0, 5) })
  }

  const webResultCount = Number(msg.webSearchResultCount) || 0
  const webPagesRead = Number(msg.webSearchPagesRead) || 0
  const webSources = Array.isArray(msg.webSearchSources) ? msg.webSearchSources : []
  const webResults = Array.isArray(msg.webSearchResults) ? msg.webSearchResults : []
  const webAnswerPreview = pickText(msg.webSearchAnswerPreview)
  if (webResultCount > 0 || webPagesRead > 0 || webResults.length > 0 || webAnswerPreview || webSources.length > 0) {
    const lines = []
    const sourceLabel = webSources.map(formatWebSource).filter(Boolean).join(' + ')
    lines.push(`命中：${webResultCount || webPagesRead || 0} 条${sourceLabel ? ` · ${sourceLabel}` : ''}`)
    webResults.slice(0, 3).forEach((item) => {
      const title = truncateText(item && typeof item === 'object' ? item.title : '', 34)
      if (title) {
        lines.push(`结果：${title}`)
      }
    })
    if (webAnswerPreview) {
      lines.push(`摘要：${truncateText(webAnswerPreview, 40)}`)
    }
    cards.push({ key: 'web', title: '联网搜索', lines: lines.slice(0, 5) })
  }

  const alignment = msg.entityAlignment && typeof msg.entityAlignment === 'object' ? msg.entityAlignment : null
  if (alignment) {
    const lines = []
    const dualVerified = Number(alignment.dual_verified) || 0
    const localOnly = Number(alignment.local_only) || 0
    const webOnly = Number(alignment.web_only) || 0
    lines.push(`双重验证：${dualVerified} · 仅本地：${localOnly} · 仅联网：${webOnly}`)
    const sampleMatches = Array.isArray(alignment.sample_matches) ? alignment.sample_matches : []
    sampleMatches.slice(0, 3).forEach((item) => {
      if (!item || typeof item !== 'object') return
      const label = truncateText(pickText(item.name, item.local_name, item.web_title), 32)
      if (!label) return
      const verification = pickText(item.verification)
      lines.push(`样本：${label}${verification ? ` · ${verification}` : ''}`)
    })
    cards.push({ key: 'alignment', title: '实体对齐', lines: lines.slice(0, 4) })
  }

  const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : []
  const spatialByAction = new Map()
  toolCalls.forEach((call) => {
    if (!call || typeof call !== 'object') return
    if (pickText(call.skill) !== 'spatial_encoder') return
    const action = pickText(call.action)
    if (!action) return
    spatialByAction.set(action, call)
  })
  const spatialLines = [
    summarizeSpatialEncoderTrace(spatialByAction.get('inspect_anchor_cell')),
    summarizeSpatialEncoderTrace(spatialByAction.get('search_anchor_cells')),
    summarizeSpatialEncoderTrace(spatialByAction.get('annotate_poi_cells')),
  ].filter(Boolean)
  if (spatialLines.length > 0) {
    cards.push({ key: 'spatial_encoder', title: '空间编码器', lines: spatialLines.slice(0, 4) })
  }

  return cards
})

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
const webSearchBadge = computed(() => {
  const msg = props.message
  if (!msg) return null
  const resultCount = Number(msg.webSearchResultCount) || 0
  const pagesRead = Number(msg.webSearchPagesRead) || 0
  const sources = Array.isArray(msg.webSearchSources) ? msg.webSearchSources : []
  const isSearching = msg.isStreaming && msg.thinkingMessage && /搜索|联网|网页/.test(String(msg.thinkingMessage || ''))

  if (resultCount > 0 || pagesRead > 0) {
    const sourceLabels = sources.map(s => {
      if (s === 'tavily') return 'Tavily'
      if (s === 'multi_search') return '多引擎'
      if (s === 'poi_discovery') return 'POI发现'
      return s
    }).join('+')
    return {
      tone: 'success',
      label: `${sourceLabels || '联网'} · ${resultCount > 0 ? `${resultCount}条` : `${pagesRead}页`}`,
    }
  }

  if (isSearching) {
    return {
      tone: 'running',
      label: '联网搜索中...',
    }
  }

  return null
})
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
  gap: 12px;
  min-width: 0;
  padding: 16px;
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
.agent-card-badges,
.process-leading,
.process-actions,
.timeline-head,
  .timeline-title-row {
  display: flex;
  align-items: center;
}

.timeline-head {
  justify-content: space-between;
}

.agent-card-header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.agent-card-title {
  flex: 1 1 320px;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.agent-card-badges {
  gap: 8px;
  row-gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.agent-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
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

.agent-elapsed {
  font-size: 12px;
  color: rgba(196, 205, 223, 0.78);
  white-space: nowrap;
}

.agent-web-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  max-width: 100%;
}

.agent-web-badge.is-running {
  background: rgba(79, 151, 255, 0.14);
  color: #8dc7ff;
}

.agent-web-badge.is-success {
  background: rgba(73, 201, 176, 0.12);
  color: #70e5cc;
}

.agent-time {
  font-size: 12px;
  color: rgba(182, 189, 203, 0.74);
  flex-shrink: 0;
  padding-top: 2px;
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

.agent-answer :deep(p + p),
.agent-answer :deep(p + ul),
.agent-answer :deep(p + ol),
.agent-answer :deep(ul + p),
.agent-answer :deep(ol + p) {
  margin-top: 12px;
}

.agent-answer :deep(h2),
.agent-answer :deep(h3),
.agent-answer :deep(h4) {
  margin: 18px 0 10px;
  font-weight: 700;
  line-height: 1.35;
}

.agent-answer :deep(h2:first-child),
.agent-answer :deep(h3:first-child),
.agent-answer :deep(h4:first-child) {
  margin-top: 0;
}

.agent-answer :deep(h2) {
  font-size: 17px;
  color: rgba(130, 210, 255, 0.96);
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.agent-answer :deep(h3) {
  font-size: 15px;
  color: rgba(246, 249, 255, 0.98);
}

.agent-answer :deep(h4) {
  font-size: 14px;
  color: rgba(220, 228, 242, 0.94);
}

.agent-answer :deep(ul),
.agent-answer :deep(ol) {
  margin: 10px 0;
  padding-left: 20px;
}

.agent-answer :deep(ul) {
  list-style: none;
  padding-left: 16px;
}

.agent-answer :deep(ul > li) {
  position: relative;
  padding-left: 14px;
}

.agent-answer :deep(ul > li::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(130, 210, 255, 0.7);
}

.agent-answer :deep(li + li) {
  margin-top: 6px;
}

.agent-answer :deep(strong) {
  color: rgba(246, 249, 255, 0.98);
  font-weight: 600;
}

.agent-answer :deep(em) {
  color: rgba(180, 215, 255, 0.9);
  font-style: italic;
}

.agent-answer :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 185, 120, 0.92);
  font-size: 0.9em;
}

.agent-answer :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 14px;
  border-left: 3px solid rgba(130, 210, 255, 0.4);
  background: rgba(255, 255, 255, 0.02);
  color: rgba(205, 213, 227, 0.86);
}

.agent-answer :deep(hr) {
  border: 0;
  height: 1px;
  margin: 14px 0;
  background: rgba(255, 255, 255, 0.08);
}

.pending-answer {
  color: rgba(189, 198, 215, 0.82);
}

.agent-debug-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.agent-debug-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 13px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-debug-card-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(142, 212, 255, 0.86);
}

.agent-debug-line {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(205, 213, 227, 0.82);
  overflow-wrap: anywhere;
  word-break: break-word;
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

  .agent-card-title {
    flex-basis: 100%;
  }

  .agent-process-toggle {
    align-items: flex-start;
  }

  .process-actions {
    margin-left: 22px;
  }
}
</style>
