function isCoordinate(candidate) {
  return Array.isArray(candidate)
    && candidate.length >= 2
    && Number.isFinite(Number(candidate[0]))
    && Number.isFinite(Number(candidate[1]))
}

export function resolvePopupAnchorCoordinate({
  feature = null,
  raw = null,
  fallbackCoordinate = null,
  resolveDisplayLonLat,
  projectToMapCoordinate
} = {}) {
  const featureCoordinate = feature?.getGeometry?.()?.getCoordinates?.()
  if (isCoordinate(featureCoordinate)) {
    return [Number(featureCoordinate[0]), Number(featureCoordinate[1])]
  }

  const displayLonLat = typeof resolveDisplayLonLat === 'function'
    ? resolveDisplayLonLat(raw)
    : null

  if (isCoordinate(displayLonLat) && typeof projectToMapCoordinate === 'function') {
    return projectToMapCoordinate([Number(displayLonLat[0]), Number(displayLonLat[1])])
  }

  if (isCoordinate(fallbackCoordinate)) {
    return [Number(fallbackCoordinate[0]), Number(fallbackCoordinate[1])]
  }

  return null
}
