import { deriveTemplateContext } from '../aiTemplateMetrics'

describe('deriveTemplateContext', () => {
  it('derives overlap and confidence metrics from evidence payload', () => {
    const context = deriveTemplateContext({
      clusters: {
        hotspots: [
          { name: '热区A', poiCount: 90, center: [114.31, 30.58], dominantCategories: [{ category: '商业' }] },
          { name: '热区B', poiCount: 75, center: [114.33, 30.59], dominantCategories: [{ category: '科教文化' }] }
        ]
      },
      vernacularRegions: [
        {
          name: '区域A',
          center: [114.31, 30.58],
          membership: { score: 0.82 },
          dominant_categories: [
            { category: '商业', count: 130 },
            { category: '科教文化', count: 120 }
          ]
        },
        {
          name: '区域B',
          center: [114.34, 30.60],
          membership: { score: 0.74 },
          dominant_categories: [
            { category: '体育健身', count: 90 },
            { category: '餐饮', count: 30 }
          ]
        }
      ],
      fuzzyRegions: [{ name: '模糊区', ambiguity: { score: 0.61 }, level: 'transition' }],
      analysisStats: { avg_boundary_confidence: 0.68 },
      intentMode: 'macro_overview',
      queryType: 'area_analysis'
    })

    expect(context.intentType).toBe('macro')
    expect(context.hotspots).toHaveLength(2)
    expect(context.regions).toHaveLength(2)
    expect(context.industryOverlap.score).toBeGreaterThan(0.5)
    expect(context.industryOverlap.topRegion?.name).toBe('区域A')
    expect(context.radiationCoverage.score).toBeGreaterThan(0)
    expect(context.confidence.score).toBeCloseTo(0.68, 2)
  })

  it('returns safe defaults when evidence is empty', () => {
    const context = deriveTemplateContext({
      clusters: null,
      vernacularRegions: null,
      fuzzyRegions: null,
      analysisStats: null,
      intentMode: '',
      queryType: ''
    })

    expect(context.intentType).toBe('macro')
    expect(context.hotspots).toHaveLength(0)
    expect(context.regions).toHaveLength(0)
    expect(context.fuzzyRegions).toHaveLength(0)
    expect(context.industryOverlap.score).toBe(0)
    expect(context.radiationCoverage.score).toBe(0)
    expect(context.confidence.score).toBe(0)
  })
})
