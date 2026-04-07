function toCoordSys(value, fallback = 'gcj02') {
  return String(value || fallback || 'gcj02').trim().toLowerCase() || 'gcj02'
}

export function resolveFeatureCoordSysHint(feature, fallback = 'gcj02') {
  return toCoordSys(
    feature?.coordSys
    || feature?.coord_sys
    || feature?.properties?.coordSys
    || feature?.properties?._coordSys,
    fallback
  )
}

export function resolveAnchorCoordSys(message, pois = [], fallback = 'gcj02') {
  const statsCoordSys = toCoordSys(
    message?.analysisStats?.anchor_coord_sys
    || message?.analysisStats?.coord_sys,
    ''
  )

  if (statsCoordSys) return statsCoordSys

  const firstPoiWithCoordSys = Array.isArray(pois)
    ? pois.find((poi) => poi && (
      poi.coordSys
      || poi.coord_sys
      || poi.properties?.coordSys
      || poi.properties?._coordSys
    ))
    : null

  return resolveFeatureCoordSysHint(firstPoiWithCoordSys, fallback)
}

function resolveAnchorName(message) {
  return String(
    message?.intentPreview?.normalizedAnchor
    || message?.intentPreview?.displayAnchor
    || message?.intentPreview?.rawAnchor
    || message?.intentMeta?.placeName
    || message?.analysisStats?.anchor_name
    || '检索锚点'
  ).trim() || '检索锚点'
}

export function buildAiAnchorFeatureFromMessage(message, pois = [], { fallbackCoordSys = 'gcj02' } = {}) {
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
