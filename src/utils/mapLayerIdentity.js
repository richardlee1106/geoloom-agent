function sameLayerSource(candidate, referenceLayer) {
  const candidateSource = candidate?.getSource?.()
  const referenceSource = referenceLayer?.getSource?.()
  return Boolean(candidateSource && referenceSource && candidateSource === referenceSource)
}

function hasPoiInteractionFlag(layer) {
  return layer?.get?.('__poiInteraction') === true
}

function sourceContainsPoiFeatures(layer) {
  const features = layer?.getSource?.()?.getFeatures?.()
  if (!Array.isArray(features) || features.length === 0) {
    return false
  }

  return features.some((feature) => feature?.get?.('__raw'))
}

export function isPoiInteractionLayer(candidateLayer, {
  hoverLayer = null,
  highlightPreviewLayer = null
} = {}) {
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
