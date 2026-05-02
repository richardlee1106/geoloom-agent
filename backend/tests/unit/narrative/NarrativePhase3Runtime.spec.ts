import { describe, expect, it } from 'vitest'

import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { NarrativePhase3Runtime } from '../../../src/narrative/NarrativePhase3Runtime.js'
import type { SpatialFeature } from '../../../src/spatial/fetchSpatialFeatures.js'

function feature(id: string, name: string, lon: number, lat: number, categoryMain = '科教文化服务', categorySub = '高等院校'): SpatialFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      name,
      category_main: categoryMain,
      category_sub: categorySub,
    },
  }
}

describe('NarrativePhase3Runtime', () => {
  it('builds region candidates, LOD, path and grounded narration without LLM structure decisions', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '武汉大学', 114.34, 30.54),
        feature('2', '武汉大学图书馆', 114.341, 30.541, '科教文化服务', '图书馆'),
        feature('3', '东湖风景区', 114.37, 30.56, '风景名胜', '风景名胜'),
        feature('4', '学生宿舍', 114.342, 30.542, '科教文化服务', '宿舍'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'wuda',
          name: '武汉大学',
          fclass: 'university',
          areaSqm: 2_000_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.52, east: 114.35, north: 30.55 }),
        },
        {
          id: 'east-lake',
          name: '东湖风景区',
          fclass: 'park',
          areaSqm: 8_000_000,
          boundary: polygonFromBounds({ west: 114.35, south: 30.54, east: 114.39, north: 30.58 }),
        },
        {
          id: 'jiefang-park',
          name: '解放公园',
          fclass: 'park',
          areaSqm: 460_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.57, east: 114.35, north: 30.595 }),
        },
        {
          id: 'wuchang-riverfront',
          name: '武昌江滩公园',
          fclass: 'park',
          areaSqm: 520_000,
          boundary: polygonFromBounds({ west: 114.355, south: 30.52, east: 114.365, north: 30.56 }),
        },
        {
          id: 'han-riverfront',
          name: '汉口江滩公园',
          fclass: 'park',
          areaSqm: 620_000,
          boundary: polygonFromBounds({ west: 114.31, south: 30.53, east: 114.34, north: 30.57 }),
        },
        {
          id: 'han-street',
          name: '楚河汉街',
          fclass: 'commercial',
          areaSqm: 230_000,
          boundary: polygonFromBounds({ west: 114.335, south: 30.545, east: 114.355, north: 30.56 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'session-1',
      viewport: {
        west: 114.3,
        south: 30.5,
        east: 114.4,
        north: 30.6,
        zoom: 14,
        center: [114.35, 30.55],
      },
    })

    expect(response.session_id).toBe('session-1')
    expect(response.regions.length).toBeGreaterThanOrEqual(6)
    expect(response.path.nodes.length).toBeGreaterThanOrEqual(5)
    expect(response.regions.some((region) => region.role === 'primary_region')).toBe(true)
    expect(response.regions.find((region) => region.display_name === '武昌江滩公园')?.visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    expect(response.regions.flatMap((region) => region.pois).some((poi) => poi.display_name.includes('宿舍') && poi.tier === 'medium')).toBe(true)
    expect(response.path.nodes.length).toBe(response.narration.chapters.length)
    expect(response.narration.chapters.every((chapter) => !/宿舍|广告|优惠/.test(chapter.text))).toBe(true)
  })
})
