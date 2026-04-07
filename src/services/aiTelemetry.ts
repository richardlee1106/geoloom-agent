import { AI_API_BASE_URL } from '../config'

type PlainObject = Record<string, unknown>

export interface TemplateWeightsSnapshot {
  version: string
  loadedAt: number
  weights: Record<string, unknown>
}

export interface TemplateWeightRefreshOptions {
  ttlMs?: unknown
  force?: boolean
}

export interface NormalizedIntentMeta {
  intentMode: string | null
  queryType: string | null
  queryPlan: unknown
}

export interface TemplateFeedbackPayload extends PlainObject {
  traceId?: unknown
  trace_id?: unknown
  templateId?: unknown
  template_id?: unknown
  intentMeta?: unknown
  intent_meta?: unknown
  ts?: unknown
  extra?: unknown
  source?: unknown
}

interface CachedWeightsState {
  version: string
  loadedAt: number
  weights: Record<string, unknown>
}

const IS_V4_MODE = String(import.meta.env.VITE_BACKEND_VERSION || import.meta.env.MODE || '').toLowerCase() === 'v4'
const AI_API_BASE = `${AI_API_BASE_URL}/api/ai`
const WEIGHT_CACHE_KEY = 'ai_template_weights_v1'

let cachedWeights: CachedWeightsState = {
  version: 'local-default',
  loadedAt: 0,
  weights: {}
}

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toWeightMap(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function nowTs(): number {
  return Date.now()
}

function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `session_${Date.now()}_${random}`
}

let sessionId = createSessionId()

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function normalizeIntentMeta(intentMeta: unknown = null): NormalizedIntentMeta | null {
  if (!isPlainObject(intentMeta)) return null
  return {
    intentMode: String(intentMeta.intentMode || intentMeta.intent_mode || '').trim() || null,
    queryType: String(intentMeta.queryType || intentMeta.query_type || '').trim() || null,
    queryPlan: intentMeta.queryPlan || intentMeta.query_plan || null
  }
}

function loadWeightsFromStorage(): void {
  const raw = safeStorageGet(WEIGHT_CACHE_KEY)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return
    cachedWeights = {
      version: String(parsed.version || 'local-storage'),
      loadedAt: Number(parsed.loadedAt || 0),
      weights: toWeightMap(parsed.weights)
    }
  } catch {
    // ignore
  }
}

loadWeightsFromStorage()

export function getTelemetrySessionId(): string {
  return sessionId
}

export function resetTelemetrySessionId(): string {
  sessionId = createSessionId()
  return sessionId
}

export function getTemplateWeightsSnapshot(): TemplateWeightsSnapshot {
  return {
    version: cachedWeights.version,
    loadedAt: cachedWeights.loadedAt,
    weights: { ...cachedWeights.weights }
  }
}

export function getTemplateWeight(templateId: string): number {
  const value = Number(cachedWeights.weights?.[templateId])
  return Number.isFinite(value) ? value : 1
}

export async function refreshTemplateWeights(options: TemplateWeightRefreshOptions = {}): Promise<TemplateWeightsSnapshot> {
  if (IS_V4_MODE) {
    return getTemplateWeightsSnapshot()
  }

  const ttlMs = Math.max(5_000, Number(options.ttlMs || 60_000))
  const force = options.force === true

  if (!force && cachedWeights.loadedAt > 0 && nowTs() - cachedWeights.loadedAt < ttlMs) {
    return getTemplateWeightsSnapshot()
  }

  try {
    const response = await fetch(`${AI_API_BASE}/template-feedback/weights`)
    if (!response.ok) {
      return getTemplateWeightsSnapshot()
    }

    const payload = await response.json()
    const safePayload = isPlainObject(payload) ? payload : {}
    cachedWeights = {
      version: String(safePayload.version || 'server'),
      loadedAt: nowTs(),
      weights: toWeightMap(safePayload.weights)
    }

    safeStorageSet(WEIGHT_CACHE_KEY, JSON.stringify(cachedWeights))
  } catch {
    // 网络不可达或网关错误时静默降级到本地权重
  }

  return getTemplateWeightsSnapshot()
}

export async function sendTemplateFeedback(eventType: string, payload: TemplateFeedbackPayload = {}): Promise<boolean> {
  if (IS_V4_MODE) return false

  const traceId = payload.traceId || payload.trace_id || ''
  if (!traceId) return false

  const extra = isPlainObject(payload.extra) ? payload.extra : {}
  const body = {
    trace_id: String(traceId),
    event_type: eventType,
    template_id: payload.templateId || payload.template_id || null,
    intent_meta: normalizeIntentMeta(payload.intentMeta || payload.intent_meta || null),
    ts: payload.ts || nowTs(),
    extra: {
      ...extra,
      session_id: sessionId,
      source: payload.source || 'ai-panel'
    }
  }

  try {
    const response = await fetch(`${AI_API_BASE}/template-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    return response.ok
  } catch {
    return false
  }
}

export function trackTemplateImpression(payload: TemplateFeedbackPayload): Promise<boolean> {
  return sendTemplateFeedback('template_impression', payload)
}

export function trackTemplateClick(payload: TemplateFeedbackPayload): Promise<boolean> {
  return sendTemplateFeedback('template_click', payload)
}

export function trackLocateClick(payload: TemplateFeedbackPayload): Promise<boolean> {
  return sendTemplateFeedback('locate_click', payload)
}

export function trackFollowupClick(payload: TemplateFeedbackPayload): Promise<boolean> {
  return sendTemplateFeedback('followup_click', payload)
}

export function trackSessionOutcome(payload: TemplateFeedbackPayload): Promise<boolean> {
  return sendTemplateFeedback('session_outcome', payload)
}

const aiTelemetry = {
  getTelemetrySessionId,
  resetTelemetrySessionId,
  getTemplateWeightsSnapshot,
  getTemplateWeight,
  refreshTemplateWeights,
  sendTemplateFeedback,
  trackTemplateImpression,
  trackTemplateClick,
  trackLocateClick,
  trackFollowupClick,
  trackSessionOutcome
}

export default aiTelemetry
