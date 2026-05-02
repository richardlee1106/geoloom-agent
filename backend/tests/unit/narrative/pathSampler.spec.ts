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

function candidate(id: string, role: RegionCandidate['role'], lon: number, lat: number, score: number): RegionCandidate {
  const poi: NarrativePoi = {
    id: `poi-${id}`,
    lon,
    lat,
    display_name: id,
    tier: 'strong',
    role: 'scene_evidence',
    category_main: '科教文化服务',
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
    candidate('b', 'primary_region', 114.36, 30.56, 0.8),
    candidate('c', 'landmark_anchor', 114.38, 30.58, 0.7),
    candidate('d', 'support_region', 114.42, 30.62, 0.6),
    candidate('outside', 'support_region', 115, 31, 1),
  ]

  it('is reproducible for the same seed and keeps nodes inside viewport', () => {
    const left = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })
    const right = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })

    expect(left.nodes).toEqual(right.nodes)
    expect(left.nodes.map((node) => node.region_id)).not.toContain('outside')
  })

  it('can produce observable differences for different seeds', () => {
    const left = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-a' })
    const right = sampleNarrativePath({ candidates, viewport, lod: 'meso', seed: 'seed-b' })

    expect(left.nodes.map((node) => node.region_id).join(',')).not.toBe(right.nodes.map((node) => node.region_id).join(','))
  })
})
