import { describe, expect, it } from 'vitest'

import { parseSseEventBlock } from './geoloomApi'

describe('geoloomApi', () => {
  it('parses and validates a refined_result SSE block', () => {
    const block = [
      'event: refined_result',
      'data: {"answer":"ok","results":{"stats":{"query_type":"nearby_poi"}}}',
      '',
    ].join('\n')

    const parsed = parseSseEventBlock(block)

    expect(parsed.event).toBe('refined_result')
    expect(parsed.payload.answer).toBe('ok')
    expect(parsed.validation.ok).toBe(true)
  })
})
