import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import VectorSource from 'ol/source/Vector'

import { useEvidenceLayer } from '../useEvidenceLayer'

describe('useEvidenceLayer', () => {
  it('ignores null hotspot entries while still rendering valid evidence boundaries', () => {
    const locateLayerSource = new VectorSource()
    const hidePopup = vi.fn()

    const layer = useEvidenceLayer({
      mapRef: ref(null),
      locateLayerSource,
      hidePopup,
      vectorLayerRuntimeOptions: {},
      toMapLonLat: (lon, lat) => [lon, lat]
    })

    expect(() => {
      layer.showAiSpatialEvidence({
        clusters: {
          hotspots: [
            null,
            {
              name: '热点片区A',
              boundary_geojson: {
                type: 'Polygon',
                coordinates: [[[114.3, 30.5], [114.4, 30.5], [114.4, 30.6], [114.3, 30.6], [114.3, 30.5]]]
              },
              boundary_confidence: 0.82
            }
          ]
        },
        stats: {
          boundary_confidence_model: 'composite_v5'
        }
      }, { fitView: false })
    }).not.toThrow()

    expect(layer.aiEvidenceLayerSource.getFeatures().length).toBe(1)
    expect(layer.aiBoundaryLegend.value.visible).toBe(true)
    expect(layer.aiBoundaryLegend.value.model).toBe('composite_v5')
  })
})
