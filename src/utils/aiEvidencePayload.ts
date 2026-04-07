type PlainObject = Record<string, unknown>

export interface NormalizedFuzzyHierarchy {
  macro_name: string
  micro_name: string
  level: string
  rank_in_macro: number | null
  macro_size: number | null
  layer_mode: string
}

export interface NormalizedFuzzyRegion extends PlainObject {
  hierarchy: NormalizedFuzzyHierarchy
  ambiguity: PlainObject
}

export interface NormalizedAiEvidencePayload {
  boundary: unknown
  stats: PlainObject
  clusters: PlainObject & { hotspots: unknown[] }
  vernacularRegions: unknown[]
  fuzzyRegions: NormalizedFuzzyRegion[]
}

export interface FuzzyLayerBundle {
  outer: { boundary: unknown; confidence: unknown }
  transition: { boundary: unknown; confidence: unknown }
  core: { boundary: unknown; confidence: unknown }
}

function asPlainObject(value: unknown): PlainObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function pickObject(...values: unknown[]): PlainObject {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as PlainObject
    }
  }
  return {}
}

function pickArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }
  return []
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeText(value: unknown): string {
  return String(value || '')
}

function normalizeFuzzyRegion(item: unknown = {}): NormalizedFuzzyRegion {
  const region = asPlainObject(item)
  const hierarchy = asPlainObject(region.hierarchy)
  const membership = asPlainObject(region.membership)
  const ambiguity = asPlainObject(region.ambiguity)

  return {
    ...region,
    hierarchy: {
      macro_name: normalizeText(hierarchy.macro_name),
      micro_name: normalizeText(hierarchy.micro_name || region.name),
      level: normalizeText(hierarchy.level || region.level || membership.level || 'transition'),
      rank_in_macro: toFiniteNumberOrNull(hierarchy.rank_in_macro),
      macro_size: toFiniteNumberOrNull(hierarchy.macro_size),
      layer_mode: normalizeText(hierarchy.layer_mode || (region.layers ? 'multi_layer' : 'single_layer'))
    },
    ambiguity: Object.keys(ambiguity).length > 0 ? ambiguity : { score: null, flags: [] }
  }
}

export function normalizeAiEvidencePayload(payload: unknown): NormalizedAiEvidencePayload {
  const root = pickObject(payload)
  const camelClusters = asPlainObject(root.spatialClusters)
  const snakeClusters = asPlainObject(root.spatial_clusters)
  const clusters = pickObject(root.clusters, camelClusters, snakeClusters)
  const hotspots = pickArray(
    clusters.hotspots,
    root.hotspots,
    camelClusters.hotspots,
    snakeClusters.hotspots
  )

  return {
    boundary: root.boundary ?? null,
    stats: pickObject(root.stats),
    clusters: { ...clusters, hotspots },
    vernacularRegions: pickArray(root.vernacularRegions, root.vernacular_regions),
    fuzzyRegions: pickArray(root.fuzzyRegions, root.fuzzy_regions).map((item) => normalizeFuzzyRegion(item))
  }
}

export function resolveRegionBoundary(entity: unknown): unknown {
  const target = pickObject(entity)
  const layers = asPlainObject(target.layers)
  const transition = asPlainObject(layers.transition)
  const outer = asPlainObject(layers.outer)

  return (
    target.boundary ||
    target.boundary_geojson ||
    target.boundary_ring ||
    transition.geojson ||
    transition.boundary ||
    outer.geojson ||
    outer.boundary ||
    null
  )
}

export function resolveFuzzyLayerBundle(region: unknown): FuzzyLayerBundle {
  const item = pickObject(region)
  const layers = asPlainObject(item.layers)
  const outer = asPlainObject(layers.outer)
  const transition = asPlainObject(layers.transition)
  const core = asPlainObject(layers.core)

  const outerBoundary =
    outer.boundary ||
    outer.geojson ||
    item.boundary ||
    item.boundary_geojson ||
    item.boundary_ring ||
    null
  const transitionBoundary =
    transition.boundary ||
    transition.geojson ||
    outerBoundary
  const coreBoundary =
    core.boundary ||
    core.geojson ||
    transitionBoundary ||
    outerBoundary

  return {
    outer: {
      boundary: outerBoundary,
      confidence: outer.confidence ?? item.boundary_confidence ?? null
    },
    transition: {
      boundary: transitionBoundary,
      confidence: transition.confidence ?? item.boundary_confidence ?? null
    },
    core: {
      boundary: coreBoundary,
      confidence: core.confidence ?? item.boundary_confidence ?? null
    }
  }
}
