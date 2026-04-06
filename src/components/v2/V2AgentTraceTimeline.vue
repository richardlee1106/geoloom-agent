<template>
  <section class="timeline-shell">
    <header class="section-head">
      <div>
        <p class="section-kicker">Event Timeline</p>
        <h2>真实链路回放</h2>
      </div>
      <span class="section-meta">{{ events.length }} events</span>
    </header>

    <div class="timeline-list">
      <article
        v-for="(entry, index) in events"
        :key="`${entry.event}-${index}`"
        class="timeline-item"
      >
        <div class="timeline-mark">
          <span class="timeline-index">{{ index + 1 }}</span>
        </div>
        <div class="timeline-body">
          <div class="timeline-top">
            <strong>{{ entry.event }}</strong>
            <span>{{ resolveState(entry.payload) }}</span>
          </div>
          <p class="timeline-summary">{{ resolveSummary(entry.payload) }}</p>
          <div class="timeline-tags">
            <span v-if="entry.payload?.result_type" class="tag-pill">{{ entry.payload.result_type }}</span>
            <span v-if="entry.payload?.execution_path" class="tag-pill">{{ entry.payload.execution_path }}</span>
            <span v-if="entry.payload?.objective" class="tag-pill">{{ entry.payload.objective }}</span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  events: {
    type: Array,
    default: () => []
  }
})

function resolveSummary(payload = {}) {
  return payload?.summary?.text
    || payload?.answer?.text
    || payload?.completion_summary
    || payload?.error?.message
    || '等待更多链路数据'
}

function resolveState(payload = {}) {
  return payload?.state || 'NO_STATE'
}
</script>

<style scoped>
.timeline-shell {
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

.timeline-list {
  display: grid;
  gap: 12px;
}

.timeline-item {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 14px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(176, 214, 219, 0.12);
  background: linear-gradient(180deg, rgba(9, 24, 38, 0.92), rgba(8, 20, 31, 0.94));
}

.timeline-mark {
  display: flex;
  justify-content: center;
}

.timeline-index {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(36, 123, 132, 0.4), rgba(15, 71, 82, 0.78));
  color: #f6ffff;
  font-weight: 700;
}

.timeline-body {
  display: grid;
  gap: 8px;
}

.timeline-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: #f5fcff;
}

.timeline-top span {
  color: rgba(174, 210, 216, 0.72);
  font-size: 12px;
}

.timeline-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(229, 243, 245, 0.88);
}

.timeline-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-pill {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(181, 214, 219, 0.18);
  background: rgba(22, 61, 76, 0.52);
  color: #ddf8fb;
  font-size: 11px;
}
</style>
