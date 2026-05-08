import { describe, expect, it } from 'vitest'

import type { NarrativeBoundaryGeometry } from '../../../src/narrative/contract.js'
import { buildNarrationChapters } from '../../../src/narrative/factGrounding.js'
import type { RegionCandidate } from '../../../src/narrative/regionCandidate.js'

const boundary: NarrativeBoundaryGeometry = {
  type: 'Polygon',
  coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.6], [114.3, 30.5]]],
}

function region(): RegionCandidate {
  return {
    id: 'wut-yujiatou',
    display_name: '武汉理工大学余家头校区',
    role: 'primary_region',
    core_anchor: { id: 'wut-yujiatou', lon: 114.35, lat: 30.55 },
    boundary,
    visual_layer: { mode: 'region_glow', poi_heat: { radius: 24, points: [] } },
    pois: [],
    narrative_facts: [
      {
        claim: '武汉理工大学余家头校区。武汉理工大学余家头校区在当前视野中有可用的真实地界。',
        source: 'aoi_entity',
        confidence: 0.92,
        verified: true,
        related_entity: { type: 'region', id: 'wut-yujiatou' },
      },
    ],
    score: 1,
    source: 'aoi',
    coverage: 0.2,
    diversity: 0.3,
    effectivePoiCount: 3,
  }
}

describe('buildNarrationChapters', () => {
  it('压缩章节事实开头重复出现的片区名', () => {
    const chapters = buildNarrationChapters({ regions: [region()], tone: 'tour', scene: 'education_culture' })

    expect(chapters[0].text).not.toContain('武汉理工大学余家头校区。武汉理工大学余家头校区')
    expect(chapters[0].text).toContain('先看武汉理工大学余家头校区。')
    expect(chapters[0].text).toContain('拥有可解释的真实地界。')
    expect(chapters[0].text).not.toContain('当前视野中')
  })

  it('后续章节优先使用空间转场而不是当前视野占位话术', () => {
    const left = region()
    const right = { ...region(), id: 'right-region', display_name: '右侧片区' }
    const chapters = buildNarrationChapters({
      regions: [left, right],
      tone: 'tour',
      scene: 'education_culture',
      pathNodes: [
        { region_id: left.id, transition_reason: '从西侧开始。' },
        { region_id: right.id, transition_reason: '右侧片区在武汉理工大学余家头校区的东侧，两个片区沿道路相互衔接。' },
      ],
    })

    expect(chapters[1].text).toContain('右侧片区在武汉理工大学余家头校区的东侧')
    expect(chapters[1].text).not.toContain('位于当前视野范围内')
  })
})
