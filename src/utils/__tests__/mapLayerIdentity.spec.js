import { describe, expect, it } from 'vitest'

import { isPoiInteractionLayer } from '../mapLayerIdentity'

describe('mapLayerIdentity', () => {
  it('accepts the exact interaction layer instance', () => {
    const hoverLayer = { id: 'hover' }
    const highlightPreviewLayer = { id: 'preview' }

    expect(isPoiInteractionLayer(hoverLayer, { hoverLayer, highlightPreviewLayer })).toBe(true)
    expect(isPoiInteractionLayer(highlightPreviewLayer, { hoverLayer, highlightPreviewLayer })).toBe(true)
  })

  it('accepts layers that share the same vector source as the interaction layer', () => {
    const sharedPreviewSource = { name: 'preview-source' }
    const candidate = {
      getSource() {
        return sharedPreviewSource
      }
    }
    const highlightPreviewLayer = {
      getSource() {
        return sharedPreviewSource
      }
    }

    expect(isPoiInteractionLayer(candidate, {
      hoverLayer: null,
      highlightPreviewLayer
    })).toBe(true)
  })

  it('accepts layers explicitly flagged as POI interaction layers', () => {
    const candidate = {
      get(key) {
        return key === '__poiInteraction' ? true : undefined
      }
    }

    expect(isPoiInteractionLayer(candidate, {
      hoverLayer: null,
      highlightPreviewLayer: null
    })).toBe(true)
  })

  it('accepts layers whose features carry raw POI payloads', () => {
    const candidate = {
      getSource() {
        return {
          getFeatures() {
            return [
              {
                get(key) {
                  return key === '__raw' ? { properties: { name: '湖北大学武昌校区' } } : undefined
                }
              }
            ]
          }
        }
      }
    }

    expect(isPoiInteractionLayer(candidate, {
      hoverLayer: null,
      highlightPreviewLayer: null
    })).toBe(true)
  })

  it('rejects unrelated layers', () => {
    const hoverLayer = { id: 'hover' }
    const highlightPreviewLayer = { id: 'preview' }

    expect(isPoiInteractionLayer({ id: 'other' }, { hoverLayer, highlightPreviewLayer })).toBe(false)
  })
})
