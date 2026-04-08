type AnyRecord = Record<string, unknown>

type FeatureProperties = {
  coordSys?: unknown
  coord_sys?: unknown
  _coordSys?: unknown
  [key: string]: unknown
}

type FeatureLike = {
  coordSys?: unknown
  coord_sys?: unknown
  properties?: FeatureProperties | null
  [key: string]: unknown
}

type MessageLike = {
  analysisStats?: AnyRecord | null
  intentPreview?: AnyRecord | null
  intentMeta?: AnyRecord | null
  [key: string]: unknown
}

type AiAnchorFeature = {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
  coordSys: string
  properties: {
    名称: string
    name: string
    title: string
    label: string
    poi_name: string
    type: '检索锚点'
    category: '检索锚点'
    _source: 'ai_anchor'
    _isAnchor: true
    _coordSys: string
  }
}

function normalizeCoordSys(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function toCoordSys(value: unknown, fallback = 'gcj02'): string {
  return normalizeCoordSys(value) || normalizeCoordSys(fallback) || 'gcj02'
}

export function resolveFeatureCoordSysHint(feature: FeatureLike | null | undefined, fallback = 'gcj02'): string {
  return toCoordSys(
    feature?.coordSys
    || feature?.coord_sys
    || feature?.properties?.coordSys
    || feature?.properties?._coordSys,
    fallback
  )
}

export function resolveAnchorCoordSys(
  message: MessageLike | null | undefined,
  pois: FeatureLike[] = [],
  fallback = 'gcj02'
): string {
  const statsCoordSys = normalizeCoordSys(
    message?.analysisStats?.anchor_coord_sys
    || message?.analysisStats?.coord_sys
  )

  if (statsCoordSys) return statsCoordSys

  const firstPoiWithCoordSys = Array.isArray(pois)
    ? pois.find((poi) => poi && (
      poi.coordSys
      || poi.coord_sys
      || poi.properties?.coordSys
      || poi.properties?._coordSys
    )) || null
    : null

  return resolveFeatureCoordSysHint(firstPoiWithCoordSys, fallback)
}

function resolveAnchorName(message: MessageLike | null | undefined): string {
  return String(
    message?.intentPreview?.normalizedAnchor
    || message?.intentPreview?.displayAnchor
    || message?.intentPreview?.rawAnchor
    || message?.intentMeta?.placeName
    || message?.analysisStats?.anchor_name
    || '检索锚点'
  ).trim() || '检索锚点'
}

export function buildAiAnchorFeatureFromMessage(
  message: MessageLike | null | undefined,
  pois: FeatureLike[] = [],
  { fallbackCoordSys = 'gcj02' }: { fallbackCoordSys?: string } = {}
): AiAnchorFeature | null {
  const stats = message?.analysisStats && typeof message.analysisStats === 'object'
    ? message.analysisStats
    : null

  const lon = Number(stats?.anchor_lon)
  const lat = Number(stats?.anchor_lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  const anchorName = resolveAnchorName(message)
  const anchorCoordSys = resolveAnchorCoordSys(message, pois, fallbackCoordSys)

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    coordSys: anchorCoordSys,
    properties: {
      名称: anchorName,
      name: anchorName,
      title: anchorName,
      label: anchorName,
      poi_name: anchorName,
      type: '检索锚点',
      category: '检索锚点',
      _source: 'ai_anchor',
      _isAnchor: true,
      _coordSys: anchorCoordSys
    }
  }
}
