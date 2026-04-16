const WEAK_NAME_PATTERNS = [
  new RegExp('^(?:\\u672a\\u77e5|\\u65e0\\u540d|Unnamed|N/A)$', 'iu'),
  new RegExp(
    '(?:\\u505c\\u8f66\\u573a|\\u505c\\u8f66\\u4f4d|\\u51fa\\u5165\\u53e3|\\u6536\\u8d39\\u7ad9|\\u95e8\\u5c97|\\u95f8\\u673a|\\u5395\\u6240|\\u516c\\u5395|\\u5783\\u573e\\u7ad9|\\u914d\\u7535\\u623f)',
    'u'
  ),
  new RegExp(
    '(?:\\u5185\\u90e8\\u9053\\u8def|\\u65e0\\u540d\\u9053\\u8def|\\u9053\\u8def\\u53e3|\\u652f\\u8def|\\u8f85\\u8def|\\u531d\\u9053)',
    'u'
  )
]

const WEAK_CATEGORY_PATTERNS = [
  new RegExp(
    '(?:\\u4ea4\\u901a\\u8bbe\\u65bd|\\u9053\\u8def\\u9644\\u5c5e|\\u505c\\u8f66\\u8bbe\\u65bd|\\u516c\\u5171\\u8bbe\\u65bd)',
    'u'
  )
]

const ALIAS_REPLACEMENTS: Array<[RegExp, string]> = [
  [new RegExp('\\u6e56\\u5927', 'gu'), '\u6e56\u5317\u5927\u5b66'],
  [new RegExp('\\u6b66\\u5927', 'gu'), '\u6b66\u6c49\u5927\u5b66'],
  [new RegExp('\\u534e\\u79d1', 'gu'), '\u534e\u4e2d\u79d1\u6280\u5927\u5b66']
]

type AnyRecord = Record<string, unknown>

type PoiLike = {
  id?: unknown
  poiid?: unknown
  name?: unknown
  poi_name?: unknown
  poiName?: unknown
  title?: unknown
  label?: unknown
  type?: unknown
  category?: unknown
  category_small?: unknown
  category_mid?: unknown
  category_big?: unknown
  score?: unknown
  relevance_score?: unknown
  relevanceScore?: unknown
  weight?: unknown
  geometry?: {
    coordinates?: unknown
    [key: string]: unknown
  } | null
  properties?: AnyRecord | null
  [key: string]: unknown
}

type IntentMetaLike = {
  queryType?: unknown
  query_type?: unknown
  intentMode?: unknown
  intent_mode?: unknown
  queryPlan?: AnyRecord | null
  query_plan?: AnyRecord | null
}

type NormalizedIntentMeta = {
  queryType: string
  intentMode: string
  queryPlan: AnyRecord
}

type StageOneCandidate = {
  id: unknown
  poi: PoiLike
  name: string
  key: string
  category: string
  address: string
  coords: [number, number] | null
  baseScoreRaw: number
  index: number
}

type MergedCandidate = {
  key: string
  names: string[]
  pois: PoiLike[]
  count: number
  baseScoreRaw: number
  strongestBase: number
  category: string
  address: string
  coords: [number, number] | null
  representativePoi?: PoiLike
  representativeId?: unknown
  name: string
}

type ScoredCandidate = MergedCandidate & {
  baseScore: number
  semanticScore: number
  geoScore: number
  rerankScore: number
}

type BuildPlaceTagsOptions = {
  topK?: unknown
  intentMeta?: IntentMetaLike | null
}

