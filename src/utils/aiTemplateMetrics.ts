type PlainObject = Record<string, unknown>
type EntityId = string | number

export type CoordinatePair = [number, number]
export type IntentType = 'macro' | 'micro' | 'comparison'

export interface CategoryCount {
  category: string
  count: number
}

export interface NormalizedHotspot {
  id: EntityId
  name: string
  poiCount: number
  center: CoordinatePair | null
  dominantCategories: unknown[]
  raw: PlainObject
}

export interface NormalizedRegion {
  id: EntityId
  name: string
  membershipScore: number
  dominantCategory: string
  dominantCategories: CategoryCount[]
  center: CoordinatePair | null
  boundaryConfidence: number
  raw: PlainObject
}

export interface NormalizedFuzzyRegion {
  id: EntityId
  name: string
  ambiguityScore: number
  level: string
  center: CoordinatePair | null
  flags: string[]
  raw: PlainObject
}

export interface IndustryOverlap {
  score: number
  topRegion: NormalizedRegion | null
  topPair: CategoryCount[]
}

export interface ConfidenceSummary {
  score: number
  model: string
}

export interface RiskSummary {
  score: number
  highAmbiguityCount: number
}

export interface AccessibilitySummary {
  score: number
  basis: string
}

export interface RadiationCoverageSummary {
  score: number
  basis: string
}

export interface TemplateContext {
  intentType: IntentType
  intentMode: string | null
  queryType: string | null
  traceId: string | null
  hotspots: NormalizedHotspot[]
  regions: NormalizedRegion[]
  fuzzyRegions: NormalizedFuzzyRegion[]
  stats: PlainObject
  industryOverlap: IndustryOverlap
  radiationCoverage: RadiationCoverageSummary
  confidence: ConfidenceSummary
  risk: RiskSummary
  accessibility: AccessibilitySummary
}

