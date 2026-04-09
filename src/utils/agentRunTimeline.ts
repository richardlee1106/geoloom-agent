import { getAgentStageSteps, normalizeAgentStage } from './agentStageConfig'

type PlainObject = Record<string, unknown>

export type AgentTimelineState = 'info' | 'running' | 'success' | 'warning' | 'error'
export type AgentTimelineKind = 'status' | 'tool' | 'artifact' | 'warning'

export interface AgentTimelineEvent {
  id: string
  type: string
  kind: AgentTimelineKind
  state: AgentTimelineState
  title: string
  detail: string
  timestamp: number
  timeLabel: string
  meta?: PlainObject | null
}

export interface AgentRunSummary {
  tone: 'idle' | 'running' | 'success' | 'warning' | 'error'
  label: string
  detail: string
  eventCount: number
  toolCount: number
}

export interface AgentRunSnapshot {
  summary: AgentRunSummary
  timeline: AgentTimelineEvent[]
}

type AssistantMessageLike = PlainObject & {
  agentEvents?: unknown[]
  toolCalls?: unknown[]
  toolCallsRecordedAt?: unknown
  isStreaming?: boolean
  isThinking?: boolean
  pipelineCompleted?: boolean
  error?: boolean
  schemaWarning?: PlainObject | null
}

const STAGE_MAP = new Map(
  getAgentStageSteps().map((step) => [step.key, step])
)

function asPlainObject(value: unknown): PlainObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function pickString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = String(candidate || '').trim()
    if (text) return text
  }
  return ''
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeState(value: unknown, fallback: AgentTimelineState = 'info'): AgentTimelineState {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return fallback

  if (['done', 'ok', 'success', 'completed', 'complete'].includes(normalized)) return 'success'
  if (['warning', 'warn', 'degraded'].includes(normalized)) return 'warning'
  if (['error', 'failed', 'fail'].includes(normalized)) return 'error'
  if (['running', 'pending', 'planned', 'start', 'started', 'loading'].includes(normalized)) return 'running'
  return fallback
}

function toTone(state: AgentTimelineState): AgentRunSummary['tone'] {
  if (state === 'running') return 'running'
  if (state === 'success') return 'success'
  if (state === 'warning') return 'warning'
  if (state === 'error') return 'error'
  return 'idle'
}

function formatTimeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--:--'
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function createEventRecord({
  id,
  type,
  kind = 'status',
  state = 'info',
  title,
  detail = '',
  timestamp = Date.now(),
  meta = null,
}: {
  id?: string
  type: string
  kind?: AgentTimelineKind
  state?: AgentTimelineState
  title: string
  detail?: string
  timestamp?: number
  meta?: PlainObject | null
}): AgentTimelineEvent {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now()
  return {
    id: id || `${type}_${safeTimestamp}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    kind,
    state,
    title,
    detail,
    timestamp: safeTimestamp,
    timeLabel: formatTimeLabel(safeTimestamp),
    meta,
  }
}

function buildIntentPreviewDetail(payload: PlainObject): string {
  const parts = [
    pickString(payload.displayAnchor, payload.place_name),
    pickString(payload.targetCategory, payload.poi_sub_type),
    pickString(payload.spatialRelation),
  ].filter(Boolean)

  const confidence = toFiniteNumber(payload.confidence)
  if (confidence !== null) {
    const normalized = confidence <= 1 ? confidence : confidence / 100
    parts.push(`置信 ${Math.round(normalized * 100)}%`)
  }

  const clarificationHint = pickString(payload.clarificationHint)
  if (clarificationHint) {
    parts.push(clarificationHint)
  }

  return parts.join(' · ')
}

function buildStatsDetail(payload: PlainObject): string {
  const modelTiming = asPlainObject(payload.model_timing_ms)
  const vlmMs = toFiniteNumber(modelTiming.vlm_ms)
  const llmMs = toFiniteNumber(modelTiming.llm_ms)
  const wallMs = toFiniteNumber(modelTiming.parallel_wall_ms)
  const parts = []

  if (vlmMs !== null) parts.push(`VLM ${Math.round(vlmMs)} ms`)
  if (llmMs !== null) parts.push(`LLM ${Math.round(llmMs)} ms`)
  if (wallMs !== null) parts.push(`Wall ${Math.round(wallMs)} ms`)

  return parts.join(' · ')
}

function buildRefinedResultDetail(payload: PlainObject): string {
  const root = asPlainObject(payload)
  const results = asPlainObject(root.results)
  const toolCalls = asArray(root.tool_calls).length
    || asArray(root.toolCalls).length
    || asArray(results.tool_calls).length
    || asArray(results.toolCalls).length

  if (toolCalls > 0) {
    return `已整合 ${toolCalls} 次工具调用与结构化证据`
  }

  return '已生成最终回答与结构化证据'
}

export function buildAgentEventRecord(type: string, payload: unknown = {}, timestamp = Date.now()): AgentTimelineEvent | null {
  const safeType = String(type || '').trim()
  if (!safeType) return null

  const data = asPlainObject(payload)

  if (safeType === 'queued') {
    return createEventRecord({
      type: safeType,
      state: 'info',
      title: '已接收问题',
      detail: pickString(data.message) || '开始准备当前轮分析',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'trace') {
    const traceId = pickString(data.trace_id, data.traceId, data.request_id, data.requestId)
    const degraded = asArray(data.degraded_dependencies).map((item) => String(item || '').trim()).filter(Boolean)
    const detailParts = []
    if (traceId) detailParts.push(`Trace ${traceId}`)
    if (degraded.length > 0) detailParts.push(`降级依赖：${degraded.join(' / ')}`)
    return createEventRecord({
      type: safeType,
      state: 'info',
      title: '建立运行追踪',
      detail: detailParts.join(' · '),
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'thinking') {
    const status = String(data.status || '').trim().toLowerCase()
    return createEventRecord({
      type: safeType,
      state: status === 'end' ? 'success' : 'running',
      title: status === 'end' ? '结束思考' : '开始思考',
      detail: pickString(data.message) || (status === 'end' ? '模型完成内部推理' : '模型开始拆解问题'),
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'reasoning') {
    const detail = pickString(data.content, data.message)
    if (!detail) return null
    return createEventRecord({
      type: safeType,
      state: 'running',
      title: '推理片段',
      detail,
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'intent_preview') {
    return createEventRecord({
      type: safeType,
      state: data.needsClarification === true ? 'warning' : 'success',
      title: '识别问题',
      detail: buildIntentPreviewDetail(data),
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'stage') {
    const normalizedStage = normalizeAgentStage(data.name || payload)
    const step = STAGE_MAP.get(normalizedStage)
    return createEventRecord({
      type: safeType,
      state: 'running',
      title: step?.label || pickString(data.name, payload) || '推进分析阶段',
      detail: step?.helper || step?.hint || '',
      timestamp,
      meta: { ...data, normalizedStage },
    })
  }

  if (safeType === 'pois') {
    const count = asArray(payload).length
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '召回候选 POI',
      detail: count > 0 ? `已载入 ${count} 个候选对象` : '未召回到候选对象',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'partial') {
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '生成边界预览',
      detail: pickString(data.source) || '地图已先行更新预览边界',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'boundary') {
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '锁定分析范围',
      detail: '最终空间边界已经回传',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'spatial_clusters') {
    const hotspotCount = asArray(data.hotspots).length
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '识别活力热点',
      detail: hotspotCount > 0 ? `发现 ${hotspotCount} 个热点` : '未形成明显热点',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'vernacular_regions') {
    const count = asArray(payload).length
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '抽取语义片区',
      detail: count > 0 ? `命中 ${count} 个语义片区` : '未抽取到稳定语义片区',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'fuzzy_regions') {
    const count = asArray(payload).length
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'warning',
      title: '识别模糊过渡区',
      detail: count > 0 ? `发现 ${count} 个边界模糊区` : '未发现明显模糊边界',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'stats') {
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '汇总统计信号',
      detail: buildStatsDetail(data) || '统计指标已经回传',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'progress') {
    return createEventRecord({
      type: safeType,
      state: 'running',
      title: '更新执行进度',
      detail: pickString(data.progress, data.message) || '执行进度已刷新',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'refined_result') {
    return createEventRecord({
      type: safeType,
      kind: 'artifact',
      state: 'success',
      title: '汇总证据并生成回答',
      detail: buildRefinedResultDetail(data),
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'schema_error') {
    return createEventRecord({
      type: safeType,
      kind: 'warning',
      state: 'warning',
      title: '收到异常输出',
      detail: asArray(data.errors).slice(0, 2).map((item) => String(item || '')).filter(Boolean).join('；') || '输出结构需要复核',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'error') {
    return createEventRecord({
      type: safeType,
      kind: 'warning',
      state: 'error',
      title: '请求失败',
      detail: pickString(data.message) || '本轮请求未成功完成',
      timestamp,
      meta: data,
    })
  }

  if (safeType === 'finalize') {
    const succeeded = data.requestSucceeded === true
    return createEventRecord({
      type: safeType,
      state: succeeded ? 'success' : 'error',
      title: succeeded ? '回答完成' : '回答未完成',
      detail: pickString(data.message) || (succeeded ? '本轮回答已结束' : '请求已中断'),
      timestamp,
      meta: data,
    })
  }

  return createEventRecord({
    type: safeType,
    state: 'info',
    title: safeType,
    detail: pickString(data.message),
    timestamp,
    meta: data,
  })
}

export function appendAgentEventToMessage(
  message: PlainObject | null | undefined,
  type: string,
  payload: unknown = {},
  options: { timestamp?: number; allowDuplicate?: boolean } = {}
): AgentTimelineEvent | null {
  if (!message || typeof message !== 'object') return null

  const event = buildAgentEventRecord(type, payload, options.timestamp)
  if (!event) return null

  const currentEvents = asArray<AgentTimelineEvent>(message.agentEvents)
  const previous = currentEvents[currentEvents.length - 1]
  const allowDuplicate = options.allowDuplicate === true

  if (
    !allowDuplicate &&
    previous &&
    previous.type === event.type &&
    previous.title === event.title &&
    previous.detail === event.detail &&
    previous.state === event.state
  ) {
    return previous
  }

  message.agentEvents = [...currentEvents, event].slice(-40)
  return event
}

function normalizeToolCallStatus(status: unknown): AgentTimelineState {
  return normalizeState(status, 'success')
}

function buildToolCallDetail(call: PlainObject): string {
  const latencyMs = toFiniteNumber(call.latency_ms ?? call.latencyMs)
  const parts = []

  if (latencyMs !== null) {
    parts.push(`${Math.round(latencyMs)} ms`)
  }

  const provider = pickString(call.provider)
  if (provider) {
    parts.push(provider)
  }

  const note = pickString(call.note, call.summary, call.message)
  if (note) {
    parts.push(note)
  }

  return parts.join(' · ')
}

function normalizeToolCallEvent(call: unknown, index: number, fallbackTimestamp: number): AgentTimelineEvent {
  const payload = asPlainObject(call)
  const skill = pickString(payload.skill, payload.tool, payload.name) || 'tool'
  const action = pickString(payload.action, payload.operation, payload.method, payload.function) || 'run'
  const timestamp = toFiniteNumber(payload.timestamp) ?? (fallbackTimestamp + index)

  return createEventRecord({
    id: pickString(payload.id) || `tool_${index}_${timestamp}`,
    type: 'tool_call',
    kind: 'tool',
    state: normalizeToolCallStatus(payload.status),
    title: `${skill}.${action}`,
    detail: buildToolCallDetail(payload),
    timestamp,
    meta: payload,
  })
}

export function syncToolCallsToMessage(
  message: PlainObject | null | undefined,
  toolCalls: unknown,
  timestamp = Date.now()
): void {
  if (!message || typeof message !== 'object') return
  message.toolCalls = asArray(toolCalls)
  message.toolCallsRecordedAt = timestamp
}

function normalizeStoredEvent(item: unknown): AgentTimelineEvent | null {
  const event = asPlainObject(item)
  const title = pickString(event.title)
  const type = pickString(event.type)
  if (!title || !type) return null

  return createEventRecord({
    id: pickString(event.id) || undefined,
    type,
    kind: (['status', 'tool', 'artifact', 'warning'].includes(String(event.kind || ''))
      ? event.kind
      : 'status') as AgentTimelineKind,
    state: normalizeState(event.state),
    title,
    detail: pickString(event.detail),
    timestamp: toFiniteNumber(event.timestamp) ?? Date.now(),
    meta: asPlainObject(event.meta),
  })
}

function buildSummary(message: AssistantMessageLike, timeline: AgentTimelineEvent[], toolCount: number): AgentRunSummary {
  const eventCount = timeline.length
  const hasSchemaWarning = Boolean(asArray(message.schemaWarning?.errors).length > 0)

  if (message.error === true) {
    return {
      tone: 'error',
      label: '本轮未完成',
      detail: eventCount > 0 ? `已记录 ${eventCount} 条过程，最后一次请求失败。` : '请求在返回结果前终止了。',
      eventCount,
      toolCount,
    }
  }

  if (message.pipelineCompleted === true) {
    return {
      tone: hasSchemaWarning ? 'warning' : 'success',
      label: hasSchemaWarning ? '结果待核验' : '已完成分析',
      detail: `已记录 ${eventCount} 条过程${toolCount > 0 ? `，调用 ${toolCount} 个工具` : ''}。`,
      eventCount,
      toolCount,
    }
  }

  if (message.isStreaming === true || message.isThinking === true) {
    return {
      tone: 'running',
      label: '正在运行',
      detail: eventCount > 0
        ? `已记录 ${eventCount} 条过程${toolCount > 0 ? `，其中 ${toolCount} 条来自工具调用` : ''}，过程记录会持续更新。`
        : '过程记录会持续更新。',
      eventCount,
      toolCount,
    }
  }

  if (hasSchemaWarning) {
    return {
      tone: 'warning',
      label: '结果待核验',
      detail: '收到结构异常，建议结合过程记录一起查看。',
      eventCount,
      toolCount,
    }
  }

  return {
    tone: 'idle',
    label: '等待开始',
    detail: '当前还没有可展示的运行记录。',
    eventCount,
    toolCount,
  }
}

export function buildAgentRunSnapshot(message: AssistantMessageLike | null | undefined): AgentRunSnapshot {
  const safeMessage = asPlainObject(message) as AssistantMessageLike
  const storedEvents = asArray(safeMessage.agentEvents)
    .map((item) => normalizeStoredEvent(item))
    .filter(Boolean) as AgentTimelineEvent[]
  const toolCalls = asArray(safeMessage.toolCalls)
  const toolCallsRecordedAt = toFiniteNumber(safeMessage.toolCallsRecordedAt) ?? Date.now()
  const toolEvents = toolCalls.map((call, index) => normalizeToolCallEvent(call, index, toolCallsRecordedAt))

  const timeline = [...storedEvents, ...toolEvents]
    .sort((left, right) => left.timestamp - right.timestamp)

  return {
    summary: buildSummary(safeMessage, timeline, toolEvents.length),
    timeline,
  }
}
