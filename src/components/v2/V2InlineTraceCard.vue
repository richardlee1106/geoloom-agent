<template>
  <section class="v2-inline-trace">
    <header class="trace-top">
      <div class="trace-headline">
        <span class="trace-kicker">V2 Agent Trace</span>
        <strong>{{ stateLabel }}</strong>
      </div>
      <div class="trace-meta">
        <span v-if="message?.traceId" class="meta-pill mono">trace {{ shortTrace }}</span>
        <span v-if="message?.v2ResultType" class="meta-pill">{{ message.v2ResultType }}</span>
      </div>
    </header>

    <div class="event-rail">
      <article
        v-for="(entry, index) in events"
        :key="`${entry.event}-${index}`"
        class="event-chip"
        :class="eventClass(entry.event)"
      >
        <span class="event-name">{{ entry.event }}</span>
        <span v-if="entry.state" class="event-state">{{ entry.state }}</span>
      </article>
    </div>

    <div class="trace-foot">
      <p class="trace-summary">{{ latestSummary }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    default: null
  }
})

const events = computed(() => Array.isArray(props.message?.v2Events) ? props.message.v2Events : [])
const latestSummary = computed(() => {
  const latest = events.value[events.value.length - 1]
  return latest?.summary || props.message?.v2Summary || '等待 V2 事件流推进...'
})
const stateLabel = computed(() => props.message?.v2State || 'NO_STATE')
const shortTrace = computed(() => String(props.message?.traceId || '').slice(0, 8))

function eventClass(eventName = '') {
  if (eventName === 'deep.failed') return 'is-failed'
  if (eventName === 'deep.final') return 'is-done'
  if (eventName === 'deep.patch' || eventName === 'deep.accepted') return 'is-active'
  return 'is-base'
}
</script>

<style scoped>
.v2-inline-trace {
  border-radius: 16px;
  border: 1px solid rgba(114, 201, 213, 0.18);
  background:
    radial-gradient(circle at 100% 0%, rgba(93, 228, 215, 0.15), transparent 36%),
    linear-gradient(180deg, rgba(6, 23, 33, 0.94), rgba(5, 16, 24, 0.98));
  padding: 14px;
  display: grid;
  gap: 12px;
}

.trace-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.trace-headline {
  display: grid;
  gap: 4px;
}

.trace-kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgba(159, 230, 239, 0.72);
}

.trace-headline strong {
  color: #f1fdff;
  font-size: 15px;
}

.trace-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.meta-pill {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(122, 211, 224, 0.16);
  background: rgba(12, 53, 66, 0.6);
  color: #dffcff;
  font-size: 10px;
}

.mono {
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}

.event-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.event-chip {
  min-width: 118px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(114, 201, 213, 0.12);
  background: rgba(10, 34, 48, 0.72);
  display: grid;
  gap: 4px;
}

.event-chip.is-active {
  border-color: rgba(255, 207, 112, 0.28);
  background: rgba(85, 62, 15, 0.45);
}

.event-chip.is-done {
  border-color: rgba(84, 214, 171, 0.3);
  background: rgba(16, 71, 55, 0.46);
}

.event-chip.is-failed {
  border-color: rgba(255, 143, 119, 0.32);
  background: rgba(95, 35, 27, 0.5);
}

.event-name {
  font-size: 11px;
  color: #f2fbff;
  font-weight: 700;
}

.event-state {
  font-size: 10px;
  color: rgba(211, 237, 241, 0.76);
}

.trace-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(222, 244, 247, 0.86);
}
</style>
