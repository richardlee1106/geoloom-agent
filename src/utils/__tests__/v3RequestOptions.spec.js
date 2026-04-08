import { describe, expect, it } from 'vitest'

import { filterV3ChatOptions } from '../v3RequestOptions'

describe('filterV3ChatOptions', () => {
  it('drops V1-only heavy visual fields but keeps spatial context required by V3', () => {
    const filtered = filterV3ChatOptions({
      requestId: 'req-1',
      sessionId: 'sess-1',
      screenshotBase64: 'base64://big-payload',
      visualSnapshotDataUrl: 'base64://duplicate',
      visualReviewEnabled: true,
      visualRemoteEnabled: true,
      selfValidationEnabled: true,
      skgEnabled: true,
      overviewEnabled: true,
      overviewMediumEnabled: true,
      visualTimeoutMs: 4500,
      selectedCategories: ['餐饮美食'],
      spatialContext: {
        center: { lon: 114.3, lat: 30.5 },
        boundary: [[114.3, 30.5], [114.4, 30.5], [114.4, 30.6]]
      },
      regions: [{ id: 'region-1' }],
      analysisDepth: 'deep',
      skipCache: true
    })

    expect(filtered).toEqual({
      requestId: 'req-1',
      sessionId: 'sess-1',
      selectedCategories: ['餐饮美食'],
      spatialContext: {
        center: { lon: 114.3, lat: 30.5 },
        boundary: [[114.3, 30.5], [114.4, 30.5], [114.4, 30.6]]
      },
      regions: [{ id: 'region-1' }],
      analysisDepth: 'deep',
      skipCache: true
    })
  })

  it('returns a safe empty object for invalid input', () => {
    expect(filterV3ChatOptions(null)).toEqual({})
    expect(filterV3ChatOptions(undefined)).toEqual({})
  })
})
