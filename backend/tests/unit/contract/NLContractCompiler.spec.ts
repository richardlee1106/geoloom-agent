import { describe, expect, it } from 'vitest'

import { NLContractCompiler } from '../../../src/contract/NLContractCompiler.js'

describe('NLContractCompiler', () => {
  it('routes nearby category candidate lookups into hybrid discovery evidence', () => {
    const compiler = new NLContractCompiler()

    const contract = compiler.compileFromIntent({
      queryType: 'nearby_poi',
      intentMode: 'deterministic_visible_loop',
      rawQuery: '光谷附近美食',
      placeName: '光谷广场',
      anchorSource: 'place',
      targetCategory: '餐饮美食',
      categoryKey: 'food',
      categoryMain: '餐饮美食',
      radiusM: 800,
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      toolIntent: 'candidate_lookup',
      searchIntentHint: null,
    }, '光谷附近美食')

    expect(contract.meta.depth).toBe('lookup')
    expect(contract.meta.needsWebEvidence).toBe(true)
    expect(contract.meta.webSearchStrategy).toBe('hybrid_with_discovery')
  })

  it('keeps candidate_reputation nearby lookups on hybrid web verification instead of discovery', () => {
    const compiler = new NLContractCompiler()

    const contract = compiler.compileFromIntent({
      queryType: 'nearby_poi',
      intentMode: 'deterministic_visible_loop',
      rawQuery: '汉口美食推荐',
      placeName: '汉口',
      anchorSource: 'place',
      targetCategory: '餐饮美食',
      categoryKey: 'food',
      categoryMain: '餐饮美食',
      radiusM: 1800,
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: true,
      toolIntent: 'candidate_reputation',
      searchIntentHint: '餐饮美食 评分 推荐',
    }, '汉口美食推荐')

    expect(contract.meta.needsWebEvidence).toBe(true)
    expect(contract.meta.webSearchStrategy).toBe('hybrid')
  })

  it('keeps lookup forbidden blocks empty for nearby_poi queries', () => {
    const compiler = new NLContractCompiler()

    const contract = compiler.compileFromIntent({
      queryType: 'nearby_poi',
      intentMode: 'deterministic_visible_loop',
      rawQuery: '光谷附近美食',
      placeName: '光谷广场',
      anchorSource: 'place',
      targetCategory: '餐饮美食',
      categoryKey: 'food',
      categoryMain: '餐饮美食',
      radiusM: 800,
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      toolIntent: 'candidate_lookup',
      searchIntentHint: null,
    }, '光谷附近美食')

    // nearby_poi 查询不会产出片区分析或选址建议，无需禁止
    expect(contract.meta.forbiddenBlocks).toEqual([])
  })
})
