import { describe, expect, it } from 'vitest'

import { useSpatialRequestBuilder } from '../useSpatialRequestBuilder'

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

  it('keeps userLocation in the display coord space when POI data already uses gcj02', () => {
    const builder = useSpatialRequestBuilder({ poiCoordSys: 'gcj02' })
    const spatialContext = builder.buildSpatialContext({
      boundaryPolygon: null,
      drawMode: 'Viewport',
      circleCenter: null,
      circleRadius: null,
      mapBounds: [114.30, 30.54, 114.38, 30.59],
      mapZoom: 15,
      regions: [],
      poiFeatures: [],
      userLocation: {
        lon: 114.3655,
        lat: 30.5431,
        rawLon: 114.3605,
        rawLat: 30.5401,
        coordSys: 'gcj02',
        rawCoordSys: 'wgs84',
        accuracyM: 18,
        source: 'browser_geolocation',
        capturedAt: '2026-04-07T01:02:03.000Z'
      }
    })

    expect(spatialContext.userLocation).toEqual({
      lon: 114.3655,
      lat: 30.5431,
      accuracyM: 18,
      source: 'browser_geolocation',
      capturedAt: '2026-04-07T01:02:03.000Z',
      coordSys: 'gcj02'
    })
  })

  it('still projects browser userLocation back to raw wgs84 when backend poi coord sys is wgs84', () => {
    const builder = useSpatialRequestBuilder({ poiCoordSys: 'wgs84' })
    const spatialContext = builder.buildSpatialContext({
      boundaryPolygon: null,
      drawMode: 'Viewport',
      circleCenter: null,
      circleRadius: null,
      mapBounds: [114.30, 30.54, 114.38, 30.59],
      mapZoom: 15,
      regions: [],
      poiFeatures: [],
      userLocation: {
        lon: 114.3655,
        lat: 30.5431,
        rawLon: 114.3605,
        rawLat: 30.5401,
        coordSys: 'gcj02',
        rawCoordSys: 'wgs84',
        accuracyM: 18,
        source: 'browser_geolocation',
        capturedAt: '2026-04-07T01:02:03.000Z'
      }
    })

    expect(spatialContext.userLocation).toEqual({
      lon: 114.3605,
      lat: 30.5401,
      accuracyM: 18,
      source: 'browser_geolocation',
      capturedAt: '2026-04-07T01:02:03.000Z',
      coordSys: 'wgs84'
    })
  })

  it('skips nullish regions when normalizing backend region payloads', () => {
    const builder = useSpatialRequestBuilder({ poiCoordSys: 'gcj02' })
    const normalizedRegions = builder.normalizeRegionsForBackend([
      null,
      {
        id: 7,
        name: '测试选区',
        type: 'Polygon',
        geometry: {
          type: 'Polygon',
          coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.5]]]
        },
        boundaryWKT: 'POLYGON((114.3 30.5, 114.4 30.5, 114.4 30.6, 114.3 30.5))',
        center: [114.35, 30.55],
        pois: [{ id: 'poi-1' }],
        stats: { poiCount: 1 }
      },
      undefined
    ])

    expect(normalizedRegions).toHaveLength(1)
    expect(normalizedRegions[0]).toMatchObject({
      id: 7,
      name: '测试选区',
      poiCount: 1
    })
  })
})
