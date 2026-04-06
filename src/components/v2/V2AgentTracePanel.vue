<template>
  <section class="trace-panel">
    <div class="trace-head">
      <div>
        <p class="eyebrow">V2 Agent Trace</p>
        <h1>{{ title }}</h1>
      </div>
      <span class="state-chip" :class="stateClass">{{ stateLabel }}</span>
    </div>

    <div class="trace-grid">
      <article class="trace-card primary">
        <span class="card-label">Query</span>
        <p class="card-value query-text">{{ snapshot?.query || '暂无 V2 任务上下文' }}</p>
      </article>
      <article class="trace-card">
        <span class="card-label">Trace ID</span>
        <p class="card-value mono">{{ snapshot?.trace_id || '--' }}</p>
      </article>
      <article class="trace-card">
        <span class="card-label">Job ID</span>
        <p class="card-value mono">{{ snapshot?.job_id || '--' }}</p>
      </article>
      <article class="trace-card">
        <span class="card-label">Latest Summary</span>
        <p class="card-value">{{ snapshot?.latest_summary || '等待 fast/deep 结果...' }}</p>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  snapshot: {
    type: Object,
    default: null
  },
  job: {
    type: Object,
    default: null
  }
})

const stateLabel = computed(() => {
  return props.job?.state || props.snapshot?.job_state || 'NO_TRACE'
})

const stateClass = computed(() => {
  const state = stateLabel.value
  if (state === 'S7_DEEP_DONE') return 'is-done'
  if (state === 'S8_TERMINAL_DEGRADED') return 'is-failed'
  if (state === 'S4_DEEP_QUEUED' || state === 'S5_DEEP_RUNNING' || state === 'S6_DEEP_PARTIAL') return 'is-active'
  return 'is-idle'
})

const title = computed(() => {
  return props.snapshot?.job_id ? '企业级 GIS Agent 链路总览' : '等待 V2 Agent 任务'
})
</script>

<style scoped>
.trace-panel {
  display: grid;
  gap: 20px;
}

.trace-head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgba(175, 216, 222, 0.72);
}

h1 {
  margin: 0;
  font-size: clamp(28px, 3.4vw, 44px);
  line-height: 1;
  color: #f6fbff;
}

.state-chip {
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(175, 216, 222, 0.24);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.state-chip.is-done {
  background: rgba(43, 123, 113, 0.26);
  color: #bdfbf5;
}

.state-chip.is-active {
  background: rgba(18, 97, 120, 0.28);
  color: #d4fbff;
}

.state-chip.is-failed {
  background: rgba(143, 70, 55, 0.26);
  color: #ffd6ca;
}

.state-chip.is-idle {
  background: rgba(62, 79, 92, 0.24);
  color: #d7e5ee;
}

.trace-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.trace-card {
  min-height: 122px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(177, 214, 220, 0.12);
  background: linear-gradient(180deg, rgba(10, 29, 45, 0.86), rgba(8, 20, 32, 0.92));
}

.trace-card.primary {
  grid-column: span 2;
}

.card-label {
  display: block;
  margin-bottom: 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(176, 209, 214, 0.66);
}

.card-value {
  margin: 0;
  color: #eff9fc;
  font-size: 15px;
  line-height: 1.5;
}

.card-value.query-text {
  font-size: 17px;
}

.mono {
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
}

@media (max-width: 900px) {
  .trace-grid {
    grid-template-columns: 1fr;
  }

  .trace-card.primary {
    grid-column: span 1;
  }
}
</style>