interface DeriveTemplateContextArgs {
  clusters?: unknown
  vernacularRegions?: unknown
  fuzzyRegions?: unknown
  analysisStats?: unknown
  intentMeta?: unknown
  intentMode?: unknown
  queryType?: unknown
}

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function toNumber(...candidates: unknown[]): number | null {
  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function normalizeCenter(center: unknown): CoordinatePair | null {
  if (Array.isArray(center) && center.length >= 2) {
    return [Number(center[0]), Number(center[1])]
  }

  const source = asPlainObject(center)
  if (Object.keys(source).length > 0) {
    const lon = toNumber(source.lon, source.lng, source.longitude)
    const lat = toNumber(source.lat, source.latitude)
    if (lon !== null && lat !== null) return [lon, lat]
  }
  return null
}

function normalizeHotspot(item: unknown, index: number): NormalizedHotspot {
  const source = asPlainObject(item)

  return {
    id: (source.id as EntityId | undefined) ?? `hotspot-${index}`,
    name: String(source.name || `热点#${index + 1}`),
    poiCount: Math.max(0, Number(source.poiCount || source.poi_count || 0)),
    center: normalizeCenter(source.center),
    dominantCategories: asArray(source.dominantCategories || source.dominant_categories),
    raw: source
  }
}

function normalizeRegion(item: unknown, index: number): NormalizedRegion {
  const source = asPlainObject(item)

  const dominantCategories = asArray(source.dominant_categories || source.dominantCategories)
    .map((cat) => {
      const categorySource = asPlainObject(cat)
      return {
        category: String(categorySource.category || categorySource.name || ''),
        count: Math.max(0, Number(categorySource.count || 0))
      }
    })
    .filter((cat) => cat.category)
    .sort((a, b) => b.count - a.count)

  const membership = asPlainObject(source.membership)
  const layers = asPlainObject(source.layers)
  const transitionLayer = asPlainObject(layers.transition)
  const outerLayer = asPlainObject(layers.outer)

  return {
    id: (source.id as EntityId | undefined) ?? (source.region_id as EntityId | undefined) ?? `region-${index}`,
    name: String(source.name || source.theme || source.dominant_category || `片区#${index + 1}`),
    membershipScore: clamp01(
      Number(membership.score ?? source.score ?? source.vitality_score ?? 0)
    ),
    dominantCategory: String(source.dominant_category || dominantCategories[0]?.category || ''),
    dominantCategories,
    center: normalizeCenter(source.center),
    boundaryConfidence: clamp01(
      Number(
        source.boundary_confidence ??
        source.boundaryConfidence ??
        transitionLayer.confidence ??
        outerLayer.confidence ??
        0
      )
    ),
    raw: source
  }
}

function normalizeFuzzyRegion(item: unknown, index: number): NormalizedFuzzyRegion {
  const source = asPlainObject(item)
  const ambiguity = asPlainObject(source.ambiguity)
  const membership = asPlainObject(source.membership)

  return {
    id: (source.id as EntityId | undefined) ?? (source.region_id as EntityId | undefined) ?? `fuzzy-${index}`,
    name: String(source.name || source.theme || `边界#${index + 1}`),
    ambiguityScore: clamp01(Number(ambiguity.score ?? source.score ?? 0)),
    level: String(source.level || membership.level || 'transition'),
    center: normalizeCenter(source.center),
    flags: asArray(ambiguity.flags)
      .map((flag) => String(flag || '').trim())
      .filter(Boolean),
    raw: source
  }
}

function resolveIntentType(intentMode: unknown, queryType: unknown): IntentType {
  const merged = `${intentMode || ''}|${queryType || ''}`.toLowerCase()
  if (merged.includes('comparison') || merged.includes('region_comparison')) return 'comparison'
  if (merged.includes('local_search') || merged.includes('poi_search') || merged.includes('micro')) return 'micro'
  return 'macro'
}

function computeIndustryOverlap(regions: NormalizedRegion[]): IndustryOverlap {
  const scored = regions
    .map((region) => {
      if (region.dominantCategories.length < 2) {
        return { region, score: 0, topPair: [] as CategoryCount[] }
      }
      const first = region.dominantCategories[0]
      const second = region.dominantCategories[1]
      const secondRatio = second.count / Math.max(1, first.count)
      const diversityBoost = Math.min(region.dominantCategories.length / 4, 1) * 0.25
      const membershipBoost = region.membershipScore * 0.15
      const score = clamp01(secondRatio * 0.6 + diversityBoost + membershipBoost)
      return { region, score, topPair: [first, second] }
    })
    .sort((a, b) => b.score - a.score)

  const top = scored[0] || { region: null, score: 0, topPair: [] as CategoryCount[] }
  return {
    score: top.score,
    topRegion: top.region,
    topPair: top.topPair
  }
}

function computeConfidence(
  stats: PlainObject,
  regions: NormalizedRegion[],
  hotspots: NormalizedHotspot[]
): ConfidenceSummary {
  const explicit = toNumber(stats.avg_boundary_confidence, stats.boundary_confidence)
  if (explicit !== null) {
    return {
      score: clamp01(explicit),
      model: String(stats.boundary_confidence_model || 'composite_v5')
    }
  }

  const pool = [
    ...regions.map((item) => item.boundaryConfidence),
    ...hotspots.map((item) =>
      clamp01(Number(item.raw.boundary_confidence ?? item.raw.boundaryConfidence ?? 0))
    )
  ].filter((value) => Number.isFinite(value) && value > 0)

  if (!pool.length) {
    return { score: 0, model: 'unknown' }
  }

  const score = pool.reduce((sum, value) => sum + value, 0) / pool.length
  return { score: clamp01(score), model: String(stats.boundary_confidence_model || 'derived') }
}

function computeRisk(fuzzyRegions: NormalizedFuzzyRegion[], overlap: IndustryOverlap): RiskSummary {
  const highAmbiguity = fuzzyRegions.filter((item) => item.ambiguityScore >= 0.6).length
  const overlapRisk = overlap.score >= 0.55 ? 0.18 : 0
  const fuzzyRisk = fuzzyRegions.length
    ? Math.min(
        0.7,
        fuzzyRegions.reduce((sum, item) => sum + item.ambiguityScore, 0) /
          Math.max(1, fuzzyRegions.length)
      )
    : 0

  return {
    score: clamp01(fuzzyRisk + overlapRisk),
    highAmbiguityCount: highAmbiguity
  }
}

function computeAccessibility(stats: PlainObject, hotspots: NormalizedHotspot[]): AccessibilitySummary {
  const roadFit = toNumber(stats.avg_road_alignment_score, stats.avg_boundary_coverage, stats.road_fit_score)
  const hotspotSpread = hotspots.length > 1
    ? clamp01(hotspots[1].poiCount / Math.max(1, hotspots[0].poiCount))
    : 0.35

  const score = clamp01((roadFit !== null ? roadFit * 0.65 : 0.35) + hotspotSpread * 0.35)
  return {
    score,
    basis: roadFit !== null ? 'road_fit' : 'proxy'
  }
}

function computeRadiationCoverage(
  hotspots: NormalizedHotspot[],
  regions: NormalizedRegion[],
  overlap: IndustryOverlap
): RadiationCoverageSummary {
  if (!hotspots.length && !regions.length) {
    return {
      score: 0,
      basis: 'insufficient'
    }
  }

  const hotspotSpread = hotspots.length > 1
    ? clamp01(hotspots[1].poiCount / Math.max(1, hotspots[0].poiCount))
    : hotspots.length > 0
      ? 0.4
      : 0

  const regionSpread = regions.length > 0
    ? clamp01(
        regions
          .slice(0, 3)
          .reduce((sum, region) => sum + region.membershipScore, 0) /
          Math.max(1, Math.min(3, regions.length))
      )
    : 0

  const overlapBoost = clamp01(overlap.score) * 0.3
  const score = clamp01(hotspotSpread * 0.32 + regionSpread * 0.38 + overlapBoost)

  return {
    score,
    basis: hotspots.length > 0 && regions.length > 0 ? 'mixed' : hotspots.length > 0 ? 'hotspot' : 'region'
  }
}

export function deriveTemplateContext({
  clusters,
  vernacularRegions,
  fuzzyRegions,
  analysisStats,
  intentMeta,
  intentMode,
  queryType
}: DeriveTemplateContextArgs): TemplateContext {
  const intentMetaObject = asPlainObject(intentMeta)
  const clustersObject = asPlainObject(clusters)
  const safeAnalysisStats = asPlainObject(analysisStats)

  const resolvedIntentMode = String(intentMetaObject.intentMode || intentMode || '')
  const resolvedQueryType = String(
    intentMetaObject.queryType ||
    queryType ||
    safeAnalysisStats.query_type ||
    ''
  )
  const intentType = resolveIntentType(resolvedIntentMode, resolvedQueryType)

  const hotspots = asArray(clustersObject.hotspots)
    .map((item, index) => normalizeHotspot(item, index))
    .sort((a, b) => b.poiCount - a.poiCount)
    .slice(0, 8)

  const regions = asArray(vernacularRegions)
    .map((item, index) => normalizeRegion(item, index))
    .sort((a, b) => b.membershipScore - a.membershipScore)
    .slice(0, 8)

  const fuzzy = asArray(fuzzyRegions)
    .map((item, index) => normalizeFuzzyRegion(item, index))
    .sort((a, b) => b.ambiguityScore - a.ambiguityScore)
    .slice(0, 8)

  const overlap = computeIndustryOverlap(regions)
  const confidence = computeConfidence(safeAnalysisStats, regions, hotspots)
  const risk = computeRisk(fuzzy, overlap)
  const accessibility = computeAccessibility(safeAnalysisStats, hotspots)
  const radiationCoverage = computeRadiationCoverage(hotspots, regions, overlap)

  return {
    intentType,
    intentMode: resolvedIntentMode || null,
    queryType: resolvedQueryType || null,
    traceId: String(intentMetaObject.traceId || intentMetaObject.trace_id || '') || null,
    hotspots,
    regions,
    fuzzyRegions: fuzzy,
    stats: safeAnalysisStats,
    industryOverlap: overlap,
    radiationCoverage,
    confidence,
    risk,
    accessibility
  }
}
