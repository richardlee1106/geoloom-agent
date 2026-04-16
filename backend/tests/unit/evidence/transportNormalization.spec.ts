import { describe, expect, it } from 'vitest'

import type { DeterministicIntent, EvidenceItem } from '../../../src/chat/types.js'
import { normalizeNearbyItemsByIntent } from '../../../src/evidence/transportNormalization.js'

function buildNearbyIntent(overrides: Partial<DeterministicIntent> = {}): DeterministicIntent {
  return {
    queryType: 'nearby_poi',
    intentMode: 'deterministic_visible_loop',
    rawQuery: '光谷附近美食',
    placeName: '光谷',
    anchorSource: 'place',
    secondaryPlaceName: null,
    targetCategory: '餐饮美食',
    comparisonTarget: null,
    categoryKey: 'food',
    categoryMain: '餐饮美食',
    categorySub: null,
    radiusM: 1800,
    needsClarification: false,
    clarificationHint: null,
    needsWebSearch: false,
    toolIntent: 'candidate_lookup',
    searchIntentHint: null,
    ...overrides,
  }
}

describe('transportNormalization', () => {
  it('keeps precise nearby lists stable when radius stays compact', () => {
    const items: EvidenceItem[] = [
      { name: 'A', distance_m: 80, longitude: 114.398, latitude: 30.505 },
      { name: 'B', distance_m: 120, longitude: 114.399, latitude: 30.505 },
      { name: 'C', distance_m: 180, longitude: 114.4, latitude: 30.506 },
    ]

    const normalized = normalizeNearbyItemsByIntent(items, buildNearbyIntent({ radiusM: 800 }))

    expect(normalized.map((item) => item.name)).toEqual(['A', 'B', 'C'])
  })

  it('spreads broad nearby results across distance bands instead of stacking the closest cell first', () => {
    const items: EvidenceItem[] = [
      { name: '锚点近邻1', distance_m: 90, longitude: 114.3986, latitude: 30.5053 },
      { name: '锚点近邻2', distance_m: 120, longitude: 114.3987, latitude: 30.5052 },
      { name: '锚点近邻3', distance_m: 160, longitude: 114.3988, latitude: 30.5051 },
      { name: '中圈商场店', distance_m: 620, longitude: 114.4045, latitude: 30.5078 },
      { name: '外圈街区店', distance_m: 1220, longitude: 114.389, latitude: 30.5142 },
      { name: '更外圈社区店', distance_m: 1660, longitude: 114.412, latitude: 30.4975 },
    ]

    const normalized = normalizeNearbyItemsByIntent(items, buildNearbyIntent())

    expect(normalized.slice(0, 4).map((item) => item.name)).toEqual([
      '锚点近邻1',
      '中圈商场店',
      '锚点近邻2',
      '外圈街区店',
    ])
    expect(normalized.map((item) => item.name)).toContain('更外圈社区店')
  })
})
