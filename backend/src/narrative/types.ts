import type { RegionFeatureTag } from '../chat/types.js'

export type NarrativeSurface = 'default' | 'narrative'

export interface NarrativeViewport {
  swLon: number
  swLat: number
  neLon: number
  neLat: number
}

export interface NarrativePoint {
  lon: number
  lat: number
}

export interface NarrativeViewportSummary {
  dominantScene: string
  sceneMix: string[]
  summarySentence: string
  featureTags: RegionFeatureTag[]
  encoderSummary?: string | null
  encoderTags?: RegionFeatureTag[]
  sceneTags: string[]
  dominantBuckets: string[]
}

export interface NarrativeNode {
  id: string
  name: string
  role: string
  roleLabel: string
  source: 'representative_sample' | 'aoi_context'
  center: NarrativePoint
  score: number
  categoryMain?: string | null
  categorySub?: string | null
  distanceM?: number | null
  tags: string[]
  reasons: string[]
}

export interface NarrativeTourTransition {
  fromId: string
  toId: string
  rationale: string
}

export interface NarrativeTourStep {
  focus: string
  voice_text: string
  duration: number
  center?: NarrativePoint
  node_id?: string
  role?: string
  transition_reason?: string
  region_id?: string
  region_index?: number
}

export interface NarrativeTourResult {
  boundary: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  viewportSummary: NarrativeViewportSummary
  candidates: NarrativeNode[]
  selectedNodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
  narrativeSteps: NarrativeTourStep[]
}
