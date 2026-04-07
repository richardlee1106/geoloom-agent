type NumericCoordinate = [number, number]
type CoordinateTuple = [unknown, unknown, ...unknown[]]

interface GeometryLike {
  getCoordinates?: () => unknown
}

interface FeatureLike {
  getGeometry?: () => GeometryLike | null | undefined
}

interface ResolvePopupAnchorCoordinateArgs {
  feature?: FeatureLike | null
  raw?: unknown
  fallbackCoordinate?: unknown
  resolveDisplayLonLat?: ((raw: unknown) => unknown) | null
  projectToMapCoordinate?: ((lonLat: NumericCoordinate) => unknown) | null
}

function isCoordinate(candidate: unknown): candidate is NumericCoordinate {
  return Array.isArray(candidate)
    && candidate.length >= 2
    && Number.isFinite(Number(candidate[0]))
    && Number.isFinite(Number(candidate[1]))
}

function isCoordinateTuple(candidate: unknown): candidate is CoordinateTuple {
  return Array.isArray(candidate) && candidate.length >= 2
}

export function resolvePopupAnchorCoordinate({
  feature = null,
  raw = null,
  fallbackCoordinate = null,
  resolveDisplayLonLat,
  projectToMapCoordinate
}: ResolvePopupAnchorCoordinateArgs = {}): CoordinateTuple | NumericCoordinate | null {
  const featureCoordinate = feature?.getGeometry?.()?.getCoordinates?.()
  if (isCoordinate(featureCoordinate)) {
    return [Number(featureCoordinate[0]), Number(featureCoordinate[1])]
  }

  const displayLonLat = typeof resolveDisplayLonLat === 'function'
    ? resolveDisplayLonLat(raw)
    : null

  if (isCoordinate(displayLonLat) && typeof projectToMapCoordinate === 'function') {
    const projected = projectToMapCoordinate([Number(displayLonLat[0]), Number(displayLonLat[1])])
    if (isCoordinateTuple(projected)) {
      return projected
    }
  }

  if (isCoordinate(fallbackCoordinate)) {
    return [Number(fallbackCoordinate[0]), Number(fallbackCoordinate[1])]
  }

  return null
}
