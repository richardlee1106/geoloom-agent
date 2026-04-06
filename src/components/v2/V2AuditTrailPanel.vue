<template>
  <section class="audit-shell">
    <header class="section-head">
      <div>
        <p class="section-kicker">Audit Trail</p>
        <h2>真实审计事件</h2>
      </div>
      <div class="head-actions">
        <span class="section-meta">{{ events.length }} items</span>
        <button class="refresh-btn" type="button" @click="$emit('refresh')">Refresh</button>
      </div>
    </header>

    <div class="filter-grid">
      <input :value="filters.trace_id || ''" type="text" placeholder="trace_id" @input="updateFilter('trace_id', $event.target.value)" />
      <input :value="filters.job_id || ''" type="text" placeholder="job_id" @input="updateFilter('job_id', $event.target.value)" />
      <input :value="filters.session_id || ''" type="text" placeholder="session_id" @input="updateFilter('session_id', $event.target.value)" />
      <input :value="filters.tenant_id || ''" type="text" placeholder="tenant_id" @input="updateFilter('tenant_id', $event.target.value)" />
      <input :value="filters.user_id || ''" type="text" placeholder="user_id" @input="updateFilter('user_id', $event.target.value)" />
      <input :value="filters.event || ''" type="text" placeholder="event" @input="updateFilter('event', $event.target.value)" />
    </div>

    <div v-if="events.length === 0" class="audit-empty">
      当前没有查到审计事件。只有真实请求、真实 SSE、真实运行日志才会出现在这里。
    </div>

    <div v-else class="audit-list">
      <article
        v-for="(entry, index) in events"
        :key="`${entry.ts}-${entry.event}-${index}`"
        class="audit-item"
      >
        <div class="audit-top">
          <strong>{{ entry.event }}</strong>
          <span>{{ entry.ts }}</span>
        </div>
        <div class="audit-meta">
          <span v-if="entry.kind" class="pill">{{ entry.kind }}</span>
          <span v-if="entry.trace_id" class="pill">{{ entry.trace_id }}</span>
          <span v-if="entry.job_id" class="pill">{{ entry.job_id }}</span>
          <span v-if="entry.session_id" class="pill">{{ entry.session_id }}</span>
        </div>
        <p class="audit-text">{{ resolvePayloadText(entry) }}</p>
      </article>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  events: {
    type: Array,
    default: () => []
  },
  filters: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:filters', 'refresh'])

function updateFilter(key, value) {
  emit('update:filters', {
    ...props.filters,
    [key]: String(value || '').trim()
  })
}

function resolvePayloadText(entry = {}) {
  const payload = entry.payload || {}
  return payload.summary?.text
    || payload.answer?.text
    || payload.completion_summary
    || payload.query
    || payload.error_message
    || entry.msg
    || '无附加文本'
}
</script>

<style scoped>
.audit-shell {
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

.head-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.refresh-btn {
  border: 1px solid rgba(181, 214, 219, 0.2);
  border-radius: 999px;
  background: rgba(20, 60, 75, 0.5);
  color: #e8fbff;
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.filter-grid input {
  border: 1px solid rgba(181, 214, 219, 0.12);
  border-radius: 12px;
  background: rgba(10, 24, 36, 0.72);
  color: #eff9fc;
  padding: 10px 12px;
  font-size: 12px;
}

.filter-grid input::placeholder {
  color: rgba(187, 217, 221, 0.42);
}

.audit-empty {
  padding: 16px;
  border-radius: 18px;
  border: 1px dashed rgba(181, 214, 219, 0.2);
  color: rgba(222, 241, 244, 0.74);
}

.audit-list {
  display: grid;
  gap: 10px;
}

.audit-item {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(181, 214, 219, 0.12);
  background: linear-gradient(180deg, rgba(9, 25, 38, 0.9), rgba(8, 18, 28, 0.96));
}

.audit-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: #f4fbff;
}

.audit-top span {
  color: rgba(188, 219, 224, 0.68);
  font-size: 12px;
}

.audit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}

.pill {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(19, 63, 81, 0.56);
  border: 1px solid rgba(181, 214, 219, 0.12);
  color: #e8fbff;
  font-size: 11px;
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}

.audit-text {
  margin: 0;
  color: #edf8fa;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 900px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
