import { describe, expect, it } from 'vitest'

import { DeterministicRouter } from '../../../src/chat/DeterministicRouter.js'

describe('DeterministicRouter current-area aliases', () => {
  const router = new DeterministicRouter()

  it('treats 快速读懂这片区域 as a map-view area_overview query when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '快速读懂这片区域。' }],
      options: {
        spatialContext: {
          viewport: [114.30, 30.54, 114.38, 30.60],
          mapZoom: 15,
        },
      },
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.anchorSource).toBe('map_view')
    expect(intent.placeName).toBe('当前区域')
    expect(intent.needsClarification).toBe(false)
  })
})
