<template>
  <div class="v2-trace-mode">
    <div class="trace-backdrop"></div>
    <div class="trace-grid"></div>

    <main class="trace-layout">
      <V2AgentTracePanel :snapshot="traceSession" :job="jobPayload" />

      <section v-if="emptyState" class="empty-shell">
        <h2>暂无 V2 链路数据</h2>
        <p>请先在首页切换到 V2，然后发起一次真实分析任务。这里不会显示任何模拟链路。</p>
        <button class="return-btn" type="button" @click="goHome">返回主页</button>
      </section>

      <template v-else>
        <V2AgentTraceTimeline :events="traceEvents" />
        <V2JobInspector
          :control-plane="controlPlane"
          :quota="quotaSnapshot"
          :audit-retention="auditRetention"
          @refresh="() => refreshAll({ includeReports: true })"
          @prune-audit="handlePruneAudit"
        />
        <V2AuditTrailPanel
          :events="auditEvents"
          :filters="auditFilters"
          @update:filters="handleAuditFiltersUpdate"
          @refresh="refreshAudit"
        />
        <V2ReleaseReportPanel
          :summary-report="latestSummaryReport"
          :release-markdown="latestReleaseMarkdown"
          :history="summaryReportHistory"
          :selected-file-name="selectedReportFileName"
          @select-report="handleSelectReport"
        />
      </template>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import V2AgentTracePanel from '../components/v2/V2AgentTracePanel.vue'
import V2AgentTraceTimeline from '../components/v2/V2AgentTraceTimeline.vue'
import V2AuditTrailPanel from '../components/v2/V2AuditTrailPanel.vue'
import V2JobInspector from '../components/v2/V2JobInspector.vue'
import V2ReleaseReportPanel from '../components/v2/V2ReleaseReportPanel.vue'
import {
  getV2AuditEvents,
  getV2AuditRetention,
  getV2ControlPlane,
  getV2Job,
  getV2LatestReleaseMarkdown,
  getV2LatestSummaryReport,
  getV2QuotaSnapshot,
  getV2ReleaseMarkdownByFile,
  getV2SummaryReportByFile,
  getV2SummaryReportHistory,
  pruneV2AuditRetention
} from '../utils/aiService'
import { readV2TraceSession } from '../utils/v2TraceSession'

const router = useRouter()
const traceSession = ref(readV2TraceSession())
const jobPayload = ref(null)
const controlPlane = ref(null)
const auditEvents = ref([])
const quotaSnapshot = ref(null)
const auditRetention = ref(null)
const auditFilters = ref({
  trace_id: '',
  job_id: '',
  session_id: '',
  tenant_id: '',
  user_id: '',
  event: ''
})
const summaryReportHistory = ref([])
const selectedReportFileName = ref('')
const latestSummaryReport = ref(null)
const latestReleaseMarkdown = ref(null)
const pollTimer = ref(null)

const emptyState = computed(() => !traceSession.value?.job_id && !(traceSession.value?.events?.length > 0))
const traceEvents = computed(() => Array.isArray(traceSession.value?.events) ? traceSession.value.events : [])

function goHome() {
  router.push('/')
}

