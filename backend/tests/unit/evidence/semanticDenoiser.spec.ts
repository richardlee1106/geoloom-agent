import { describe, expect, it } from 'vitest'

import { IntentAwareAreaSemanticDenoiser } from '../../../src/evidence/areaInsight/semanticDenoiser.js'
import { createDependencyStatus, type DependencyStatus } from '../../../src/integration/dependencyStatus.js'
import type {
  EncodedPoiProfileResult,
  EncodedRegionResult,
  EncodedTextResult,
  PythonBridge,
} from '../../../src/integration/pythonBridge.js'

class StubBridge implements PythonBridge {
  constructor(
    private readonly vectors: Array<{ test: RegExp, vector: number[] }>,
    private readonly status: DependencyStatus = createDependencyStatus({
      name: 'spatial_encoder',
      ready: true,
      mode: 'remote',
      degraded: false,
      target: 'http://encoder.test',
    }),
  ) {}

  async encodeText(text: string): Promise<EncodedTextResult> {
    const matched = this.vectors.find((item) => item.test.test(text))
    const vector = matched?.vector || [0, 0, 0]
    return {
      vector,
      tokens: [text],
      dimension: vector.length,
    }
  }

  async encodeRegionSnapshot(): Promise<EncodedRegionResult> {
    throw new Error('not implemented')
  }

  async encodePoiProfile(): Promise<EncodedPoiProfileResult> {
    throw new Error('not implemented')
  }

  async getCellContext() {
    return {
      context: {},
      models_used: ['stub'],
    }
  }

  async searchNearbyCells() {
    return {
      anchor_cell_context: {},
      cells: [],
      model_route: 'stub',
      models_used: ['stub'],
      search_radius_m: null,
      per_cell_radius_m: null,
      support_bucket_distribution: [],
      dominant_buckets: [],
      scene_tags: [],
      cell_mix: [],
      macro_uncertainty: {},
    }
  }

  async batchPoiCellContext() {
    return {
      anchor_cell_context: {},
      results: [],
      model_route: 'stub',
      models_used: ['stub'],
    }
  }

  async getStatus() {
    return this.status
  }
}

function createBridge() {
  return new StubBridge([
    { test: /业态|商业|结构|餐饮|购物|便利店|中餐厅|公司|企业|服务站|咨询中心/u, vector: [1, 0, 0] },
    { test: /公共厕所|厕所/u, vector: [0, 1, 0] },
    { test: /停车/u, vector: [0.15, 0.65, 0.2] },
    { test: /地铁|交通/u, vector: [0.2, 0, 1] },
  ])
}

describe('IntentAwareAreaSemanticDenoiser', () => {
  it('drops low-relevance utility categories for business-mix questions', async () => {
    const denoiser = new IntentAwareAreaSemanticDenoiser({
      bridge: createBridge(),
    })

    const result = await denoiser.denoise({
      rawQuery: '总结一下华中农业大学周边的业态结构',
      anchorName: '华中农业大学',
      areaInsight: {
        categoryHistogram: [
          { category_main: '餐饮美食', poi_count: 18 },
          { category_main: '购物服务', poi_count: 9 },
          { category_main: '公共厕所', poi_count: 5 },
          { category_main: '停车场', poi_count: 7 },
        ],
        competitionDensity: [
          { competition_key: '餐饮美食', poi_count: 18 },
          { competition_key: '购物服务', poi_count: 9 },
          { competition_key: '公共厕所', poi_count: 5 },
        ],
        representativeSamples: [
          { name: '华中农业大学武昌鱼馆', category_main: '餐饮美食', category_sub: '中餐厅' },
          { name: '华中农业大学便利蜂', category_main: '购物服务', category_sub: '便利店' },
          { name: '华中农业大学东门公共厕所', category_main: '公共厕所', category_sub: '公共厕所' },
          { name: '华中农业大学校园停车场', category_main: '停车场', category_sub: '停车场' },
        ],
      },
    })

    expect(result.areaInsight.categoryHistogram?.map((row) => row.category_main)).toEqual([
      '餐饮美食',
      '购物服务',
    ])
    expect(result.areaInsight.competitionDensity?.map((row) => row.competition_key)).toEqual([
      '餐饮美食',
      '购物服务',
    ])
    expect(result.rows.map((row) => row.name)).toEqual([
      '华中农业大学武昌鱼馆',
      '华中农业大学便利蜂',
    ])
    expect(result.diagnostics.droppedCategories).toEqual(expect.arrayContaining(['公共厕所', '停车场']))
    expect(result.semanticEvidence?.level).toBe('available')
    expect(result.diagnostics.focusQuery).toBe('业态结构')
  })

  it('does not let noisy representative sample names pull business-mix ranking away from consumer-facing categories', async () => {
    const denoiser = new IntentAwareAreaSemanticDenoiser({
      bridge: createBridge(),
    })

    const result = await denoiser.denoise({
      rawQuery: '解读一下华中农业大学周边的业态结构',
      anchorName: '华中农业大学',
      areaInsight: {
        categoryHistogram: [
          { category_main: '餐饮美食', poi_count: 18 },
          { category_main: '购物服务', poi_count: 12 },
          { category_main: '商务住宅', poi_count: 10 },
        ],
        representativeSamples: [
          { name: '华中农业大学武昌鱼馆', category_main: '餐饮美食', category_sub: '中餐厅' },
          { name: '华中农业大学便利蜂', category_main: '购物服务', category_sub: '便利店' },
          { name: '洪山区狮子山街华农东社区服务站', category_main: '商务住宅', category_sub: '住宅区' },
        ],
      },
    })

    expect(result.areaInsight.categoryHistogram?.map((row) => row.category_main)).toEqual([
      '餐饮美食',
      '购物服务',
    ])
    expect(result.diagnostics.droppedCategories).toContain('商务住宅')
    expect(result.diagnostics.focusQuery).toBe('业态结构')
  })

  it('keeps public-toilet evidence when the user explicitly asks about toilet distribution', async () => {
    const denoiser = new IntentAwareAreaSemanticDenoiser({
      bridge: createBridge(),
    })

    const result = await denoiser.denoise({
      rawQuery: '公共厕所分布怎么样',
      areaInsight: {
        categoryHistogram: [
          { category_main: '餐饮美食', poi_count: 18 },
          { category_main: '公共厕所', poi_count: 5 },
          { category_main: '停车场', poi_count: 7 },
        ],
        representativeSamples: [
          { name: '武昌鱼馆', category_main: '餐饮美食', category_sub: '中餐厅' },
          { name: '东门公共厕所', category_main: '公共厕所', category_sub: '公共厕所' },
          { name: '校园停车场', category_main: '停车场', category_sub: '停车场' },
        ],
      },
    })

    expect(result.areaInsight.categoryHistogram?.map((row) => row.category_main)).toEqual([
      '公共厕所',
    ])
    expect(result.rows.map((row) => row.name)).toEqual([
      '东门公共厕所',
    ])
    expect(result.diagnostics.keptCategories).toEqual(['公共厕所'])
  })
})
