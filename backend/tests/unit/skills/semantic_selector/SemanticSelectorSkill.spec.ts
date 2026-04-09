import { describe, expect, it } from 'vitest'

import { createDependencyStatus, type DependencyStatus } from '../../../../src/integration/dependencyStatus.js'
import type {
  EncodedPoiProfileResult,
  EncodedRegionResult,
  EncodedTextResult,
  PythonBridge,
} from '../../../../src/integration/pythonBridge.js'
import { createSkillExecutionContext } from '../../../../src/skills/SkillContext.js'
import { createSemanticSelectorSkill } from '../../../../src/skills/semantic_selector/SemanticSelectorSkill.js'

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

describe('SemanticSelectorSkill', () => {
  it('selects query-aligned business evidence instead of returning noisy utility categories', async () => {
    const skill = createSemanticSelectorSkill({
      bridge: createBridge(),
    })

    const result = await skill.execute(
      'select_area_evidence',
      {
        raw_query: '总结一下华中农业大学周边的业态结构',
        semantic_focus: '业态结构',
        anchor_name: '华中农业大学',
        area_insight: {
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
      },
      createSkillExecutionContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      selected_area_insight: {
        categoryHistogram: [
          { category_main: '餐饮美食', poi_count: 18 },
          { category_main: '购物服务', poi_count: 9 },
        ],
      },
      selected_rows: [
        expect.objectContaining({ name: '华中农业大学武昌鱼馆' }),
        expect.objectContaining({ name: '华中农业大学便利蜂' }),
      ],
      diagnostics: {
        applied: true,
        mode: 'query_driven',
        focusQuery: '业态结构',
        selectedCategories: ['餐饮美食', '购物服务'],
        skippedCategories: expect.arrayContaining(['公共厕所', '停车场']),
      },
      semantic_evidence: {
        level: 'available',
        weakEvidence: false,
      },
    })
  })
})
