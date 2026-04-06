import { AI_API_BASE_URL } from '../config'

const IS_V4_MODE = String(import.meta.env.VITE_BACKEND_VERSION || import.meta.env.MODE || '').toLowerCase() === 'v4'
const AI_API_BASE = `${AI_API_BASE_URL}/api/ai`
const WEIGHT_CACHE_KEY = 'ai_template_weights_v1'

let cachedWeights = {
  version: 'local-default',
  loadedAt: 0,
  weights: {}
}

function nowTs() {
  return Date.now()
}

function createSessionId() {
  const random = Math.random().toString(36).slice(2, 10)
  return `session_${Date.now()}_${random}`
}

let sessionId = createSessionId()

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function normalizeIntentMeta(intentMeta = null) {
  if (!intentMeta || typeof intentMeta !== 'object') return null
  return {
    intentMode: intentMeta.intentMode || intentMeta.intent_mode || null,
    queryType: intentMeta.queryType || intentMeta.query_type || null,
    queryPlan: intentMeta.queryPlan || intentMeta.query_plan || null
  }
}

function loadWeightsFromStorage() {
  const raw = safeStorageGet(WEIGHT_CACHE_KEY)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    cachedWeights = {
      version: parsed.version || 'local-storage',
      loadedAt: Number(parsed.loadedAt || 0),
      weights: parsed.weights && typeof parsed.weights === 'object' ? parsed.weights : {}
    }
  } catch {
    // ignore
  }
}

loadWeightsFromStorage()

export function getTelemetrySessionId() {
  return sessionId
}

export function resetTelemetrySessionId() {
  sessionId = createSessionId()
  return sessionId
}

export function getTemplateWeightsSnapshot() {
  return {
    version: cachedWeights.version,
    loadedAt: cachedWeights.loadedAt,
    weights: { ...(cachedWeights.weights || {}) }
  }
}

export function getTemplateWeight(templateId) {
  const value = Number(cachedWeights.weights?.[templateId])
  return Number.isFinite(value) ? value : 1
}

export async function refreshTemplateWeights(options = {}) {
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
    cachedWeights = {
      version: payload.version || 'server',
      loadedAt: nowTs(),
      weights: payload.weights && typeof payload.weights === 'object' ? payload.weights : {}
    }

    safeStorageSet(WEIGHT_CACHE_KEY, JSON.stringify(cachedWeights))
  } catch {
    // 网络不可达或网关错误时静默降级到本地权重
  }

  return getTemplateWeightsSnapshot()
}

export async function sendTemplateFeedback(eventType, payload = {}) {
  if (IS_V4_MODE) return false

  const traceId = payload.traceId || payload.trace_id || ''
  if (!traceId) return false

  const body = {
    trace_id: traceId,
    event_type: eventType,
    template_id: payload.templateId || payload.template_id || null,
    intent_meta: normalizeIntentMeta(payload.intentMeta || payload.intent_meta || null),
    ts: payload.ts || nowTs(),
    extra: {
      ...((payload.extra && typeof payload.extra === 'object') ? payload.extra : {}),
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

export function trackTemplateImpression(payload) {
  return sendTemplateFeedback('template_impression', payload)
}

export function trackTemplateClick(payload) {
  return sendTemplateFeedback('template_click', payload)
}

export function trackLocateClick(payload) {
  return sendTemplateFeedback('locate_click', payload)
}

export function trackFollowupClick(payload) {
  return sendTemplateFeedback('followup_click', payload)
}

export function trackSessionOutcome(payload) {
  return sendTemplateFeedback('session_outcome', payload)
}

export default {
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
