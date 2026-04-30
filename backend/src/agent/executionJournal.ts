import type { DeterministicIntent, ToolExecutionTrace } from '../chat/types.js'

export type AgentExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface AgentExecutionStep {
  id: string
  title: string
  detail: string
  status: AgentExecutionStepStatus
  startedAt: string | null
  finishedAt: string | null
}

export interface AgentExecutionEvent {
  kind: 'note' | 'tool' | 'verification'
  at: string
  message: string
  meta?: Record<string, unknown>
}

export interface AgentExecutionVerification {
  status: 'allow' | 'clarify' | 'degraded'
  reason: string
  answerGrounded: boolean
  evidenceCount: number
  toolCallCount: number
  answerSource: string | null
  needsUserFollowUp: boolean
}

export interface AgentExecutionJournal {
  version: 'v1'
  createdAt: string
  rawQuery: string
  queryType: DeterministicIntent['queryType']
  taskMode: 'query' | 'analysis'
  plannerSource: string
  recommendedTrack: string
  summary: string
  steps: AgentExecutionStep[]
  events: AgentExecutionEvent[]
  verification: AgentExecutionVerification | null
}

function buildQuerySummary(input: {
  intent: DeterministicIntent
  taskMode: 'query' | 'analysis'
  recommendedTrack: string
}) {
  const anchor = String(input.intent.placeName || '当前空间范围').trim()
  const target = String(input.intent.targetCategory || input.intent.categoryMain || input.intent.categorySub || '空间结果').trim()

  switch (input.intent.queryType) {
    case 'nearby_poi':
      return `围绕 ${anchor} 检索 ${target}，再校验候选结果是否足够支撑最终回答。`
    case 'nearest_station':
      return `围绕 ${anchor} 锁定最近地铁站与站口，再验证“最近”结论是否有足够证据。`
    case 'area_overview':
      return `针对 ${anchor} 做区域分析，先补结构证据，再整理区域主语、关键特征和热点结构。`
    case 'compare_places':
      return `比较多地点范围内的 ${target} 或空间结构差异，并验证对比口径是否一致。`
    case 'similar_regions':
      return `以 ${anchor} 为参照召回相似片区，并验证相似性依据是否成立。`
    case 'composite_recommendation':
      return `把用户问题拆成多阶段行程建议，分别取证后再合并输出。`
    default:
      return `${input.taskMode === 'analysis' ? '分析' : '查询'}用户问题，并在证据不足时诚实回退。`
  }
}

function buildExecutionSteps(input: {
  intent: DeterministicIntent
  needsWebSearch: boolean
}): AgentExecutionStep[] {
  const createStep = (id: string, title: string, detail: string): AgentExecutionStep => ({
    id,
    title,
    detail,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
  })

  if (input.intent.queryType === 'composite_recommendation') {
    return [
      createStep('decompose_request', '拆解用户复合需求', '把多阶段任务拆成可执行的阶段计划。'),
      createStep('resolve_stage_anchors', '定位阶段锚点', '分别锁定走廊起终点与后续目的地。'),
      createStep('collect_corridor_evidence', '收集中途证据', '获取走廊段的候选点位并做初筛。'),
      createStep('collect_destination_evidence', '收集目的地证据', '获取目的地周边的后续候选点位。'),
      createStep('synthesize_answer', '合并阶段结果', '把多阶段证据整理成一条顺路、可执行的建议。'),
      createStep('verify_answer', '验证最终输出', '检查答案是否与阶段证据和用户原意一致。'),
    ]
  }

  const base = [
    createStep('understand_request', '理解用户请求', '识别主任务、锚点、品类和约束条件。'),
    createStep('resolve_scope', '确定执行范围', '确认锚点、地图范围或用户位置，并准备好执行上下文。'),
    createStep('collect_evidence', '收集核心证据', '调用工具获取完成当前任务所需的主证据。'),
  ]

  if (input.intent.queryType === 'area_overview') {
    base.push(createStep('enrich_evidence', '补充分析证据', '补 AOI、用地、热点或语义证据，让区域判断更稳定。'))
  } else if (input.needsWebSearch) {
    base.push(createStep('enrich_evidence', '补充外部证据', '按需要补充联网或对齐证据，避免只凭本地样本下结论。'))
  }

  base.push(
    createStep('synthesize_answer', '组织最终回答', '将已验证证据整理成符合用户直觉的结果。'),
    createStep('verify_answer', '验证最终输出', '检查答案是否 grounded，是否需要诚实回退或澄清。'),
  )

  return base
}

