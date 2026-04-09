import type { SemanticEvidenceStatus } from '../integration/dependencyStatus.js'

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
  | 'area_overview'
  | 'similar_regions'
  | 'compare_places'
  | 'unsupported'

export type IntentMode =
  | 'deterministic_visible_loop'
  | 'agent_full_loop'

export type AnchorSource =
  | 'place'
  | 'map_view'
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
  coord_sys?: string | null
}

export interface EvidenceAnchor {
  placeName: string
  displayName: string
  resolvedPlaceName: string
  lon?: number
  lat?: number
  source?: string
  coordSys?: string | null
}

export interface EvidenceItem {
  id?: string | number | null
  name: string
  category?: string | null
  categoryMain?: string | null
  categorySub?: string | null
  longitude?: number
  latitude?: number
  coordSys?: string | null
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

export interface AreaInsightInput {
  categoryHistogram?: Record<string, unknown>[]
  ringDistribution?: Record<string, unknown>[]
  representativeSamples?: Record<string, unknown>[]
  competitionDensity?: Record<string, unknown>[]
  hotspotCells?: Record<string, unknown>[]
  aoiContext?: Record<string, unknown>[]
  landuseContext?: Record<string, unknown>[]
}

export interface AreaProfileCategory {
  label: string
  count: number
  share: number
}

export interface AreaRingFootfall {
  label: string
  count: number
  share: number
}

export interface AreaProfile {
  totalCount: number
  dominantCategories: AreaProfileCategory[]
  preferredPrimaryCategory?: string | null
  dominantPrimary?: AreaProfileCategory | null
  primaryCategories?: AreaProfileCategory[]
  dominantSecondary?: AreaProfileCategory | null
  secondaryTop?: AreaProfileCategory[]
  lowSignalRatio: number
  lowSignalCount?: number
  ringFootfall: AreaRingFootfall[]
  rankingApplied?: boolean
}

export interface AreaHotspot {
  label: string
  poiCount: number
  gridWkt?: string | null
  sampleNames?: string[]
}

export interface AreaAoiContextItem {
  id?: string | number | null
  name: string
  fclass?: string | null
  code?: string | null
  population?: number | null
  areaSqm?: number | null
}

export interface AreaLanduseContextItem {
  landType: string
  parcelCount: number
  totalAreaSqm: number
}

export type AreaInsightSignalKind =
  | 'mono_structure_risk'
  | 'core_cluster_risk'
  | 'low_signal_warning'
  | 'hotspot_density'
  | 'scarcity_opportunity'
  | 'over_competition_warning'
  | 'complementary_service_gap'

export interface AreaInsightSignal {
  kind?: AreaInsightSignalKind
  title: string
  detail: string
  score: number
}

export interface AreaInsightConfidence {
  score: number
  level: 'low' | 'medium' | 'high'
  reasons: string[]
}

export interface AreaSubject {
  title: string
  anchorName: string
  typeHint?: string | null
  confidence: 'low' | 'medium' | 'high'
  reasons?: string[]
}

export interface RegionSnapshotCategory {
  label: string
  count?: number | null
  share?: number | null
}

export interface RegionSnapshotHotspot {
  label: string
  poiCount?: number | null
  sampleNames?: string[]
}

export interface RegionSnapshotRepresentativePoi {
  name: string
  categoryMain?: string | null
  categorySub?: string | null
  distanceM?: number | null
}

export interface RegionSnapshotCompetition {
  label: string
  count: number
  avgDistanceM?: number | null
}

export interface RegionSnapshotInput {
  anchorName?: string | null
  subjectName?: string | null
  rawQuery?: string | null
  dominantCategories?: RegionSnapshotCategory[]
  ringDistribution?: AreaRingFootfall[]
  hotspots?: RegionSnapshotHotspot[]
  representativePois?: RegionSnapshotRepresentativePoi[]
  aoiContext?: AreaAoiContextItem[]
  landuseContext?: AreaLanduseContextItem[]
  competitionDensity?: RegionSnapshotCompetition[]
}

export interface RegionFeatureTag {
  key: string
  label: string
  score: number
  detail?: string | null
}

export interface PoiProfileInput {
  name: string
  categoryMain?: string | null
  categorySub?: string | null
  distanceM?: number | null
  areaSubject?: string | null
  hotspotLabel?: string | null
  surroundingCategories?: string[]
  aoiContext?: AreaAoiContextItem[]
}

export interface PoiFeatureTag {
  key: string
  label: string
  score: number
  detail?: string | null
}

export interface RepresentativePoiProfile {
  name: string
  summary: string
  categoryMain?: string | null
  categorySub?: string | null
  featureTags: PoiFeatureTag[]
}

export type EvidenceViewType =
  | 'poi_list'
  | 'transport'
  | 'area_overview'
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
  areaProfile?: AreaProfile
  hotspots?: AreaHotspot[]
  anomalySignals?: AreaInsightSignal[]
  opportunitySignals?: AreaInsightSignal[]
  representativeSamples?: EvidenceItem[]
  confidence?: AreaInsightConfidence
  areaSubject?: AreaSubject
  aoiContext?: AreaAoiContextItem[]
  landuseContext?: AreaLanduseContextItem[]
  regionFeatures?: RegionFeatureTag[]
  regionFeatureSummary?: string | null
  representativePoiProfiles?: RepresentativePoiProfile[]
  semanticHints?: Array<{ label: string, detail?: string, score?: number | null }>
  semanticEvidence?: SemanticEvidenceStatus
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
  error_kind?: 'execution_exception' | 'tool_result_error' | null
  payload: Record<string, unknown>
  result?: unknown
  error?: string | null
  latency_ms?: number
}
