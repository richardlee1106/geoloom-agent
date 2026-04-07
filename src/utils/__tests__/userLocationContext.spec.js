import { describe, expect, it } from 'vitest'

import {
  assessBrowserUserLocation,
  createBrowserUserLocation,
  getLocationActionLabel,
  resolveLocationReferenceCenter,
  shouldRetryBrowserLocation,
  getUserLocationSummary,
  toDisplayLonLat
} from '../userLocationContext.js'

describe('userLocationContext', () => {
  it('projects browser WGS84 coordinates into display coordinates', () => {
    const [lon, lat] = toDisplayLonLat(114.334, 30.56, 'wgs84')

    expect(lon).not.toBe(114.334)
    expect(lat).not.toBe(30.56)
  })

  it('keeps gcj02 coordinates unchanged for display', () => {
    expect(toDisplayLonLat(114.334, 30.56, 'gcj02')).toEqual([114.334, 30.56])
  })

  it('builds a browser user location payload with display and raw coordinates', () => {
    const result = createBrowserUserLocation({
      coords: {
        longitude: 114.334,
        latitude: 30.56,
        accuracy: 18
      },
      timestamp: Date.UTC(2026, 3, 7, 8, 0, 0)
    })

    expect(result).toMatchObject({
      rawLon: 114.334,
      rawLat: 30.56,
      coordSys: 'gcj02',
      rawCoordSys: 'wgs84',
      accuracyM: 18,
      source: 'browser_geolocation'
    })
    expect(result.lon).not.toBe(114.334)
    expect(result.lat).not.toBe(30.56)
    expect(result.capturedAt).toBe('2026-04-07T08:00:00.000Z')
  })

  it('marks coarse locations far from the current focus as unreliable', () => {
    const result = assessBrowserUserLocation(
      {
        lon: 114.168,
        lat: 22.319,
        accuracyM: 3500
      },
      {
        referenceLon: 114.35,
        referenceLat: 30.58
      }
    )

    expect(result).toMatchObject({
      reliable: false,
      reason: 'far_from_reference',
      accuracyM: 3500
    })
    expect(result.distanceKm).toBeGreaterThan(500)
  })

  it('rejects far-away locations even when browser accuracy looks deceptively fine', () => {
    const result = assessBrowserUserLocation(
      {
        lon: 114.168,
        lat: 22.319,
        accuracyM: 120
      },
      {
        referenceLon: 114.35,
        referenceLat: 30.58
      }
    )

    expect(result).toMatchObject({
      reliable: false,
      reason: 'far_from_reference',
      accuracyM: 120
    })
    expect(result.distanceKm).toBeGreaterThan(500)
  })

  it('falls back to map bounds center when the live map center is not ready yet', () => {
    expect(resolveLocationReferenceCenter({
      mapCenter: null,
      mapBounds: [114.30, 30.54, 114.38, 30.60],
      fallbackCenter: { lon: 114.168, lat: 22.319 }
    })).toEqual({
      lon: 114.34,
      lat: 30.57
    })
  })

  it('uses the configured fallback center when neither map center nor bounds are available', () => {
    expect(resolveLocationReferenceCenter({
      mapCenter: null,
      mapBounds: null,
      fallbackCenter: { lon: 114.33, lat: 30.58 }
    })).toEqual({
      lon: 114.33,
      lat: 30.58
    })
  })

  it('returns a ready summary once current location is enabled', () => {
    const summary = getUserLocationSummary({
      userLocation: { accuracyM: 22 },
      userLocationStatus: 'ready'
    })

    expect(summary).toEqual({
      tone: 'active',
      label: '当前位置已启用',
      detail: '精度约 22 米'
    })
  })

  it('returns a denied summary and retry action label after permission rejection', () => {
    const summary = getUserLocationSummary({
      userLocation: null,
      userLocationStatus: 'denied'
    })

    expect(summary).toEqual({
      tone: 'warning',
      label: '定位未授权',
      detail: '先授权当前位置，或直接说一个地点'
    })
    expect(getLocationActionLabel('denied')).toBe('重新授权')
  })

  it('treats coarse browser locations as retryable so we can wait for a better fix', () => {
    expect(shouldRetryBrowserLocation({
      reliable: false,
      reason: 'accuracy_too_coarse',
      accuracyM: 86632,
      distanceKm: 910
    })).toBe(true)
  })

  it('does not keep waiting on a far-away but precise browser location', () => {
    expect(shouldRetryBrowserLocation({
      reliable: false,
      reason: 'far_from_reference',
      accuracyM: 120,
      distanceKm: 910
    })).toBe(false)
  })
})
