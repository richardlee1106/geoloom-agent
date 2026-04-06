<template>
  <section class="inspector-shell">
    <header class="section-head">
      <div>
        <p class="section-kicker">Control Plane</p>
        <h2>运行与治理面板</h2>
      </div>
      <button class="refresh-btn" type="button" @click="$emit('refresh')">Refresh</button>
    </header>

    <div class="inspector-grid">
      <article class="inspector-card">
        <span class="card-title">Persistence</span>
        <p class="card-line">Redis: {{ persistenceLabel }}</p>
        <p class="card-line">Postgres: {{ postgresLabel }}</p>
      </article>

      <article class="inspector-card">
        <span class="card-title">Deep Queue</span>
        <p class="card-line">Mode: {{ deepLaneMode }}</p>
        <p class="card-line">Queued: {{ deepLaneQueued }}</p>
      </article>

      <article class="inspector-card">
        <span class="card-title">Cache</span>
        <p class="card-line">L1 Sessions: {{ cacheL1Sessions }}</p>
        <p class="card-line">L2 Redis: {{ cacheRedisLabel }}</p>
      </article>

      <article class="inspector-card">
        <span class="card-title">Agents</span>
        <p class="card-line">Subscribers: {{ subscribersCount }}</p>
        <p class="card-line">Requests: {{ requestsTotal }}</p>
      </article>

      <article class="inspector-card">
        <span class="card-title">Quota</span>
        <p class="card-line">Tenant: {{ quotaTenant }}</p>
        <p class="card-line">User: {{ quotaUser }}</p>
      </article>

      <article class="inspector-card">
        <span class="card-title">Audit Retention</span>
        <p class="card-line">Days: {{ retentionDays }}</p>
        <p class="card-line">Max Events: {{ retentionMaxEvents }}</p>
      </article>
    </div>

    <div class="alerts-shell">
      <div
        v-for="alert in alerts"
        :key="alert.code"
        class="alert-chip"
        :class="alert.level"
      >
        <strong>{{ alert.title }}</strong>
        <span>{{ alert.message }}</span>
      </div>
    </div>

    <div class="subscriber-list">
      <div
        v-for="subscriber in subscribers"
        :key="`${subscriber.topic}-${subscriber.agent_id}`"
        class="subscriber-item"
      >
        <span class="subscriber-topic">{{ subscriber.topic }}</span>
        <span class="subscriber-agent">{{ subscriber.agent_id }}</span>
      </div>
    </div>

    <div class="governance-actions">
      <button class="refresh-btn" type="button" @click="$emit('prune-audit')">Prune Audit</button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  controlPlane: {
    type: Object,
    default: null
  },
  quota: {
    type: Object,
    default: null
  },
  auditRetention: {
    type: Object,
    default: null
  }
})

defineEmits(['refresh', 'prune-audit'])

