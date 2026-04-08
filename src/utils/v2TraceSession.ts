const V2_TRACE_SESSION_STORAGE_KEY = 'v2-agent-trace-session'
const MAX_TRACE_EVENTS = 120

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type TracePayload = Record<string, any>

type TraceEventRecord = {
  event: string
  payload: TracePayload
  received_at: number
}

type V2TraceSnapshot = {
  session_id: string | null
  query: string
  architecture_mode: string
  trace_id: string | null
  job_id: string | null
  job_state: string | null
  latest_summary: string
  latest_answer: TracePayload | null
  latest_event: string | null
  latest_event_at: number
  latest_message?: Record<string, unknown> | null
  events: TraceEventRecord[]
}

type StartV2TraceSessionArgs = {
  storage?: StorageLike | null
  sessionId?: unknown
  query?: unknown
  architectureMode?: unknown
}

type AppendV2TraceEventArgs = {
  storage?: StorageLike | null
  event?: unknown
  payload?: unknown
}

type FinalizeV2TraceSessionArgs = {
  storage?: StorageLike | null
  message?: Record<string, unknown> | null
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage
  }
  return null
}

function safeParse(raw: string | null): V2TraceSnapshot | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as V2TraceSnapshot
  } catch {
    return null
  }
}

function persistSnapshot(storage: StorageLike | null | undefined, snapshot: V2TraceSnapshot): void {
  const activeStorage = resolveStorage(storage)
  if (!activeStorage) return

  try {
    activeStorage.setItem(V2_TRACE_SESSION_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore storage failures
  }
}

function normalizeSummaryText(value: unknown): string {
  return String(value ?? '').trim()
}

export function readV2TraceSession(storage?: StorageLike | null): V2TraceSnapshot | null {
  const activeStorage = resolveStorage(storage)
  if (!activeStorage) return null

  try {
    return safeParse(activeStorage.getItem(V2_TRACE_SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearV2TraceSession(storage?: StorageLike | null): void {
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
}: StartV2TraceSessionArgs = {}): V2TraceSnapshot {
  const snapshot: V2TraceSnapshot = {
    session_id: sessionId ? String(sessionId) : null,
    query: String(query || '').trim(),
    architecture_mode: String(architectureMode || 'v2'),
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
}: AppendV2TraceEventArgs = {}): V2TraceSnapshot | null {
  if (!event || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return readV2TraceSession(storage)
  }

  const typedPayload = payload as TracePayload
  const current = readV2TraceSession(storage) ?? startV2TraceSession({ storage, architectureMode: 'v2' })
  const nextEvents = [
    ...current.events,
    {
      event: String(event),
      payload: typedPayload,
      received_at: Date.now()
    }
  ].slice(-MAX_TRACE_EVENTS)

  const next: V2TraceSnapshot = {
    ...current,
    trace_id: typedPayload.trace_id || current.trace_id || null,
    job_id: typedPayload.job_id || current.job_id || null,
    job_state: typedPayload.state || current.job_state || null,
    latest_event: String(event),
    latest_event_at: Date.now(),
    latest_summary: normalizeSummaryText(
      typedPayload.summary?.text
      || typedPayload.answer?.text
      || typedPayload.completion_summary
      || current.latest_summary
    ),
    latest_answer: (typedPayload.answer as TracePayload | undefined) || current.latest_answer || null,
    events: nextEvents
  }

  persistSnapshot(storage, next)
  return next
}

export function finalizeV2TraceSession({
  storage,
  message
}: FinalizeV2TraceSessionArgs = {}): V2TraceSnapshot | null {
  const current = readV2TraceSession(storage)
  if (!current) {
    return null
  }

  const messageSummary = normalizeSummaryText(message?.content)

  const next: V2TraceSnapshot = {
    ...current,
    latest_summary: messageSummary || current.latest_summary || '',
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
