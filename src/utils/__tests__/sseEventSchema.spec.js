import { validateSSEEventPayload } from '../../../shared/sseEventSchema'

describe('sseEventSchema optional metadata', () => {
  it('accepts stage payload with trace metadata fields', () => {
    const result = validateSSEEventPayload('stage', {
      name: 'planner',
      trace_id: 'trace-1',
      schema_version: 'v1.1',
      capabilities: ['intent_meta', 'l2_cache']
    })

    expect(result.ok).toBe(true)
  })

  it('keeps legacy payload compatibility', () => {
    const result = validateSSEEventPayload('progress', {
      progress: 0.5,
      stage: 'cluster'
    })

    expect(result.ok).toBe(true)
  })
})
