import { describe, expect, it } from 'vitest'

import { RequirementResolver } from '../../../src/evidence/RequirementResolver.js'

describe('RequirementResolver', () => {
  it('keeps tavily as optional fallback instead of executing it by default', () => {
    const resolver = new RequirementResolver()
    const result = resolver.resolve({
      contract: {
        narrative: '围绕用户问题组织回答。',
        meta: {
          scope: 'viewport',
          depth: 'lookup',
          forbiddenBlocks: [],
          estimatedAtomCount: 4,
          trackingId: 'contract_test_001',
          needsWebEvidence: true,
          webSearchStrategy: 'hybrid',
        },
      },
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '这里有哪些高分美食店',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '餐饮美食',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
      },
    })

    expect(result.requiredAtoms).toEqual(expect.arrayContaining(['anchor.resolved', 'poi.nearby_list', 'area.aoi_context', 'web.multi_search', 'web.entity_alignment']))
    expect(result.optionalAtoms).toContain('web.tavily')
    expect(result.executionSpecs.map((spec) => spec.atom)).toEqual(expect.arrayContaining(['web.multi_search', 'web.entity_alignment']))
    expect(result.executionSpecs.map((spec) => spec.atom)).not.toContain('web.tavily')
  })

  it('waits for nearby poi candidates before launching candidate reputation web search', () => {
    const resolver = new RequirementResolver()
    const result = resolver.resolve({
      contract: {
        narrative: '围绕用户问题组织回答。',
        meta: {
          scope: 'viewport',
          depth: 'lookup',
          forbiddenBlocks: [],
          estimatedAtomCount: 5,
          trackingId: 'contract_test_002',
          needsWebEvidence: true,
          webSearchStrategy: 'hybrid',
        },
      },
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '这块有哪些高分推荐的酒店？',
        placeName: '当前区域',
        anchorSource: 'map_view',
        targetCategory: '酒店',
        radiusM: 800,
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
        toolIntent: 'candidate_reputation',
        searchIntentHint: '酒店 评分 推荐',
      },
    })

    const multiSearchSpec = result.executionSpecs.find((spec) => spec.atom === 'web.multi_search')
    expect(multiSearchSpec).toBeTruthy()
    expect(multiSearchSpec?.dependsOn).toEqual(expect.arrayContaining(['poi.nearby_list']))
  })
})
