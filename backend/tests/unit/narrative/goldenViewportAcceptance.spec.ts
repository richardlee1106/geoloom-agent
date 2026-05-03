import { describe, expect, it } from 'vitest'

import type { NarrativeResponse, ViewportBBox } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { NarrativePhase3Runtime } from '../../../src/narrative/NarrativePhase3Runtime.js'
import type { AoiCandidateRow } from '../../../src/narrative/regionCandidate.js'
import type { SpatialFeature, SpatialFetchRequest } from '../../../src/spatial/fetchSpatialFeatures.js'

const FORBIDDEN_TEXT_RE = /宿舍|家属区|楼栋|服务中心|广告|优惠|POI|样本|节点|权重|score|tier/u

interface GoldenWorld {
  features: SpatialFeature[]
  aois: AoiCandidateRow[]
}

interface DebugSnapshot {
  recall?: { features_count?: number; aoi_count?: number; renderable_poi_count?: number }
  candidates?: { built_count?: number; fallback_used?: boolean; items?: Array<{ name?: string; role?: string; source?: string; coverage?: number }> }
  lod?: { selected?: string }
  path?: { node_count?: number }
  facts?: { selected_region_count?: number }
  web_facts?: { queried_region_count?: number; source_count?: number }
}

function feature(id: string, name: string, lon: number, lat: number, categoryMain: string, categorySub = categoryMain): SpatialFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      name,
      category_main: categoryMain,
      category_sub: categorySub,
      geom_longitude: lon,
      geom_latitude: lat,
      coordSys: 'wgs84',
    },
  }
}

function aoi(id: string, name: string, bounds: { west: number; south: number; east: number; north: number }, fclass: string, areaSqm: number): AoiCandidateRow {
  return {
    id,
    name,
    fclass,
    areaSqm,
    boundary: polygonFromBounds(bounds),
  }
}

function overlapsViewport(aoiRow: AoiCandidateRow, viewport: ViewportBBox): boolean {
  const ring = aoiRow.boundary.coordinates[0]
  const lons = ring.map((point) => point[0])
  const lats = ring.map((point) => point[1])
  return Math.max(...lons) > viewport.west
    && Math.min(...lons) < viewport.east
    && Math.max(...lats) > viewport.south
    && Math.min(...lats) < viewport.north
}

function normalizeBounds(input: SpatialFetchRequest): [number, number, number, number] | null {
  if (!Array.isArray(input.bounds) || input.bounds.length < 4) return null
  const [west, south, east, north] = input.bounds.map(Number)
  return [west, south, east, north]
}

function isFeatureInBounds(featureItem: SpatialFeature, bounds: [number, number, number, number] | null): boolean {
  if (!bounds) return true
  const [west, south, east, north] = bounds
  const lon = Number(featureItem.properties.geom_longitude ?? featureItem.geometry.coordinates[0])
  const lat = Number(featureItem.properties.geom_latitude ?? featureItem.geometry.coordinates[1])
  return lon >= west && lon <= east && lat >= south && lat <= north
}

function runtimeFromWorld(world: GoldenWorld, options: { withWebFacts?: boolean } = {}) {
  return new NarrativePhase3Runtime({
    fetchSpatialFeatures: async (input) => world.features.filter((item) => isFeatureInBounds(item, normalizeBounds(input))),
    fetchAoiCandidates: async (viewport) => world.aois.filter((item) => overlapsViewport(item, viewport)),
    searchWebFacts: options.withWebFacts
      ? async (query) => [{ title: `${query}来源`, url: 'https://example.com/source', snippet: '验收来源' }]
      : undefined,
  })
}

function campusFeatures(prefix: string, name: string, lon: number, lat: number): SpatialFeature[] {
  return [
    feature(`${prefix}-main`, name, lon, lat, '科教文化服务', '高等院校'),
    feature(`${prefix}-library`, `${name}图书馆`, lon + 0.002, lat + 0.001, '科教文化服务', '图书馆'),
    feature(`${prefix}-museum`, `${name}博物馆`, lon - 0.002, lat + 0.001, '科教文化服务', '博物馆'),
    feature(`${prefix}-stadium`, `${name}体育馆`, lon + 0.001, lat - 0.002, '体育休闲服务', '体育馆'),
    feature(`${prefix}-dorm`, `${name}学生宿舍`, lon - 0.001, lat - 0.002, '科教文化服务', '宿舍'),
    feature(`${prefix}-canteen`, `${name}食堂`, lon + 0.003, lat - 0.001, '餐饮服务', '食堂'),
  ]
}

