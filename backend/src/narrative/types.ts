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
    | 'soft_relevance_hull'
    | 'point_halo'
}

export interface NarrativeViewportSummary {
  dominantScene: string
  sceneMix: string[]
  summarySentence: string
  scaleLevel?: NarrativeScaleLevel
  macroRegionProfile?: NarrativeMacroRegionProfile | null
  macroRegionName?: NarrativeMacroRegionName | null
  featureTags: RegionFeatureTag[]
  encoderSummary?: string | null
  encoderTags?: RegionFeatureTag[]
  sceneTags: string[]
  dominantBuckets: string[]
  requestedStyle: NarrativeTourStyle
  requestedStyleLabel: string
}

export type NarrativeHotness = 'low' | 'medium' | 'high' | 'very_high'
export type NarrativeTourStyle = 'classic_must_see' | 'local_vibe' | 'business_leisure' | 'humanities_walk'
export type NarrativeNodeTier = 'must_see' | 'optional' | 'entry' | 'local_pick' | 'background'
export type NarrativeNodeSource = 'representative_sample' | 'cell_entity' | 'aoi_context' | 'brand_cluster'
export type NarrativeRegionClass = 'primary' | 'support' | 'overflow'

export interface NarrativeReasonCard {
  represents: string
  whyWorthVisiting: string
  bestTime: string
  nearbyConnections: string[]
}

export interface NarrativeNodeFactEnrichment {
  nodeId: string
  snippets: string[]
  labels: string[]
  titles?: string[]
  urls?: string[]
  searchAnswer?: string | null
  source: 'tavily' | 'multi_search' | 'unknown'
}

export interface NarrativeWebSourceItem {
  title: string
  snippet?: string
  url: string
  source: 'tavily' | 'multi_search' | 'unknown'
}

export type NarrativeRegionGlowTier = 'core' | 'inner' | 'outer'

export interface NarrativeRegionGlowLayer {
  id: string
  tier: NarrativeRegionGlowTier
  intensity: number
  boundary: NarrativeNodeBoundary
  source: NarrativeNodeBoundary['source']
}

