import { normalizeRefinedResultEvidence } from './refinedResultEvidence.js'

function createEventRecord(event, payload) {
  return {
    event,
    payload,
    recordedAt: new Date().toISOString(),
  }
}

export function createAssistantRun(prompt) {
  return {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    answer: '',
    trace: null,
    job: null,
    currentStage: 'pending',
    thinking: '',
    intentPreview: null,
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
    error: null,
  }
}

export function applyStreamEvent(run, event, payload) {
  const next = {
    ...run,
    events: [...run.events, createEventRecord(event, payload)].slice(-24),
  }

  switch (event) {
    case 'trace':
      next.trace = payload
      next.degradedDependencies = Array.isArray(payload?.degraded_dependencies) ? payload.degraded_dependencies : next.degradedDependencies
      break
    case 'job':
      next.job = payload
      break
    case 'stage':
      next.currentStage = payload?.name || next.currentStage
      break
    case 'thinking':
      next.thinking = payload?.message || payload?.status || next.thinking
      break
    case 'intent_preview':
      next.intentPreview = payload
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
      next.stats = payload
      break
    case 'refined_result': {
      const normalized = normalizeRefinedResultEvidence(payload)
      next.refinedResult = payload
      next.answer = String(payload?.answer || '').trim()
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
    case 'error':
      next.error = String(payload?.message || 'Unknown stream error')
      next.complete = true
      break
    default:
      break
  }

  return next
}
