export type NarrativeRoleInternal =
  | 'primary_region'
  | 'support_region'
  | 'landmark_anchor'
  | 'scene_evidence'
  | 'background_ecology'
  | 'micro_facility'
  | 'noise'

export type VisualTier = 'core' | 'strong' | 'medium' | 'weak' | 'excluded'
export type LODLevel = 'micro' | 'meso' | 'macro'
export type SceneProfile = 'education_culture' | 'heritage_tourism' | 'commercial_leisure' | 'natural_ecology' | 'mixed_urban'
export type NarrationTone = 'science' | 'tour' | 'humanity'
export type NarrativeExplorationTheme = 'comprehensive' | 'commerce' | 'nightlife' | 'memory' | 'family' | 'education' | 'commute' | 'tourism'
export type NarrativeGranularity = 'auto' | 'district' | 'aoi' | 'poi_cluster'
export type NarrativeEvidenceStrictness = 'strict' | 'balanced' | 'loose'
export type NarrativeDiversity = 'low' | 'medium' | 'high'
export type NarrativeLocalness = 'tourist' | 'balanced' | 'local'
export type NarrativeDurationPreset = 'casual' | 'standard' | 'detailed'
export type NarrativeCentroidStrategy = 'auto' | 'region_first' | 'poi_first'
export type StoryTag =
  | 'campus'
  | 'education'
  | 'culture'
  | 'heritage'
  | 'food'
  | 'nightlife'
  | 'commerce'
  | 'market'
  | 'ecology'
  | 'waterfront'
  | 'transit'
  | 'community'
  | 'landmark'
  | 'leisure'
  | 'urban_life'
export type NarrativeRouteStrategy =
  | 'seeded_spatial_story'
  | 'micro_detail_walk'
  | 'meso_mixed_cluster_walk'
  | 'macro_city_cross_section'
  | 'campus_ecology_walk'
  | 'campus_life_loop'
  | 'commercial_food_walk'
  | 'night_market_walk'
  | 'heritage_culture_walk'
  | 'heritage_commerce_walk'
  | 'waterfront_ecology_walk'
  | 'waterfront_leisure_walk'
  | 'commercial_axis_walk'
  | 'civic_service_walk'
  | 'transit_gateway_walk'
  | 'mixed_discovery_walk'

export interface ViewportBBox {
  west: number
  south: number
  east: number
  north: number
  zoom: number
  center: [number, number]
}

export interface NarrativePoi {
  id: string
  lon: number
  lat: number
  display_name: string
  tier: VisualTier
  role: NarrativeRoleInternal
  category_main?: string
  category_sub?: string
  semantic_score?: number
  semantic_distance?: number
  fusion_score?: number
  story_tags?: StoryTag[]
}

export type LonLat = [number, number]

export interface NarrativePolygonGeometry {
  type: 'Polygon'
  coordinates: LonLat[][]
}

export type NarrativeBoundaryGeometry = NarrativePolygonGeometry

export interface NarrativeRegionGlowLayer {
  core: NarrativeBoundaryGeometry
  inner?: NarrativeBoundaryGeometry
  outer?: NarrativeBoundaryGeometry
  color: string
  opacity_profile: {
    core: number
    inner: number
    outer: number
  }
}

export interface NarrativePoiHeatLayer {
  radius: number
  points: Array<{ lon: number; lat: number; tier: VisualTier }>
}

export interface NarrativePoiBusinessCategoryProfile {
  name: string
  count: number
  share: number
  examples?: string[]
}

export interface NarrativePoiBusinessProfile {
  sample_size: number
  dominant_main_types: NarrativePoiBusinessCategoryProfile[]
  dominant_sub_types: NarrativePoiBusinessCategoryProfile[]
  representative_places: string[]
  summary_hint: string
  confidence: 'low' | 'medium' | 'high'
}

export interface NarrativeVisualLayer {
  mode: 'region_glow' | 'poi_heat'
  region_glow?: NarrativeRegionGlowLayer
  poi_heat?: NarrativePoiHeatLayer
}

