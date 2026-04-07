import { describe, expect, it } from 'vitest'

import {
  buildCoarseLocationBrowserHint,
  detectBrowserBrand
} from '../geolocationDiagnostics.js'

describe('geolocationDiagnostics', () => {
  it('detects edge and chrome user agents separately', () => {
    expect(detectBrowserBrand('Mozilla/5.0 Edg/135.0.0.0')).toBe('edge')
    expect(detectBrowserBrand('Mozilla/5.0 Chrome/135.0.0.0 Safari/537.36')).toBe('chrome')
  })

  it('builds a chrome-specific coarse-location hint', () => {
    expect(buildCoarseLocationBrowserHint({
      browserBrand: 'chrome',
      accuracyM: 86632,
      permissionState: 'granted'
    })).toContain('Chrome 这次更像只拿到了网络级粗定位')
  })

  it('falls back to a generic hint for other browsers', () => {
    expect(buildCoarseLocationBrowserHint({
      browserBrand: 'firefox',
      accuracyM: 4000,
      permissionState: 'prompt'
    })).toContain('浏览器这次返回的位置精度仍然偏粗')
  })
})