function parkFeatures(prefix: string, name: string, lon: number, lat: number): SpatialFeature[] {
  return [
    feature(`${prefix}-main`, name, lon, lat, '风景名胜', '公园广场'),
    feature(`${prefix}-trail`, `${name}环湖步道`, lon + 0.002, lat, '风景名胜', '步道'),
    feature(`${prefix}-square`, `${name}观景广场`, lon - 0.002, lat + 0.001, '风景名胜', '广场'),
    feature(`${prefix}-dock`, `${name}亲水平台`, lon + 0.001, lat - 0.002, '风景名胜', '观景点'),
  ]
}

function commercialFeatures(prefix: string, name: string, lon: number, lat: number): SpatialFeature[] {
  return [
    feature(`${prefix}-main`, name, lon, lat, '购物服务', '商业街'),
    feature(`${prefix}-food`, `${name}美食街`, lon + 0.001, lat + 0.001, '餐饮服务', '中餐厅'),
    feature(`${prefix}-book`, `${name}书店`, lon - 0.001, lat, '购物服务', '书店'),
    feature(`${prefix}-cinema`, `${name}影城`, lon, lat - 0.001, '体育休闲服务', '电影院'),
  ]
}

function viewport(name: 'micro' | 'meso' | 'macro' | 'dense' | 'abstract' | 'empty'): ViewportBBox {
  const values = {
    micro: { west: 114.32, south: 30.52, east: 114.36, north: 30.56, zoom: 15, center: [114.34, 30.54] },
    meso: { west: 114.31, south: 30.52, east: 114.39, north: 30.60, zoom: 14, center: [114.35, 30.56] },
    macro: { west: 114.24, south: 30.48, east: 114.52, north: 30.68, zoom: 12, center: [114.38, 30.58] },
    dense: { west: 114.32, south: 30.53, east: 114.37, north: 30.58, zoom: 15, center: [114.345, 30.555] },
    abstract: { west: 114.25, south: 30.54, east: 114.39, north: 30.63, zoom: 13, center: [114.32, 30.585] },
    empty: { west: 114.1, south: 30.1, east: 114.12, north: 30.12, zoom: 15, center: [114.11, 30.11] },
  } satisfies Record<string, ViewportBBox>
  return values[name]
}

function microWorld(): GoldenWorld {
  return {
    features: campusFeatures('wuda', '武汉大学', 114.34, 30.54),
    aois: [aoi('wuda', '武汉大学', { west: 114.322, south: 30.522, east: 114.358, north: 30.558 }, 'university', 2_000_000)],
  }
}

function mesoWorld(): GoldenWorld {
  return {
    features: [
      ...campusFeatures('hbu', '湖北大学', 114.336, 30.55),
      ...parkFeatures('shahu', '沙湖公园', 114.372, 30.58),
      ...commercialFeatures('hanjie', '楚河汉街', 114.365, 30.555),
      ...parkFeatures('riverfront', '武昌江滩公园', 114.324, 30.565),
    ],
    aois: [
      aoi('hbu', '湖北大学', { west: 114.312, south: 30.53, east: 114.352, north: 30.57 }, 'university', 1_500_000),
      aoi('shahu', '沙湖公园', { west: 114.358, south: 30.565, east: 114.386, north: 30.595 }, 'park', 1_200_000),
      aoi('hanjie', '楚河汉街', { west: 114.358, south: 30.545, east: 114.382, north: 30.568 }, 'commercial', 350_000),
      aoi('riverfront', '武昌江滩公园', { west: 114.314, south: 30.548, east: 114.336, north: 30.586 }, 'park', 520_000),
    ],
  }
}

function macroWorld(): GoldenWorld {
  return {
    features: [
      ...campusFeatures('wuda', '武汉大学', 114.34, 30.54),
      ...campusFeatures('hust', '华中科技大学', 114.415, 30.515),
      ...parkFeatures('eastlake', '东湖风景区', 114.41, 30.57),
      ...parkFeatures('shahu', '沙湖公园', 114.355, 30.57),
      ...parkFeatures('riverfront', '武昌江滩公园', 114.31, 30.56),
      ...commercialFeatures('hanjie', '楚河汉街', 114.36, 30.55),
      feature('tower-main', '黄鹤楼', 114.305, 30.545, '风景名胜', '古迹'),
      feature('station-main', '武昌火车站', 114.315, 30.53, '交通设施服务', '火车站'),
      feature('hospital-main', '武汉大学人民医院', 114.32, 30.535, '医疗保健服务', '综合医院'),
    ],
    aois: [
      aoi('wuda', '武汉大学', { west: 114.325, south: 30.525, east: 114.36, north: 30.56 }, 'university', 2_000_000),
      aoi('hust', '华中科技大学', { west: 114.395, south: 30.5, east: 114.435, north: 30.535 }, 'university', 2_400_000),
      aoi('eastlake', '东湖风景区', { west: 114.39, south: 30.55, east: 114.45, north: 30.61 }, 'park', 8_000_000),
      aoi('shahu', '沙湖公园', { west: 114.34, south: 30.555, east: 114.38, north: 30.595 }, 'park', 1_200_000),
      aoi('riverfront', '武昌江滩公园', { west: 114.295, south: 30.535, east: 114.325, north: 30.585 }, 'park', 520_000),
      aoi('hanjie', '楚河汉街', { west: 114.35, south: 30.54, east: 114.375, north: 30.565 }, 'commercial', 350_000),
      aoi('yellow-crane', '黄鹤楼公园', { west: 114.295, south: 30.535, east: 114.315, north: 30.555 }, 'park', 320_000),
    ],
  }
}

