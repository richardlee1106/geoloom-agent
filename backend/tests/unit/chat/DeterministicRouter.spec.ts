import { describe, expect, it } from 'vitest'

import { DeterministicRouter } from '../../../src/chat/DeterministicRouter.js'

describe('DeterministicRouter', () => {
  const router = new DeterministicRouter()

  it('routes nearby poi queries and extracts anchor plus category hints', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '武汉大学附近有哪些咖啡店？' }],
      options: {},
    })

    expect(intent.queryType).toBe('nearby_poi')
    expect(intent.placeName).toBe('武汉大学')
    expect(intent.targetCategory).toBe('咖啡')
    expect(intent.radiusM).toBe(800)
    expect(intent.needsClarification).toBe(false)
  })

  it('routes nearest station queries to the transport template flow', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '武汉大学最近的地铁站是什么？' }],
      options: {},
    })

    expect(intent.queryType).toBe('nearest_station')
    expect(intent.placeName).toBe('武汉大学')
    expect(intent.targetCategory).toBe('地铁站')
    expect(intent.needsClarification).toBe(false)
  })

  it('falls back to unsupported for non-supported decision questions', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '这里适合开什么店？' }],
      options: {},
    })

    expect(intent.queryType).toBe('unsupported')
    expect(intent.needsClarification).toBe(true)
    expect(intent.clarificationHint).toMatch(/只支持|附近|最近/)
  })

  it('keeps the query type but asks for clarification when anchor is missing', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '附近有哪些咖啡店？' }],
      options: {},
    })

    expect(intent.queryType).toBe('nearby_poi')
    expect(intent.placeName).toBeNull()
    expect(intent.needsClarification).toBe(true)
    expect(intent.clarificationHint).toMatch(/明确地点/)
  })

  it('treats 我附近 queries as user-location anchored when browser coordinates are present', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '我附近有哪些咖啡店？' }],
      options: {
        spatialContext: {
          userLocation: {
            lon: 114.3655,
            lat: 30.5431,
            accuracyM: 18,
            source: 'browser_geolocation',
            capturedAt: '2026-04-06T10:00:00.000Z',
          },
        },
      },
    })

    expect(intent.queryType).toBe('nearby_poi')
    expect(intent.anchorSource).toBe('user_location')
    expect(intent.placeName).toBeNull()
    expect(intent.needsClarification).toBe(false)
  })

  it('asks for location authorization or a place name when 我附近 lacks browser coordinates', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '我附近有哪些咖啡店？' }],
      options: {},
    })

    expect(intent.queryType).toBe('nearby_poi')
    expect(intent.anchorSource).toBe('user_location')
    expect(intent.needsClarification).toBe(true)
    expect(intent.clarificationHint).toMatch(/授权当前位置|明确地点/)
  })

  it('treats 离我最近的地铁站 as a user-location nearest-station query when coordinates are present', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '离我最近的地铁站是什么？' }],
      options: {
        spatialContext: {
          userLocation: {
            lon: 114.3655,
            lat: 30.5431,
            accuracyM: 18,
            source: 'browser_geolocation',
            capturedAt: '2026-04-06T10:00:00.000Z',
          },
        },
      },
    })

    expect(intent.queryType).toBe('nearest_station')
    expect(intent.anchorSource).toBe('user_location')
    expect(intent.placeName).toBeNull()
    expect(intent.needsClarification).toBe(false)
  })

  it('routes current-area insight prompts to area_overview when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '请快速读懂当前区域，用简洁但有洞察的方式总结主导业态、活力热点、异常点，以及最值得关注的机会。' }],
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

  it('routes place-based business-mix insight prompts to area_overview instead of nearby poi', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '湖北大学附近有什么值得关注的配套、热门业态和明显缺口？' }],
      options: {},
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.anchorSource).toBe('place')
    expect(intent.placeName).toBe('湖北大学')
    expect(intent.needsClarification).toBe(false)
  })
})
