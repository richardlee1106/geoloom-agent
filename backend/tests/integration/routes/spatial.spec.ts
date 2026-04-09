import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../../../src/app.js'
import { SkillRegistry } from '../../../src/skills/SkillRegistry.js'
import type { SpatialFeature } from '../../../src/spatial/fetchSpatialFeatures.js'

describe('POST /api/spatial/fetch', () => {
  it('returns frontend-compatible feature payloads for manual area/category filtering', async () => {
    const fetchSpatialFeatures = vi.fn(async (): Promise<SpatialFeature[]> => ([
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [114.334121, 30.57687],
        },
        properties: {
          id: 101,
          name: '湖北大学',
          名称: '湖北大学',
          category_main: '科教文化服务',
          category_sub: '学校',
          brand_category: '高等院校',
          大类: '科教文化服务',
          中类: '学校',
          小类: '高等院校',
        },
      },
    ]))

    const app = createApp({
      registry: new SkillRegistry(),
      version: '0.3.1-test',
      checkDatabaseHealth: async () => true,
      fetchSpatialFeatures,
    })
    await app.ready()

    const payload = {
      categories: ['学校'],
      geometry: 'POLYGON((114.329 30.575, 114.339 30.575, 114.339 30.581, 114.329 30.581, 114.329 30.575))',
      limit: 500000,
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/spatial/fetch',
      payload,
    })

    expect(response.statusCode).toBe(200)
    expect(fetchSpatialFeatures).toHaveBeenCalledWith(payload)
    expect(response.json()).toEqual({
      success: true,
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [114.334121, 30.57687],
          },
          properties: {
            id: 101,
            name: '湖北大学',
            名称: '湖北大学',
            category_main: '科教文化服务',
            category_sub: '学校',
            brand_category: '高等院校',
            大类: '科教文化服务',
            中类: '学校',
            小类: '高等院校',
          },
        },
      ],
    })

    await app.close()
  })
})
