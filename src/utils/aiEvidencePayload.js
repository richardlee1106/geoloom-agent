function pickObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return {}
}

function pickArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }
  return []
}

function normalizeFuzzyRegion(item = {}) {
  const region = item && typeof item === 'object' ? item : {}
  const hierarchy = region.hierarchy && typeof region.hierarchy === 'object'
    ? region.hierarchy
    : {}
  return {
    ...region,
    hierarchy: {
      macro_name: hierarchy.macro_name || '',
      micro_name: hierarchy.micro_name || region.name || '',
      level: hierarchy.level || region.level || region.membership?.level || 'transition',
      rank_in_macro: Number.isFinite(Number(hierarchy.rank_in_macro)) ? Number(hierarchy.rank_in_macro) : null,
      macro_size: Number.isFinite(Number(hierarchy.macro_size)) ? Number(hierarchy.macro_size) : null,
      layer_mode: hierarchy.layer_mode || (region.layers ? 'multi_layer' : 'single_layer')
    },
    ambiguity: region.ambiguity && typeof region.ambiguity === 'object'
      ? region.ambiguity
      : { score: null, flags: [] }
  }
}

export function normalizeAiEvidencePayload(payload) {
  const root = pickObject(payload)
  const clusters = pickObject(root.clusters, root.spatialClusters, root.spatial_clusters)
  const hotspots = pickArray(
    clusters.hotspots,
    root.hotspots,
    root.spatialClusters?.hotspots,
    root.spatial_clusters?.hotspots
  )

  return {
    boundary: root.boundary ?? null,
    stats: pickObject(root.stats),
    clusters: { ...clusters, hotspots },
    vernacularRegions: pickArray(root.vernacularRegions, root.vernacular_regions),
    fuzzyRegions: pickArray(root.fuzzyRegions, root.fuzzy_regions).map((item) => normalizeFuzzyRegion(item))
  }
}

export function resolveRegionBoundary(entity) {
  const target = pickObject(entity)
  return (
    target.boundary ||
    target.boundary_geojson ||
    target.boundary_ring ||
    target.layers?.transition?.geojson ||
    target.layers?.transition?.boundary ||
    target.layers?.outer?.geojson ||
    target.layers?.outer?.boundary ||
    null
  )
}

export function resolveFuzzyLayerBundle(region) {
  const item = pickObject(region)
  const outerBoundary =
    item.layers?.outer?.boundary ||
    item.layers?.outer?.geojson ||
    item.boundary ||
    item.boundary_geojson ||
    item.boundary_ring ||
    null
  const transitionBoundary =
    item.layers?.transition?.boundary ||
    item.layers?.transition?.geojson ||
    outerBoundary
  const coreBoundary =
    item.layers?.core?.boundary ||
    item.layers?.core?.geojson ||
    transitionBoundary ||
    outerBoundary

  return {
    outer: {
      boundary: outerBoundary,
      confidence: item.layers?.outer?.confidence ?? item.boundary_confidence ?? null
    },
    transition: {
      boundary: transitionBoundary,
      confidence: item.layers?.transition?.confidence ?? item.boundary_confidence ?? null
    },
    core: {
      boundary: coreBoundary,
      confidence: item.layers?.core?.confidence ?? item.boundary_confidence ?? null
    }
  }
}
