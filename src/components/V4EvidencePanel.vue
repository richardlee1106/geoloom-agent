<template>
  <section class="v4-evidence-panel">
    <header class="panel-header">
      <div>
        <p class="panel-kicker">GeoLoom V4</p>
        <h3 class="panel-title">{{ viewTitle }}</h3>
      </div>
      <div class="panel-status">
        <span class="status-pill" :class="providerReady ? 'is-ready' : 'is-fallback'">
          {{ providerReady ? 'LLM 在线' : 'Fallback 模式' }}
        </span>
        <span v-if="modelId" class="status-pill is-model">{{ modelId }}</span>
      </div>
    </header>

    <div class="panel-meta">
      <article class="meta-card">
        <span class="meta-label">锚点</span>
        <strong class="meta-value">{{ anchorLabel }}</strong>
      </article>
      <article class="meta-card">
        <span class="meta-label">结果数</span>
        <strong class="meta-value">{{ resultCount }}</strong>
      </article>
      <article class="meta-card">
        <span class="meta-label">Tool Calls</span>
        <strong class="meta-value">{{ toolCalls.length }}</strong>
      </article>
      <article class="meta-card">
        <span class="meta-label">Session</span>
        <strong class="meta-value">{{ shortSessionId }}</strong>
      </article>
    </div>

    <div v-if="degradedDependencies.length > 0" class="degraded-strip">
      <span class="degraded-label">当前降级</span>
      <span
        v-for="dependency in degradedDependencies"
        :key="dependency"
        class="degraded-chip"
      >
        {{ dependency }}
      </span>
    </div>

    <div class="panel-grid">
      <section class="panel-card panel-card-main">
        <div class="card-head">
          <span class="card-kicker">Evidence</span>
          <strong>{{ viewTitle }}</strong>
        </div>

        <ul v-if="listItems.length > 0" class="result-list">
          <li v-for="item in listItems" :key="itemKey(item)" class="result-item">
            <div class="result-main">
              <strong>{{ item.name }}</strong>
              <span>{{ item.category || item.categorySub || item.categoryMain || '未分类' }}</span>
            </div>
            <div class="result-side">
              <span v-if="item.score !== null && item.score !== undefined">{{ formatScore(item.score) }}</span>
              <span v-else>{{ formatDistance(item.distance_m) }}</span>
              <em v-if="item.duration_min !== null && item.duration_min !== undefined">
                {{ formatDuration(item.duration_min) }}
              </em>
            </div>
          </li>
        </ul>

        <div v-else-if="comparisonPairs.length > 0" class="comparison-grid">
          <article v-for="pair in comparisonPairs" :key="pair.label" class="comparison-card">
            <div class="comparison-head">
              <strong>{{ pair.label }}</strong>
              <span>{{ pair.value }} 项</span>
            </div>
            <p class="comparison-summary">
              {{ pair.items.slice(0, 3).map((item) => item.name).join(' · ') || '暂无结构化结果' }}
            </p>
          </article>
        </div>

        <div v-else-if="semanticRegions.length > 0" class="semantic-grid">
          <div v-if="semanticReferenceDimensions.length > 0" class="semantic-reference-card">
            <div class="semantic-reference-head">
              <strong>参考维度</strong>
              <span>{{ semanticReferenceDimensions.length }} 项</span>
            </div>
            <div class="semantic-reference-chips">
              <span
                v-for="dimension in semanticReferenceDimensions"
                :key="dimension.key || dimension.label"
                class="semantic-reference-chip"
              >
                {{ dimension.label }} {{ formatScore(dimension.score) }}
              </span>
            </div>
          </div>

          <article v-for="(region, index) in semanticRegions" :key="region.regionId || region.name" class="semantic-card">
            <div class="semantic-rank">{{ region.rank || index + 1 }}</div>
            <div class="semantic-body">
              <div class="semantic-head">
                <div class="semantic-title-group">
                  <strong>{{ region.name }}</strong>
                  <span class="semantic-summary">{{ region.summary || '暂无摘要' }}</span>
                </div>
                <span class="semantic-score">{{ formatScore(region.score) }}</span>
              </div>

              <div class="semantic-bar">
                <span class="semantic-bar-fill" :style="{ width: `${Math.max(10, Math.round((region.score || 0) * 100))}%` }"></span>
              </div>

              <div v-if="Array.isArray(region.dimensions) && region.dimensions.length > 0" class="semantic-dimension-grid">
                <div
                  v-for="dimension in region.dimensions"
                  :key="dimensionKey(region, dimension)"
                  class="semantic-dimension"
                >
                  <div class="semantic-dimension-head">
                    <span>{{ dimension.label }}</span>
                    <strong>{{ formatScore(dimension.score) }}</strong>
                  </div>
                  <div class="semantic-dimension-bar">
                    <span class="semantic-dimension-fill" :style="{ width: `${Math.max(8, Math.round((dimension.score || 0) * 100))}%` }"></span>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="empty-state">
          还没有可展示的结构化证据，后端返回后会在这里汇总。
        </div>
      </section>

      <section class="panel-card panel-card-side">
        <div class="card-head">
          <span class="card-kicker">Trace</span>
          <strong>{{ providerLabel || 'GeoLoom Agent' }}</strong>
        </div>

        <ul v-if="toolCalls.length > 0" class="trace-list">
          <li v-for="call in toolCalls" :key="toolCallKey(call)" class="trace-item">
            <div class="trace-main">
              <strong>{{ call.skill }}.{{ call.action }}</strong>
              <span class="trace-status" :class="`is-${call.status || 'planned'}`">
                {{ call.status || 'planned' }}
              </span>
            </div>
            <span class="trace-latency">{{ formatLatency(call.latency_ms) }}</span>
          </li>
        </ul>

        <div v-else class="empty-state">
          当前回答还没有 tool trace。
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    default: () => ({}),
  },
  providerReady: {
    type: Boolean,
    default: false,
  },
  providerLabel: {
    type: String,
    default: '',
  },
  modelId: {
    type: String,
    default: '',
  },
  degradedDependencies: {
    type: Array,
    default: () => [],
  },
  sessionId: {
    type: String,
    default: '',
  },
})