const persistenceLabel = computed(() => props.controlPlane?.persistence?.redis?.reachable ? 'online' : 'offline')
const postgresLabel = computed(() => props.controlPlane?.persistence?.postgres?.reachable ? 'online' : 'offline')
const deepLaneMode = computed(() => props.controlPlane?.deep_lane?.mode || 'memory')
const deepLaneQueued = computed(() => props.controlPlane?.deep_lane?.queue_counts?.waiting ?? props.controlPlane?.deep_lane?.queued_count ?? 0)
const cacheL1Sessions = computed(() => props.controlPlane?.cache?.l1?.sessions ?? 0)
const cacheRedisLabel = computed(() => props.controlPlane?.cache?.l2?.redis_reachable ? 'online' : 'degraded')
const subscribersCount = computed(() => Array.isArray(props.controlPlane?.subscribers) ? props.controlPlane.subscribers.length : 0)
const requestsTotal = computed(() => props.controlPlane?.metrics?.counters?.analysis_requests_total ?? 0)
const subscribers = computed(() => Array.isArray(props.controlPlane?.subscribers) ? props.controlPlane.subscribers : [])
const quotaTenant = computed(() => {
  const quota = props.quota?.quota || props.quota
  if (!quota) return '--'
  return `${quota.tenant_used}/${quota.tenant_limit}`
})
const quotaUser = computed(() => {
  const quota = props.quota?.quota || props.quota
  if (!quota) return '--'
  return `${quota.user_used}/${quota.user_limit}`
})
const retentionDays = computed(() => props.auditRetention?.retention?.retention_days ?? props.auditRetention?.retention_days ?? '--')
const retentionMaxEvents = computed(() => props.auditRetention?.retention?.max_events ?? props.auditRetention?.max_events ?? '--')
const alerts = computed(() => {
  const next = []
  const persistence = props.controlPlane?.persistence
  const deepLane = props.controlPlane?.deep_lane
  const cache = props.controlPlane?.cache
  const quota = props.quota?.quota || props.quota
  const retention = props.auditRetention?.retention || props.auditRetention

  if (persistence?.ok !== true) {
    next.push({
      code: 'persistence-degraded',
      level: 'warn',
      title: 'Persistence',
      message: 'Redis/Postgres 至少有一项不可用，当前不是完整企业模式。'
    })
  }

  if (deepLane?.mode !== 'persistent') {
    next.push({
      code: 'queue-memory',
      level: 'warn',
      title: 'Deep Queue',
      message: 'Deep lane 当前未运行在 BullMQ durable mode。'
    })
  }

  if (cache?.l2?.redis_reachable !== true) {
    next.push({
      code: 'cache-redis-degraded',
      level: 'info',
      title: 'Cache',
      message: 'L2 Redis cache 未连通，当前会退回内存模式。'
    })
  }

  if (quota && quota.user_remaining <= 0) {
    next.push({
      code: 'quota-user-exhausted',
      level: 'warn',
      title: 'Quota',
      message: '当前用户额度已耗尽，后续分析请求会被拒绝。'
    })
  }

  if (retention && retention.total_events >= retention.max_events) {
    next.push({
      code: 'audit-retention-cap',
      level: 'info',
      title: 'Audit Retention',
      message: '审计事件已达到上限，建议执行 prune/归档。'
    })
  }

  if (next.length === 0) {
    next.push({
      code: 'all-good',
      level: 'ok',
      title: 'Control Plane',
      message: '当前控制面状态满足企业模式基础要求。'
    })
  }

  return next
})
</script>

<style scoped>
.inspector-shell {
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

.refresh-btn {
  border: 1px solid rgba(181, 214, 219, 0.2);
  border-radius: 999px;
  background: rgba(20, 60, 75, 0.5);
  color: #e8fbff;
  font-size: 12px;
  padding: 8px 12px;
  cursor: pointer;
}

.inspector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.inspector-card {
  min-height: 116px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(178, 214, 219, 0.12);
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

.card-line {
  margin: 0 0 8px;
  color: #edf8fa;
  font-size: 14px;
}

.alerts-shell {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.alert-chip {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(181, 214, 219, 0.12);
}

.alert-chip strong {
  font-size: 12px;
  color: #f5fdff;
}

.alert-chip span {
  font-size: 12px;
  color: rgba(230, 244, 246, 0.82);
}

.alert-chip.warn {
  background: rgba(110, 68, 22, 0.34);
}

.alert-chip.info {
  background: rgba(18, 64, 95, 0.34);
}

.alert-chip.ok {
  background: rgba(20, 81, 61, 0.32);
}

.subscriber-list {
  display: grid;
  gap: 8px;
}

.governance-actions {
  display: flex;
  justify-content: flex-end;
}

.subscriber-item {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(10, 25, 38, 0.64);
  border: 1px solid rgba(181, 214, 219, 0.1);
}

.subscriber-topic,
.subscriber-agent {
  color: #ecf8fa;
  font-size: 12px;
  font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
}

@media (max-width: 900px) {
  .inspector-grid {
    grid-template-columns: 1fr;
  }
}
</style>
