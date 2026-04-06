import { describe, expect, it } from 'vitest'

import {
  buildViewportHash,
  createContextBindingManager
} from '../contextBinding.js'

describe('contextBinding utils', () => {
  it('buildViewportHash is stable for semantically equivalent map state', () => {
    const hashA = buildViewportHash({
      viewport: [114.3, 30.5, 114.4, 30.6],
      drawMode: 'polygon',
      regions: [
        { id: 'r2', name: 'B' },
        { id: 'r1', name: 'A' }
      ]
    })
    const hashB = buildViewportHash({
      viewport: [114.3000001, 30.5000001, 114.3999999, 30.6000001],
      drawMode: 'polygon',
      regions: [
        { id: 'r1', name: 'A' },
        { id: 'r2', name: 'B' }
      ]
    })

    expect(hashA).toBe(hashB)
  })

  it('createContextBindingManager keeps client_view_id stable and event_seq monotonic', () => {
    const manager = createContextBindingManager({
      seed: 'test-seed',
      startSeq: 0,
      now: () => 1700000000000
    })

    const first = manager.next({
      viewport: [114.3, 30.5, 114.4, 30.6],
      drawMode: 'viewport',
      regions: []
    })
    const second = manager.next({
      viewport: [114.3, 30.5, 114.4, 30.6],
      drawMode: 'viewport',
      regions: []
    })

    expect(first.client_view_id).toBe(second.client_view_id)
    expect(first.event_seq).toBe(1)
    expect(second.event_seq).toBe(2)
    expect(second.viewport_hash).toBe(first.viewport_hash)
  })
})
