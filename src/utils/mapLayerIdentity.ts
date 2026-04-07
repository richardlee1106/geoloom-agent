interface FeatureLike {
  get?: (key: string) => unknown
}

interface SourceLike {
  getFeatures?: () => unknown
}

interface LayerLike {
  get?: (key: string) => unknown
  getSource?: () => SourceLike | null | undefined
}

function sameLayerSource(candidate: LayerLike | null | undefined, referenceLayer: LayerLike | null | undefined): boolean {
  const candidateSource = candidate?.getSource?.()
  const referenceSource = referenceLayer?.getSource?.()
  return Boolean(candidateSource && referenceSource && candidateSource === referenceSource)
}

function hasPoiInteractionFlag(layer: LayerLike | null | undefined): boolean {
  return layer?.get?.('__poiInteraction') === true
}

function sourceContainsPoiFeatures(layer: LayerLike | null | undefined): boolean {
  const features = layer?.getSource?.()?.getFeatures?.()
  if (!Array.isArray(features) || features.length === 0) {
    return false
  }

  return features.some((feature) => (feature as FeatureLike)?.get?.('__raw'))
}

export function isPoiInteractionLayer(
  candidateLayer: LayerLike | null | undefined,
  {
    hoverLayer = null,
    highlightPreviewLayer = null
  }: {
    hoverLayer?: LayerLike | null
    highlightPreviewLayer?: LayerLike | null
  } = {}
): boolean {
  if (!candidateLayer) return false
  if (hasPoiInteractionFlag(candidateLayer)) {
    return true
  }
  if (candidateLayer === hoverLayer || candidateLayer === highlightPreviewLayer) {
    return true
  }
  if (sameLayerSource(candidateLayer, hoverLayer) || sameLayerSource(candidateLayer, highlightPreviewLayer)) {
    return true
  }
  return sourceContainsPoiFeatures(candidateLayer)
}
