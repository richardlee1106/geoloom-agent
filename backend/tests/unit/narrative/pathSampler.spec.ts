import { describe, expect, it } from 'vitest'

import type { NarrativePoi, StoryTag, ViewportBBox } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { sampleNarrativePath } from '../../../src/narrative/pathSampler.js'
import { buildRegionRelation } from '../../../src/narrative/regionRelations.js'
import type { RegionCandidate } from '../../../src/narrative/regionCandidate.js'

const viewport: ViewportBBox = {
  west: 114.3,
  south: 30.5,
  east: 114.5,
  north: 30.7,
  zoom: 13,
  center: [114.4, 30.6],
}

function candidate(id: string, role: RegionCandidate['role'], lon: number, lat: number, score: number, categoryMain = '科教文化服务'): RegionCandidate {
  const poi: NarrativePoi = {
    id: `poi-${id}`,
    lon,
    lat,
    display_name: id,
    tier: 'strong',
    role: 'scene_evidence',
    category_main: categoryMain,
    story_tags: categoryMain === '风景名胜' ? ['ecology'] : categoryMain === '餐饮服务' ? ['food'] : categoryMain === '购物服务' ? ['commerce'] : ['education'],
  }
  const boundary = polygonFromBounds({ west: lon - 0.005, south: lat - 0.005, east: lon + 0.005, north: lat + 0.005 })
  return {
    id,
    display_name: id,
    role,
    core_anchor: { id, lon, lat },
    boundary,
    visual_layer: { mode: 'region_glow' },
    pois: [poi],
    narrative_facts: [],
    story_tags: poi.story_tags,
    score,
    source: 'aoi',
    coverage: 0.1,
    diversity: 0.8,
    effectivePoiCount: 1,
  }
}

function withTags(item: RegionCandidate, storyTags: StoryTag[]): RegionCandidate {
  return { ...item, story_tags: storyTags }
}

