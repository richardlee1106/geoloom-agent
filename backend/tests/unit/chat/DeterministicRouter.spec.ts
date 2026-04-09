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

  it('keeps store-opportunity questions in area_overview and asks for spatial context when anchor is missing', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '这里适合开什么店？' }],
      options: {},
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.needsClarification).toBe(true)
    expect(intent.clarificationHint).toMatch(/明确地点|地图移动|分析/)
  })

  it('treats current-area store-opportunity questions as area_overview when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '如果要在当前区域开店，哪些业态更值得优先考虑？请结合周边供给、需求和竞争关系说明理由。' }],
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

  it('routes place-based store-opportunity questions to area_overview instead of unsupported', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '武汉大学附近适合开什么店？请结合周边供给、需求和竞争关系说明。' }],
      options: {},
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.anchorSource).toBe('place')
    expect(intent.placeName).toBe('武汉大学')
    expect(intent.needsClarification).toBe(false)
  })

  it('treats 这里适合开什么店 as current-area overview when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '这里适合开什么店？' }],
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

  it('routes 解读一下这片区域 to area_overview when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '解读一下这片区域' }],
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

  it('treats current-area semantic classification prompts as area_overview instead of similar_regions', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '请判断当前区域更像居住片区、商业片区还是混合片区，并说明依据。' }],
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

  it('strips area-analysis lead-ins before extracting place anchors', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '解读一下武汉大学周边的业态结构' }],
      options: {},
    })

    expect(intent.queryType).toBe('area_overview')
    expect(intent.anchorSource).toBe('place')
    expect(intent.placeName).toBe('武汉大学')
    expect(intent.needsClarification).toBe(false)
  })

  it('treats 这里附近 business-mix prompts as current-area overview when viewport context is available', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '请帮我看看这里附近有什么值得关注的配套、热门业态和明显缺口，并按相关性排序。' }],
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

  it('treats current-area compare-like prompts as map-view overview instead of fake place anchors', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '请把当前区域和周边热点片区做对比，说明它们在人流、业态结构和商业机会上的差异，并给出建议。' }],
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

  it('routes multi-region compare prompts to compare_places when the user has selected multiple regions', () => {
    const intent = router.route({
      messages: [{ role: 'user', content: '比较选区1和选区2的餐饮业态分布，并说明差异。' }],
      options: {
        regions: [
          {
            id: 'region-1',
            name: '选区1',
            center: [114.331, 30.577],
            boundaryWKT: 'POLYGON((114.329 30.575, 114.333 30.575, 114.333 30.579, 114.329 30.579, 114.329 30.575))',
          },
          {
            id: 'region-2',
            name: '选区2',
            center: [114.338, 30.583],
            boundaryWKT: 'POLYGON((114.336 30.581, 114.34 30.581, 114.34 30.585, 114.336 30.585, 114.336 30.581))',
          },
        ],
        spatialContext: {
          mapZoom: 15,
        },
      },
    })

    expect(intent.queryType).toBe('compare_places')
    expect(intent.anchorSource).toBe('map_view')
    expect(intent.placeName).toBe('选区1')
    expect(intent.secondaryPlaceName).toBe('选区2')
    expect(intent.needsClarification).toBe(false)
  })
})
