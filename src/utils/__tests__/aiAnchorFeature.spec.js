import { describe, expect, it } from 'vitest'

import { buildAiAnchorFeatureFromMessage } from '../aiAnchorFeature'

describe('aiAnchorFeature', () => {
  it('keeps the semantic anchor even when a poi shares the same coordinates', () => {
    const message = {
      analysisStats: {
        anchor_lon: 114.3349,
        anchor_lat: 30.5848,
        anchor_coord_sys: 'gcj02'
      },
      intentPreview: {
        displayAnchor: '湖北大学'
      }
    }

    const pois = [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [114.3349, 30.5848]
        },
        properties: {
          名称: '湖北大学(地铁站)',
          _coordSys: 'gcj02'
        }
      }
    ]

    expect(buildAiAnchorFeatureFromMessage(message, pois, { fallbackCoordSys: 'gcj02' })).toMatchObject({
      coordSys: 'gcj02',
      properties: {
        名称: '湖北大学',
        name: '湖北大学',
        _isAnchor: true,
        _source: 'ai_anchor'
      }
    })
  })

  it('falls back to the resolved place name when preview text is absent', () => {
    const message = {
      analysisStats: {
        anchor_lon: 114.33,
        anchor_lat: 30.58
      },
      intentMeta: {
        placeName: '三角路地铁站'
      }
    }

    expect(buildAiAnchorFeatureFromMessage(message, [], { fallbackCoordSys: 'gcj02' })).toMatchObject({
      properties: {
        名称: '三角路地铁站',
        title: '三角路地铁站'
      }
    })
  })

  it('falls back to poi coord sys hints when analysis stats only provide blank coord sys text', () => {
    const message = {
      analysisStats: {
        anchor_lon: 114.33,
        anchor_lat: 30.58,
        anchor_coord_sys: '   '
      },
      intentPreview: {
        displayAnchor: '湖北大学'
      }
    }

    const pois = [
      {
        properties: {
          _coordSys: 'wgs84'
        }
      }
    ]

    expect(buildAiAnchorFeatureFromMessage(message, pois, { fallbackCoordSys: 'gcj02' })).toMatchObject({
      coordSys: 'wgs84',
      properties: {
        _coordSys: 'wgs84'
      }
    })
  })

  it('returns null when the message does not contain valid anchor coordinates', () => {
    expect(buildAiAnchorFeatureFromMessage({ analysisStats: {} }, [], { fallbackCoordSys: 'gcj02' })).toBeNull()
  })
})
