import { describe, expect, it } from 'vitest'

import type { NarrativePoi, ViewportBBox } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { buildRegionCandidates } from '../../../src/narrative/regionCandidate.js'

const viewport: ViewportBBox = {
  west: 114.3,
  south: 30.5,
  east: 114.4,
  north: 30.6,
  zoom: 14,
  center: [114.35, 30.55],
}

function poi(id: string, lon: number, lat: number, category = '科教文化服务', tier: NarrativePoi['tier'] = 'strong'): NarrativePoi {
  return {
    id,
    lon,
    lat,
    display_name: `点${id}`,
    tier,
    role: 'scene_evidence',
    category_main: category,
  }
}

describe('buildRegionCandidates', () => {
  it('clips AOI boundary to viewport and keeps representative AOI with few POIs', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'education_culture',
      pois: [poi('1', 114.34, 30.54)],
      aois: [
        {
          id: 'wuda',
          name: '武汉大学',
          fclass: 'university',
          areaSqm: 2_000_000,
          boundary: polygonFromBounds({ west: 114.28, south: 30.48, east: 114.36, north: 30.56 }),
        },
      ],
    })

    expect(candidates[0].role).toBe('primary_region')
    expect(candidates[0].source).toBe('aoi')
    expect(candidates[0].visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    // boundary 已在 materializeCandidate 出口转为 GCJ-02，WGS-84 [114.3, 30.5] 对应 GCJ-02 约 [114.305, 30.497]
    const [gcjLon, gcjLat] = candidates[0].boundary.coordinates[0][0] as [number, number]
    expect(gcjLon).toBeGreaterThan(114.3)
    expect(gcjLon).toBeLessThan(114.32)
    expect(gcjLat).toBeGreaterThan(30.49)
    expect(gcjLat).toBeLessThan(30.51)
  })

  it('uses point-cloud fallback only when diversity gate passes', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        poi('1', 114.32, 30.52, '商务住宅'),
        poi('2', 114.33, 30.53, '商务住宅'),
        poi('3', 114.34, 30.54, '商务住宅'),
      ],
    })

    expect(candidates).toHaveLength(0)
  })

  it('有强证据时弱 POI 不进入 AOI 热力证据', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'education_culture',
      pois: [
        poi('library', 114.34, 30.54, '科教文化服务', 'strong'),
        poi('metro', 114.341, 30.541, '交通设施服务', 'weak'),
      ],
      aois: [
        {
          id: 'hbu',
          name: '湖北大学',
          fclass: 'university',
          areaSqm: 1_000_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    expect(candidates[0].pois.map((item) => item.id)).toEqual(expect.arrayContaining(['library', 'metro']))
    expect(candidates[0].visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    expect(candidates[0].visual_layer.poi_heat?.points.some((point) => point.tier === 'weak')).toBe(false)
    expect(candidates[0].effectivePoiCount).toBe(1)
  })

  it('AOI 内校内设施会恢复为分层证据', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'education_culture',
      pois: [
        { ...poi('dorm', 114.34, 30.54, '科教文化服务', 'excluded'), display_name: '湖北大学学生宿舍' },
        { ...poi('gate', 114.341, 30.541, '通行设施', 'excluded'), display_name: '湖北大学南门出入口' },
      ],
      aois: [
        {
          id: 'hbu',
          name: '湖北大学',
          fclass: 'university',
          areaSqm: 1_000_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    const dorm = candidates[0].pois.find((item) => item.id === 'dorm')
    const gate = candidates[0].pois.find((item) => item.id === 'gate')
    expect(dorm?.tier).toBe('medium')
    expect(gate?.tier).toBe('weak')
    expect(candidates[0].effectivePoiCount).toBe(1)
  })

  it('只有弱设施的 AOI 仍返回低权重可视点', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'natural_ecology',
      pois: [
        { ...poi('parking-a', 114.34, 30.54, '交通设施服务', 'excluded'), display_name: '沙湖公园A区停车场' },
        { ...poi('gate-b', 114.341, 30.541, '通行设施', 'excluded'), display_name: '沙湖公园B区出入口' },
      ],
      aois: [
        {
          id: 'shahu-a',
          name: '沙湖公园A区',
          fclass: 'park',
          areaSqm: 60_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    expect(candidates[0].pois.map((item) => item.id)).toEqual(expect.arrayContaining(['parking-a', 'gate-b']))
    expect(candidates[0].visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    expect(candidates[0].visual_layer.poi_heat?.points.some((point) => point.tier === 'weak')).toBe(true)
    expect(candidates[0].visual_layer.poi_heat?.points.some((point) => point.tier === 'medium')).toBe(true)
    expect(candidates[0].effectivePoiCount).toBe(0)
  })

  it('典型公园 AOI 即使没有 POI 也会生成几何可视锚点', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'natural_ecology',
      pois: [],
      aois: [
        {
          id: 'wuchang-riverfront',
          name: '武昌江滩公园',
          fclass: 'park',
          areaSqm: 500_000,
          boundary: polygonFromBounds({ west: 114.36, south: 30.54, east: 114.39, north: 30.58 }),
        },
      ],
    })

    expect(candidates[0].display_name).toBe('武昌江滩公园')
    expect(candidates[0].pois).toHaveLength(0)
    expect(candidates[0].visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    expect(candidates[0].visual_layer.poi_heat?.points.every((point) => point.tier === 'medium')).toBe(true)
    expect(candidates[0].effectivePoiCount).toBe(0)
  })

  it('商业 AOI 内餐饮购物 POI 会恢复为片区证据', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      pois: [
        { ...poi('food', 114.34, 30.54, '餐饮服务', 'weak'), display_name: '楚河汉街美食店' },
        { ...poi('shop', 114.341, 30.541, '购物服务', 'weak'), display_name: '楚河汉街服饰店' },
        { ...poi('coffee', 114.342, 30.542, '餐饮服务', 'excluded'), display_name: '汉街咖啡' },
      ],
      aois: [
        {
          id: 'han-street',
          name: '楚河汉街',
          fclass: 'commercial',
          areaSqm: 200_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    expect(candidates[0].display_name).toBe('楚河汉街')
    expect(candidates[0].pois.every((item) => item.tier === 'medium')).toBe(true)
    expect(candidates[0].visual_layer.poi_heat?.points.length).toBeGreaterThanOrEqual(7)
    expect(candidates[0].effectivePoiCount).toBe(3)
  })

  it('从 POI 名称中发现步行街抽象片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('food', 114.34, 30.54, '餐饮服务', 'weak'), display_name: '江汉路步行街小吃店' },
        { ...poi('shop', 114.341, 30.541, '购物服务', 'weak'), display_name: '江汉路步行街服饰店' },
        { ...poi('book', 114.342, 30.542, '购物服务', 'weak'), display_name: '江汉路步行街书店' },
      ],
    })

    expect(candidates[0].display_name).toBe('江汉路步行街')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates[0].role).toBe('primary_region')
    expect(candidates[0].effectivePoiCount).toBe(3)
  })

  it('从商业证据中发现商圈抽象片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('mall', 114.36, 30.56, '购物服务', 'medium'), display_name: '徐东商圈购物入口' },
        { ...poi('food', 114.361, 30.561, '餐饮服务', 'medium'), display_name: '徐东商圈美食餐饮' },
        { ...poi('cinema', 114.362, 30.562, '体育休闲服务', 'weak'), display_name: '徐东商圈影城' },
      ],
    })

    expect(candidates[0].display_name).toBe('徐东商圈')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates[0].role).toBe('primary_region')
  })

  it('从道路命名和多点证据中发现街区走廊', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        { ...poi('coffee', 114.35, 30.55, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('book', 114.351, 30.551, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('snack', 114.352, 30.552, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
      ],
    })

    expect(candidates[0].display_name).toBe('水塔街')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates[0].role).toBe('support_region')
  })

  it('道路走廊型抽象片区使用更收敛的走廊边界', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        { ...poi('a', 114.32, 30.55, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('b', 114.36, 30.551, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('c', 114.38, 30.552, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
      ],
    })

    const ring = candidates[0].boundary.coordinates[0]
    const lats = ring.map((point) => point[1])
    const lons = ring.map((point) => point[0])
    expect(Math.max(...lons) - Math.min(...lons)).toBeGreaterThan(Math.max(...lats) - Math.min(...lats))
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(0.01)
  })

  it('行政边界命中时不会抑制同名抽象片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      pois: [
        { ...poi('coffee', 114.35, 30.55, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('book', 114.351, 30.551, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('snack', 114.352, 30.552, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
      ],
      aois: [
        {
          id: 'shuita-subdistrict',
          name: '水塔街道',
          fclass: 'administrative',
          areaSqm: 320_000,
          boundary: polygonFromBounds({ west: 114.345, south: 30.545, east: 114.36, north: 30.56 }),
        },
      ],
    })

    expect(candidates.some((candidate) => candidate.display_name === '水塔街' && candidate.source === 'abstract_region')).toBe(true)
  })

  it('已有同名 AOI 时不重复生成抽象片区抢占主体', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      pois: [
        { ...poi('food', 114.34, 30.54, '餐饮服务', 'weak'), display_name: '江汉路步行街小吃店' },
        { ...poi('shop', 114.341, 30.541, '购物服务', 'weak'), display_name: '江汉路步行街服饰店' },
      ],
      aois: [
        {
          id: 'jianghan-road',
          name: '江汉路步行街',
          fclass: 'commercial',
          areaSqm: 180_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    expect(candidates[0].display_name).toBe('江汉路步行街')
    expect(candidates[0].source).toBe('aoi')
    expect(candidates.filter((candidate) => candidate.source === 'abstract_region')).toHaveLength(0)
  })
})