function denseNoiseWorld(): GoldenWorld {
  return {
    features: [
      ...campusFeatures('hbu', '湖北大学', 114.345, 30.555),
      feature('noise-parking', '湖北大学停车场', 114.346, 30.556, '交通设施服务', '停车场'),
      feature('noise-gate', '湖北大学服务中心', 114.347, 30.557, '生活服务', '服务中心'),
      feature('noise-ad', '校园优惠广告牌', 114.344, 30.554, '公共设施', '广告牌'),
      feature('noise-dorm-2', '湖北大学二号学生宿舍', 114.343, 30.553, '科教文化服务', '宿舍'),
    ],
    aois: [aoi('hbu', '湖北大学', { west: 114.327, south: 30.537, east: 114.363, north: 30.573 }, 'university', 1_500_000)],
  }
}

function abstractRegionWorld(): GoldenWorld {
  return {
    features: [
      feature('jianghan-food', '江汉路步行街小吃店', 114.285, 30.585, '餐饮服务', '小吃'),
      feature('jianghan-shop', '江汉路步行街服饰店', 114.287, 30.587, '购物服务', '服饰'),
      feature('jianghan-book', '江汉路步行街书店', 114.289, 30.589, '购物服务', '书店'),
      feature('xudong-xpm-food', '销品茂美食餐饮', 114.34, 30.59, '餐饮服务', '中餐厅'),
      feature('xudong-xpm-shop', '销品茂服饰店', 114.341, 30.591, '购物服务', '服饰'),
      feature('xudong-mixc-food', '武汉徐东万象汇餐饮', 114.342, 30.592, '餐饮服务', '中餐厅'),
      feature('xudong-mixc-shop', '武汉徐东万象汇商铺', 114.343, 30.593, '购物服务', '商铺'),
      feature('xudong-oyd-home', '欧亚达家居徐东店', 114.344, 30.594, '购物服务', '家居'),
      feature('shuita-coffee', '水塔街咖啡馆', 114.295, 30.575, '餐饮服务', '咖啡厅'),
      feature('shuita-book', '水塔街书店', 114.297, 30.577, '购物服务', '书店'),
      feature('shuita-snack', '水塔街小吃店', 114.299, 30.579, '餐饮服务', '小吃'),
    ],
    aois: [],
  }
}

function emptyWorld(): GoldenWorld {
  return { features: [], aois: [] }
}

function expectCommonPhase3Invariants(response: NarrativeResponse) {
  expect(response.session_id).toBeTruthy()
  expect(response.state_version).toBe(1)
  expect(response.regions.length).toBeGreaterThanOrEqual(1)
  expect(response.path.nodes.length).toBe(response.narration.chapters.length)
  expect(response.path.nodes.length).toBeGreaterThanOrEqual(1)
  expect(response.path.seed).toContain(response.session_id)
  expect(response.path.nodes.every((node) => response.regions.some((region) => region.id === node.region_id))).toBe(true)
  expect(response.narration.chapters.every((chapter) => !FORBIDDEN_TEXT_RE.test(chapter.text))).toBe(true)
  expect(response.regions.flatMap((region) => region.narrative_facts).every((fact) => fact.verified && fact.confidence >= 0.7 && !FORBIDDEN_TEXT_RE.test(fact.claim))).toBe(true)
  expect(response.regions.every((region) => region.boundary.type === 'Polygon' && region.core_anchor.lon > 70 && region.core_anchor.lat > 10)).toBe(true)
  expect(response.debug).toMatchObject({
    recall: { features_count: expect.any(Number), aoi_count: expect.any(Number), renderable_poi_count: expect.any(Number) },
    candidates: { built_count: expect.any(Number), fallback_used: expect.any(Boolean) },
    lod: { selected: response.lod },
    path: { node_count: response.path.nodes.length },
    facts: { selected_region_count: response.narration.chapters.length },
    web_facts: { queried_region_count: expect.any(Number), source_count: expect.any(Number) },
  })
}

