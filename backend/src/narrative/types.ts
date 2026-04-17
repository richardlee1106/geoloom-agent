import type { PoiFeatureTag, RegionFeatureTag } from '../chat/types.js'

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

/**
 * 节点模糊边界（GeoJSON Polygon 或 MultiPolygon）。
 * 来源：
 * 1) AOI 原生 polygon（aois.geom，最优先）
 * 2) 路网闭合地块 / landuse parcel 聚合（Phase 2）
 * 3) 成员 POI DBSCAN → ConcaveHull → Buffer 形态学软化（聚合兜底）
 * 4) 单点圆/椭圆（单点 POI 兜底，用 JS 纯生成）
 */
export interface NarrativeNodeBoundary {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
  /** 边界来源标识，便于前端区分渲染样式与 opacity */
  source:
    | 'aoi_native'
    | 'landuse_parcel'
    | 'road_block'
    | 'concave_hull'
    | 'buffer'
    | 'aggregate_morphology'
    | 'point_halo'
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

export type NarrativeHotness = 'low' | 'medium' | 'high' | 'very_high'

export interface NarrativeNodeFactEnrichment {
  nodeId: string
  snippets: string[]
  labels: string[]
  source: 'tavily' | 'multi_search' | 'unknown'
}

export interface NarrativeCellEntity {
  cellId: string
  cellName: string
  center: NarrativePoint
  dominantCategory: string
  aoiType: string
  sceneTags: string[]
  searchScore: number
  childPoiIds: string[]
}

export interface NarrativeNode {
  id: string
  name: string
  role: string
  roleLabel: string
  source: 'representative_sample' | 'aoi_context' | 'brand_cluster'
  center: NarrativePoint
  score: number
  hotness?: NarrativeHotness
  categoryMain?: string | null
  categorySub?: string | null
  distanceM?: number | null
  tags: string[]
  reasons: string[]
  encoderSummary?: string | null
  encoderTags?: PoiFeatureTag[]
  sceneBucket?: string | null
  selectionReason?: string | null
  webFacts?: NarrativeNodeFactEnrichment | null
  cellId?: string | null
  childPoiIds?: string[]
  /**
   * 聚合边界生成所需的成员点集（WGS84）。
   * brand cluster 用 cluster.members；cell-based 节点用 cell 内 POI 坐标。
   * 若 undefined 或 <3 个点，聚合管线回退到单点圆/椭圆。
   */
  memberPoints?: NarrativePoint[]
  /** 节点模糊边界，来自 AOI 原生 polygon / landuse / 路网闭合地块 / ConcaveHull */
  boundary?: NarrativeNodeBoundary | null
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
  hotness?: NarrativeHotness
  tagline?: string | null
  webFactHint?: string | null
  /** 节点模糊边界，播放到该步骤时前端会渲染光带 */
  boundary?: NarrativeNodeBoundary | null
}

export interface NarrativePopulationHotspot {
  label: string
  gridWkt?: string | null
  center: NarrativePoint
  popSum: number
  popPeak: number
  cellCount: number
}

export interface NarrativeNodeGrounding {
  nodeId: string
  radiusM: number
  populationHotness: NarrativeHotness
  populationSum: number
  populationPeak: number
  populationAvg: number
  cellCount: number
  summary: string
}

export interface NarrativeTourResult {
  boundary: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  viewportSummary: NarrativeViewportSummary
  candidates: NarrativeNode[]
  selectedNodes: NarrativeNode[]
  populationHotspots?: NarrativePopulationHotspot[]
  nodeGrounding?: NarrativeNodeGrounding[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
  narrativeSteps: NarrativeTourStep[]
}