describe('sampleNarrativePath', () => {
  const candidates = [
    candidate('a', 'primary_region', 114.34, 30.54, 0.9),
    candidate('far', 'support_region', 114.46, 30.66, 0.88),
    candidate('b', 'primary_region', 114.35, 30.545, 0.8),
    candidate('c', 'landmark_anchor', 114.36, 30.55, 0.7),
    candidate('d', 'support_region', 114.37, 30.56, 0.6),
  ]

  it('is reproducible for the same seed and follows nearest neighboring regions', () => {
    const left = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })
    const right = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })

    expect(left.nodes).toEqual(right.nodes)
    expect(left.engine).toBe('seeded_lod_bbox_sampler')
    expect(left.storyTags.length).toBeGreaterThan(0)
    expect(left.nodes[0].region_id).toBe('d')
  })

  it('allows different seeds to sample different but valid story paths', () => {
    const varied = [
      candidate('a', 'primary_region', 114.34, 30.54, 0.9),
      candidate('b', 'support_region', 114.345, 30.542, 0.78),
      candidate('c', 'landmark_anchor', 114.346, 30.543, 0.77),
      candidate('d', 'support_region', 114.347, 30.544, 0.76),
      candidate('e', 'landmark_anchor', 114.348, 30.545, 0.75),
      candidate('f', 'scene_evidence', 114.349, 30.546, 0.74),
      candidate('g', 'support_region', 114.35, 30.547, 0.73),
      candidate('h', 'landmark_anchor', 114.351, 30.548, 0.72),
      candidate('i', 'scene_evidence', 114.352, 30.549, 0.71),
    ]
    const paths = new Set(Array.from({ length: 8 }, (_, index) =>
      sampleNarrativePath({ candidates: varied, viewport, lod: 'meso', seed: `seed-${index}` }).nodes.map((node) => node.region_id).join('>')))

    for (const path of paths) expect(path.startsWith('a>')).toBe(true)
  })

  it('orders selected regions by map reading direction from west to east and north to south', () => {
    const grid = [
      candidate('left-bottom', 'support_region', 114.32, 30.52, 0.62),
      candidate('right-top', 'support_region', 114.44, 30.66, 0.86),
      candidate('middle-bottom', 'support_region', 114.38, 30.53, 0.82),
      candidate('left-top', 'primary_region', 114.31, 30.66, 0.9),
      candidate('middle-top', 'landmark_anchor', 114.37, 30.65, 0.84),
    ]

    const result = sampleNarrativePath({ candidates: grid, viewport, lod: 'meso', seed: 'reading-order' })

    expect(result.nodes.map((node) => node.region_id).slice(0, 5)).toEqual([
      'left-top',
      'left-bottom',
      'middle-top',
      'middle-bottom',
      'right-top',
    ])
    expect(result.nodes[1].transition_reason).toContain('left-bottom在left-top的南侧')
  })

  it('avoids a third consecutive region with the same role when a nearby alternative exists', () => {
    const mixed = [
      candidate('core', 'primary_region', 114.34, 30.54, 0.9),
      candidate('campus-east', 'primary_region', 114.341, 30.54, 0.8),
      candidate('campus-north', 'primary_region', 114.342, 30.54, 0.7),
      candidate('park-edge', 'support_region', 114.356, 30.54, 0.68),
    ]

    const result = sampleNarrativePath({ candidates: mixed, viewport, lod: 'meso', seed: 'seed-a' })

    expect(result.nodes.map((node) => node.region_id).slice(0, 3)).toEqual(['core', 'campus-east', 'park-edge'])
  })

  it('uses deterministic region relations for natural transition reasons', () => {
    const related = [
      candidate('武汉大学', 'primary_region', 114.34, 30.54, 0.9, '科教文化服务'),
      candidate('东湖风景区', 'support_region', 114.345, 30.542, 0.82, '风景名胜'),
    ]

    const result = sampleNarrativePath({ candidates: related, viewport, lod: 'meso', seed: 'seed-a' })

    expect(result.relations[0]).toMatchObject({
      from_region_id: '武汉大学',
      to_region_id: '东湖风景区',
      type: 'campus_ecology_edge',
    })
    expect(result.nodes[1].transition_reason).toContain('校园文化和开放绿地')
  })

  it('uses story tags to expose route strategy and relation tag overlap', () => {
    const tagged = [
      candidate('粮道街', 'primary_region', 114.34, 30.54, 0.9, '餐饮服务'),
      candidate('餐饮街', 'support_region', 114.345, 30.542, 0.88, '餐饮服务'),
      candidate('商场', 'landmark_anchor', 114.39, 30.59, 0.2, '购物服务'),
    ]

    const result = sampleNarrativePath({ candidates: tagged, viewport, lod: 'micro', seed: 'food-seed' })

    expect(result.strategy).toBe('commercial_food_walk')
    expect(result.storyTags).toEqual(expect.arrayContaining(['food']))
    expect(result.nodes[0].story_tags).toEqual(expect.arrayContaining(['food']))
    expect(result.relations[0].shared_story_tags).toEqual(expect.arrayContaining(['food']))
  })

  it('uses LOD policy differences to expose product route behavior', () => {
    const varied = [
      candidate('core', 'primary_region', 114.34, 30.54, 0.9, '科教文化服务'),
      candidate('park', 'support_region', 114.345, 30.542, 0.86, '风景名胜'),
      candidate('food', 'support_region', 114.352, 30.548, 0.8, '餐饮服务'),
      candidate('mall', 'landmark_anchor', 114.36, 30.55, 0.78, '购物服务'),
      candidate('culture', 'support_region', 114.39, 30.59, 0.74, '科教文化服务'),
      candidate('market', 'support_region', 114.43, 30.62, 0.72, '餐饮服务'),
    ]

    const micro = sampleNarrativePath({ candidates: varied, viewport, lod: 'micro', seed: 'lod-seed' })
    const macro = sampleNarrativePath({ candidates: varied, viewport, lod: 'macro', seed: 'lod-seed' })

    expect(micro.lodPolicy).toMatchObject({ distance_bias: 'strong', diversity_bias: 'local_detail', max_nodes: 5 })
    expect(macro.lodPolicy).toMatchObject({ distance_bias: 'loose', diversity_bias: 'cross_section', max_nodes: 10 })
    expect(macro.nodes.length).toBeGreaterThanOrEqual(micro.nodes.length)
  })

  it('maps richer relation taxonomy into route strategy matrix', () => {
    const localLife = [
      withTags(candidate('保成路夜市', 'primary_region', 114.34, 30.54, 0.9, '餐饮服务'), ['market', 'nightlife', 'food']),
      withTags(candidate('水塔街', 'support_region', 114.345, 30.542, 0.85, '餐饮服务'), ['market', 'food']),
      candidate('商场', 'landmark_anchor', 114.37, 30.56, 0.3, '购物服务'),
    ]

    const result = sampleNarrativePath({ candidates: localLife, viewport, lod: 'meso', seed: 'market-seed' })

    expect(result.relations.map((relation) => relation.type)).toContain('market_street_life')
    expect(result.strategy).toBe('night_market_walk')
  })

  it('adjusts relation strength with distance and shared story tags', () => {
    const core = withTags(candidate('保成路夜市', 'primary_region', 114.34, 30.54, 0.9, '餐饮服务'), ['market', 'nightlife', 'food'])
    const nearShared = withTags(candidate('水塔街', 'support_region', 114.345, 30.542, 0.85, '餐饮服务'), ['market', 'food'])
    const farUnshared = withTags(candidate('远处餐饮街', 'support_region', 114.45, 30.66, 0.85, '餐饮服务'), ['food'])

    const strongRelation = buildRegionRelation(core, nearShared)
    const weakRelation = buildRegionRelation(core, farUnshared)

    expect(strongRelation.type).toBe(weakRelation.type)
    expect(strongRelation.strength).toBeGreaterThan(weakRelation.strength)
    expect(strongRelation.evidence).toEqual(expect.arrayContaining(['共享线索:market/food']))
  })
})
