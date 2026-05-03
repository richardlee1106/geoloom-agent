import { describe, expect, it } from 'vitest'

import type { NarrativePoi, ViewportBBox } from '../../../src/narrative/contract.js'
import { polygonFromBounds } from '../../../src/narrative/geometry.js'
import { sampleNarrativePath } from '../../../src/narrative/pathSampler.js'
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
    score,
    source: 'aoi',
    coverage: 0.1,
    diversity: 0.8,
    effectivePoiCount: 1,
  }
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
    expect(left.nodes.map((node) => node.region_id)).toEqual(['a', 'b', 'c', 'd', 'far'])
  })

  it('keeps the gradual order stable across different seeds', () => {
    const left = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })
    const right = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-b' })

    expect(left.nodes.map((node) => node.region_id)).toEqual(right.nodes.map((node) => node.region_id))
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
      type: 'functional_complement',
    })
    expect(result.nodes[1].transition_reason).toContain('教育文化空间和开放生态空间')
  })
})
