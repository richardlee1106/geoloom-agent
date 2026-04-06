import { describe, expect, it } from 'vitest'
import { buildPlaceTagsFromPois } from '../placeTagExtractor'

function createPoi(name, score, extra = {}) {
  return {
    name,
    score,
    type: extra.type || '',
    properties: {
      category_small: extra.category || '',
      ...extra.properties
    },
    geometry: {
      type: 'Point',
      coordinates: extra.coordinates || [114.3, 30.6]
    }
  }
}

describe('buildPlaceTagsFromPois', () => {
  it('filters weak place names and keeps high-signal names', () => {
    const pois = [
      createPoi('沙湖公园', 0.92, { category: '公园' }),
      createPoi('湖北大学', 0.88, { category: '高校' }),
      createPoi('停车场出入口', 0.99, { category: '停车场' }),
      createPoi('无名道路', 0.85, { category: '道路' }),
      createPoi('楚河汉街', 0.76, { category: '商圈' })
    ]

    const tags = buildPlaceTagsFromPois(pois, { mode: 'fine', intentMode: 'macro', maxCount: 10 })
    const names = tags.map((tag) => tag.name)

    expect(names).toContain('沙湖公园')
    expect(names).toContain('湖北大学')
    expect(names).toContain('楚河汉街')
    expect(names).not.toContain('停车场出入口')
    expect(names).not.toContain('无名道路')
  })

  it('deduplicates alias-like names and merges weight', () => {
    const pois = [
      createPoi('沙湖公园', 0.8, { category: '公园' }),
      createPoi('沙湖公园(东门)', 0.5, { category: '景点' }),
      createPoi('沙湖公园东门', 0.45, { category: '景点' }),
      createPoi('武商梦时代', 0.7, { category: '商场' })
    ]

    const tags = buildPlaceTagsFromPois(pois, { mode: 'coarse', intentMode: 'macro', maxCount: 10 })
    const shahuTags = tags.filter((tag) => tag.name.includes('沙湖公园'))

    expect(shahuTags.length).toBe(1)
    expect(tags[0].weight).toBeGreaterThan(0.8)
  })

  it('obeys maxCount and returns deterministic order by score', () => {
    const pois = [
      createPoi('A地标', 0.2),
      createPoi('B地标', 0.4),
      createPoi('C地标', 0.6),
      createPoi('D地标', 0.8)
    ]

    const tags = buildPlaceTagsFromPois(pois, { mode: 'fine', intentMode: 'micro', maxCount: 2 })

    expect(tags).toHaveLength(2)
    expect(tags[0].name).toBe('D地标')
    expect(tags[1].name).toBe('C地标')
  })
})
