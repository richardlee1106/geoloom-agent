import { describe, expect, it } from 'vitest'

import { buildSimilarRegionEvidence, buildSimilarRegionSearchText } from '../../../src/evidence/similarRegions.js'
import type { EvidenceView } from '../../../src/chat/types.js'

function createReferenceView(): EvidenceView {
  return {
    type: 'semantic_candidate',
    anchor: {
      placeName: '武汉大学',
      displayName: '武汉大学',
      resolvedPlaceName: '武汉大学',
    },
    items: [],
    meta: {
      queryType: 'similar_regions',
    },
    areaProfile: {
      totalCount: 28,
      dominantCategories: [
        { label: '餐饮美食', count: 13, share: 0.46 },
        { label: '购物服务', count: 7, share: 0.25 },
      ],
      lowSignalRatio: 0.06,
      ringFootfall: [
        { label: '0-300m', count: 14, share: 0.5 },
      ],
    },
    hotspots: [
      { label: '街道口主入口一带', poiCount: 10 },
    ],
    areaSubject: {
      title: '武汉大学校园生活带',
      anchorName: '武汉大学',
      confidence: 'high',
    },
    aoiContext: [
      { name: '武汉大学', fclass: 'school', areaSqm: 210000 },
      { name: '街道口商圈', fclass: 'commercial', areaSqm: 82000 },
    ],
    landuseContext: [
      { landType: 'education', parcelCount: 4, totalAreaSqm: 96000 },
      { landType: 'commercial', parcelCount: 5, totalAreaSqm: 68000 },
      { landType: 'residential', parcelCount: 6, totalAreaSqm: 72000 },
    ],
    regionFeatures: [
      { key: 'campus_anchor', label: '校园主导', score: 0.93, detail: '高校与学生信号很强。' },
      { key: 'food_dominant', label: '餐饮主导', score: 0.82, detail: '轻餐饮和咖啡分布稳定。' },
      { key: 'transit_connected', label: '交通口活力', score: 0.76, detail: '地铁接驳比较明显。' },
    ],
    regionFeatureSummary: '围绕武汉大学，编码器提取的片区特征包括：校园主导、餐饮主导、交通口活力。',
  }
}

describe('similar region evidence builder', () => {
  it('builds reference dimensions and per-region similarity breakdowns', () => {
    const result = buildSimilarRegionEvidence({
      referenceView: createReferenceView(),
      candidates: [
        {
          regionId: 'region_wuda',
          name: '街道口-武大商圈',
          summary: '高校密集、咖啡和夜间活跃度较高',
          score: 0.91,
          rerankScore: 0.88,
          tags: ['高校', '学生', '咖啡', '活跃', '夜间'],
        },
        {
          regionId: 'region_huazhong',
          name: '光谷青年社区',
          summary: '年轻人消费活跃，咖啡与轻餐饮集中',
          score: 0.83,
          rerankScore: 0.79,
          tags: ['年轻', '咖啡', '交通'],
        },
      ],
    })

    expect(result.referenceDimensions.map((item) => item.label)).toContain('校园氛围')
    expect(result.referenceDimensions.map((item) => item.label)).toContain('餐饮密度')
    expect(result.regions[0]?.name).toBe('街道口-武大商圈')
    expect(result.regions[0]?.dimensions?.map((item) => item.label)).toContain('校园氛围')
    expect(result.regions[0]?.dimensions?.map((item) => item.label)).toContain('餐饮密度')
    expect(result.regions[0]?.score).toBeGreaterThan(0.85)
  })

  it('builds an encoder-informed search text for similar-region recall', () => {
    const referenceView = createReferenceView()
    const evidence = buildSimilarRegionEvidence({
      referenceView,
      candidates: [],
    })

    const searchText = buildSimilarRegionSearchText({
      rawQuery: '和武汉大学周边气质相似的片区有哪些？',
      referenceView,
      featureSummary: referenceView.regionFeatureSummary,
      referenceDimensions: evidence.referenceDimensions,
    })

    expect(searchText).toContain('和武汉大学周边气质相似的片区有哪些')
    expect(searchText).toContain('参考片区：武汉大学校园生活带')
    expect(searchText).toContain('校园主导')
    expect(searchText).toContain('关键维度：校园氛围')
  })
})