type PlaceTag = {
  id: unknown
  name: string
  type: string
  weight: number
  score: number
  scoreBreakdown: {
    base: number
    semantic: number
    geo: number
  }
  aliasCount: number
  originalPoi: PoiLike | null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function pickText(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeWhitespace(text: unknown): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeNameForDisplay(name: string): string {
  return normalizeWhitespace(name)
    .replace(/(?:\uFF08|\()\s*/gu, '\uFF08')
    .replace(/\s*(?:\uFF09|\))/gu, '\uFF09')
}

function normalizeNameKey(name: unknown): string {
  let text = normalizeWhitespace(name)
  if (!text) return ''

  text = text
    .replace(/(?:\uFF08|\()([^()]+)(?:\uFF09|\))/gu, '$1')
    .replace(/[\u00B7\u2022\-_/\\|,.\uFF0C\u3002\u3001:;\uFF1A\uFF1B"'`~!?\uFF01\uFF1F]/gu, '')
    .toLowerCase()

  for (const [pattern, replacement] of ALIAS_REPLACEMENTS) {
    text = text.replace(pattern, replacement.toLowerCase())
  }

  return text
}

function isWeakName(name: string, category: string): boolean {
  const text = normalizeWhitespace(name)
  if (!text) return true
  if (text.length < 2) return true
  if (/^\d+$/u.test(text)) return true
  if (WEAK_NAME_PATTERNS.some((pattern) => pattern.test(text))) return true
  if (WEAK_CATEGORY_PATTERNS.some((pattern) => pattern.test(String(category || '')))) return true
  return false
}

function normalizeIntentMeta(intentMeta: IntentMetaLike | null | undefined): NormalizedIntentMeta {
  const queryType = pickText(intentMeta?.queryType, intentMeta?.query_type).toLowerCase()
  const intentMode = pickText(intentMeta?.intentMode, intentMeta?.intent_mode).toLowerCase()
  const queryPlan = intentMeta?.queryPlan && typeof intentMeta.queryPlan === 'object'
    ? intentMeta.queryPlan
    : intentMeta?.query_plan && typeof intentMeta.query_plan === 'object'
      ? intentMeta.query_plan
      : {}

  return {
    queryType,
    intentMode,
    queryPlan
  }
}

function expandKeywordsFromText(text: unknown, output: string[], seen: Set<string>): void {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return

  const splitTokens = normalized
    .split(/[\s,.\uFF0C\u3002;:\uFF1B\uFF1A\u3001/|]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  for (const token of splitTokens) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(token)
  }

  const compact = normalized.replace(/[\s,.\uFF0C\u3002;:\uFF1B\uFF1A\u3001/|]+/gu, '')
  if (compact.length >= 4) {
    for (let size = 4; size >= 2; size -= 1) {
      if (compact.length < size) continue
      for (let i = 0; i <= compact.length - size; i += 1) {
        const gram = compact.slice(i, i + size)
        const key = gram.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        output.push(gram)
      }
    }
  }
}

function buildSemanticKeywords(intentMeta: IntentMetaLike | null | undefined): string[] {
  const meta = normalizeIntentMeta(intentMeta)
  const queryPlan = meta.queryPlan
  const keywords: string[] = []
  const seen = new Set<string>()

  const sources = [
    queryPlan.semantic_query,
    queryPlan.query,
    queryPlan.anchor,
    ...(Array.isArray(queryPlan.categories) ? queryPlan.categories : []),
    ...(Array.isArray(queryPlan.terms) ? queryPlan.terms : []),
    queryPlan.target_keyword
  ]

  for (const source of sources) {
    expandKeywordsFromText(source, keywords, seen)
  }

  return keywords.slice(0, 40)
}

function extractPoiName(poi: PoiLike = {}): string {
  return pickText(
    poi.name,
    poi.poi_name,
    poi.poiName,
    poi.title,
    poi.label,
    poi?.properties?.name,
    poi?.properties?.Name,
    poi?.properties?.poi_name,
    poi?.properties?.poiName,
    poi?.properties?.['\u540d\u79f0']
  )
}

function extractPoiCategory(poi: PoiLike = {}): string {
  return pickText(
    poi.type,
    poi.category,
    poi.category_small,
    poi.category_mid,
    poi.category_big,
    poi?.properties?.type,
    poi?.properties?.category_small,
    poi?.properties?.category_mid,
    poi?.properties?.category_big,
    poi?.properties?.smallCategory,
    poi?.properties?.midCategory,
    poi?.properties?.bigCategory
  )
}

function extractPoiAddress(poi: PoiLike = {}): string {
  return pickText(
    poi.address,
    poi.addr,
    poi.location,
    poi?.properties?.address,
    poi?.properties?.addr
  )
}

function extractPoiVerification(poi: PoiLike = {}): string {
  const meta = poi.meta && typeof poi.meta === 'object' ? poi.meta as AnyRecord : {}
  const properties = poi.properties && typeof poi.properties === 'object' ? poi.properties as AnyRecord : {}
  return pickText(
    poi.verification,
    meta.verification,
    properties.verification
  ).toLowerCase()
}

function extractPoiSource(poi: PoiLike = {}): string {
  const meta = poi.meta && typeof poi.meta === 'object' ? poi.meta as AnyRecord : {}
  const properties = poi.properties && typeof poi.properties === 'object' ? poi.properties as AnyRecord : {}
  return pickText(
    poi.source,
    meta.source,
    properties.source
  ).toLowerCase()
}

function looksLikeWebArticleTitle(name: string): boolean {
  const text = normalizeWhitespace(name)
  if (!text) return true
  if (/今日头条|小红书|知乎|大众点评|美团|携程|马蜂窝/u.test(text)) return true
  return /攻略|必去|值得|逛吃|旅行|旅游|盘点|合集|榜单|十大/u.test(text)
}

function isRenderablePoiCandidate(poi: PoiLike = {}): boolean {
  const verification = extractPoiVerification(poi)
  const source = extractPoiSource(poi)
  const name = extractPoiName(poi)

  if (verification === 'web_only') return false
  if (source === 'multi_search' || source === 'tavily' || source === 'web_only') return false
  if (looksLikeWebArticleTitle(name)) return false

  return true
}

function extractPoiCoordinates(poi: PoiLike = {}): [number, number] | null {
  const geometry = poi.geometry && typeof poi.geometry === 'object' ? poi.geometry : {}
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : null
  if (!coordinates || coordinates.length < 2) return null
  const lon = toFiniteNumber(coordinates[0], NaN)
  const lat = toFiniteNumber(coordinates[1], NaN)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return [lon, lat]
}

function extractBaseScore(poi: PoiLike = {}, fallback = 0): number {
  const score = toFiniteNumber(
    poi.score ??
      poi.relevance_score ??
      poi.relevanceScore ??
      poi.weight ??
      poi?.properties?.score ??
      poi?.properties?.relevance_score,
    NaN
  )
  return Number.isFinite(score) ? score : fallback
}

function semanticMatchScore(
  candidate: Pick<StageOneCandidate | MergedCandidate, 'name' | 'category' | 'address'>,
  keywords: string[]
): number {
  if (!keywords.length) return 0.5
  const text = `${candidate.name} ${candidate.category} ${candidate.address}`.toLowerCase()
  if (!text.trim()) return 0

  let hit = 0
  for (const keyword of keywords) {
    const token = String(keyword || '').trim().toLowerCase()
    if (!token) continue
    if (text.includes(token)) {
      hit += Math.min(1, token.length / 5)
    }
  }

  return clamp01(hit / Math.max(1, keywords.length * 0.85))
}

function estimateGeoScores(candidates: Array<Pick<StageOneCandidate | MergedCandidate, 'coords'>>): number[] {
  const withCoords = candidates.filter((item): item is typeof item & { coords: [number, number] } => Array.isArray(item.coords))
  if (!withCoords.length) {
    return candidates.map(() => 0.25)
  }

  let lonSum = 0
  let latSum = 0
  withCoords.forEach((item) => {
    lonSum += item.coords[0]
    latSum += item.coords[1]
  })
  const centerLon = lonSum / withCoords.length
  const centerLat = latSum / withCoords.length

  const distances = withCoords.map((item) => {
    const dx = item.coords[0] - centerLon
    const dy = item.coords[1] - centerLat
    return Math.sqrt(dx * dx + dy * dy)
  })
  const maxDistance = Math.max(...distances, 1e-6)

  return candidates.map((item) => {
    if (!Array.isArray(item.coords)) return 0.15
    const dx = item.coords[0] - centerLon
    const dy = item.coords[1] - centerLat
    const dist = Math.sqrt(dx * dx + dy * dy)
    const centerScore = clamp01(1 - dist / maxDistance)

    let nearCount = 0
    for (const other of withCoords) {
      if (other === item || !Array.isArray(other.coords)) continue
      const odx = other.coords[0] - item.coords[0]
      const ody = other.coords[1] - item.coords[1]
      const d = Math.sqrt(odx * odx + ody * ody)
      if (d <= 0.0045) nearCount += 1
    }
    const densityScore = clamp01(nearCount / Math.max(1, withCoords.length - 1))

    return clamp01(0.6 * centerScore + 0.4 * densityScore)
  })
}

function resolveScoreWeights(intentMeta: IntentMetaLike | null | undefined): { base: number; semantic: number; geo: number } {
  const meta = normalizeIntentMeta(intentMeta)
  if (meta.queryType === 'poi_search' || meta.intentMode === 'local_search') {
    return { base: 0.42, semantic: 0.43, geo: 0.15 }
  }
  if (meta.queryType === 'area_analysis' || meta.intentMode === 'macro_overview') {
    return { base: 0.36, semantic: 0.24, geo: 0.4 }
  }
  return { base: 0.4, semantic: 0.35, geo: 0.25 }
}

function pickRepresentativeName(names: string[] = [], fallback = ''): string {
  const valid = names
    .map((name) => normalizeNameForDisplay(name))
    .filter(Boolean)
  if (!valid.length) return fallback
  valid.sort((a, b) => b.length - a.length)
  return valid[0]
}

function buildCandidatesFromPois(pois: PoiLike[] = []): StageOneCandidate[] {
  const candidates: StageOneCandidate[] = []
  for (let index = 0; index < pois.length; index += 1) {
    const poi = pois[index]
    if (!isRenderablePoiCandidate(poi)) continue
    const name = extractPoiName(poi)
    const category = extractPoiCategory(poi)
    if (isWeakName(name, category)) continue

    candidates.push({
      id: poi?.id ?? poi?.poiid ?? index,
      poi,
      name: normalizeNameForDisplay(name),
      key: normalizeNameKey(name),
      category,
      address: extractPoiAddress(poi),
      coords: extractPoiCoordinates(poi),
      baseScoreRaw: extractBaseScore(poi, pois.length - index),
      index
    })
  }

  return candidates
}

function mergeAliasCandidates(candidates: StageOneCandidate[] = []): MergedCandidate[] {
  const merged = new Map<string, Omit<MergedCandidate, 'name'>>()

  for (const candidate of candidates) {
    if (!candidate.key) continue
    const bucket = merged.get(candidate.key) || {
      key: candidate.key,
      names: [],
      pois: [],
      count: 0,
      baseScoreRaw: 0,
      strongestBase: -1,
      category: '',
      address: '',
      coords: candidate.coords
    }

    bucket.count += 1
    bucket.names.push(candidate.name)
    bucket.pois.push(candidate.poi)
    bucket.baseScoreRaw += Math.max(0, candidate.baseScoreRaw)
    if (candidate.baseScoreRaw > bucket.strongestBase) {
      bucket.strongestBase = candidate.baseScoreRaw
      bucket.representativePoi = candidate.poi
      bucket.representativeId = candidate.id
      bucket.category = candidate.category
      bucket.address = candidate.address
      bucket.coords = candidate.coords || bucket.coords
    }

    merged.set(candidate.key, bucket)
  }

  return Array.from(merged.values()).map((item) => ({
    ...item,
    name: pickRepresentativeName(item.names, item.key)
  }))
}

function applySecondStageRerank(
  candidates: MergedCandidate[],
  { intentMeta, topK }: { intentMeta: IntentMetaLike | null | undefined; topK: number }
): ScoredCandidate[] {
  if (!candidates.length) return []

  const meta = normalizeIntentMeta(intentMeta)
  const keywords = buildSemanticKeywords(intentMeta)
  const geoScores = estimateGeoScores(candidates)
  const maxBase = Math.max(1, ...candidates.map((item) => item.baseScoreRaw))
  const weights = resolveScoreWeights(intentMeta)
  const anchorToken = normalizeNameKey(meta.queryPlan?.anchor || '')
  const categoryTokens = (Array.isArray(meta.queryPlan?.categories) ? meta.queryPlan.categories : [])
    .map((item) => normalizeNameKey(item))
    .filter(Boolean)
  const isLocalSearch = meta.queryType === 'poi_search' || meta.intentMode === 'local_search'

  const scored = candidates.map((item, index) => {
    const baseScore = clamp01(item.baseScoreRaw / maxBase)
    const semanticScore = semanticMatchScore(item, keywords)
    const geoScore = geoScores[index]
    const aliasBoost = clamp01(Math.log2(1 + item.count) / 3.5)
    const nameKey = normalizeNameKey(item.name)
    const categoryKey = normalizeNameKey(item.category)
    const anchorBoost = anchorToken && (nameKey.includes(anchorToken) || anchorToken.includes(nameKey)) ? 0.24 : 0
    const categoryBoost = categoryKey && categoryTokens.some((token) => {
      if (!token) return false
      return (
        categoryKey.includes(token) ||
        token.includes(categoryKey) ||
        nameKey.includes(token)
      )
    }) ? 0.18 : 0

    let rerankScore = clamp01(
      weights.base * baseScore +
      weights.semantic * semanticScore +
      weights.geo * geoScore +
      0.08 * aliasBoost +
      anchorBoost +
      categoryBoost
    )

    if (isLocalSearch && (anchorToken || categoryTokens.length)) {
      const weakMatch = anchorBoost <= 0 && categoryBoost <= 0 && semanticScore < 0.2
      if (weakMatch) {
        rerankScore *= 0.72
      }
    }

    return {
      ...item,
      baseScore,
      semanticScore,
      geoScore,
      rerankScore
    }
  })

  scored.sort((a, b) => b.rerankScore - a.rerankScore)
  const topScore = scored[0]?.rerankScore || 0
  const minKeep = Math.min(8, scored.length)

  const filtered = scored.filter((item, index) => {
    if (index < minKeep) return true
    if (item.rerankScore >= topScore * 0.35) return true
    if (item.semanticScore >= 0.28) return true
    return item.baseScore >= 0.6
  })

  return filtered.slice(0, Math.max(1, topK))
}

export function buildPlaceTags(
  pois: PoiLike[] = [],
  options: BuildPlaceTagsOptions = {}
): PlaceTag[] {
  const topK = Math.max(1, Number(options?.topK) || 20)
  const intentMeta = options?.intentMeta || null

  const stageOneCandidates = buildCandidatesFromPois(Array.isArray(pois) ? pois : [])
  if (!stageOneCandidates.length) return []

  const aliasMerged = mergeAliasCandidates(stageOneCandidates)
  const reranked = applySecondStageRerank(aliasMerged, { intentMeta, topK })

  return reranked.map((item, index) => {
    const representativePoi = item.representativePoi || item.pois?.[0] || null
    return {
      id: item.representativeId ?? index,
      name: item.name,
      type: item.category || '',
      weight: Number((item.rerankScore * 100).toFixed(2)),
      score: item.rerankScore,
      scoreBreakdown: {
        base: Number(item.baseScore.toFixed(4)),
        semantic: Number(item.semanticScore.toFixed(4)),
        geo: Number(item.geoScore.toFixed(4))
      },
      aliasCount: item.count,
      originalPoi: representativePoi
    }
  })
}
