type PlainObject = Record<string, unknown>

export interface IntentMeta {
  queryType: string | null
  intentMode: string | null
  queryPlan: PlainObject | null
  placeName: string | null
  targetCategory: string | null
  parserProvider: string | null
  parserModel: string | null
  needsWebSearch: boolean | null
  webEvidencePlanned: boolean | null
  webSearchStrategy: string | null
  webRequirementMode: string | null
  intentSource: string | null
  sourceConfidence: number | null
  sourceLatencyMs: number | null
  categoryMain: string | null
  categorySub: string | null
  categoryScore: number | null
  toolIntent: string | null
  searchIntentHint: string | null
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

function pickBoolean(...candidates: unknown[]): boolean | null {
  for (const value of candidates) {
    if (value === true) return true
    if (value === false) return false
  }
  return null
}

function pickNumber(...candidates: unknown[]): number | null {
  for (const value of candidates) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function normalizeIntentMeta(root: PlainObject, results: PlainObject): IntentMeta | null {
  const rootStats = pickObject(root.stats)
  const resultsStats = pickObject(results.stats)
  const rootQueryExecuted = pickObject(root.query_executed, root.queryExecuted)
  const resultsQueryExecuted = pickObject(results.query_executed, results.queryExecuted)

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

  const placeName = pickString(
    intentMetaCandidate?.placeName,
    intentMetaCandidate?.place_name,
    results.placeName,
    results.place_name,
    root.placeName,
    root.place_name
  )

  const targetCategory = pickString(
    intentMetaCandidate?.targetCategory,
    intentMetaCandidate?.target_category,
    results.targetCategory,
    results.target_category,
    root.targetCategory,
    root.target_category
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

  const needsWebSearch = pickBoolean(
    intentMetaCandidate?.needsWebSearch,
    intentMetaCandidate?.needs_web_search,
    results.needsWebSearch,
    results.needs_web_search,
    root.needsWebSearch,
    root.needs_web_search
  )

  const webEvidencePlanned = pickBoolean(
    intentMetaCandidate?.webEvidencePlanned,
    intentMetaCandidate?.web_evidence_planned,
    results.webEvidencePlanned,
    results.web_evidence_planned,
    root.webEvidencePlanned,
    root.web_evidence_planned
  )

  const webSearchStrategy = pickString(
    intentMetaCandidate?.webSearchStrategy,
    intentMetaCandidate?.web_search_strategy,
    results.webSearchStrategy,
    results.web_search_strategy,
    root.webSearchStrategy,
    root.web_search_strategy
  )

  const webRequirementMode = pickString(
    intentMetaCandidate?.webRequirementMode,
    intentMetaCandidate?.web_requirement_mode,
    results.webRequirementMode,
    results.web_requirement_mode,
    root.webRequirementMode,
    root.web_requirement_mode
  )

  const intentSource = pickString(
    intentMetaCandidate?.intentSource,
    intentMetaCandidate?.intent_source,
    results.intentSource,
    results.intent_source,
    root.intentSource,
    root.intent_source,
    parserProvider
  )

  const sourceConfidence = pickNumber(
    intentMetaCandidate?.sourceConfidence,
    intentMetaCandidate?.source_confidence,
    results.sourceConfidence,
    results.source_confidence,
    root.sourceConfidence,
    root.source_confidence
  )

  const sourceLatencyMs = pickNumber(
    intentMetaCandidate?.sourceLatencyMs,
    intentMetaCandidate?.source_latency_ms,
    results.sourceLatencyMs,
    results.source_latency_ms,
    root.sourceLatencyMs,
    root.source_latency_ms
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

  const categoryScore = pickNumber(
    intentMetaCandidate?.categoryScore,
    intentMetaCandidate?.category_score,
    results.categoryScore,
    results.category_score,
    root.categoryScore,
    root.category_score
  )

  const toolIntent = pickString(
    intentMetaCandidate?.toolIntent,
    intentMetaCandidate?.tool_intent,
    results.toolIntent,
    results.tool_intent,
    root.toolIntent,
    root.tool_intent
  )

  const searchIntentHint = pickString(
    intentMetaCandidate?.searchIntentHint,
    intentMetaCandidate?.search_intent_hint,
    results.searchIntentHint,
    results.search_intent_hint,
    root.searchIntentHint,
    root.search_intent_hint
  )

  if (
    !queryPlan
    && !queryType
    && !intentMode
    && !placeName
    && !targetCategory
    && !parserProvider
    && !parserModel
    && needsWebSearch === null
    && webEvidencePlanned === null
    && !webSearchStrategy
    && !webRequirementMode
    && !intentSource
    && sourceConfidence === null
    && sourceLatencyMs === null
    && !categoryMain
    && !categorySub
    && categoryScore === null
    && !toolIntent
    && !searchIntentHint
  ) {
    return null
  }

  return {
    queryType: queryType || null,
    intentMode: intentMode || null,
    queryPlan: queryPlan || null,
    placeName: placeName || null,
    targetCategory: targetCategory || null,
    parserProvider: parserProvider || null,
    parserModel: parserModel || null,
    needsWebSearch,
    webEvidencePlanned,
    webSearchStrategy: webSearchStrategy || null,
    webRequirementMode: webRequirementMode || null,
    intentSource: intentSource || null,
    sourceConfidence,
    sourceLatencyMs,
    categoryMain: categoryMain || null,
    categorySub: categorySub || null,
    categoryScore,
    toolIntent: toolIntent || null,
    searchIntentHint: searchIntentHint || null
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
