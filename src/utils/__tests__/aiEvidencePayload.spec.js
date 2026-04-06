import {
  normalizeAiEvidencePayload,
  resolveFuzzyLayerBundle,
  resolveRegionBoundary
} from '../aiEvidencePayload'

describe('aiEvidencePayload utils', () => {
  it('normalizes sparse payload without throwing on missing hotspots/layers', () => {
    const normalized = normalizeAiEvidencePayload({
      spatial_clusters: { h3_summary: [] },
      fuzzy_regions: [{ id: 1, boundary: { type: 'Polygon', coordinates: [] } }],
      stats: { boundary_confidence_model: 'composite_v5' }
    })

    expect(Array.isArray(normalized.clusters.hotspots)).toBe(true)
    expect(normalized.clusters.hotspots).toHaveLength(0)
    expect(normalized.fuzzyRegions).toHaveLength(1)
    expect(normalized.stats.boundary_confidence_model).toBe('composite_v5')
    expect(normalized.fuzzyRegions[0].hierarchy.level).toBe('transition')
    expect(Array.isArray(normalized.fuzzyRegions[0].ambiguity.flags)).toBe(true)
  })

  it('resolves region and fuzzy boundaries with safe fallbacks', () => {
    const region = {
      boundary_geojson: { type: 'Polygon', coordinates: [[[114, 30], [114.1, 30], [114.1, 30.1], [114, 30.1], [114, 30]]] }
    }
    const fuzzy = {
      boundary: { type: 'Polygon', coordinates: [[[114, 30], [114.1, 30], [114.1, 30.1], [114, 30.1], [114, 30]]] },
      boundary_confidence: 0.66
    }

    expect(resolveRegionBoundary(region)).toBeTruthy()
    const layerBundle = resolveFuzzyLayerBundle(fuzzy)
    expect(layerBundle.outer.boundary).toBeTruthy()
    expect(layerBundle.transition.boundary).toBeTruthy()
    expect(layerBundle.core.boundary).toBeTruthy()
    expect(layerBundle.core.confidence).toBe(0.66)
  })
})
