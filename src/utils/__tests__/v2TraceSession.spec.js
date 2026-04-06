import {
  appendV2TraceEvent,
  finalizeV2TraceSession,
  readV2TraceSession,
  startV2TraceSession
} from '../v2TraceSession.js'

function createMemoryStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    }
  }
}

describe('v2TraceSession', () => {
  it('starts and updates a real v2 trace snapshot', () => {
    const storage = createMemoryStorage()

    startV2TraceSession({
      storage,
      sessionId: 'session-v2',
      query: 'analyze this area',
      architectureMode: 'v2'
    })

    appendV2TraceEvent({
      storage,
      event: 'fast.result',
      payload: {
        trace_id: 'trace-1',
        job_id: 'job-1',
        state: 'S3_FAST_DONE',
        summary: {
          text: 'fast summary'
        }
      }
    })

    finalizeV2TraceSession({
      storage,
      message: {
        content: 'assistant final text'
      }
    })

    const snapshot = readV2TraceSession(storage)
    expect(snapshot.session_id).toBe('session-v2')
    expect(snapshot.trace_id).toBe('trace-1')
    expect(snapshot.job_id).toBe('job-1')
    expect(snapshot.job_state).toBe('S3_FAST_DONE')
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.latest_summary).toBe('assistant final text')
  })
})
