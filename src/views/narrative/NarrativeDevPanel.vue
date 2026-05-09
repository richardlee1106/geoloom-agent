<template>
  <section class="panel-card dev-panel">
    <div class="card-head">
      <span class="card-title">开发调试面板</span>
      <button class="mini-link" type="button" @click="$emit('copy-snapshot')">复制快照</button>
    </div>
    <ul class="dev-summary-list">
      <li v-for="item in summaryItems" :key="item.key">
        <span>{{ item.label }}</span>
        <strong>{{ item.summary }}</strong>
      </li>
    </ul>
    <details v-for="item in detailItems" :key="`detail-${item.key}`" class="dev-detail">
      <summary>{{ item.label }}</summary>
      <pre>{{ item.detail }}</pre>
    </details>
    <div class="dev-actions">
      <button class="ghost-btn" type="button" @click="$emit('replay')">重放当前视野</button>
      <button class="ghost-btn" type="button" @click="$emit('copy-golden')">复制回放参数</button>
    </div>
    <div class="explore-agent">
      <div class="explore-agent-head">
        <div>
          <strong>探索控件自测 Agent</strong>
          <span>{{ exploreAgentMessage || '对差异化控件组合做批量请求与结果诊断。' }}</span>
        </div>
        <button class="mini-link" type="button" :disabled="exploreAgentStatus === 'running'" @click="$emit('run-explore-agent')">
          {{ exploreAgentStatus === 'running' ? '自测中' : '开始自测' }}
        </button>
      </div>
      <ul v-if="exploreAgentCases?.length" class="explore-agent-list">
        <li v-for="item in exploreAgentCases" :key="item.id" :class="`status-${item.status}`">
          <div class="case-row">
            <strong>{{ item.label }}</strong>
            <span>{{ item.metrics }}</span>
          </div>
          <p>{{ item.verdict }}</p>
          <small>{{ item.summary }}</small>
        </li>
      </ul>
      <button v-if="exploreAgentCases?.length" class="ghost-btn single" type="button" @click="$emit('copy-explore-agent')">复制自测报告</button>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  summaryItems: Array<{ key: string; label: string; summary: string }>
  detailItems: Array<{ key: string; label: string; detail: string }>
  exploreAgentStatus?: 'idle' | 'running' | 'completed' | 'error'
  exploreAgentMessage?: string
  exploreAgentCases?: Array<{
    id: string
    label: string
    status: 'pending' | 'running' | 'completed' | 'error'
    summary: string
    metrics: string
    verdict: string
  }>
}>()

defineEmits<{
  (event: 'copy-snapshot'): void
  (event: 'replay'): void
  (event: 'copy-golden'): void
  (event: 'run-explore-agent'): void
  (event: 'copy-explore-agent'): void
}>()
</script>

<style scoped>
.panel-card {
  background: var(--bg-panel);
  border: 1px solid var(--bd);
  border-radius: 10px;
  padding: 14px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.card-title {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
}

.dev-panel {
  border-color: rgba(59, 130, 246, 0.35);
}

.mini-link {
  border: 0;
  background: transparent;
  color: #93c5fd;
  font-size: 11px;
  cursor: pointer;
}

.mini-link:hover {
  color: #fff;
}

.dev-summary-list {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  display: grid;
  gap: 6px;
}

.dev-summary-list li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--bg-card);
  color: var(--txt-mute);
  font-size: 11.5px;
}

.dev-summary-list strong {
  color: #fff;
  font-weight: 500;
  text-align: right;
}

.dev-detail {
  margin-top: 6px;
  border: 1px solid var(--bd);
  border-radius: 7px;
  background: var(--bg-card);
}

.dev-detail summary {
  padding: 7px 9px;
  cursor: pointer;
  color: #bfdbfe;
  font-size: 11.5px;
}

.dev-detail pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 0 9px 9px;
  color: #dbeafe;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.dev-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 8px;
  background: var(--bg-card);
  color: var(--txt);
  border: 1px solid var(--bd);
  border-radius: 7px;
  font-size: 12px;
  cursor: pointer;
}

.ghost-btn:hover {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.4);
}

.ghost-btn.single {
  width: 100%;
  margin-top: 8px;
}

.explore-agent {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.explore-agent-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.explore-agent-head div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.explore-agent-head strong {
  color: #e0f2fe;
  font-size: 12px;
}

.explore-agent-head span {
  color: var(--txt-mute);
  font-size: 11px;
  line-height: 1.4;
}

.explore-agent-list {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.explore-agent-list li {
  padding: 7px 8px;
  border: 1px solid var(--bd);
  border-radius: 8px;
  background: var(--bg-card);
}

.explore-agent-list li.status-running {
  border-color: rgba(96, 165, 250, 0.45);
}

.explore-agent-list li.status-error {
  border-color: rgba(248, 113, 113, 0.45);
}

.case-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.case-row strong {
  color: #fff;
  font-size: 11.5px;
}

.case-row span {
  color: #93c5fd;
  font-size: 10.5px;
  text-align: right;
}

.explore-agent-list p {
  margin: 5px 0 3px;
  color: var(--txt);
  font-size: 11px;
  line-height: 1.45;
}

.explore-agent-list small {
  display: block;
  color: var(--txt-faint);
  font-size: 10.5px;
  line-height: 1.45;
}
</style>
