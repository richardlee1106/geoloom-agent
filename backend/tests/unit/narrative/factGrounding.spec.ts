import { describe, expect, it } from 'vitest'

import type { NarrativeBoundaryGeometry, NarrativePoi } from '../../../src/narrative/contract.js'
import { buildChapterScaffolds, buildRegionFacts, isAllowedFact } from '../../../src/narrative/factGrounding.js'
import { buildPoiBusinessProfile } from '../../../src/narrative/poiBusinessProfile.js'
import type { RegionCandidate } from '../../../src/narrative/regionCandidate.js'

const boundary: NarrativeBoundaryGeometry = {
  type: 'Polygon',
  coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.6], [114.3, 30.5]]],
}

function region(pois: NarrativePoi[] = []): RegionCandidate {
  return {
    id: 'wut-yujiatou',
    display_name: '武汉理工大学余家头校区',
    role: 'primary_region',
    core_anchor: { id: 'wut-yujiatou', lon: 114.35, lat: 30.55 },
    boundary,
    visual_layer: { mode: 'region_glow', poi_heat: { radius: 24, points: [] } },
    pois,
    narrative_facts: [],
    story_tags: ['education'],
    score: 1,
    source: 'aoi',
    coverage: 0.2,
    diversity: 0.3,
    effectivePoiCount: 3,
  }
}

describe('buildChapterScaffolds', () => {
  it('为每个候选片区生成空文本骨架，仅保留 region_id 与时长元数据', () => {
    const chapters = buildChapterScaffolds({ regions: [region()], lod: 'meso' })

    expect(chapters).toHaveLength(1)
    expect(chapters[0].region_id).toBe('wut-yujiatou')
    expect(chapters[0].text).toBe('')
    expect(chapters[0].generation_error).toBeUndefined()
    expect(chapters[0].length_ms).toBeGreaterThan(0)
    expect(chapters[0].story_tags).toEqual(['education'])
  })

  it('片区数量决定章节数量，顺序与输入一致', () => {
    const right = { ...region(), id: 'right-region', display_name: '右侧片区' }
    const chapters = buildChapterScaffolds({ regions: [region(), right] })

    expect(chapters.map((chapter) => chapter.region_id)).toEqual(['wut-yujiatou', 'right-region'])
    expect(chapters.every((chapter) => chapter.text === '')).toBe(true)
  })

  it('章节时长受 LOD 与有效 POI 数量影响', () => {
    const microShort = buildChapterScaffolds({ regions: [region()], lod: 'micro' })[0]
    const macroShort = buildChapterScaffolds({ regions: [region()], lod: 'macro' })[0]

    expect(microShort.length_ms).toBeGreaterThan(macroShort.length_ms ?? 0)
  })
})

describe('buildRegionFacts', () => {
  it('保留高置信、verified、不命中禁词的事实', () => {
    const facts = buildRegionFacts({ region: region(), scene: 'education_culture' })

    expect(facts.length).toBeGreaterThan(0)
    expect(facts.every((fact) => fact.verified && fact.confidence >= 0.7)).toBe(true)
    expect(facts.every(isAllowedFact)).toBe(true)
  })

  it('AOI 来源的片区生成"拥有可解释的真实地界"事实', () => {
    const facts = buildRegionFacts({ region: region(), scene: 'education_culture' })

    expect(facts.some((fact) => fact.claim.includes('真实地界'))).toBe(true)
  })

  it('把片区业态画像注入可用事实', () => {
    const pois: NarrativePoi[] = [
      { id: 'food-1', lon: 114.35, lat: 30.55, display_name: '甲小吃', tier: 'medium', role: 'scene_evidence', category_main: '餐饮服务', category_sub: '小吃快餐店' },
      { id: 'food-2', lon: 114.351, lat: 30.551, display_name: '乙小吃', tier: 'medium', role: 'scene_evidence', category_main: '餐饮服务', category_sub: '小吃快餐店' },
      { id: 'food-3', lon: 114.352, lat: 30.552, display_name: '丙饭馆', tier: 'medium', role: 'scene_evidence', category_main: '餐饮服务', category_sub: '中餐厅' },
    ]
    const current = {
      ...region(pois),
      business_profile: buildPoiBusinessProfile({ pois }),
    }

    const facts = buildRegionFacts({ region: current, scene: 'commercial_leisure' })

    expect(facts.some((fact) => fact.source === 'poi_business_profile')).toBe(true)
    expect(facts.some((fact) => fact.claim.includes('小吃快餐店'))).toBe(true)
    expect(facts.every((fact) => !fact.claim.includes('POI'))).toBe(true)
  })
})

describe('isAllowedFact', () => {
  it('拒绝未 verified 或置信度低于 0.7 的事实', () => {
    expect(isAllowedFact({
      claim: '某地点是真实地点。',
      source: 'postgis',
      confidence: 0.6,
      verified: true,
      related_entity: { type: 'region', id: 'x' },
    })).toBe(false)

    expect(isAllowedFact({
      claim: '某地点是真实地点。',
      source: 'postgis',
      confidence: 0.9,
      verified: false,
      related_entity: { type: 'region', id: 'x' },
    })).toBe(false)
  })

  it('拒绝命中禁词的事实（住宅、广告、工程术语等）', () => {
    expect(isAllowedFact({
      claim: '某宿舍是真实地点。',
      source: 'postgis',
      confidence: 0.95,
      verified: true,
      related_entity: { type: 'region', id: 'x' },
    })).toBe(false)
  })
})
