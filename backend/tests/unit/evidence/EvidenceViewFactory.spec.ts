import { describe, expect, it } from 'vitest'

import { EvidenceViewFactory } from '../../../src/evidence/EvidenceViewFactory.js'

const anchor = {
  place_name: '武汉大学',
  display_name: '武汉大学',
  role: 'primary',
  resolved_place_name: '武汉大学',
  poi_id: 1,
  lon: 114.364339,
  lat: 30.536334,
  source: 'poi_search',
}

describe('EvidenceViewFactory', () => {
  const factory = new EvidenceViewFactory()

  it('creates poi_list evidence for nearby poi results', () => {
    const view = factory.create({
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        placeName: '武汉大学',
        targetCategory: '咖啡',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: '武汉大学附近有哪些咖啡店？',
      },
      anchor,
      rows: [
        {
          id: 1,
          name: 'luckin coffee',
          category_main: '餐饮美食',
          category_sub: '咖啡',
          longitude: 114.3651,
          latitude: 30.5368,
          distance_m: 123.7,
        },
      ],
    })

    expect(view.type).toBe('poi_list')
    expect(view.anchor.resolvedPlaceName).toBe('武汉大学')
    expect(view.items).toHaveLength(1)
    expect(view.meta.radiusM).toBe(800)
  })

  it('creates transport evidence for nearest station results', () => {
    const view = factory.create({
      intent: {
        queryType: 'nearest_station',
        intentMode: 'deterministic_visible_loop',
        placeName: '武汉大学',
        targetCategory: '地铁站',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: '武汉大学最近的地铁站是什么？',
      },
      anchor,
      rows: [
        {
          id: 2,
          name: '小洪山地铁站A口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.355,
          latitude: 30.540,
          distance_m: 1027.9,
        },
      ],
    })

    expect(view.type).toBe('transport')
    expect(view.items[0]?.name).toBe('小洪山地铁站A口')
    expect(view.meta.resultCount).toBe(1)
  })
})
