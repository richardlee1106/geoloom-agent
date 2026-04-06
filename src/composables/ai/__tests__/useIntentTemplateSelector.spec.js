import { deriveTemplateContext } from '../../../utils/aiTemplateMetrics'
import { useIntentTemplateSelector } from '../useIntentTemplateSelector'

function createMacroContext() {
  return deriveTemplateContext({
    clusters: {
      hotspots: [
        { name: '热点A', poiCount: 120, center: [114.31, 30.58], dominantCategories: [{ category: '商业' }] },
        { name: '热点B', poiCount: 88, center: [114.33, 30.60], dominantCategories: [{ category: '科教文化' }] }
      ]
    },
    vernacularRegions: [
      {
        name: '商教融合区',
        center: [114.31, 30.58],
        membership: { score: 0.81 },
        dominant_categories: [
          { category: '商业', count: 125 },
          { category: '科教文化', count: 118 }
        ]
      }
    ],
    fuzzyRegions: [{ name: '边界区A', ambiguity: { score: 0.57 }, level: 'transition' }],
    analysisStats: { avg_boundary_confidence: 0.72 },
    intentMode: 'macro_overview',
    queryType: 'area_analysis'
  })
}

describe('useIntentTemplateSelector', () => {
  it('selects 1-3 templates for macro intent and prioritizes hotspot + industry', () => {
    const { selectTemplates } = useIntentTemplateSelector()
    const selected = selectTemplates(createMacroContext())

    expect(selected.length).toBeGreaterThanOrEqual(1)
    expect(selected.length).toBeLessThanOrEqual(3)
    expect(selected.some((item) => item.id === 'hotspot_overview')).toBe(true)
    expect(selected.some((item) => item.id === 'dominant_industry')).toBe(true)
    expect(selected.some((item) => item.id === 'industry_overlap_radiation')).toBe(true)
    expect(selected.every((item) => Number.isFinite(item.score))).toBe(true)
  })

  it('prioritizes comparison digest for comparison intent', () => {
    const { selectTemplates } = useIntentTemplateSelector()
    const context = deriveTemplateContext({
      ...createMacroContext(),
      intentMode: 'comparison',
      queryType: 'region_comparison'
    })
    const selected = selectTemplates(context)

    expect(selected[0]?.id).toBe('comparison_digest')
  })

  it('falls back to a stable widget when data is sparse', () => {
    const { selectTemplates } = useIntentTemplateSelector()
    const selected = selectTemplates(
      deriveTemplateContext({
        clusters: { hotspots: [] },
        vernacularRegions: [],
        fuzzyRegions: [],
        analysisStats: null,
        intentMode: 'macro_overview',
        queryType: 'area_analysis'
      })
    )

    expect(selected.length).toBe(1)
    expect(selected[0]?.id).toBeTruthy()
  })
})