const evidenceView = computed(() => {
  const fallback = {
    type: 'poi_list',
    anchor: {},
    items: [],
    meta: {},
  }
  return props.message?.evidenceView || fallback
})

const toolCalls = computed(() => Array.isArray(props.message?.toolCalls) ? props.message.toolCalls : [])

const viewTitleMap = {
  poi_list: '周边证据清单',
  transport: '交通接驳证据',
  bucket: '聚合分桶证据',
  comparison: '双片区对比证据',
  semantic_candidate: '语义相似片区证据',
}

const viewTitle = computed(() => viewTitleMap[evidenceView.value?.type] || '结构化证据')

const anchorLabel = computed(() => {
  const anchor = evidenceView.value?.anchor || {}
  return anchor.resolvedPlaceName || anchor.displayName || anchor.placeName || '未解析锚点'
})

const resultCount = computed(() => {
  if (Array.isArray(evidenceView.value?.pairs) && evidenceView.value.pairs.length > 0) {
    return evidenceView.value.pairs.reduce((sum, pair) => sum + Number(pair.value || 0), 0)
  }
  if (Array.isArray(evidenceView.value?.regions) && evidenceView.value.regions.length > 0) {
    return evidenceView.value.regions.length
  }
  return Array.isArray(evidenceView.value?.items) ? evidenceView.value.items.length : 0
})

const shortSessionId = computed(() => {
  const candidate = props.sessionId || props.message?.sessionId || ''
  if (!candidate) return '未分配'
  return candidate.length > 18 ? `${candidate.slice(0, 8)}...${candidate.slice(-6)}` : candidate
})

const comparisonPairs = computed(() => Array.isArray(evidenceView.value?.pairs) ? evidenceView.value.pairs : [])
const semanticRegions = computed(() => Array.isArray(evidenceView.value?.regions) ? evidenceView.value.regions : [])
const semanticReferenceDimensions = computed(() => {
  const meta = evidenceView.value?.meta
  return Array.isArray(meta?.referenceDimensions) ? meta.referenceDimensions : []
})
const listItems = computed(() => {
  if (comparisonPairs.value.length > 0 || semanticRegions.value.length > 0) return []
  return Array.isArray(evidenceView.value?.items) ? evidenceView.value.items : []
})

function itemKey(item = {}) {
  return `${item.id ?? item.name}-${item.distance_m ?? item.score ?? 'x'}`
}

function toolCallKey(call = {}) {
  return `${call.id || 'trace'}-${call.skill || 'skill'}-${call.action || 'action'}`
}

function dimensionKey(region = {}, dimension = {}) {
  return `${region.regionId || region.name || 'region'}-${dimension.key || dimension.label || 'dimension'}`
}

