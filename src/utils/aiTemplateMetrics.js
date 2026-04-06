function asArray(value) {
  return Array.isArray(value) ? value : []
}

function toNumber(...candidates) {
  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return null
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function normalizeCenter(center) {
  if (Array.isArray(center) && center.length >= 2) return [Number(center[0]), Number(center[1])]
  if (center && typeof center === 'object') {
    const lon = toNumber(center.lon, center.lng, center.longitude)
    const lat = toNumber(center.lat, center.latitude)
    if (lon !== null && lat !== null) return [lon, lat]
  }
  return null
}

function normalizeHotspot(item, index) {
  return {
    id: item?.id ?? `hotspot-${index}`,
    name: String(item?.name || `热点#${index + 1}`),
    poiCount: Math.max(0, Number(item?.poiCount || item?.poi_count || 0)),
    center: normalizeCenter(item?.center),
    dominantCategories: asArray(item?.dominantCategories || item?.dominant_categories),
    raw: item
  }
}

function normalizeRegion(item, index) {
  const dominantCategories = asArray(item?.dominant_categories || item?.dominantCategories)
    .map((cat) => ({
      category: String(cat?.category || cat?.name || ''),
      count: Math.max(0, Number(cat?.count || 0))
    }))
    .filter((cat) => cat.category)
    .sort((a, b) => b.count - a.count)

  return {
    id: item?.id ?? item?.region_id ?? `region-${index}`,
    name: String(item?.name || item?.theme || item?.dominant_category || `片区#${index + 1}`),
    membershipScore: clamp01(
      Number(item?.membership?.score ?? item?.score ?? item?.vitality_score ?? 0)
    ),
    dominantCategory: String(item?.dominant_category || dominantCategories[0]?.category || ''),
    dominantCategories,
    center: normalizeCenter(item?.center),
    boundaryConfidence: clamp01(
      Number(
        item?.boundary_confidence ??
          item?.boundaryConfidence ??
          item?.layers?.transition?.confidence ??
          item?.layers?.outer?.confidence ??
          0
      )
    ),
    raw: item
  }
}

function normalizeFuzzyRegion(item, index) {
  return {
    id: item?.id ?? item?.region_id ?? `fuzzy-${index}`,
    name: String(item?.name || item?.theme || `边界#${index + 1}`),
    ambiguityScore: clamp01(Number(item?.ambiguity?.score ?? item?.score ?? 0)),
    level: String(item?.level || item?.membership?.level || 'transition'),
    center: normalizeCenter(item?.center),
    flags: asArray(item?.ambiguity?.flags).filter(Boolean),
    raw: item
  }
}

function resolveIntentType(intentMode, queryType) {
  const merged = `${intentMode || ''}|${queryType || ''}`.toLowerCase()
  if (merged.includes('comparison') || merged.includes('region_comparison')) return 'comparison'
  if (merged.includes('local_search') || merged.includes('poi_search') || merged.includes('micro')) return 'micro'
  return 'macro'
}

function computeIndustryOverlap(regions) {
  const scored = regions
    .map((region) => {
      if (region.dominantCategories.length < 2) {
        return { region, score: 0, topPair: [] }
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

  const top = scored[0] || { region: null, score: 0, topPair: [] }
  return {
    score: top.score,
    topRegion: top.region,
    topPair: top.topPair
  }
}

function computeConfidence(stats, regions, hotspots) {
  const explicit = toNumber(stats?.avg_boundary_confidence, stats?.boundary_confidence)
  if (explicit !== null) {
    return {
      score: clamp01(explicit),
      model: String(stats?.boundary_confidence_model || 'composite_v5')
    }
  }

  const pool = [
    ...regions.map((item) => item.boundaryConfidence),
    ...hotspots.map((item) =>
      clamp01(Number(item?.raw?.boundary_confidence ?? item?.raw?.boundaryConfidence ?? 0))
    )
  ].filter((value) => Number.isFinite(value) && value > 0)

  if (!pool.length) {
    return { score: 0, model: 'unknown' }
  }

  const score = pool.reduce((sum, value) => sum + value, 0) / pool.length
  return { score: clamp01(score), model: String(stats?.boundary_confidence_model || 'derived') }
}

function computeRisk(fuzzyRegions, overlap) {
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

function computeAccessibility(stats, hotspots) {
  const roadFit = toNumber(stats?.avg_road_alignment_score, stats?.avg_boundary_coverage, stats?.road_fit_score)
  const hotspotSpread = hotspots.length > 1 ? clamp01(hotspots[1].poiCount / Math.max(1, hotspots[0].poiCount)) : 0.35

  const score = clamp01((roadFit !== null ? roadFit * 0.65 : 0.35) + hotspotSpread * 0.35)
  return {
    score,
    basis: roadFit !== null ? 'road_fit' : 'proxy'
  }
}

function computeRadiationCoverage(hotspots, regions, overlap) {
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
}) {
  const resolvedIntentMode = intentMeta?.intentMode || intentMode || ''
  const resolvedQueryType = intentMeta?.queryType || queryType || analysisStats?.query_type || ''
  const intentType = resolveIntentType(resolvedIntentMode, resolvedQueryType)

  const hotspots = asArray(clusters?.hotspots)
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
  const confidence = computeConfidence(analysisStats || {}, regions, hotspots)
  const risk = computeRisk(fuzzy, overlap)
  const accessibility = computeAccessibility(analysisStats || {}, hotspots)
  const radiationCoverage = computeRadiationCoverage(hotspots, regions, overlap)

  return {
    intentType,
    intentMode: resolvedIntentMode || null,
    queryType: resolvedQueryType || null,
    traceId: intentMeta?.traceId || intentMeta?.trace_id || null,
    hotspots,
    regions,
    fuzzyRegions: fuzzy,
    stats: analysisStats || {},
    industryOverlap: overlap,
    radiationCoverage,
    confidence,
    risk,
    accessibility
  }
}
