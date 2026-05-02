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
    expect(response.narration.chapters.every((chapter) => !/宿舍|广告|优惠|POI|样本|节点|权重|score|tier/.test(chapter.text))).toBe(true)
    expect(response.debug).toBeUndefined()
  })

  it('returns a structured debug snapshot only when requested', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'debug-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.debug?.recall).toMatchObject({
      features_count: 1,
      poi_count: 1,
      renderable_poi_count: 1,
      aoi_count: 1,
    })
    expect(response.debug?.candidates).toMatchObject({
      built_count: expect.any(Number),
      response_count: response.regions.length,
      fallback_used: false,
    })
    expect(response.debug?.lod).toMatchObject({ selected: response.lod })
    expect(response.debug?.path).toMatchObject({ node_count: response.path.nodes.length })
    expect(response.debug?.facts).toMatchObject({ selected_region_count: response.narration.chapters.length })
  })

  it('attaches optional web fact sources to narration chapters', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '武汉市沙湖公园管理处',
          url: 'https://ylj.wuhan.gov.cn/zwgk/zwxxgkzl_12298/jggk_12304/xsdwszjzz_12308/202001/t20200110_726388.shtml',
          snippet: '沙湖公园是武汉市中心城区最大的综合性公园。',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'webfact-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].web_sources?.[0]).toMatchObject({
      title: '武汉市沙湖公园管理处',
      url: expect.stringMatching(/^https:\/\//),
      quality: 'official',
      quality_score: 0.95,
    })
    expect(response.debug?.web_facts).toMatchObject({
      queried_region_count: 1,
      source_count: 1,
    })
  })

  it('sorts optional web fact sources by quality before attaching', async () => {
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => [
        {
          title: '沙湖公园团购优惠',
          url: 'https://example.com/deal',
          snippet: '团购优惠信息',
        },
        {
          title: '武汉市园林和林业局 沙湖公园',
          url: 'https://ylj.wuhan.gov.cn/official',
          snippet: '官方介绍',
        },
      ],
    })

    const response = await runtime.build({
      session_id: 'webfact-quality-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    expect(response.narration.chapters[0].web_sources?.map((source) => source.quality)).toEqual(['official', 'general'])
    expect(response.narration.chapters[0].web_sources?.[0].title).toContain('园林')
  })

  it('keeps web name candidates debug-only without changing structural regions', async () => {
    let queryCount = 0
    const runtime = new NarrativePhase3Runtime({
      fetchSpatialFeatures: async () => [
        feature('1', '沙湖公园', 114.34, 30.56, '风景名胜', '公园广场'),
      ],
      fetchAoiCandidates: async () => [
        {
          id: 'shahu-park',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.32, south: 30.54, east: 114.36, north: 30.58 }),
        },
      ],
      searchWebFacts: async () => {
        queryCount += 1
        return [
          {
            title: '武汉市文旅局介绍江汉路步行街与徐东商圈',
            url: 'https://wlj.wuhan.gov.cn/example',
            snippet: '江汉路步行街、徐东商圈和水塔街是武汉重要城市认知片区。',
          },
        ]
      },
    })

    const response = await runtime.build({
      session_id: 'web-name-debug-session',
      debug: true,
      viewport: {
        west: 114.31,
        south: 30.53,
        east: 114.37,
        north: 30.59,
        zoom: 14,
        center: [114.34, 30.56],
      },
    })

    const debug = response.debug as {
      web_name_candidates?: {
        candidate_count?: number
        structural_effect?: string
        items?: Array<{ name?: string; confidence?: number }>
      }
    }
    expect(queryCount).toBeGreaterThanOrEqual(2)
    expect(debug.web_name_candidates?.structural_effect).toBe('debug_only')
    expect(debug.web_name_candidates?.items?.some((item) => item.name === '江汉路步行街')).toBe(true)
    expect(response.regions.some((region) => region.display_name === '江汉路步行街')).toBe(false)
  })
})
