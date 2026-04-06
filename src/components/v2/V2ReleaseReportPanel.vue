<template>
  <section class="report-shell">
    <header class="section-head">
      <div>
        <p class="section-kicker">Release Gate</p>
        <h2>最近一次发布评估</h2>
      </div>
      <span class="section-meta">{{ summaryFileName || 'no-report' }}</span>
    </header>

    <div v-if="!summaryReport && !releaseMarkdown" class="report-empty">
      暂无真实发布报告。请先运行 V2 后端评测脚本生成 `reports/summary` 目录下的文件。
    </div>

    <div v-else class="report-grid">
      <article class="report-card history-card">
        <span class="card-title">History</span>
        <div class="history-list">
          <button
            v-for="item in history"
            :key="item.file_name"
            type="button"
            class="history-item"
            :class="{ active: item.file_name === selectedFileName }"
            @click="$emit('select-report', item.file_name)"
          >
            <strong>{{ item.generated_at || item.file_name }}</strong>
            <span>{{ formatStatus(item.summary) }}</span>
          </button>
        </div>
      </article>

      <article class="report-card">
        <span class="card-title">Summary</span>
        <div class="report-lines">
          <p>Generated: {{ summaryReport?.report?.generated_at || '--' }}</p>
          <p>Comparison: {{ asYesNo(summaryReport?.report?.summary?.summary?.comparison_available) }}</p>
          <p>Persistence OK: {{ asYesNo(summaryReport?.report?.summary?.summary?.persistence_ok) }}</p>
          <p>Routing Eval OK: {{ asYesNo(summaryReport?.report?.summary?.summary?.routing_eval_ok) }}</p>
          <p>No-data Eval OK: {{ asYesNo(summaryReport?.report?.summary?.summary?.no_data_eval_ok) }}</p>
        </div>
      </article>

      <article class="report-card markdown-card">
        <span class="card-title">Release Markdown</span>
        <pre>{{ releaseMarkdown?.markdown || 'No markdown available.' }}</pre>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  summaryReport: {
    type: Object,
    default: null
  },
  releaseMarkdown: {
    type: Object,
    default: null
  },
  history: {
    type: Array,
    default: () => []
  },
  selectedFileName: {
    type: String,
    default: ''
  }
})

defineEmits(['select-report'])

const summaryFileName = computed(() => props.summaryReport?.file_name || props.releaseMarkdown?.file_name || null)

function asYesNo(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'n/a'
}

function formatStatus(summary = {}) {
  const parts = []
  if (summary.persistence_ok === true) parts.push('persistence')
  if (summary.routing_eval_ok === true) parts.push('routing')
  if (summary.no_data_eval_ok === true) parts.push('no-data')
  return parts.length > 0 ? parts.join(' / ') : 'status n/a'
}
</script>

<style scoped>
.report-shell {
  display: grid;
  gap: 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}

.section-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(180, 214, 218, 0.66);
}

h2 {
  margin: 0;
  font-size: 24px;
  color: #f4fbff;
}

.section-meta {
  font-size: 12px;
  color: rgba(198, 224, 228, 0.74);
}

.report-empty {
  padding: 16px;
  border-radius: 18px;
  border: 1px dashed rgba(181, 214, 219, 0.2);
  color: rgba(222, 241, 244, 0.74);
}

.report-grid {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(280px, 360px) 1fr;
  gap: 12px;
}

.report-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(181, 214, 219, 0.12);
  background: linear-gradient(180deg, rgba(9, 25, 38, 0.9), rgba(8, 18, 28, 0.96));
}

.card-title {
  display: block;
  margin-bottom: 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(181, 214, 219, 0.66);
}

.history-list {
  display: grid;
  gap: 8px;
}

.history-item {
  width: 100%;
  text-align: left;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(181, 214, 219, 0.12);
  background: rgba(10, 24, 36, 0.72);
  color: #eff9fc;
  cursor: pointer;
  display: grid;
  gap: 6px;
}

.history-item strong {
  font-size: 12px;
}

.history-item span {
  font-size: 11px;
  color: rgba(209, 232, 236, 0.72);
}

.history-item.active {
  border-color: rgba(93, 228, 215, 0.42);
  background: rgba(15, 74, 82, 0.46);
}

.report-lines {
  display: grid;
  gap: 8px;
}

.report-lines p {
  margin: 0;
  color: #edf8fa;
  font-size: 14px;
}

.markdown-card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: #eff9fc;
  font-size: 13px;
  line-height: 1.6;
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}

@media (max-width: 900px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
}
</style>
