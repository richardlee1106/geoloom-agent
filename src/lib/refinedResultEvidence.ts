type PlainObject = Record<string, unknown>

export interface IntentMeta {
  queryType: string | null
  intentMode: string | null
  queryPlan: PlainObject | null
}

export interface NormalizedRefinedResultEvidence {
  boundary: unknown
  spatialClusters: PlainObject
  vernacularRegions: unknown[]
  fuzzyRegions: unknown[]
  stats: PlainObject | null
  evidenceView: PlainObject | null
  toolCalls: unknown[]
  intent: IntentMeta | null
  hasEvidence: boolean
}

function pickArray(...candidates: unknown[]): unknown[] {
  for (const value of candidates) {
    if (Array.isArray(value)) return value
  }
  return []
}

function pickObject(...candidates: unknown[]): PlainObject | null {
  for (const value of candidates) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as PlainObject
    }
  }
  return null
}

function pickString(...candidates: unknown[]): string {
  for (const value of candidates) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeIntentMeta(root: PlainObject, results: PlainObject): IntentMeta | null {
  const rootStats = pickObject(root.stats)
  const resultsStats = pickObject(results.stats)
  const rootQueryExecuted = pickObject(root.query_executed, root.queryExecuted)
  const resultsQueryExecuted = pickObject(results.query_executed, results.queryExecuted)

  const intentMetaCandidate = pickObject(
    results.intentMeta,
    results.intent_meta,
    root.intentMeta,
    root.intent_meta
  )

  const queryPlan = pickObject(
    results.query_plan,
    results.queryPlan,
    resultsStats?.query_plan,
    resultsStats?.queryPlan,
    root.query_plan,
    root.queryPlan,
    rootStats?.query_plan,
    rootStats?.queryPlan,
    resultsQueryExecuted,
    rootQueryExecuted,
    intentMetaCandidate?.queryPlan,
    intentMetaCandidate?.query_plan
  )

  const queryType = pickString(
    queryPlan?.query_type,
    queryPlan?.queryType,
    resultsQueryExecuted?.query_type,
    resultsQueryExecuted?.queryType,
    rootQueryExecuted?.query_type,
    rootQueryExecuted?.queryType,
    results.query_type,
    results.queryType,
    resultsStats?.query_type,
    resultsStats?.queryType,
    intentMetaCandidate?.queryType,
    intentMetaCandidate?.query_type,
    root.query_type,
    root.queryType,
    rootStats?.query_type,
    rootStats?.queryType
  ).toLowerCase()

  const intentMode = pickString(
    queryPlan?.intent_mode,
    queryPlan?.intentMode,
    resultsQueryExecuted?.intent_mode,
    resultsQueryExecuted?.intentMode,
    rootQueryExecuted?.intent_mode,
    rootQueryExecuted?.intentMode,
    results.intent_mode,
    results.intentMode,
    resultsStats?.intent_mode,
    resultsStats?.intentMode,
    intentMetaCandidate?.intentMode,
    intentMetaCandidate?.intent_mode,
    root.intent_mode,
    root.intentMode,
    rootStats?.intent_mode,
    rootStats?.intentMode
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

export function resolveIntentMeta(payload: unknown): IntentMeta | null {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root
  return normalizeIntentMeta(root, results)
}

export function normalizeRefinedResultEvidence(payload: unknown): NormalizedRefinedResultEvidence {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root

  const evidenceView = pickObject(
    results.evidence_view,
    results.evidenceView,
    root.evidence_view,
    root.evidenceView
  )
  const toolCalls = pickArray(
    root.tool_calls,
    root.toolCalls,
    results.tool_calls,
    results.toolCalls
  )
  const boundary = results.boundary ?? root.boundary ?? null
  const spatialClusters = pickObject(
    results.spatial_clusters,
    results.spatialClusters,
    root.spatial_clusters,
    root.spatialClusters
  ) || { hotspots: [] }
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

  const hotspotList = Array.isArray(spatialClusters.hotspots) ? spatialClusters.hotspots : []
  const hasEvidence = Boolean(
    evidenceView ||
    boundary ||
    hotspotList.length > 0 ||
    vernacularRegions.length > 0 ||
    fuzzyRegions.length > 0
  )

  return {
    boundary,
    spatialClusters,
    vernacularRegions,
    fuzzyRegions,
    stats,
    evidenceView,
    toolCalls,
    intent,
    hasEvidence
  }
}
