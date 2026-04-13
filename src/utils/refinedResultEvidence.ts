type AnyRecord = Record<string, unknown>

type NormalizedIntentMeta = {
  queryType: string | null
  intentMode: string | null
  queryPlan: AnyRecord | null
  parserProvider: string | null
  parserModel: string | null
  categoryMain: string | null
  categorySub: string | null
}

type NormalizedRefinedResultEvidence = {
  boundary: unknown
  spatialClusters: AnyRecord
  vernacularRegions: unknown[]
  fuzzyRegions: unknown[]
  stats: AnyRecord | null
  toolCalls: unknown[]
  intent: NormalizedIntentMeta | null
  hasEvidence: boolean
}

function pickArray(...candidates: unknown[]): unknown[] {
  for (const value of candidates) {
    if (Array.isArray(value)) return value
  }
  return []
}

function pickObject(...candidates: unknown[]): AnyRecord | null {
  for (const value of candidates) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as AnyRecord
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

function normalizeIntentMeta(root: AnyRecord, results: AnyRecord): NormalizedIntentMeta | null {
  const intentMetaCandidate = pickObject(
    results.intentMeta,
    results.intent_meta,
    results.intent,
    root.intentMeta,
    root.intent_meta,
    root.intent
  )

  const queryPlan = pickObject(
    results.query_plan,
    results.queryPlan,
    results.stats && pickObject(results.stats)?.query_plan,
    results.stats && pickObject(results.stats)?.queryPlan,
    root.query_plan,
    root.queryPlan,
    root.stats && pickObject(root.stats)?.query_plan,
    root.stats && pickObject(root.stats)?.queryPlan,
    results.query_executed,
    root.query_executed,
    intentMetaCandidate?.queryPlan,
    intentMetaCandidate?.query_plan
  )

  const queryType = pickString(
    queryPlan?.query_type,
    queryPlan?.queryType,
    pickObject(results.query_executed)?.query_type,
    pickObject(results.query_executed)?.queryType,
    pickObject(root.query_executed)?.query_type,
    pickObject(root.query_executed)?.queryType,
    results.query_type,
    results.queryType,
    pickObject(results.stats)?.query_type,
    pickObject(results.stats)?.queryType,
    intentMetaCandidate?.queryType,
    intentMetaCandidate?.query_type,
    root.query_type,
    root.queryType,
    pickObject(root.stats)?.query_type,
    pickObject(root.stats)?.queryType
  ).toLowerCase()

  const intentMode = pickString(
    queryPlan?.intent_mode,
    queryPlan?.intentMode,
    pickObject(results.query_executed)?.intent_mode,
    pickObject(results.query_executed)?.intentMode,
    pickObject(root.query_executed)?.intent_mode,
    pickObject(root.query_executed)?.intentMode,
    results.intent_mode,
    results.intentMode,
    pickObject(results.stats)?.intent_mode,
    pickObject(results.stats)?.intentMode,
    intentMetaCandidate?.intentMode,
    intentMetaCandidate?.intent_mode,
    root.intent_mode,
    root.intentMode,
    pickObject(root.stats)?.intent_mode,
    pickObject(root.stats)?.intentMode
  ).toLowerCase()

  const parserProvider = pickString(
    intentMetaCandidate?.parserProvider,
    intentMetaCandidate?.parser_provider,
    results.parserProvider,
    results.parser_provider,
    root.parserProvider,
    root.parser_provider
  )

  const parserModel = pickString(
    intentMetaCandidate?.parserModel,
    intentMetaCandidate?.parser_model,
    results.parserModel,
    results.parser_model,
    root.parserModel,
    root.parser_model
  )

  const categoryMain = pickString(
    intentMetaCandidate?.categoryMain,
    intentMetaCandidate?.category_main,
    results.categoryMain,
    results.category_main,
    root.categoryMain,
    root.category_main
  )

  const categorySub = pickString(
    intentMetaCandidate?.categorySub,
    intentMetaCandidate?.category_sub,
    results.categorySub,
    results.category_sub,
    root.categorySub,
    root.category_sub
  )

  if (!queryPlan && !queryType && !intentMode && !parserProvider && !parserModel && !categoryMain && !categorySub) {
    return null
  }

  return {
    queryType: queryType || null,
    intentMode: intentMode || null,
    queryPlan: queryPlan || null,
    parserProvider: parserProvider || null,
    parserModel: parserModel || null,
    categoryMain: categoryMain || null,
    categorySub: categorySub || null
  }
}

export function resolveIntentMeta(payload: unknown): NormalizedIntentMeta | null {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root
  return normalizeIntentMeta(root, results)
}

export function normalizeRefinedResultEvidence(payload: unknown): NormalizedRefinedResultEvidence {
  const root = pickObject(payload) || {}
  const results = pickObject(root.results) || root

  const boundary = results.boundary ?? root.boundary ?? null
  const spatialClusters =
    pickObject(results.spatial_clusters, results.spatialClusters, root.spatial_clusters, root.spatialClusters) ||
    { hotspots: [] as unknown[] }
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
  const toolCalls = pickArray(
    root.tool_calls,
    root.toolCalls,
    results.tool_calls,
    results.toolCalls
  )
  const intent = resolveIntentMeta(payload)

  const hotspotCount = Array.isArray(spatialClusters.hotspots) ? spatialClusters.hotspots.length : 0
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
    toolCalls,
    intent,
    hasEvidence
  }
}