export interface NarrativeFact {
  claim: string
  source: 'postgis' | 'web_verified' | 'web_snippet' | 'spatial_encoder' | 'aoi_entity' | 'poi_business_profile'
  confidence: number
  verified: boolean
  related_entity: { type: 'poi' | 'aoi' | 'region'; id: string }
}

export interface NarrativeRegion {
  id: string
  display_name: string
  role: NarrativeRoleInternal
  core_anchor: { id: string; lon: number; lat: number }
  boundary: NarrativeBoundaryGeometry
  visual_layer: NarrativeVisualLayer
  pois: NarrativePoi[]
  business_profile?: NarrativePoiBusinessProfile
  narrative_facts: NarrativeFact[]
  story_tags?: StoryTag[]
}

export type PathNarrationRole = 'core' | 'related' | 'cultural' | 'landmark' | 'educational' | 'ecological'

export interface NarrativePathNode {
  region_id: string
  narration_role: PathNarrationRole
  transition_reason: string
  story_tags?: StoryTag[]
}

export interface NarrativeChapter {
  region_id: string
  text: string
  web_source?: { title: string; url: string }
  web_sources?: NarrativeWebSource[]
  length_ms?: number
  story_tags?: StoryTag[]
  generation_error?: string
}

export interface NarrativeWebSource {
  title: string
  url: string
  snippet?: string
  quality?: 'official' | 'encyclopedia' | 'media' | 'general'
  quality_score?: number
}

export interface UserContext {
  time_label: string
  weather_label: string
  preference_label: string
  history_label: string
}

export type NarrativeEnrichmentMode = 'sync' | 'async' | 'cache_only' | 'off'
export type NarrativeEnrichmentStatus = 'disabled' | 'pending' | 'running' | 'completed' | 'failed'

export interface NarrativeExplorationControls {
  theme?: NarrativeExplorationTheme
  granularity?: NarrativeGranularity
  evidence_strictness?: NarrativeEvidenceStrictness
  relevance_threshold?: number
  diversity?: NarrativeDiversity
  localness?: NarrativeLocalness
  duration_preset?: NarrativeDurationPreset
  candidate_count?: number
  scope_query?: string
  centroid_strategy?: NarrativeCentroidStrategy
}

export interface NarrativeEnrichmentSummary {
  job_id?: string
  mode: NarrativeEnrichmentMode
  status: NarrativeEnrichmentStatus
  phase: 'initial' | 'enriched'
  total_region_count: number
  completed_region_count: number
  cached_region_count: number
  source_count: number
  error?: string
  started_at?: string
  updated_at?: string
  completed_at?: string
}

export interface NarrativeEnrichmentJob {
  job_id: string
  status: NarrativeEnrichmentStatus
  summary: NarrativeEnrichmentSummary
  response?: NarrativeResponse
  error?: string
}

export interface NarrativeResponse {
  session_id: string
  state_version: number
  scene_profile: SceneProfile
  lod: LODLevel
  viewport: ViewportBBox
  dominant_coverage: number
  candidate_count: number
  poi_density: number
  semantic_diversity: number
  story_tags?: StoryTag[]
  regions: NarrativeRegion[]
  path: {
    nodes: NarrativePathNode[]
    seed: string
    alternatives_count: number
    strategy?: NarrativeRouteStrategy
    story_tags?: StoryTag[]
    relations?: unknown[]
    lod_policy?: unknown
  }
  narration: {
    chapters: NarrativeChapter[]
    tone: NarrationTone
  }
  user_context: UserContext
  enrichment?: NarrativeEnrichmentSummary
  debug?: Record<string, unknown>
}

export interface NarrativeRequest {
  session_id?: string
  viewport?: Partial<ViewportBBox>
  tone?: NarrationTone
  user_context?: Partial<UserContext>
  exploration?: NarrativeExplorationControls
  limit?: number
  debug?: boolean
  enrichment_mode?: NarrativeEnrichmentMode
}

export interface NarrativeBuilder {
  build(input: NarrativeRequest): Promise<NarrativeResponse>
  getEnrichmentJob?(jobId: string): NarrativeEnrichmentJob | undefined
}
