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

  it('deduplicates nearby metro exits and suppresses repeated station shell entries', () => {
    const view = factory.create({
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        placeName: '湖北大学',
        targetCategory: '地铁站',
        categoryKey: 'metro_station',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: '湖北大学附近有哪些地铁站？',
      },
      anchor: {
        ...anchor,
        place_name: '湖北大学',
        display_name: '湖北大学',
        resolved_place_name: '湖北大学(武昌校区)',
      },
      rows: [
        {
          id: 2101,
          name: '湖北大学地铁站E口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3308,
          latitude: 30.5772,
          distance_m: 372,
        },
        {
          id: 2102,
          name: '湖北大学地铁站A口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3312,
          latitude: 30.5775,
          distance_m: 448,
        },
        {
          id: 2103,
          name: '湖北大学地铁站D口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3304,
          latitude: 30.5768,
          distance_m: 448,
        },
        {
          id: 2104,
          name: '湖北大学(地铁站)',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3309,
          latitude: 30.5770,
          distance_m: 458,
        },
        {
          id: 2105,
          name: '湖北大学(地铁站)',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3309,
          latitude: 30.5770,
          distance_m: 458,
        },
        {
          id: 2106,
          name: '三角路地铁站H口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3270,
          latitude: 30.5786,
          distance_m: 612,
        },
      ],
    })

    expect(view.type).toBe('poi_list')
    expect(view.items.map((item) => item.name)).toEqual([
      '湖北大学地铁站E口',
      '湖北大学地铁站A口',
      '湖北大学地铁站D口',
      '三角路地铁站H口',
    ])
    expect(view.meta.resultCount).toBe(4)
  })

  it('keeps backend coordinate system metadata on anchors and poi items', () => {
    const view = factory.create({
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        placeName: 'coord test',
        targetCategory: 'poi',
        radiusM: 500,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: 'coord test',
      },
      anchor: {
        ...anchor,
        place_name: 'coord test',
        display_name: 'coord test',
        resolved_place_name: 'coord test',
        coord_sys: 'wgs84',
      },
      rows: [
        {
          id: 99,
          name: 'sample poi',
          category_main: 'test',
          category_sub: 'test_sub',
          longitude: 114.3651,
          latitude: 30.5368,
          distance_m: 123.7,
          coord_sys: 'wgs84',
        },
      ],
    })

    expect(view.anchor.coordSys).toBe('wgs84')
    expect(view.items[0]?.coordSys).toBe('wgs84')
  })

  it('defaults missing backend coordinate system metadata to gcj02', () => {
    const view = factory.create({
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        placeName: '默认坐标系测试',
        targetCategory: 'poi',
        radiusM: 500,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: '默认坐标系测试',
      },
      anchor: {
        ...anchor,
        place_name: '默认坐标系测试',
        display_name: '默认坐标系测试',
        resolved_place_name: '默认坐标系测试',
      },
      rows: [
        {
          id: 99,
          name: 'sample poi',
          category_main: 'test',
          category_sub: 'test_sub',
          longitude: 114.3651,
          latitude: 30.5368,
          distance_m: 123.7,
        },
      ],
    })

    expect(view.anchor.coordSys).toBe('gcj02')
    expect(view.items[0]?.coordSys).toBe('gcj02')
  })

  it('creates area_overview evidence for business-mix insight queries', () => {
    const view = factory.create({
      intent: {
        queryType: 'area_overview',
        intentMode: 'agent_full_loop',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
        rawQuery: '请快速读懂当前区域',
      },
      anchor: {
        ...anchor,
        place_name: '当前区域',
        display_name: '当前区域',
        resolved_place_name: '当前区域',
      },
      rows: [
        {
          id: 7001,
          name: '湖北大学地铁站E口',
          category_main: '交通设施服务',
          category_sub: '地铁站',
          longitude: 114.3308,
          latitude: 30.5772,
          distance_m: 268.4,
        },
        {
          id: 7002,
          name: '武昌鱼馆',
          category_main: '餐饮美食',
          category_sub: '中餐厅',
          longitude: 114.3312,
          latitude: 30.5775,
          distance_m: 312.1,
        },
        {
          id: 7003,
          name: '校园便利店',
          category_main: '购物服务',
          category_sub: '便利店',
          longitude: 114.3304,
          latitude: 30.5768,
          distance_m: 356.9,
        },
      ],
    })

    expect(view.type).toBe('area_overview')
    expect(view.items).toHaveLength(3)
    expect(view.buckets).toHaveLength(3)
  })
})
