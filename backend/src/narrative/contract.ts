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

export interface NarrativeVisualLayer {
  mode: 'region_glow' | 'poi_heat'
  region_glow?: NarrativeRegionGlowLayer
  poi_heat?: NarrativePoiHeatLayer
}

export interface NarrativeFact {
  claim: string
  source: 'postgis' | 'web_verified' | 'web_snippet' | 'spatial_encoder' | 'aoi_entity'
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
  narrative_facts: NarrativeFact[]
}

export type PathNarrationRole = 'core' | 'related' | 'cultural' | 'landmark' | 'educational' | 'ecological'

export interface NarrativePathNode {
  region_id: string
  narration_role: PathNarrationRole
  transition_reason: string
}

export interface NarrativeChapter {
  region_id: string
  text: string
  web_source?: { title: string; url: string }
  web_sources?: Array<{ title: string; url: string; snippet?: string }>
  length_ms?: number
}

export interface UserContext {
  time_label: string
  weather_label: string
  preference_label: string
  history_label: string
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
  regions: NarrativeRegion[]
  path: {
    nodes: NarrativePathNode[]
    seed: string
    alternatives_count: number
  }
  narration: {
    chapters: NarrativeChapter[]
    tone: NarrationTone
  }
  user_context: UserContext
  debug?: Record<string, unknown>
}

export interface NarrativeRequest {
  session_id?: string
  viewport?: Partial<ViewportBBox>
  tone?: NarrationTone
  user_context?: Partial<UserContext>
  limit?: number
  debug?: boolean
}

export interface NarrativeBuilder {
  build(input: NarrativeRequest): Promise<NarrativeResponse>
}
