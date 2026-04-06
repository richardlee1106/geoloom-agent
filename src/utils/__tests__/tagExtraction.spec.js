import { buildPlaceTags } from '../tagExtraction'

function createPoi({
  id,
  name,
  type = '',
  category = '',
  score = 0,
  lon = 114.33,
  lat = 30.58
}) {
  return {
    id,
    name,
    type,
    score,
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      name,
      type,
      category_small: category
    }
  }
}

describe('buildPlaceTags', () => {
  it('filters weak-related names and merges aliases', () => {
    const pois = [
      createPoi({ id: 1, name: '湖北大学(北门)', category: '高校', score: 0.9 }),
      createPoi({ id: 2, name: '湖北大学北门', category: '高校', score: 0.8 }),
      createPoi({ id: 3, name: '停车场出口', category: '交通设施', score: 0.95 }),
      createPoi({ id: 4, name: '无名道路', category: '道路', score: 0.7 })
    ]

    const tags = buildPlaceTags(pois, {
      topK: 20,
      intentMeta: {
        queryType: 'poi_search',
        intentMode: 'local_search',
        queryPlan: { semantic_query: '湖北大学附近有什么' }
      }
    })

    expect(tags.length).toBeGreaterThan(0)
    expect(tags.some((tag) => tag.name.includes('湖北大学'))).toBe(true)
    expect(tags.some((tag) => tag.name.includes('停车场出口'))).toBe(false)
    expect(tags.some((tag) => tag.name.includes('无名道路'))).toBe(false)
    expect(tags.filter((tag) => tag.name.includes('湖北大学')).length).toBe(1)
  })

  it('uses semantic and geo context rerank in second stage', () => {
    const pois = [
      createPoi({
        id: 1,
        name: '沙湖游客中心',
        category: '游客中心',
        score: 0.95,
        lon: 114.31,
        lat: 30.60
      }),
      createPoi({
        id: 2,
        name: '湖北大学咖啡馆',
        category: '咖啡厅',
        score: 0.48,
        lon: 114.332,
        lat: 30.579
      }),
      createPoi({
        id: 3,
        name: '湖大咖啡',
        category: '咖啡厅',
        score: 0.45,
        lon: 114.333,
        lat: 30.578
      })
    ]

    const tags = buildPlaceTags(pois, {
      topK: 20,
      intentMeta: {
        queryType: 'poi_search',
        intentMode: 'local_search',
        queryPlan: {
          semantic_query: '湖北大学周边咖啡店',
          anchor: '湖北大学',
          categories: ['咖啡厅']
        }
      }
    })

    expect(tags.length).toBeGreaterThan(0)
    expect(tags[0].name.includes('湖北大学') || tags[0].name.includes('湖大')).toBe(true)
  })
})
