import {
  normalizeRefinedResultEvidence,
  type IntentMeta
} from './refinedResultEvidence'

type PlainObject = Record<string, unknown>

export interface StreamEventRecord {
  event: string
  payload: unknown
  recordedAt: string
}

export interface AssistantRun {
  id: string
  prompt: string
  answer: string
  trace: unknown
  job: unknown
  currentStage: string
  thinking: string
  intentPreview: unknown
  webSearch: unknown
  entityAlignment: unknown
  pois: unknown[]
  boundary: unknown
  spatialClusters: unknown
  vernacularRegions: unknown[]
  fuzzyRegions: unknown[]
  stats: PlainObject | null
  toolCalls: unknown[]
  refinedResult: unknown
  evidenceView: PlainObject | null
  intent: IntentMeta | null
  degradedDependencies: string[]
  events: StreamEventRecord[]
  complete: boolean
  error: string | null
}

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function createEventRecord(event: string, payload: unknown): StreamEventRecord {
  return {
    event,
    payload,
    recordedAt: new Date().toISOString()
  }
}

export function createAssistantRun(prompt: string): AssistantRun {
  return {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    answer: '',
    trace: null,
    job: null,
    currentStage: 'pending',
    thinking: '',
    intentPreview: null,
    webSearch: null,
    entityAlignment: null,
    pois: [],
    boundary: null,
    spatialClusters: null,
    vernacularRegions: [],
    fuzzyRegions: [],
    stats: null,
    toolCalls: [],
    refinedResult: null,
    evidenceView: null,
    intent: null,
    degradedDependencies: [],
    events: [],
    complete: false,
    error: null
  }
}

export function applyStreamEvent(run: AssistantRun, event: string, payload: unknown): AssistantRun {
  const next: AssistantRun = {
    ...run,
    events: [...run.events, createEventRecord(event, payload)].slice(-24)
  }

  switch (event) {
    case 'trace': {
      const tracePayload = asPlainObject(payload)
      next.trace = payload
      if (Array.isArray(tracePayload.degraded_dependencies)) {
        next.degradedDependencies = toStringList(tracePayload.degraded_dependencies)
      }
      break
    }
    case 'job':
      next.job = payload
      break
    case 'stage': {
      const stagePayload = asPlainObject(payload)
      next.currentStage = String(stagePayload.name || next.currentStage)
      break
    }
    case 'thinking': {
      const thinkingPayload = asPlainObject(payload)
      const nextThinking = String(thinkingPayload.message || thinkingPayload.status || '').trim()
      next.thinking = nextThinking || next.thinking
      break
    }
    case 'intent_preview':
      next.intentPreview = payload
      break
    case 'web_search':
      next.webSearch = payload
      break
    case 'entity_alignment':
      next.entityAlignment = payload
      break
    case 'pois':
      next.pois = Array.isArray(payload) ? payload : []
      break
    case 'boundary':
      next.boundary = payload
      break
    case 'spatial_clusters':
      next.spatialClusters = payload
      break
    case 'vernacular_regions':
      next.vernacularRegions = Array.isArray(payload) ? payload : []
      break
    case 'fuzzy_regions':
      next.fuzzyRegions = Array.isArray(payload) ? payload : []
      break
    case 'stats':
      next.stats = asPlainObject(payload)
      break
    case 'refined_result': {
      const normalized = normalizeRefinedResultEvidence(payload)
      const refinedResultPayload = asPlainObject(payload)
      next.refinedResult = payload
      next.answer = String(refinedResultPayload.answer || '').trim()
      next.toolCalls = normalized.toolCalls
      next.boundary = normalized.boundary
      next.spatialClusters = normalized.spatialClusters
      next.vernacularRegions = normalized.vernacularRegions
      next.fuzzyRegions = normalized.fuzzyRegions
      next.stats = normalized.stats
      next.evidenceView = normalized.evidenceView
      next.intent = normalized.intent
      break
    }
    case 'done':
      next.complete = true
      break
    case 'error': {
      const errorPayload = asPlainObject(payload)
      next.error = String(errorPayload.message || 'Unknown stream error')
      next.complete = true
      break
    }
    default:
      break
  }

  return next
}