function formatDistance(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '未知距离'
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)} km`
  return `${Math.round(numeric)} m`
}

function formatDuration(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  return `${Math.round(numeric)} min`
}

function formatLatency(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  return `${Math.round(numeric)} ms`
}

function formatScore(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  const normalized = numeric <= 1 ? numeric : numeric / 100
  return `${Math.round(normalized * 100)}%`
}
</script>

<style scoped>
.v4-evidence-panel {
  --v4-line: rgba(137, 170, 202, 0.2);
  --v4-text: #edf6ff;
  --v4-muted: rgba(195, 210, 228, 0.72);
  --v4-cyan: #67d5ff;
  --v4-mint: #7ef2c4;
  border-radius: 22px;
  border: 1px solid rgba(106, 164, 206, 0.22);
  background:
    radial-gradient(circle at 85% 0%, rgba(103, 213, 255, 0.18), transparent 32%),
    radial-gradient(circle at 0% 25%, rgba(249, 199, 79, 0.12), transparent 28%),
    linear-gradient(155deg, rgba(6, 13, 24, 0.98), rgba(11, 25, 43, 0.96) 55%, rgba(14, 34, 54, 0.94));
  color: var(--v4-text);
  padding: 18px;
  display: grid;
  gap: 14px;
}

.panel-header,
.card-head,
.comparison-head,
.semantic-head,
.trace-main,
.result-main,
.result-side,
.panel-status,
.panel-meta,
.panel-grid,
.degraded-strip {
  display: flex;
}

.panel-header,
.card-head,
.comparison-head,
.semantic-head,
.trace-main,
.result-main,
.result-side {
  justify-content: space-between;
  align-items: center;
}

.panel-header,
.panel-status,
.degraded-strip,
.panel-meta,
.panel-grid {
  gap: 10px;
  flex-wrap: wrap;
}

.panel-kicker,
.card-kicker,
.meta-label,
.degraded-label {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(171, 203, 233, 0.7);
}

.panel-title {
  margin: 4px 0 0;
  font-size: 22px;
}

.status-pill,
.degraded-chip,
.trace-status {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 11px;
}

.status-pill.is-ready,
.trace-status.is-done {
  border: 1px solid rgba(126, 242, 196, 0.42);
  color: #d7fff0;
  background: rgba(16, 70, 55, 0.42);
}

.status-pill.is-fallback,
.degraded-chip,
.trace-status.is-error {
  border: 1px solid rgba(255, 146, 43, 0.38);
  color: #ffe2c5;
  background: rgba(92, 43, 11, 0.46);
}

.status-pill.is-model {
  border: 1px solid rgba(122, 169, 209, 0.28);
  color: #d8efff;
  background: rgba(10, 23, 39, 0.74);
}

.meta-card,
.panel-card,
.result-item,
.trace-item,
.comparison-card,
.semantic-card,
.semantic-reference-card {
  border-radius: 16px;
  border: 1px solid var(--v4-line);
  background: rgba(10, 22, 37, 0.72);
  padding: 12px 14px;
}

.meta-card {
  min-width: 132px;
  flex: 1 1 132px;
  display: grid;
  gap: 6px;
}

.meta-value {
  font-size: 15px;
}

.panel-card-main {
  flex: 1 1 420px;
}

.panel-card-side {
  flex: 0 1 280px;
}

.result-list,
.trace-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.result-item,
.trace-item {
  display: grid;
  gap: 8px;
}

.result-main,
.result-side {
  gap: 12px;
}

.comparison-grid,
.semantic-grid {
  display: grid;
  gap: 10px;
}

.semantic-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.semantic-reference-card {
  display: grid;
  gap: 10px;
}

.semantic-reference-head,
.semantic-dimension-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.semantic-reference-head span,
.semantic-summary,
.semantic-score,
.semantic-dimension-head span,
.semantic-dimension-head strong {
  font-size: 12px;
  color: var(--v4-muted);
}

.semantic-reference-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.semantic-reference-chip {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: #dff6ff;
  background: rgba(16, 45, 70, 0.82);
  border: 1px solid rgba(103, 213, 255, 0.22);
}

.semantic-rank {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #e7fbff;
  background: linear-gradient(145deg, rgba(103, 213, 255, 0.18), rgba(126, 242, 196, 0.12));
  border: 1px solid rgba(103, 213, 255, 0.2);
}

.semantic-body,
.semantic-title-group,
.semantic-dimension-grid,
.semantic-dimension {
  display: grid;
  gap: 10px;
}

.semantic-title-group {
  min-width: 0;
}

.semantic-summary {
  line-height: 1.55;
}

.semantic-score {
  font-size: 13px;
  font-weight: 700;
  color: #e7fbff;
}

.result-main span,
.comparison-summary,
.trace-latency,
.semantic-card p {
  font-size: 12px;
  line-height: 1.55;
  color: var(--v4-muted);
}

.semantic-bar {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(18, 38, 60, 0.9);
  overflow: hidden;
}

.semantic-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--v4-cyan), var(--v4-mint));
}

.semantic-dimension-bar {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(18, 38, 60, 0.9);
  overflow: hidden;
}

.semantic-dimension-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(103, 213, 255, 0.92), rgba(249, 199, 79, 0.9));
}

.empty-state {
  padding: 14px;
  border-radius: 14px;
  border: 1px dashed rgba(123, 169, 209, 0.28);
  color: var(--v4-muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>
