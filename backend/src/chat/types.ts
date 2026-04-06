export interface ChatMessageV4 {
  role: string
  content: unknown
}

export interface ChatRequestOptionsV4 {
  requestId?: string
  sessionId?: string
  spatialContext?: Record<string, unknown>
  regions?: unknown[]
  selectedCategories?: unknown[]
  sourcePolicy?: Record<string, unknown>
  skipCache?: boolean
  forceRefresh?: boolean
  [key: string]: unknown
}

export interface ChatRequestV4 {
  messages: ChatMessageV4[]
  poiFeatures?: unknown[]
  options?: ChatRequestOptionsV4
}

export type QueryType =
  | 'nearby_poi'
  | 'nearest_station'
  | 'similar_regions'
  | 'compare_places'
  | 'unsupported'

export type IntentMode =
  | 'deterministic_visible_loop'
  | 'agent_full_loop'

export type AnchorSource =
  | 'place'
  | 'user_location'

export interface DeterministicIntent {
  queryType: QueryType
  intentMode: IntentMode
  rawQuery: string
  placeName: string | null
  anchorSource?: AnchorSource
  secondaryPlaceName?: string | null
  targetCategory: string | null
  comparisonTarget?: string | null
  categoryKey?: string | null
  radiusM: number
  needsClarification: boolean
  clarificationHint: string | null
}

export interface UserLocationContext {
  lon: number
  lat: number
  accuracyM?: number | null
  source?: string
  capturedAt?: string
  coordSys?: string
}

export interface ResolvedAnchor {
  place_name: string
  display_name: string
  role: string
  source: string
  resolved_place_name: string
  poi_id: string | number | null
  lon?: number
  lat?: number
}

export interface EvidenceAnchor {
  placeName: string
  displayName: string
  resolvedPlaceName: string
  lon?: number
  lat?: number
  source?: string
}

export interface EvidenceItem {
  id?: string | number | null
  name: string
  category?: string | null
  categoryMain?: string | null
  categorySub?: string | null
  longitude?: number
  latitude?: number
  distance_m?: number | null
  score?: number | null
  rank?: number | null
  duration_min?: number | null
  meta?: Record<string, unknown>
}

export interface ComparisonPair {
  label: string
  anchor: EvidenceAnchor
  value: number
  items: EvidenceItem[]
}

export type EvidenceViewType =
  | 'poi_list'
  | 'transport'
  | 'bucket'
  | 'comparison'
  | 'semantic_candidate'

export interface EvidenceView {
  type: EvidenceViewType
  anchor: EvidenceAnchor
  items: EvidenceItem[]
  meta: Record<string, unknown>
  secondaryAnchor?: EvidenceAnchor
  pairs?: ComparisonPair[]
  buckets?: Array<{ label: string, value: number }>
  regions?: Array<{ name: string, score: number, summary?: string }>
  boundary?: Record<string, unknown> | null
  spatialClusters?: { hotspots: Record<string, unknown>[] } | null
  vernacularRegions?: Record<string, unknown>[]
  fuzzyRegions?: Record<string, unknown>[]
}

export interface RenderedAnswer {
  answer: string
  summary: string
  pois: EvidenceItem[]
  stats: Record<string, unknown>
}

export interface ToolExecutionTrace {
  id: string
  skill: string
  action: string
  status: 'planned' | 'running' | 'done' | 'error'
  payload: Record<string, unknown>
  result?: unknown
  error?: string | null
  latency_ms?: number
}
