import { normalizeRefinedResultEvidence } from '../refinedResultEvidence'

describe('normalizeRefinedResultEvidence', () => {
  it('extracts spatial evidence from refined_result envelope', () => {
    const input = {
      success: true,
      results: {
        boundary: { type: 'Polygon', coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.6], [114.3, 30.5]]] },
        spatial_clusters: {
          hotspots: [{ id: 1, name: '沙湖生态片区' }]
        },
        vernacular_regions: [{ id: 11, name: '沙湖片区' }],
        fuzzy_regions: [{ id: 21, level: 'core' }],
        stats: { cluster_count: 1 }
      }
    }

    const normalized = normalizeRefinedResultEvidence(input)
    expect(normalized.boundary).toBeTruthy()
    expect(normalized.spatialClusters?.hotspots?.length).toBe(1)
    expect(normalized.vernacularRegions).toHaveLength(1)
    expect(normalized.fuzzyRegions).toHaveLength(1)
    expect(normalized.stats?.cluster_count).toBe(1)
    expect(normalized.hasEvidence).toBe(true)
  })

  it('supports direct results payload and camelCase keys', () => {
    const input = {
      boundary: null,
      spatialClusters: { hotspots: [] },
      vernacularRegions: [{ id: 1 }],
      fuzzyRegions: [],
      analysisStats: { total_candidates: 88 }
    }

    const normalized = normalizeRefinedResultEvidence(input)
    expect(normalized.boundary).toBeNull()
    expect(normalized.spatialClusters?.hotspots?.length).toBe(0)
    expect(normalized.vernacularRegions).toHaveLength(1)
    expect(normalized.fuzzyRegions).toHaveLength(0)
    expect(normalized.stats?.total_candidates).toBe(88)
    expect(normalized.hasEvidence).toBe(true)
  })

  it('extracts intent metadata from refined_result envelope', () => {
    const input = {
      query_plan: {
        query_type: 'poi_search',
        intent_mode: 'local_search',
        anchor: '湖北大学',
        categories: ['咖啡厅']
      },
      results: {
        stats: { cluster_count: 2 }
      }
    }

    const normalized = normalizeRefinedResultEvidence(input)
    expect(normalized.intent).toEqual({
      queryType: 'poi_search',
      intentMode: 'local_search',
      queryPlan: {
        query_type: 'poi_search',
        intent_mode: 'local_search',
        anchor: '湖北大学',
        categories: ['咖啡厅']
      }
    })
  })
})
