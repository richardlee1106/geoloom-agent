import { beforeEach, describe, expect, it } from 'vitest'

import { useRegions } from '../useRegions'

describe('useRegions', () => {
  const regionsApi = useRegions()

  beforeEach(() => {
    regionsApi.clearAllRegions()
  })

  it('derives initial region stats from the provided poi collection', () => {
    const region = regionsApi.addRegion({
      geometry: { type: 'Polygon', coordinates: [] },
      center: [114.3, 30.5],
      boundaryWKT: 'POLYGON((114.3 30.5, 114.4 30.5, 114.4 30.6, 114.3 30.5))',
      pois: [
        { properties: { 小类: '咖啡厅' } },
        { properties: { category: '咖啡厅' } },
        { properties: { 中类: '餐饮服务' } }
      ]
    })

    expect(region.stats).toEqual({
      poiCount: 3,
      categories: {
        咖啡厅: 2,
        餐饮服务: 1
      },
      topCategories: [
        { name: '咖啡厅', count: 2 },
        { name: '餐饮服务', count: 1 }
      ]
    })
  })
})
