import { describe, expect, it } from 'vitest'

import { useSpatialRequestBuilder } from '../useSpatialRequestBuilder.js'

describe('useSpatialRequestBuilder', () => {
  it('always injects context_binding even when DSL gray is disabled', () => {
    const builder = useSpatialRequestBuilder({ contextBindingSeed: 'ctx-seed' })
    const meta = builder.buildDslMetaSkeleton({
      enabled: false,
      requestId: 'req-disabled',
      spatialContext: {
        viewport: [114.1, 30.5, 114.3, 30.7],
        mode: 'polygon'
      },
      drawMode: 'polygon',
      regions: []
    })

    expect(meta.context_binding).toBeTruthy()
    expect(meta.context_binding.client_view_id).toMatch(/^view_/)
    expect(meta.context_binding.event_seq).toBe(1)
    expect(meta.revision).toBeUndefined()
    expect(meta.streaming_hints).toBeUndefined()
  })

  it('includes revision and streaming hints when DSL gray is enabled', () => {
    const builder = useSpatialRequestBuilder({ contextBindingSeed: 'ctx-seed-enabled' })
    const meta = builder.buildDslMetaSkeleton({
      enabled: true,
      requestId: 'req-enabled',
      spatialContext: {
        viewport: [114.1, 30.5, 114.3, 30.7],
        mode: 'polygon'
      },
      drawMode: 'polygon',
      regions: []
    })

    expect(meta.context_binding).toBeTruthy()
    expect(meta.revision).toEqual({
      mode: 'rebuild',
      base_trace_id: null,
      patch_ops: []
    })
    expect(meta.streaming_hints).toEqual({
      allow_prefetch: false,
      prefetch_on_fields: []
    })
  })
})
