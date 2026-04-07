<template>
  <section v-if="hasWidgets" class="evidence-board">
    <header class="board-head">
      <div>
        <p class="board-kicker">空间信息聚合</p>
        <h3 class="board-title">意图驱动模板看板</h3>
      </div>
      <span class="board-intent">{{ intentLabel }}</span>
    </header>

    <div class="template-grid">
      <article v-for="widget in selectedWidgets" :key="widget.id" class="template-card">
        <div class="template-head">
          <h4 class="template-title">{{ widget.title }}</h4>
          <p class="template-subtitle">{{ widget.subtitle }}</p>
        </div>

        <ul class="template-list">
          <li
            v-for="(line, lineIndex) in widget.lines"
            :key="`${widget.id}-line-${lineIndex}`"
            class="template-line"
          >
            {{ line }}
          </li>
        </ul>

        <div v-if="widget.actions.length" class="template-actions">
          <button
            v-for="action in widget.actions"
            :key="`${widget.id}-${action.label}`"
            type="button"
            class="template-action"
            @click="runAction(action, widget.id)"
          >
            {{ action.label }}
          </button>
        </div>
      </article>
    </div>

    <section v-if="encoderSummary" class="encoder-summary">
      <div class="encoder-summary-head">编码器参与</div>
      <div class="encoder-summary-grid">
        <span class="encoder-pill">预测 {{ encoderSummary.predictedCount }}</span>
        <span class="encoder-pill">高置信 {{ encoderSummary.highConfidenceCount }}</span>
        <span class="encoder-pill">纯度 {{ encoderSummary.purityText }}</span>
        <span class="encoder-pill">约束源 {{ encoderSummary.constraintSource }}</span>
      </div>
    </section>

    <details v-if="detailRows.length" class="detail-panel">
      <summary>查看候选片区明细</summary>
      <div class="detail-list">
        <button
          v-for="item in detailRows"
          :key="item.key"
          type="button"
          class="detail-row"
          @click="handleLocate(item.center)"
        >
          <span class="detail-rank">{{ item.rank }}</span>
          <span class="detail-name">{{ item.name }}</span>
          <span class="detail-metric">{{ item.metric }}</span>
        </button>
      </div>
    </details>
  </section>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useIntentTemplateSelector } from '../composables/ai/useIntentTemplateSelector'
import { deriveTemplateContext } from '../utils/aiTemplateMetrics'
import {
  trackTemplateImpression,
  trackTemplateClick,
  trackLocateClick,
  trackFollowupClick
} from '../services/aiTelemetry'

const props = defineProps({
  clusters: { type: Object, default: null },
  vernacularRegions: { type: Array, default: null },
  fuzzyRegions: { type: Array, default: null },
  analysisStats: { type: Object, default: null },
  intentMode: { type: String, default: 'macro_overview' },
  queryType: { type: String, default: 'area_analysis' },
  intentMeta: { type: Object, default: null }
})

const emit = defineEmits(['locate', 'ask-followup'])
const { selectTemplates } = useIntentTemplateSelector()

const templateContext = computed(() =>
  deriveTemplateContext({
    clusters: props.clusters,
    vernacularRegions: props.vernacularRegions,
    fuzzyRegions: props.fuzzyRegions,
    analysisStats: props.analysisStats,
    intentMeta: props.intentMeta,
    intentMode: props.intentMode,
    queryType: props.queryType
  })
)

const selectedWidgets = computed(() => selectTemplates(templateContext.value))

const hasWidgets = computed(() => selectedWidgets.value.length > 0)
const traceId = computed(() => {
  return (
    props.intentMeta?.traceId ||
    props.intentMeta?.trace_id ||
    props.analysisStats?.trace_id ||
    null
  )
})
const emittedImpressionKeys = new Set()

const intentLabel = computed(() => {
  if (templateContext.value.intentType === 'comparison') return '对比意图'
  if (templateContext.value.intentType === 'micro') return '微观意图'
  return '宏观意图'
})

const encoderSummary = computed(() => {
  const stats = props.analysisStats
  if (!stats || typeof stats !== 'object') return null

  const predictedCount = Number(stats.encoder_region_predicted_count)
  const highConfidenceCount = Number(stats.encoder_region_high_confidence_count)
  const purity = Number(stats.encoder_region_purity)
  const constraintSource = String(stats.vector_constraint_source || '').trim()
  const signalModel = String(stats.boundary_signal_model || '').trim().toLowerCase()

  const hasEncoderSignal = signalModel.includes('encoder')
    || Number.isFinite(predictedCount)
    || Number.isFinite(highConfidenceCount)
    || Number.isFinite(purity)
    || Boolean(constraintSource)

  if (!hasEncoderSignal) return null

  return {
    predictedCount: Number.isFinite(predictedCount) ? predictedCount : '--',
    highConfidenceCount: Number.isFinite(highConfidenceCount) ? highConfidenceCount : '--',
    purityText: Number.isFinite(purity) ? toPercent(purity) : '--',
    constraintSource: constraintSource || 'unknown'
  }
})

const detailRows = computed(() => {
  const rows = []
  const context = templateContext.value

  context.hotspots.slice(0, 3).forEach((item, index) => {
    rows.push({
      key: `hotspot-${item.id}`,
      rank: `热点 #${index + 1}`,
      name: item.name,
      metric: `${item.poiCount} POI`,
      center: item.center
    })
  })

  context.regions.slice(0, 3).forEach((item, index) => {
    rows.push({
      key: `region-${item.id}`,
      rank: `片区 #${index + 1}`,
      name: item.name,
      metric: `隶属度 ${toPercent(item.membershipScore)}`,
      center: item.center
    })
  })

  context.fuzzyRegions.slice(0, 2).forEach((item, index) => {
    rows.push({
      key: `fuzzy-${item.id}`,
      rank: `边界 #${index + 1}`,
      name: item.name,
      metric: `歧义 ${toPercent(item.ambiguityScore)}`,
      center: item.center
    })
  })

  return rows
})

