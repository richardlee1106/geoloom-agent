import { describe, expect, it } from 'vitest'

import { resolvePopupAnchorCoordinate } from '../popupFeatureAnchor.js'

describe('popupFeatureAnchor', () => {
  it('prefers the rendered feature geometry so the tip stays pinned to the red point', () => {
    const feature = {
      getGeometry() {
        return {
          getCoordinates() {
            return [12600000, 3570000]
          }
        }
      }
    }

    expect(resolvePopupAnchorCoordinate({
      feature,
      raw: {
        geometry: {
          type: 'Point',
          coordinates: [114.3349, 30.5848]
        }
      },
      fallbackCoordinate: [1, 2],
      resolveDisplayLonLat: () => [114.3349, 30.5848],
      projectToMapCoordinate: (lonLat) => ['projected', ...lonLat]
    })).toEqual([12600000, 3570000])
  })

  it('falls back to raw feature coordinates when openlayers feature geometry is unavailable', () => {
    expect(resolvePopupAnchorCoordinate({
      feature: null,
      raw: {
        lon: 114.3292,
        lat: 30.5907,
        coordSys: 'gcj02'
      },
      fallbackCoordinate: [1, 2],
      resolveDisplayLonLat: () => [114.3292, 30.5907],
      projectToMapCoordinate: (lonLat) => ['projected', ...lonLat]
    })).toEqual(['projected', 114.3292, 30.5907])
  })

  it('uses the click coordinate only as the last fallback', () => {
    expect(resolvePopupAnchorCoordinate({
      feature: null,
      raw: null,
      fallbackCoordinate: [118, 32],
      resolveDisplayLonLat: () => null,
      projectToMapCoordinate: (lonLat) => lonLat
    })).toEqual([118, 32])
  })
})
