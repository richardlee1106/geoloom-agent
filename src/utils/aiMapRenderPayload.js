function resolveFallbackName(entry = {}) {
  return String(
    entry?.name
    || entry?.名称
    || entry?.properties?.名称
    || entry?.properties?.name
    || entry?.properties?.Name
    || ''
  ).trim()
}

function resolveCoordSys(entry = {}, fallbackCoordSys = 'gcj02') {
  const resolved = String(
    entry?.coordSys
    || entry?.coord_sys
    || entry?.properties?.coordSys
    || entry?.properties?._coordSys
    || ''
  ).trim().toLowerCase()

  return resolved || String(fallbackCoordSys || 'gcj02').trim().toLowerCase()
}

function extractPointCoordinates(entry = {}) {
  if (entry?.type === 'Feature' && entry?.geometry?.type === 'Point') {
    const [lon, lat] = entry.geometry.coordinates || []
    return [Number(lon), Number(lat)]
  }

  return [
    Number(entry?.lon ?? entry?.longitude ?? entry?.geometry?.coordinates?.[0]),
    Number(entry?.lat ?? entry?.latitude ?? entry?.geometry?.coordinates?.[1])
  ]
}

function buildDedupeKey(feature = {}) {
  const [lon, lat] = feature?.geometry?.coordinates || []
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
  entry,
  {
    fallbackCoordSys = 'gcj02',
    source = 'ai_tagcloud',
    forceAnchor = false
  } = {}
) {
  if (!entry) return null

  const [lon, lat] = extractPointCoordinates(entry)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  const coordSys = resolveCoordSys(entry, fallbackCoordSys)
  const properties = {
    ...(entry?.properties || {})
  }

  const fallbackName = resolveFallbackName(entry)
  if (fallbackName && !properties.名称) {
    properties.名称 = fallbackName
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

export function normalizeAiMapRenderPayload(payload, { fallbackCoordSys = 'gcj02' } = {}) {
  const rawPois = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.pois)
      ? payload.pois
      : []

  const dedupeSet = new Set()
  const features = rawPois.reduce((result, entry) => {
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

  const anchorFeature = normalizeRenderFeature(payload?.anchorFeature, {
    fallbackCoordSys,
    source: 'ai_anchor',
    forceAnchor: true
  })

  return {
    features,
    anchorFeature
  }
}
