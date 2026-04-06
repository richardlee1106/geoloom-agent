function pickArray(...candidates) {
  for (const value of candidates) {
    if (Array.isArray(value)) return value
  }
  return []
}

function pickObject(...candidates) {
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  }
  return null
}

function pickString(...candidates) {
  for (const value of candidates) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeIntentMeta(root, results) {
  const intentMetaCandidate = pickObject(
    results.intentMeta,
    results.intent_meta,
    root.intentMeta,
    root.intent_meta
  )

  const queryPlan = pickObject(
    results.query_plan,
    results.queryPlan,
    results.stats?.query_plan,
    results.stats?.queryPlan,
    root.query_plan,
    root.queryPlan,
    root.stats?.query_plan,
    root.stats?.queryPlan,
    results.query_executed,
    root.query_executed,
    intentMetaCandidate?.queryPlan,
    intentMetaCandidate?.query_plan
  )

  const queryType = pickString(
    queryPlan?.query_type,
    queryPlan?.queryType,
    results.query_executed?.query_type,
    results.query_executed?.queryType,
    root.query_executed?.query_type,
    root.query_executed?.queryType,
    results.query_type,
    results.queryType,
    results.stats?.query_type,
    results.stats?.queryType,
    intentMetaCandidate?.queryType,
    intentMetaCandidate?.query_type,
    root.query_type,
    root.queryType,
    root.stats?.query_type,
    root.stats?.queryType
  ).toLowerCase()

  const intentMode = pickString(
    queryPlan?.intent_mode,
    queryPlan?.intentMode,
    results.query_executed?.intent_mode,
    results.query_executed?.intentMode,
    root.query_executed?.intent_mode,
    root.query_executed?.intentMode,
    results.intent_mode,
    results.intentMode,
    results.stats?.intent_mode,
    results.stats?.intentMode,
    intentMetaCandidate?.intentMode,
    intentMetaCandidate?.intent_mode,
    root.intent_mode,
    root.intentMode,
    root.stats?.intent_mode,
    root.stats?.intentMode
  ).toLowerCase()

  if (!queryPlan && !queryType && !intentMode) {
    return null
  }

  return {
    queryType: queryType || null,
    intentMode: intentMode || null,
    queryPlan: queryPlan || null
  }
}

export function resolveIntentMeta(payload) {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root
  return normalizeIntentMeta(root, results)
}

export function normalizeRefinedResultEvidence(payload) {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root

  const boundary = results.boundary ?? root.boundary ?? null
  const spatialClusters =
    pickObject(results.spatial_clusters, results.spatialClusters, root.spatial_clusters, root.spatialClusters) ||
    { hotspots: [] }
  const vernacularRegions = pickArray(
    results.vernacular_regions,
    results.vernacularRegions,
    root.vernacular_regions,
    root.vernacularRegions
  )
  const fuzzyRegions = pickArray(
    results.fuzzy_regions,
    results.fuzzyRegions,
    root.fuzzy_regions,
    root.fuzzyRegions
  )
  const stats = pickObject(results.stats, results.analysisStats, root.stats, root.analysisStats)
  const intent = resolveIntentMeta(payload)

  const hotspotCount = Array.isArray(spatialClusters?.hotspots) ? spatialClusters.hotspots.length : 0
  const hasEvidence = Boolean(
    boundary ||
      hotspotCount > 0 ||
      vernacularRegions.length > 0 ||
      fuzzyRegions.length > 0
  )

  return {
    boundary,
    spatialClusters,
    vernacularRegions,
    fuzzyRegions,
    stats,
    intent,
    hasEvidence
  }
}

