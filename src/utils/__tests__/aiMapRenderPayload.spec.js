import { describe, expect, it } from 'vitest'

import {
  normalizeAiMapRenderPayload,
  normalizeRenderFeature
} from '../aiMapRenderPayload'

describe('aiMapRenderPayload', () => {
  it('normalizes mixed poi payloads and removes duplicate points', () => {
    const payload = {
      pois: [
        {
          name: '湖北大学地铁站A口',
          lon: 114.3371,
          lat: 30.5842,
          coordSys: 'gcj02'
        },
        {
          type: 'Feature',
          coordSys: 'gcj02',
          geometry: {
            type: 'Point',
            coordinates: [114.3371, 30.5842]
          },
          properties: {
            名称: '湖北大学地铁站A口'
          }
        },
        {
          name: '三角路地铁站H口',
          lon: 114.3292,
          lat: 30.5907,
          coord_sys: 'gcj02'
        }
      ]
    }

    const result = normalizeAiMapRenderPayload(payload, { fallbackCoordSys: 'wgs84' })

    expect(result.anchorFeature).toBeNull()
    expect(result.features).toHaveLength(2)
    expect(result.features.map((item) => item.properties.名称)).toEqual([
      '湖北大学地铁站A口',
      '三角路地铁站H口'
    ])
    expect(result.features.every((item) => item.properties._source === 'ai_tagcloud')).toBe(true)
  })

  it('normalizes anchor features and preserves coord sys metadata', () => {
    const payload = {
      pois: [],
      anchorFeature: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [114.3349, 30.5848]
        },
        properties: {
          名称: '湖北大学',
          coordSys: 'wgs84'
        }
      }
    }

    const result = normalizeAiMapRenderPayload(payload, { fallbackCoordSys: 'gcj02' })

    expect(result.features).toEqual([])
    expect(result.anchorFeature).toMatchObject({
      coordSys: 'wgs84',
      properties: {
        名称: '湖北大学',
        _coordSys: 'wgs84',
        _isAnchor: true,
        _source: 'ai_anchor'
      }
    })
  })

  it('supports snake_case anchor_feature payloads', () => {
    const payload = {
      pois: [],
      anchor_feature: {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [114.301, 30.611]
        },
        properties: {
          名称: '沙湖公园'
        }
      }
    }

    const result = normalizeAiMapRenderPayload(payload, { fallbackCoordSys: 'gcj02' })

    expect(result.anchorFeature).toMatchObject({
      geometry: {
        coordinates: [114.301, 30.611]
      },
      properties: {
        名称: '沙湖公园',
        _isAnchor: true,
        _source: 'ai_anchor'
      }
    })
  })

  it('returns null when an entry does not contain valid point coordinates', () => {
    expect(normalizeRenderFeature({ name: '坏数据', lon: null, lat: undefined })).toBeNull()
  })
})
