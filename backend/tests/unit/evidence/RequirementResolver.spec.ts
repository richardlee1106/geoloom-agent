import { describe, expect, it } from 'vitest'

import { RequirementResolver } from '../../../src/evidence/RequirementResolver.js'

describe('RequirementResolver', () => {
  it('uses tavily as the default search dependency for hybrid lookup flows', () => {
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

    expect(result.requiredAtoms).toEqual(expect.arrayContaining(['anchor.resolved', 'poi.nearby_list', 'area.aoi_context', 'web.tavily', 'web.entity_alignment']))
    expect(result.optionalAtoms).toContain('web.multi_search')
    expect(result.executionSpecs.map((spec) => spec.atom)).toEqual(expect.arrayContaining(['web.tavily', 'web.entity_alignment']))
    expect(result.executionSpecs.map((spec) => spec.atom)).not.toContain('web.multi_search')
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

    const tavilySpec = result.executionSpecs.find((spec) => spec.atom === 'web.tavily')
    const alignmentSpec = result.executionSpecs.find((spec) => spec.atom === 'web.entity_alignment')
    expect(tavilySpec).toBeTruthy()
    expect(tavilySpec?.dependsOn).toEqual(expect.arrayContaining(['poi.nearby_list']))
    expect(alignmentSpec?.dependsOn).toEqual(expect.arrayContaining(['web.tavily']))
  })

  it('adds scope_cells and poi_discovery for nearby candidate lookup discovery flows', () => {
    const resolver = new RequirementResolver()
    const result = resolver.resolve({
      contract: {
        narrative: '围绕用户问题组织回答。',
        meta: {
          scope: 'place',
          depth: 'lookup',
          forbiddenBlocks: [],
          estimatedAtomCount: 7,
          trackingId: 'contract_test_002b',
          needsWebEvidence: true,
          webSearchStrategy: 'hybrid_with_discovery',
        },
      },
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '汉口景点推荐',
        placeName: '汉口',
        anchorSource: 'place',
        targetCategory: '景点',
        categoryKey: 'scenic',
        categoryMain: '风景名胜',
        radiusM: 1800,
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
        toolIntent: 'candidate_lookup',
        searchIntentHint: '景点 推荐',
      },
    })

    expect(result.requiredAtoms).toEqual(expect.arrayContaining([
      'anchor.resolved',
      'poi.nearby_list',
      'anchor.scope_cells',
      'web.tavily',
      'web.entity_alignment',
      'web.poi_discovery',
    ]))

    const scopeSpec = result.executionSpecs.find((spec) => spec.atom === 'anchor.scope_cells')
    const discoverySpec = result.executionSpecs.find((spec) => spec.atom === 'web.poi_discovery')
    expect(scopeSpec?.dependsOn).toEqual(expect.arrayContaining(['anchor.resolved']))
    expect(discoverySpec?.dependsOn).toEqual(expect.arrayContaining(['anchor.scope_cells']))
  })

  it('downgrades stale hybrid_with_discovery nearby candidate reputation flows back to hybrid atoms', () => {
    const resolver = new RequirementResolver()
    const result = resolver.resolve({
      contract: {
        narrative: '围绕用户问题组织回答。',
        meta: {
          scope: 'place',
          depth: 'lookup',
          forbiddenBlocks: [],
          estimatedAtomCount: 6,
          trackingId: 'contract_test_003',
          needsWebEvidence: true,
          webSearchStrategy: 'hybrid_with_discovery',
        },
      },
      intent: {
        queryType: 'nearby_poi',
        intentMode: 'deterministic_visible_loop',
        rawQuery: '汉口美食推荐',
        placeName: '汉口',
        anchorSource: 'place',
        targetCategory: '餐饮美食',
        categoryKey: 'food',
        categoryMain: '餐饮美食',
        radiusM: 1200,
        needsClarification: false,
        clarificationHint: null,
        needsWebSearch: true,
        toolIntent: 'candidate_reputation',
        searchIntentHint: '餐饮美食 评分 推荐',
      },
    })

    expect(result.requiredAtoms).toEqual(expect.arrayContaining([
      'anchor.resolved',
      'poi.nearby_list',
      'web.tavily',
      'web.entity_alignment',
    ]))
    expect(result.requiredAtoms).not.toContain('web.poi_discovery')
    expect(result.optionalAtoms).toContain('web.multi_search')

    const discoverySpec = result.executionSpecs.find((spec) => spec.atom === 'web.poi_discovery')
    expect(discoverySpec).toBeUndefined()
  })
})
