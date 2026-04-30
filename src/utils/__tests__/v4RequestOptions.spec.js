import { describe, expect, it } from 'vitest'

import { buildV4ChatRequestPayload, filterV4ChatOptions } from '../v4RequestOptions'

describe('filterV4ChatOptions', () => {
  it('drops frontend-only heavy visual fields and keeps backend-consumed chat options', () => {
    const filtered = filterV4ChatOptions({
      requestId: 'req-1',
      sessionId: 'sess-1',
      surface: 'default',
      screenshotBase64: 'base64://huge-payload',
      visualSnapshotDataUrl: 'base64://duplicate-payload',
      visualReviewEnabled: true,
      overviewEnabled: true,
      clientMetrics: { panel: 'ai-chat' },
      spatialContext: {
        viewport: [114.3, 30.5, 114.4, 30.6],
        interactionHints: { poiCount: 9737 }
      },
      regions: [{ id: 'region-1' }],
      selectedCategories: ['餐饮美食'],
      sourcePolicy: { enforceUiConstraints: true },
      skipCache: true,
      forceRefresh: true,
      narrativeStyle: 'classic_must_see'
    })

    expect(filtered).toEqual({
      requestId: 'req-1',
      sessionId: 'sess-1',
      surface: 'default',
      spatialContext: {
        viewport: [114.3, 30.5, 114.4, 30.6],
        interactionHints: { poiCount: 9737 }
      },
      regions: [{ id: 'region-1' }],
      selectedCategories: ['餐饮美食'],
      sourcePolicy: { enforceUiConstraints: true },
      skipCache: true,
      forceRefresh: true,
      narrativeStyle: 'classic_must_see'
    })
  })

  it('omits raw poiFeatures from v4 chat payloads because backend does not consume them', () => {
    const payload = buildV4ChatRequestPayload({
      messages: [{ role: 'user', content: '请快速读懂当前区域' }],
      poiFeatures: new Array(9737).fill({
        type: 'Feature',
        properties: { name: 'POI' },
        geometry: { type: 'Point', coordinates: [114.3, 30.5] }
      }),
      options: {
        requestId: 'req-2',
        spatialContext: {
          viewport: [114.3, 30.5, 114.4, 30.6],
          interactionHints: { poiCount: 9737 }
        },
        screenshotBase64: 'base64://should-be-dropped'
      }
    })

    expect(payload).toEqual({
      messages: [{ role: 'user', content: '请快速读懂当前区域' }],
      poiFeatures: [],
      options: {
        requestId: 'req-2',
        spatialContext: {
          viewport: [114.3, 30.5, 114.4, 30.6],
          interactionHints: { poiCount: 9737 }
        }
      }
    })
  })
})