export function createAgentExecutionJournal(input: {
  rawQuery: string
  intent: DeterministicIntent
  taskMode: 'query' | 'analysis'
  plannerSource: string
  recommendedTrack: string
  needsWebSearch: boolean
}): AgentExecutionJournal {
  return {
    version: 'v1',
    createdAt: new Date().toISOString(),
    rawQuery: input.rawQuery,
    queryType: input.intent.queryType,
    taskMode: input.taskMode,
    plannerSource: input.plannerSource,
    recommendedTrack: input.recommendedTrack,
    summary: buildQuerySummary({
      intent: input.intent,
      taskMode: input.taskMode,
      recommendedTrack: input.recommendedTrack,
    }),
    steps: buildExecutionSteps({
      intent: input.intent,
      needsWebSearch: input.needsWebSearch,
    }),
    events: [],
    verification: null,
  }
}

export function updateAgentExecutionStep(
  journal: AgentExecutionJournal | undefined,
  stepId: string,
  status: AgentExecutionStepStatus,
  detail?: string,
) {
  if (!journal) return

  const step = journal.steps.find((item) => item.id === stepId)
  if (!step) return

  const now = new Date().toISOString()
  step.status = status
  if (detail) {
    step.detail = detail
  }
  if (status === 'running' && !step.startedAt) {
    step.startedAt = now
  }
  if (['completed', 'failed', 'skipped'].includes(status)) {
    if (!step.startedAt) {
      step.startedAt = now
    }
    step.finishedAt = now
  }
}

export function appendAgentExecutionEvent(
  journal: AgentExecutionJournal | undefined,
  kind: AgentExecutionEvent['kind'],
  message: string,
  meta?: Record<string, unknown>,
) {
  if (!journal) return

  journal.events.push({
    kind,
    at: new Date().toISOString(),
    message,
    ...(meta ? { meta } : {}),
  })
}

export function appendToolTraceEvent(
  journal: AgentExecutionJournal | undefined,
  trace: ToolExecutionTrace,
) {
  appendAgentExecutionEvent(
    journal,
    'tool',
    `${trace.skill}.${trace.action} -> ${trace.status}`,
    {
      skill: trace.skill,
      action: trace.action,
      status: trace.status,
      error: trace.error || null,
      latencyMs: trace.latency_ms,
    },
  )
}

export function finalizeAgentExecutionJournal(
  journal: AgentExecutionJournal | undefined,
  input: {
    verificationStatus: 'allow' | 'clarify' | 'degraded'
    verificationReason: string
    answerGrounded: boolean
    evidenceCount: number
    toolCallCount: number
    answerSource?: string | null
  },
) {
  if (!journal) return

  journal.verification = {
    status: input.verificationStatus,
    reason: input.verificationReason,
    answerGrounded: input.answerGrounded,
    evidenceCount: input.evidenceCount,
    toolCallCount: input.toolCallCount,
    answerSource: input.answerSource || null,
    needsUserFollowUp: input.verificationStatus !== 'allow',
  }
  updateAgentExecutionStep(
    journal,
    'verify_answer',
    'completed',
    `验证结果：${input.verificationStatus}/${input.verificationReason}，证据 ${input.evidenceCount} 条，工具调用 ${input.toolCallCount} 次。`,
  )
  appendAgentExecutionEvent(
    journal,
    'verification',
    `verification=${input.verificationStatus}/${input.verificationReason}`,
    {
      answerGrounded: input.answerGrounded,
      evidenceCount: input.evidenceCount,
      toolCallCount: input.toolCallCount,
      answerSource: input.answerSource || null,
    },
  )
}

export function toAgentExecutionLogPayload(journal: AgentExecutionJournal | undefined) {
  if (!journal) return null

  return {
    version: journal.version,
    createdAt: journal.createdAt,
    rawQuery: journal.rawQuery,
    queryType: journal.queryType,
    taskMode: journal.taskMode,
    plannerSource: journal.plannerSource,
    recommendedTrack: journal.recommendedTrack,
    summary: journal.summary,
    steps: journal.steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: step.status,
      detail: step.detail,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    })),
    verification: journal.verification,
    events: journal.events,
  }
}