function stopPolling() {
  if (pollTimer.value) {
    window.clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

async function refreshControlPlane() {
  try {
    controlPlane.value = await getV2ControlPlane()
  } catch {
    controlPlane.value = null
  }
}

async function refreshGovernance() {
  traceSession.value = readV2TraceSession()
  try {
    quotaSnapshot.value = await getV2QuotaSnapshot({
      session_id: traceSession.value?.session_id
    })
  } catch {
    quotaSnapshot.value = null
  }

  try {
    auditRetention.value = await getV2AuditRetention()
  } catch {
    auditRetention.value = null
  }
}

async function refreshReports() {
  try {
    summaryReportHistory.value = (await getV2SummaryReportHistory({ limit: 20 })).items || []
  } catch {
    summaryReportHistory.value = []
  }

  try {
    if (!selectedReportFileName.value) {
      const latest = await getV2LatestSummaryReport()
      latestSummaryReport.value = latest
      selectedReportFileName.value = latest?.file_name || ''
    } else {
      latestSummaryReport.value = await getV2SummaryReportByFile(selectedReportFileName.value)
    }
  } catch {
    latestSummaryReport.value = null
  }

  try {
    if (!selectedReportFileName.value) {
      latestReleaseMarkdown.value = await getV2LatestReleaseMarkdown()
    } else {
      latestReleaseMarkdown.value = await getV2ReleaseMarkdownByFile(selectedReportFileName.value)
    }
  } catch {
    latestReleaseMarkdown.value = null
  }
}

async function refreshAudit() {
  traceSession.value = readV2TraceSession()
  const resolvedFilters = {
    ...auditFilters.value
  }
  if (!resolvedFilters.trace_id) {
    resolvedFilters.trace_id = traceSession.value?.trace_id || ''
  }
  if (!resolvedFilters.job_id) {
    resolvedFilters.job_id = traceSession.value?.job_id || ''
  }
  if (!resolvedFilters.session_id) {
    resolvedFilters.session_id = traceSession.value?.session_id || ''
  }
  try {
    const payload = await getV2AuditEvents({ ...resolvedFilters, limit: 80 })
    auditEvents.value = Array.isArray(payload?.items) ? payload.items : []
  } catch {
    auditEvents.value = []
  }
}

async function refreshJob() {
  traceSession.value = readV2TraceSession()
  const jobId = traceSession.value?.job_id
  if (!jobId) {
    jobPayload.value = null
    return
  }

  try {
    jobPayload.value = await getV2Job(jobId)
  } catch {
    jobPayload.value = null
  }
}

async function refreshAll({ includeReports = false } = {}) {
  const tasks = [
    refreshJob(),
    refreshControlPlane(),
    refreshAudit(),
    refreshGovernance()
  ]

  if (includeReports) {
    tasks.push(refreshReports())
  }

  await Promise.all(tasks)
}

function handleAuditFiltersUpdate(nextFilters) {
  auditFilters.value = {
    ...auditFilters.value,
    ...nextFilters
  }
}

async function handleSelectReport(fileName) {
  selectedReportFileName.value = fileName
  await refreshReports()
}

async function handlePruneAudit() {
  await pruneV2AuditRetention()
  await Promise.all([
    refreshGovernance(),
    refreshAudit()
  ])
}

function startPolling() {
  stopPolling()
  pollTimer.value = window.setInterval(() => {
    void refreshAll()
  }, 2500)
}

onMounted(async () => {
  await refreshAll({ includeReports: true })
  startPolling()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap');

.v2-trace-mode {
  --bg-1: #061018;
  --bg-2: #0b1a25;
  --bg-3: #0d2431;
  --line: rgba(173, 214, 220, 0.12);
  --teal: #5de4d7;
  --amber: #ffcf70;
  --ink: #f4fbff;
  position: relative;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background:
    radial-gradient(circle at 12% 10%, rgba(93, 228, 215, 0.12), transparent 34%),
    radial-gradient(circle at 86% 14%, rgba(255, 207, 112, 0.12), transparent 28%),
    linear-gradient(180deg, var(--bg-1), var(--bg-2) 55%, var(--bg-3));
  color: var(--ink);
  font-family: 'Space Grotesk', 'Noto Sans SC', sans-serif;
}

.trace-backdrop {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(circle at 50% 0%, rgba(93, 228, 215, 0.05), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 25%);
  pointer-events: none;
}

.trace-grid {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(circle at 50% 35%, black 0%, transparent 74%);
  pointer-events: none;
}

.trace-layout {
  position: relative;
  z-index: 1;
  width: min(1220px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 44px 0 72px;
  display: grid;
  gap: 22px;
}

.empty-shell {
  padding: 32px;
  border-radius: 24px;
  border: 1px solid var(--line);
  background: rgba(7, 18, 27, 0.76);
}

.empty-shell h2 {
  margin: 0 0 10px;
  font-size: 28px;
}

.empty-shell p {
  margin: 0 0 18px;
  max-width: 720px;
  line-height: 1.7;
  color: rgba(226, 241, 244, 0.82);
}

.return-btn {
  border: 1px solid rgba(173, 214, 220, 0.2);
  border-radius: 999px;
  background: rgba(15, 63, 73, 0.56);
  color: #eafdfb;
  padding: 10px 14px;
  font-size: 13px;
  cursor: pointer;
}

@media (max-width: 900px) {
  .trace-layout {
    width: min(100vw - 24px, 100%);
    padding-top: 28px;
  }
}
</style>