function runAction(action, widgetId = null) {
  if (!action?.type) return
  const payloadBase = {
    traceId: traceId.value,
    templateId: widgetId,
    intentMeta: props.intentMeta || null
  }

  trackTemplateClick(payloadBase).catch(() => {})

  if (action.type === 'locate') {
    trackLocateClick(payloadBase).catch(() => {})
    handleLocate(action.payload)
    return
  }
  if (action.type === 'followup' && action.payload) {
    trackFollowupClick(payloadBase).catch(() => {})
    emit('ask-followup', action.payload)
  }
}

function handleLocate(center) {
  const normalized = normalizeCenter(center)
  if (!normalized) return
  emit('locate', normalized)
}

function normalizeCenter(center) {
  if (Array.isArray(center) && center.length >= 2) {
    const lon = Number(center[0])
    const lat = Number(center[1])
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
  }
  if (center && typeof center === 'object') {
    const lon = Number(center.lon ?? center.lng ?? center.longitude)
    const lat = Number(center.lat ?? center.latitude)
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
  }
  return null
}

function toPercent(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '--'
  return `${Math.round(Math.max(0, Math.min(1, num)) * 100)}%`
}

watch(
  () => [traceId.value, props.intentMeta, selectedWidgets.value],
  ([currentTrace, currentIntentMeta, widgets]) => {
    if (!currentTrace || !Array.isArray(widgets) || widgets.length === 0) return

    widgets.forEach((widget) => {
      const key = `${currentTrace}:${widget.id}`
      if (emittedImpressionKeys.has(key)) return
      emittedImpressionKeys.add(key)
      trackTemplateImpression({
        traceId: currentTrace,
        templateId: widget.id,
        intentMeta: currentIntentMeta || null
      }).catch(() => {})
    })
  },
  { immediate: true, deep: false }
)
</script>

<style scoped>
.evidence-board {
  border-radius: 16px;
  border: 1px solid rgba(80, 125, 167, 0.35);
  background:
    radial-gradient(circle at 10% 0%, rgba(18, 102, 163, 0.18), transparent 55%),
    linear-gradient(150deg, rgba(9, 20, 40, 0.95), rgba(12, 28, 50, 0.9));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.board-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(147, 197, 253, 0.9);
}

.board-title {
  margin: 4px 0 0;
  color: #f8fafc;
  font-size: 15px;
  font-weight: 650;
}

.board-intent {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(2, 132, 199, 0.18);
  color: #e0f2fe;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.template-grid {
  padding: 12px;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.template-card {
  border-radius: 12px;
  border: 1px solid rgba(110, 160, 205, 0.22);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.82), rgba(15, 30, 56, 0.62));
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 8px;
  animation: widget-enter 220ms ease-out;
}

.template-head {
  min-width: 0;
}

.template-title {
  margin: 0;
  font-size: 14px;
  color: #f8fafc;
}

.template-subtitle {
  margin: 3px 0 0;
  color: rgba(191, 219, 254, 0.8);
  font-size: 12px;
  line-height: 1.4;
}

.template-list {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.template-line {
  color: rgba(226, 232, 240, 0.92);
  font-size: 12px;
  line-height: 1.45;
}

.template-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}

.template-action {
  border: 1px solid rgba(56, 189, 248, 0.36);
  border-radius: 999px;
  background: rgba(2, 132, 199, 0.18);
  color: #e0f2fe;
  padding: 5px 10px;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  align-self: flex-start;
  cursor: pointer;
  transition: all 180ms ease;
}

.template-action:hover {
  background: rgba(14, 165, 233, 0.28);
  border-color: rgba(56, 189, 248, 0.56);
}

.detail-panel {
  border-top: 1px solid rgba(148, 163, 184, 0.15);
  padding: 10px 12px 12px;
}

.encoder-summary {
  margin: 0 12px 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(110, 160, 205, 0.22);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.78), rgba(15, 30, 56, 0.54));
}

.encoder-summary-head {
  color: #f8fafc;
  font-size: 13px;
  font-weight: 650;
  margin-bottom: 10px;
}

.encoder-summary-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.encoder-pill {
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  background: rgba(14, 165, 233, 0.12);
  color: rgba(226, 232, 240, 0.95);
  padding: 5px 10px;
  font-size: 11px;
  line-height: 1.2;
}

.detail-panel > summary {
  cursor: pointer;
  color: rgba(186, 230, 253, 0.96);
  font-size: 12px;
  font-weight: 600;
}

.detail-list {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.detail-row {
  width: 100%;
  border: 1px solid rgba(110, 160, 205, 0.28);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.58);
  color: rgba(226, 232, 240, 0.95);
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease;
}

.detail-row:hover {
  border-color: rgba(56, 189, 248, 0.48);
  background: rgba(15, 32, 58, 0.72);
}

.detail-rank {
  color: rgba(125, 211, 252, 0.95);
  font-weight: 700;
}

.detail-name {
  text-align: left;
}

.detail-metric {
  color: rgba(203, 213, 225, 0.86);
}

@keyframes widget-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .template-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .template-card,
  .template-action,
  .detail-row {
    animation: none;
    transition: none;
  }
}
</style>