describe('Narrative phase 3 golden viewport acceptance', () => {
  it('通过单主体高校视野的 Micro 验收', async () => {
    const runtime = runtimeFromWorld(microWorld())
    const response = await runtime.build({ session_id: 'golden-micro', viewport: viewport('micro'), debug: true })
    const debug = response.debug as DebugSnapshot

    expectCommonPhase3Invariants(response)
    expect(response.lod).toBe('micro')
    expect(response.regions[0]?.display_name).toBe('武汉大学')
    expect(debug.candidates?.fallback_used).toBe(false)
    expect(debug.candidates?.items?.some((item) => item.name === '武汉大学' && item.role === 'primary_region')).toBe(true)
  })

  it('通过高校公园商业混合视野的 Meso 验收', async () => {
    const runtime = runtimeFromWorld(mesoWorld(), { withWebFacts: true })
    const response = await runtime.build({ session_id: 'golden-meso', viewport: viewport('meso'), debug: true })
    const regionNames = response.regions.map((region) => region.display_name)
    const debug = response.debug as DebugSnapshot

    expectCommonPhase3Invariants(response)
    expect(response.lod).toBe('meso')
    expect(regionNames).toContain('湖北大学')
    expect(regionNames).toContain('沙湖公园')
    expect(response.path.nodes.length).toBeGreaterThanOrEqual(3)
    expect(response.narration.chapters.some((chapter) => (chapter.web_sources?.length || 0) > 0)).toBe(true)
    expect(debug.web_facts?.source_count).toBeGreaterThan(0)
  })

  it('通过城市级多片区视野的 Macro 验收', async () => {
    const runtime = runtimeFromWorld(macroWorld())
    const response = await runtime.build({ session_id: 'golden-macro', viewport: viewport('macro'), debug: true })
    const debug = response.debug as DebugSnapshot
    const expectedRegionHits = response.regions
      .filter((region) => ['武汉大学', '华中科技大学', '东湖风景区', '沙湖公园', '武昌江滩公园', '楚河汉街', '黄鹤楼公园'].includes(region.display_name))
      .length

    expectCommonPhase3Invariants(response)
    expect(response.lod).toBe('macro')
    expect(response.candidate_count).toBeGreaterThanOrEqual(6)
    expect(response.path.nodes.length).toBeGreaterThanOrEqual(6)
    expect(response.semantic_diversity).toBeGreaterThan(1.2)
    expect(expectedRegionHits).toBeGreaterThanOrEqual(5)
    expect(debug.candidates?.items?.length).toBeGreaterThanOrEqual(6)
  })

  it('通过噪声密集视野的主链过滤验收', async () => {
    const runtime = runtimeFromWorld(denseNoiseWorld())
    const response = await runtime.build({ session_id: 'golden-dense-noise', viewport: viewport('dense'), debug: true })
    const pathRoles = response.path.nodes
      .map((node) => response.regions.find((region) => region.id === node.region_id)?.role)
      .filter(Boolean)

    expectCommonPhase3Invariants(response)
    expect(response.regions[0]?.display_name).toBe('湖北大学')
    expect(pathRoles).not.toContain('micro_facility')
    expect(pathRoles).not.toContain('noise')
  })

  it('通过城市认知抽象片区视野验收', async () => {
    const runtime = runtimeFromWorld(abstractRegionWorld())
    const response = await runtime.build({ session_id: 'golden-abstract-region', viewport: viewport('abstract'), debug: true })
    const regionNames = response.regions.map((region) => region.display_name)
    const debug = response.debug as DebugSnapshot

    expectCommonPhase3Invariants(response)
    expect(regionNames).toContain('江汉路步行街')
    expect(regionNames).toContain('徐东商圈')
    expect(regionNames).toContain('水塔街')
    expect(debug.candidates?.items?.filter((item) => item.source === 'abstract_region').length).toBeGreaterThanOrEqual(3)
    expect(response.path.nodes.length).toBeGreaterThanOrEqual(3)
  })

  it('通过空召回视野的 fallback 验收', async () => {
    const runtime = runtimeFromWorld(emptyWorld())
    const response = await runtime.build({ session_id: 'golden-empty', viewport: viewport('empty'), debug: true })
    const debug = response.debug as DebugSnapshot

    expectCommonPhase3Invariants(response)
    expect(response.lod).toBe('micro')
    expect(response.candidate_count).toBe(1)
    expect(response.regions[0]?.display_name).toBe('混合城区概览')
    expect(debug.candidates?.fallback_used).toBe(true)
    expect(debug.recall?.features_count).toBe(0)
    expect(debug.recall?.aoi_count).toBe(0)
  })
})