export interface NarrativeRegionFactEnrichment {
  regionId: string
  query: string
  snippets: string[]
  labels: string[]
  titles?: string[]
  urls?: string[]
  searchAnswer?: string | null
  source: 'tavily' | 'multi_search' | 'unknown'
  sourceItems?: NarrativeWebSourceItem[]
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
  source: NarrativeNodeSource
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
  tier?: NarrativeNodeTier | null
  reasonCard?: NarrativeReasonCard | null
  localTip?: string | null
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

export interface NarrativeRegionCluster {
  id: string
  name: string
  spokenName?: string | null
  regionClass?: NarrativeRegionClass
  center: NarrativePoint
  quadrant?: string | null
  nodes: NarrativeNode[]
  nodeIds: string[]
  nodeCount: number
  dominantBucket: string
  dominantBuckets: string[]
  supportNames: string[]
  anchors: NarrativeRelevanceFieldAnchor[]
  hotspots: NarrativeRelevanceFieldHotspot[]
  summary?: string | null
  boundary?: NarrativeNodeBoundary | null
  glowBoundary?: NarrativeNodeBoundary | null
  glowLayers?: NarrativeRegionGlowLayer[]
  webFacts?: NarrativeRegionFactEnrichment | null
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
  tier?: NarrativeNodeTier | null
  tierLabel?: string | null
  reasonCard?: NarrativeReasonCard | null
  localTip?: string | null
  tourStyle?: NarrativeTourStyle | null
  tourStyleLabel?: string | null
  /** 短 labels 补充式补充（如“关键词·关键词”），由前端 narrator 卡片单行灰底展示 */
  webFactHint?: string | null
  /** 网页原文摘要（已在后端滤掉广告），前端独立样式展示，标识为“网页来源” */
  webFactSnippet?: string | null
  webSources?: NarrativeWebSourceItem[]
  regionSupportNames?: string[]
  /** 节点模糊边界，播放到该步骤时前端会渲染光带 */
  boundary?: NarrativeNodeBoundary | null
  glowBoundary?: NarrativeNodeBoundary | null
  glowLayers?: NarrativeRegionGlowLayer[]
  /**
   * 文案来源标识（first paint 分段下发）：
   * - 'placeholder'：骨架阶段的占位短句，等待 LLM patch 覆盖
   * - 'template'：确定性模板产出（如区域概览 overview）
   * - 'llm'：LLM narration 最终产出
   * 前端在 phase=final 的 patch 到达时，可据此判断是否覆盖已有文案。
   */
  voiceTextSource?: 'placeholder' | 'template' | 'llm'
}

/**
 * 叙事渲染模式。当前默认 aoi_boundary（硬 AOI 边界），
 * 后续阶段会引入基于语义 × 距离核密度的 fluorescent_field（荧光相关性场）。
 * 这里先把 schema 打开，前端可据此切换渲染策略。
 */
export type NarrativeRenderMode = 'aoi_boundary' | 'fluorescent_field' | 'hybrid'

/**
 * 视口尺度层级。用于多尺度叙事：不同尺度讲的根本不是同一层实体。
 * - micro：<3km 对角线，讲具体 POI / 单点 AOI
 * - meso：3-10km，讲品牌/功能聚集区
 * - macro：>10km，讲高阶语义聚合区（如"武汉大学城科教文化区"）
 * 当前第一阶段只读不用，占位供后续分支。
 */
export type NarrativeScaleLevel = 'micro' | 'meso' | 'macro'

/**
 * First paint 分段下发阶段标识。
 * - skeleton：骨架版（boundary + nodes + 模板 voice_text）
 * - final：最终版（LLM voice_text + webFacts 全量落地）
 */
export type NarrativeStreamPhase = 'skeleton' | 'final'

export type NarrativeMacroSpatialForm = 'district' | 'belt' | 'interface' | 'corridor' | 'cluster'

export interface NarrativeMacroRegionProfile {
  scaleLevel: 'macro'
  primaryAnchor: string | null
  anchorNames: string[]
  dominantBuckets: string[]
  supportingBuckets: string[]
  spatialForm: NarrativeMacroSpatialForm
  waterfrontHint: boolean
  axisHint?: string | null
  adminHint?: string | null
}

export interface NarrativeMacroRegionName {
  primaryName: string
  shortName: string
  spokenName: string
  labelType: NarrativeMacroSpatialForm
  source: 'deterministic' | 'llm'
  confidence: number
  reason: string
}

export interface NarrativeRelevanceFieldCell {
  row: number
  col: number
  center: NarrativePoint
  intensity: number
  semanticIntensity?: number
  distanceIntensity?: number
  dominantAnchorId?: string | null
}

export interface NarrativeRelevanceFieldAnchor {
  nodeId: string
  name: string
  center: NarrativePoint
  role: string
  weight: number
  semanticWeight?: number
  densityWeight?: number
  radiusM: number
}

export interface NarrativeEngineProfile {
  engineVersion: string
  generationId: string
  phase: 'skeleton' | 'final'
  scaleLevel: NarrativeScaleLevel
  renderMode: NarrativeRenderMode
  algorithm: {
    field: 'semantic_distance_gaussian'
    ranking: 'region_first_contextual'
    narration: 'llm_contextual_variant' | 'deterministic_skeleton'
  }
  sampling: {
    temperature: number
    topP: number
    variantSeed?: string | null
    narrativeAngle?: string | null
    wordingConstraint?: string | null
  }
  context: {
    regionCount: number
    supportNodeCount: number
    sourceCount: number
    viewportRelationSummary: string[]
  }
  quality: {
    overall: number
    sourceCoverage: number
    supportCoverage: number
    contextVariance: number
    repetitionRisk: number
    flags: string[]
  }
}

export interface NarrativeRelevanceFieldHotspot {
  center: NarrativePoint
  intensity: number
}

export interface NarrativeRelevanceFieldCluster {
  /** 象限标签：right_bottom / right_top / center / left_top / left_bottom */
  quadrant: string
  /** 簇内锚点 */
  anchors: NarrativeRelevanceFieldAnchor[]
  /** 簇内热点 */
  hotspots: NarrativeRelevanceFieldHotspot[]
  /** 簇质心 */
  centroid: NarrativePoint
  /** 簇内节点数 */
  nodeCount: number
}

export interface NarrativeRelevanceField {
  mode: 'gaussian_kernel'
  falloff: 'gaussian'
  scaleLevel: NarrativeScaleLevel
  bounds: NarrativeViewport
  grid: {
    cols: number
    rows: number
  }
  anchors: NarrativeRelevanceFieldAnchor[]
  cells: NarrativeRelevanceFieldCell[]
  hotspots: NarrativeRelevanceFieldHotspot[]
  maxIntensity: number
  minRenderableIntensity: number
  /** macro 多中心聚簇（上限 5 簇），meso/micro 时为空数组 */
  clusters: NarrativeRelevanceFieldCluster[]
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
  relevanceField?: NarrativeRelevanceField | null
  candidates: NarrativeNode[]
  selectedNodes: NarrativeNode[]
  selectedRegions?: NarrativeRegionCluster[]
  populationHotspots?: NarrativePopulationHotspot[]
  nodeGrounding?: NarrativeNodeGrounding[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
  narrativeSteps: NarrativeTourStep[]
}
