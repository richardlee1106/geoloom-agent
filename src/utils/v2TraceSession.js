const V2_TRACE_SESSION_STORAGE_KEY = 'v2-agent-trace-session'
const MAX_TRACE_EVENTS = 120

function resolveStorage(storage) {
  if (storage) return storage
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage
  }
  return null
}

function safeParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function persistSnapshot(storage, snapshot) {
  const activeStorage = resolveStorage(storage)
  if (!activeStorage) return

  try {
    activeStorage.setItem(V2_TRACE_SESSION_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore storage failures
  }
}

export function readV2TraceSession(storage) {
  const activeStorage = resolveStorage(storage)
  if (!activeStorage) return null

  try {
    return safeParse(activeStorage.getItem(V2_TRACE_SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearV2TraceSession(storage) {
  const activeStorage = resolveStorage(storage)
  if (!activeStorage) return

  try {
    activeStorage.removeItem(V2_TRACE_SESSION_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

export function startV2TraceSession({
  storage,
  sessionId,
  query,
  architectureMode = 'v2'
} = {}) {
  const snapshot = {
    session_id: sessionId || null,
    query: String(query || '').trim(),
    architecture_mode: architectureMode,
    trace_id: null,
    job_id: null,
    job_state: null,
    latest_summary: '',
    latest_answer: null,
    latest_event: null,
    latest_event_at: Date.now(),
    events: []
  }

  persistSnapshot(storage, snapshot)
  return snapshot
}

export function appendV2TraceEvent({
  storage,
  event,
  payload
} = {}) {
  if (!event || !payload || typeof payload !== 'object') {
    return readV2TraceSession(storage)
  }

  const current = readV2TraceSession(storage) ?? startV2TraceSession({ storage, architectureMode: 'v2' })
  const nextEvents = [
    ...current.events,
    {
      event,
      payload,
      received_at: Date.now()
    }
  ].slice(-MAX_TRACE_EVENTS)

  const next = {
    ...current,
    trace_id: payload.trace_id || current.trace_id || null,
    job_id: payload.job_id || current.job_id || null,
    job_state: payload.state || current.job_state || null,
    latest_event: event,
    latest_event_at: Date.now(),
    latest_summary: payload.summary?.text || payload.answer?.text || payload.completion_summary || current.latest_summary || '',
    latest_answer: payload.answer || current.latest_answer || null,
    events: nextEvents
  }

  persistSnapshot(storage, next)
  return next
}

export function finalizeV2TraceSession({
  storage,
  message
} = {}) {
  const current = readV2TraceSession(storage)
  if (!current) {
    return null
  }

  const next = {
    ...current,
    latest_summary: String(message?.content || current.latest_summary || '').trim(),
    latest_answer: current.latest_answer || null,
    latest_event_at: Date.now(),
    latest_message: message ?? null
  }

  persistSnapshot(storage, next)
  return next
}

export {
  V2_TRACE_SESSION_STORAGE_KEY
}
