type PlainObject = Record<string, unknown>
type CoordinatePair = [number, number]

interface NormalizedFeatureGeometry {
  type: 'Point'
  coordinates: CoordinatePair
}

interface NormalizedFeatureProperties extends PlainObject {
  名称?: string
  _source?: string
  _coordSys?: string
  _isAnchor?: boolean
}

export interface NormalizedRenderFeature {
  type: 'Feature'
  geometry: NormalizedFeatureGeometry
  coordSys: string
  properties: NormalizedFeatureProperties
}

interface NormalizeRenderFeatureOptions {
  fallbackCoordSys?: unknown
  source?: string
  forceAnchor?: boolean
}

interface NormalizeAiMapRenderPayloadOptions {
  fallbackCoordSys?: unknown
}

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function resolveFallbackName(entry: unknown = {}): string {
  const source = asPlainObject(entry)
  const properties = asPlainObject(source.properties)

  return String(
    source.name ||
    source['名称'] ||
    properties['名称'] ||
    properties.name ||
    properties.Name ||
    ''
  ).trim()
}

function resolveCoordSys(entry: unknown = {}, fallbackCoordSys: unknown = 'gcj02'): string {
  const source = asPlainObject(entry)
  const properties = asPlainObject(source.properties)

  const resolved = String(
    source.coordSys ||
    source.coord_sys ||
    properties.coordSys ||
    properties._coordSys ||
    ''
  ).trim().toLowerCase()

  return resolved || String(fallbackCoordSys || 'gcj02').trim().toLowerCase()
}

function extractPointCoordinates(entry: unknown = {}): CoordinatePair {
  const source = asPlainObject(entry)
  const geometry = asPlainObject(source.geometry)

  if (source.type === 'Feature' && geometry.type === 'Point') {
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
    return [Number(coordinates[0]), Number(coordinates[1])]
  }

  const fallbackCoordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
  return [
    Number(source.lon ?? source.longitude ?? fallbackCoordinates[0]),
    Number(source.lat ?? source.latitude ?? fallbackCoordinates[1])
  ]
}

function buildDedupeKey(feature: NormalizedRenderFeature): string {
  const [lon, lat] = feature.geometry.coordinates
  const name = resolveFallbackName(feature)
  const coordSys = resolveCoordSys(feature)
  return [
    name || '__anonymous__',
    Number(lon).toFixed(6),
    Number(lat).toFixed(6),
    coordSys
  ].join('::')
}

export function normalizeRenderFeature(
  entry: unknown,
  {
    fallbackCoordSys = 'gcj02',
    source = 'ai_tagcloud',
    forceAnchor = false
  }: NormalizeRenderFeatureOptions = {}
): NormalizedRenderFeature | null {
  if (!entry) return null

  const sourceEntry = asPlainObject(entry)
  const [lon, lat] = extractPointCoordinates(sourceEntry)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  const coordSys = resolveCoordSys(sourceEntry, fallbackCoordSys)
  const properties: NormalizedFeatureProperties = {
    ...asPlainObject(sourceEntry.properties)
  }

  const fallbackName = resolveFallbackName(sourceEntry)
  if (fallbackName && !properties['名称']) {
    properties['名称'] = fallbackName
  }
  if (!properties._source) {
    properties._source = source
  }
  if (!properties._coordSys) {
    properties._coordSys = coordSys
  }
  if (forceAnchor) {
    properties._isAnchor = true
    properties._source = 'ai_anchor'
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    coordSys,
    properties
  }
}

export function normalizeAiMapRenderPayload(
  payload: unknown,
  { fallbackCoordSys = 'gcj02' }: NormalizeAiMapRenderPayloadOptions = {}
): {
  features: NormalizedRenderFeature[]
  anchorFeature: NormalizedRenderFeature | null
} {
  const source = asPlainObject(payload)
  const rawPois = Array.isArray(payload)
    ? payload
    : Array.isArray(source.pois)
      ? source.pois
      : []

  const dedupeSet = new Set<string>()
  const features = rawPois.reduce<NormalizedRenderFeature[]>((result, entry) => {
    const feature = normalizeRenderFeature(entry, {
      fallbackCoordSys,
      source: 'ai_tagcloud'
    })

    if (!feature) return result

    const dedupeKey = buildDedupeKey(feature)
    if (dedupeSet.has(dedupeKey)) {
      return result
    }

    dedupeSet.add(dedupeKey)
    result.push(feature)
    return result
  }, [])

  const anchorCandidate = source.anchorFeature ?? source.anchor_feature ?? null
  const anchorFeature = normalizeRenderFeature(anchorCandidate, {
    fallbackCoordSys,
    source: 'ai_anchor',
    forceAnchor: true
  })

  return {
    features,
    anchorFeature
  }
}
