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

const hankouViewport: ViewportBBox = {
  west: 114.27,
  south: 30.56,
  east: 114.31,
  north: 30.605,
  zoom: 15,
  center: [114.29, 30.585],
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
      pois: [
        poi('1', 114.34, 30.54),
        poi('2', 114.341, 30.541),
        poi('3', 114.342, 30.542),
      ],
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
    expect(candidates[0].visual_layer.poi_heat?.points).toHaveLength(candidates[0].effectivePoiCount)
    // boundary 已在 materializeCandidate 出口转为 GCJ-02，WGS-84 [114.3, 30.5] 对应 GCJ-02 约 [114.305, 30.497]
    const [gcjLon, gcjLat] = candidates[0].boundary.coordinates[0][0] as [number, number]
    expect(gcjLon).toBeGreaterThan(114.3)
    expect(gcjLon).toBeLessThan(114.32)
    expect(gcjLat).toBeGreaterThan(30.49)
    expect(gcjLat).toBeLessThan(30.51)
  })

  it('不再将点云品类聚合暴露成正式活力区片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        poi('1', 114.32, 30.52, '风景名胜'),
        poi('2', 114.33, 30.53, '风景名胜'),
        poi('3', 114.34, 30.54, '风景名胜'),
        poi('4', 114.35, 30.55, '政府机构及社会团体'),
        poi('5', 114.36, 30.56, '政府机构及社会团体'),
        poi('6', 114.37, 30.57, '政府机构及社会团体'),
      ],
    })

    expect(candidates.some((candidate) => /活力区/u.test(candidate.display_name))).toBe(false)
  })

  it('有强证据时弱 POI 不进入 AOI 热力证据', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'education_culture',
      pois: [
        poi('library', 114.34, 30.54, '科教文化服务', 'strong'),
        poi('museum', 114.341, 30.541, '科教文化服务', 'medium'),
        poi('hall', 114.342, 30.542, '科教文化服务', 'medium'),
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
    expect(candidates[0].visual_layer.poi_heat?.points).toHaveLength(candidates[0].effectivePoiCount)
    expect(candidates[0].visual_layer.poi_heat?.points.some((point) => point.tier === 'weak')).toBe(false)
    expect(candidates[0].effectivePoiCount).toBe(3)
  })

  it('AOI 内校内设施只保留已进入召回的真实支撑点', () => {
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

    expect(candidates).toHaveLength(0)
  })

  it('只有弱设施的 AOI 不进入正式片区展示', () => {
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

    expect(candidates).toHaveLength(0)
  })

  it('典型 AOI 没有真实 POI 支撑时不进入正式片区展示', () => {
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

    expect(candidates).toHaveLength(0)
  })

  it('住宅楼盘名包含公园时不会混入正式解说主链', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'natural_ecology',
      pois: [
        { ...poi('a', 114.34, 30.54, '商务住宅', 'medium'), display_name: '公园家南门' },
        { ...poi('b', 114.341, 30.541, '商务住宅', 'medium'), display_name: '公园家物业中心' },
        { ...poi('c', 114.342, 30.542, '商务住宅', 'medium'), display_name: '公园家地下停车场' },
      ],
      aois: [
        {
          id: 'park-home',
          name: '公园家',
          fclass: 'residential',
          areaSqm: 80_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
      ],
    })

    expect(candidates.some((candidate) => candidate.display_name === '公园家')).toBe(false)
  })

  it('商业 AOI 内餐饮购物 POI 会恢复为片区证据', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      pois: [
        { ...poi('food', 114.34, 30.54, '餐饮服务', 'weak'), display_name: '楚河汉街美食店' },
        { ...poi('shop', 114.341, 30.541, '购物服务', 'weak'), display_name: '楚河汉街服饰店' },
        { ...poi('book', 114.342, 30.542, '购物服务', 'weak'), display_name: '楚河汉街书店' },
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
    expect(candidates[0].visual_layer.poi_heat?.points).toHaveLength(candidates[0].effectivePoiCount)
    expect(candidates[0].effectivePoiCount).toBe(3)
  })

  it('从 POI 名称中发现步行街抽象片区', () => {
    const candidates = buildRegionCandidates({
      viewport: hankouViewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('food', 114.286, 30.584, '餐饮服务', 'weak'), display_name: '江汉路步行街小吃店' },
        { ...poi('shop', 114.287, 30.585, '购物服务', 'weak'), display_name: '江汉路步行街服饰店' },
        { ...poi('book', 114.288, 30.586, '购物服务', 'weak'), display_name: '江汉路步行街书店' },
      ],
    })

    expect(candidates[0].display_name).toBe('江汉路步行街')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates[0].role).toBe('primary_region')
    expect(candidates[0].effectivePoiCount).toBe(3)
  })

  it('补充本地人熟悉的过早街、夜市和生活商圈', () => {
    const localCases: Array<{ name: string; viewport: ViewportBBox; pois: NarrativePoi[] }> = [
      {
        name: '广埠屯商圈',
        viewport: { west: 114.34, south: 30.515, east: 114.375, north: 30.54, zoom: 15, center: [114.357, 30.528] },
        pois: [
          { ...poi('gbt-computer', 114.35, 30.525, '购物服务', 'medium'), display_name: '广埠屯电脑城' },
          { ...poi('gbt-info', 114.352, 30.526, '购物服务', 'medium'), display_name: '广埠屯资讯广场' },
          { ...poi('gbt-cyber', 114.354, 30.527, '购物服务', 'medium'), display_name: '赛博数码商铺' },
        ],
      },
      {
        name: '虎泉夜市',
        viewport: { west: 114.35, south: 30.49, east: 114.39, north: 30.525, zoom: 15, center: [114.37, 30.51] },
        pois: [
          { ...poi('hq-food', 114.37, 30.512, '餐饮服务', 'medium'), display_name: '虎泉夜市小吃' },
          { ...poi('hq-street', 114.372, 30.513, '餐饮服务', 'medium'), display_name: '虎泉街餐饮' },
          { ...poi('hq-shop', 114.374, 30.514, '购物服务', 'medium'), display_name: '虎泉夜市商铺' },
        ],
      },
      {
        name: '红钢城',
        viewport: { west: 114.38, south: 30.62, east: 114.43, north: 30.66, zoom: 14, center: [114.405, 30.64] },
        pois: [
          { ...poi('hgc-food', 114.405, 30.64, '餐饮服务', 'medium'), display_name: '红钢城餐饮' },
          { ...poi('hgc-mall', 114.41, 30.642, '购物服务', 'medium'), display_name: '武商众圆广场购物' },
          { ...poi('hgc-shop', 114.407, 30.641, '购物服务', 'medium'), display_name: '红钢城商铺' },
        ],
      },
      {
        name: '粮道街',
        viewport: { west: 114.285, south: 30.535, east: 114.315, north: 30.56, zoom: 16, center: [114.3, 30.547] },
        pois: [
          { ...poi('ldj-zhao', 114.298, 30.545, '餐饮服务', 'medium'), display_name: '粮道街赵师傅红油热干面' },
          { ...poi('ldj-food', 114.3, 30.546, '餐饮服务', 'medium'), display_name: '粮道街油饼包烧卖' },
          { ...poi('ldj-shop', 114.302, 30.547, '餐饮服务', 'medium'), display_name: '粮道街过早小吃' },
        ],
      },
      {
        name: '大成路夜市',
        viewport: { west: 114.285, south: 30.525, east: 114.31, north: 30.55, zoom: 16, center: [114.297, 30.537] },
        pois: [
          { ...poi('dcl-night', 114.296, 30.536, '餐饮服务', 'medium'), display_name: '大成路夜市牛杂' },
          { ...poi('dcl-qiu', 114.298, 30.538, '餐饮服务', 'medium'), display_name: '大成路小秋水饺' },
          { ...poi('dcl-snack', 114.3, 30.539, '餐饮服务', 'medium'), display_name: '大成路夜市小吃' },
        ],
      },
      {
        name: '台北路',
        viewport: { west: 114.255, south: 30.585, east: 114.29, north: 30.615, zoom: 15, center: [114.272, 30.6] },
        pois: [
          { ...poi('tbl-food', 114.272, 30.598, '餐饮服务', 'medium'), display_name: '台北路美食餐饮' },
          { ...poi('tbl-cafe', 114.274, 30.6, '餐饮服务', 'medium'), display_name: '台北一路咖啡' },
          { ...poi('tbl-shop', 114.276, 30.602, '购物服务', 'medium'), display_name: '台北路商铺' },
        ],
      },
      {
        name: '山海关路',
        viewport: { west: 114.29, south: 30.59, east: 114.32, north: 30.615, zoom: 16, center: [114.305, 30.603] },
        pois: [
          { ...poi('shg-ji', 114.302, 30.602, '餐饮服务', 'medium'), display_name: '山海关路李记鸡冠饺' },
          { ...poi('shg-qi', 114.304, 30.604, '餐饮服务', 'medium'), display_name: '山海关路毛氏汽水包' },
          { ...poi('shg-snack', 114.306, 30.606, '餐饮服务', 'medium'), display_name: '山海关路过早小吃' },
        ],
      },
      {
        name: '胜利街',
        viewport: { west: 114.285, south: 30.58, east: 114.32, north: 30.61, zoom: 16, center: [114.302, 30.595] },
        pois: [
          { ...poi('slj-ms', 114.3, 30.594, '餐饮服务', 'medium'), display_name: '胜利街三镇民生甜食馆' },
          { ...poi('slj-noodle', 114.302, 30.596, '餐饮服务', 'medium'), display_name: '胜利街热干面' },
          { ...poi('slj-shop', 114.304, 30.598, '餐饮服务', 'medium'), display_name: '胜利街餐饮商铺' },
        ],
      },
      {
        name: '保成路夜市',
        viewport: { west: 114.275, south: 30.57, east: 114.3, north: 30.595, zoom: 16, center: [114.287, 30.583] },
        pois: [
          { ...poi('bcl-food', 114.286, 30.582, '餐饮服务', 'medium'), display_name: '保成路夜市小吃' },
          { ...poi('bcl-shop', 114.288, 30.584, '购物服务', 'medium'), display_name: '保成路夜市服饰' },
          { ...poi('bcl-night', 114.29, 30.586, '餐饮服务', 'medium'), display_name: '保成路夜市餐饮' },
        ],
      },
    ]

    for (const localCase of localCases) {
      const candidates = buildRegionCandidates({
        viewport: localCase.viewport,
        scene: 'commercial_leisure',
        aois: [],
        pois: localCase.pois,
      })
      const candidate = candidates.find((item) => item.display_name === localCase.name)
      expect(candidates.map((item) => item.display_name)).toContain(localCase.name)
      expect(candidate?.source).toBe('abstract_region')
      expect(candidate?.effectivePoiCount).toBeGreaterThanOrEqual(localCase.pois.length)
    }
  })

  it('非预设商圈和居民区商业点不会被自由命名成抽象商圈', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('a', 114.36, 30.56, '购物服务', 'medium'), display_name: '王府井商圈便利店' },
        { ...poi('b', 114.361, 30.561, '餐饮服务', 'medium'), display_name: '世纪江尚商圈咖啡店' },
        { ...poi('c', 114.362, 30.562, '商务住宅', 'medium'), display_name: '世纪江尚小区底商' },
      ],
    })

    expect(candidates.some((candidate) => /王府井商圈|世纪江尚商圈|世纪江尚/u.test(candidate.display_name))).toBe(false)
    expect(candidates.every((candidate) => !/购物服务活力区|餐饮服务活力区/u.test(candidate.display_name))).toBe(true)
  })


  it('缩小尺度时将徐东商业锚点上卷为徐东商圈', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('xp', 114.342, 30.59, '购物服务', 'medium'), display_name: '销品茂购物中心' },
        { ...poi('oyd', 114.343, 30.591, '购物服务', 'medium'), display_name: '欧亚达家居徐东店' },
        { ...poi('mix', 114.344, 30.592, '购物服务', 'medium'), display_name: '武汉徐东万象汇' },
        { ...poi('food', 114.345, 30.593, '餐饮服务', 'weak'), display_name: '徐东大街美食餐饮' },
      ],
    })

    expect(candidates[0].display_name).toBe('徐东商圈')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates.some((candidate) => candidate.display_name === '销品茂')).toBe(false)
    expect(candidates.some((candidate) => candidate.display_name === '万象汇')).toBe(false)
    expect(candidates.some((candidate) => candidate.display_name === '团结')).toBe(false)
  })

  it('销品茂和欧亚达同级出现时仍上卷为徐东商圈', () => {
    const candidates = buildRegionCandidates({
      viewport: {
        west: 114.32,
        south: 30.56,
        east: 114.39,
        north: 30.615,
        zoom: 13,
        center: [114.36, 30.59],
      },
      scene: 'commercial_leisure',
      aois: [
        {
          id: 'xpm',
          name: '销品茂',
          fclass: 'mall',
          areaSqm: 90_000,
          boundary: polygonFromBounds({ west: 114.335, south: 30.585, east: 114.35, north: 30.598 }),
        },
        {
          id: 'oyd',
          name: '欧亚达家居',
          fclass: 'mall',
          areaSqm: 80_000,
          boundary: polygonFromBounds({ west: 114.35, south: 30.595, east: 114.365, north: 30.608 }),
        },
      ],
      pois: [
        { ...poi('xp', 114.342, 30.59, '购物服务', 'medium'), display_name: '销品茂购物中心' },
        { ...poi('oyd', 114.358, 30.602, '购物服务', 'medium'), display_name: '欧亚达家居徐东店' },
      ],
    })

    expect(candidates[0].display_name).toBe('徐东商圈')
    expect(candidates.map((candidate) => candidate.display_name)).not.toEqual(expect.arrayContaining(['销品茂', '欧亚达家居']))
  })

  it('同一视口只保留一个主导抽象主商圈，避免多个远距商圈一起展示', () => {
    const candidates = buildRegionCandidates({
      viewport: {
        west: 114.315,
        south: 30.535,
        east: 114.39,
        north: 30.615,
        zoom: 13,
        center: [114.36, 30.59],
      },
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('xp', 114.342, 30.59, '购物服务', 'medium'), display_name: '销品茂购物中心' },
        { ...poi('oyd', 114.343, 30.591, '购物服务', 'medium'), display_name: '欧亚达家居徐东店' },
        { ...poi('mix', 114.344, 30.592, '购物服务', 'medium'), display_name: '武汉徐东万象汇' },
        { ...poi('dream', 114.35, 30.57, '购物服务', 'medium'), display_name: '武商梦时代购物中心' },
        { ...poi('zn', 114.345, 30.565, '购物服务', 'medium'), display_name: '中南路中商广场' },
        { ...poi('zb', 114.35, 30.575, '餐饮服务', 'medium'), display_name: '中北路商业餐饮' },
      ],
    })

    const primaryAbstractNames = candidates
      .filter((candidate) => candidate.source === 'abstract_region' && candidate.role === 'primary_region')
      .map((candidate) => candidate.display_name)
    expect(primaryAbstractNames).toEqual(['徐东商圈'])
  })

  it('湖北大学附近不会把中南中北商圈误投影到校园北侧', () => {
    const candidates = buildRegionCandidates({
      viewport: {
        west: 114.32,
        south: 30.57,
        east: 114.39,
        north: 30.615,
        zoom: 14,
        center: [114.355, 30.592],
      },
      scene: 'education_culture',
      aois: [
        {
          id: 'hubei-university',
          name: '湖北大学',
          fclass: 'university',
          areaSqm: 1_200_000,
          boundary: polygonFromBounds({ west: 114.335, south: 30.58, east: 114.36, north: 30.6 }),
        },
      ],
      pois: [
        { ...poi('hbu-library', 114.345, 30.59, '科教文化服务', 'strong'), display_name: '湖北大学图书馆' },
        { ...poi('hbu-museum', 114.347, 30.592, '科教文化服务', 'medium'), display_name: '湖北大学校史馆' },
        { ...poi('dream', 114.352, 30.583, '购物服务', 'medium'), display_name: '武商梦时代购物中心' },
        { ...poi('mall', 114.353, 30.584, '购物服务', 'medium'), display_name: '中南路商业配套' },
      ],
    })

    expect(candidates.map((candidate) => candidate.display_name)).not.toContain('中南中北商圈')
  })

  it('徐东视口不会把跨城区 profile 名称误投影成候选片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('lingjiao-1', 114.342, 30.59, '餐饮服务', 'medium'), display_name: '菱角湖万达餐饮' },
        { ...poi('lingjiao-2', 114.343, 30.591, '购物服务', 'medium'), display_name: '菱角湖商圈咖啡' },
        { ...poi('lingjiao-3', 114.344, 30.592, '购物服务', 'medium'), display_name: '唐家墩新华路购物' },
        { ...poi('jiqing-1', 114.345, 30.593, '餐饮服务', 'medium'), display_name: '吉庆街小吃' },
        { ...poi('jiqing-2', 114.346, 30.594, '餐饮服务', 'medium'), display_name: '大智路餐饮' },
        { ...poi('tanhualin-1', 114.347, 30.595, '购物服务', 'medium'), display_name: '昙华林文创店' },
        { ...poi('tanhualin-2', 114.348, 30.596, '餐饮服务', 'medium'), display_name: '胭脂路咖啡' },
        { ...poi('hanzheng-1', 114.349, 30.597, '购物服务', 'medium'), display_name: '汉正街市场服饰' },
        { ...poi('hanzheng-2', 114.35, 30.598, '购物服务', 'medium'), display_name: '多福路品牌服饰批发广场' },
        { ...poi('hanzheng-3', 114.351, 30.599, '购物服务', 'medium'), display_name: '第一大道商铺' },
        { ...poi('tiandi-1', 114.352, 30.59, '餐饮服务', 'medium'), display_name: '武汉天地餐饮' },
        { ...poi('tiandi-2', 114.353, 30.591, '购物服务', 'medium'), display_name: '壹方购物中心商铺' },
        { ...poi('tiandi-3', 114.354, 30.592, '购物服务', 'medium'), display_name: '芦沟桥路购物' },
        { ...poi('hgc-1', 114.355, 30.593, '餐饮服务', 'medium'), display_name: '红钢城餐饮' },
        { ...poi('hq-1', 114.356, 30.594, '餐饮服务', 'medium'), display_name: '虎泉夜市小吃' },
        { ...poi('ldj-1', 114.357, 30.595, '餐饮服务', 'medium'), display_name: '粮道街赵师傅热干面' },
        { ...poi('bcl-1', 114.358, 30.596, '餐饮服务', 'medium'), display_name: '保成路夜市小吃' },
      ],
    })

    expect(candidates.map((candidate) => candidate.display_name).join(' ')).not.toMatch(/菱角湖|吉庆街|昙华林|汉正街|武汉天地|红钢城|虎泉夜市|粮道街|保成路夜市/)
  })


  it('商业综合体先由真实消费 POI 撑起，再参与父级商圈抽象', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'commercial_leisure',
      aois: [],
      pois: [
        { ...poi('xp-food', 114.342, 30.59, '餐饮服务', 'medium'), display_name: '销品茂美食餐饮' },
        { ...poi('xp-shop', 114.3425, 30.5905, '购物服务', 'medium'), display_name: '销品茂服饰店' },
        { ...poi('mix-food', 114.344, 30.592, '餐饮服务', 'medium'), display_name: '武汉徐东万象汇餐饮' },
        { ...poi('mix-shop', 114.3445, 30.5925, '购物服务', 'medium'), display_name: '武汉徐东万象汇商铺' },
        { ...poi('oyd-home', 114.343, 30.591, '购物服务', 'medium'), display_name: '欧亚达家居徐东店' },
      ],
    })

    const xudong = candidates.find((candidate) => candidate.display_name === '徐东商圈')
    expect(xudong?.effectivePoiCount).toBeGreaterThanOrEqual(3)
    expect(xudong?.visual_layer.poi_heat?.points.length).toBe(xudong?.effectivePoiCount)
    expect(xudong?.pois.map((item) => item.display_name).join(' ')).toMatch(/销品茂|万象汇|欧亚达/)
  })
  it('不会把团结大道截断成含义不明的团结片区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        { ...poi('a', 114.342, 30.542, '购物服务', 'medium'), display_name: '团结大道便利店' },
        { ...poi('b', 114.343, 30.543, '餐饮服务', 'medium'), display_name: '团结大道餐饮' },
        { ...poi('c', 114.344, 30.544, '购物服务', 'medium'), display_name: '团结大道商铺' },
      ],
    })

    expect(candidates.some((candidate) => candidate.display_name === '团结')).toBe(false)
  })
  it('从道路命名和多点证据中发现街区走廊', () => {
    const candidates = buildRegionCandidates({
      viewport: hankouViewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        { ...poi('coffee', 114.286, 30.575, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('book', 114.287, 30.576, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('snack', 114.288, 30.577, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
      ],
    })

    expect(candidates[0].display_name).toBe('水塔街')
    expect(candidates[0].source).toBe('abstract_region')
    expect(candidates[0].role).toBe('support_region')
  })

  it('道路走廊型抽象片区使用更收敛的走廊边界', () => {
    const candidates = buildRegionCandidates({
      viewport: hankouViewport,
      scene: 'mixed_urban',
      aois: [],
      pois: [
        { ...poi('a', 114.272, 30.575, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('b', 114.286, 30.576, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('c', 114.298, 30.577, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
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
      viewport: hankouViewport,
      scene: 'mixed_urban',
      pois: [
        { ...poi('coffee', 114.286, 30.575, '餐饮服务', 'medium'), display_name: '水塔街咖啡馆' },
        { ...poi('book', 114.287, 30.576, '购物服务', 'medium'), display_name: '水塔街书店' },
        { ...poi('snack', 114.288, 30.577, '餐饮服务', 'weak'), display_name: '水塔街小吃店' },
      ],
      aois: [
        {
          id: 'admin-shuita',
          name: '水塔街道',
          fclass: 'administrative',
          areaSqm: 900_000,
          boundary: polygonFromBounds({ west: 114.28, south: 30.57, east: 114.3, north: 30.59 }),
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

  it('沙湖公园裸名会标注为当前视野内片区，避免误导为完整公园', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'natural_ecology',
      pois: [
        { ...poi('trail', 114.34, 30.54, '风景名胜', 'medium'), display_name: '沙湖公园步道' },
        { ...poi('lake', 114.341, 30.541, '风景名胜', 'medium'), display_name: '沙湖公园湖岸' },
      ],
      aois: [
        {
          id: 'shahu',
          name: '沙湖公园',
          fclass: 'park',
          areaSqm: 2_000_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.36, north: 30.56 }),
        },
      ],
    })

    expect(candidates[0].display_name).toBe('沙湖公园（视野内片区）')
  })

  it('剔除党校、医院 AOI，且不生成住宿服务活力区', () => {
    const candidates = buildRegionCandidates({
      viewport,
      scene: 'education_culture',
      pois: [
        { ...poi('hotel-a', 114.342, 30.542, '住宿服务', 'strong'), display_name: '城市便捷酒店' },
        { ...poi('hotel-b', 114.343, 30.543, '住宿服务', 'strong'), display_name: '如家酒店' },
        { ...poi('hotel-c', 114.344, 30.544, '住宿服务', 'medium'), display_name: '汉庭酒店' },
      ],
      aois: [
        {
          id: 'party-school',
          name: '中国铁路武汉局集团有限公司党校',
          fclass: 'school',
          areaSqm: 80_000,
          boundary: polygonFromBounds({ west: 114.33, south: 30.53, east: 114.35, north: 30.55 }),
        },
        {
          id: 'hospital',
          name: '武汉大学人民医院',
          fclass: 'hospital',
          areaSqm: 180_000,
          boundary: polygonFromBounds({ west: 114.35, south: 30.54, east: 114.37, north: 30.56 }),
        },
      ],
    })

    expect(candidates.some((candidate) => /党校|医院|住宿服务活力区/u.test(candidate.display_name))).toBe(false)
  })
})
