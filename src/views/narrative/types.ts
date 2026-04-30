/**
 * Narrative 解说引擎数据契约 v1（mock 阶段）
 *
 * 严格对齐：docs/plans/2026-04-29-narrative-engine-rebuild-spec.md §8
 *
 * 注意事项：
 * - 类型层面允许出现 `role`、`tier` 等内部字段
 * - 但 UI 层面必须按 §8.2 白名单显示，禁止把英文 role / score / weight 展示给用户
 * - 任何修改必须显式更新 §8 规范文档，禁止在此私自扩展契约
 */

// 1. 叙事对象分级（§1.1）
export type NarrativeRoleInternal =
  | 'primary_region'
  | 'support_region'
  | 'landmark_anchor'
  | 'scene_evidence'
  | 'background_ecology'
  | 'micro_facility'
  | 'noise'

// 2. 渲染分层（§2）
export type VisualTier = 'core' | 'strong' | 'medium' | 'weak' | 'excluded'

// 3. 尺度策略（§3.1）
export type LODLevel = 'micro' | 'meso' | 'macro'

// 4. 场景画像（§5.1）
export type SceneProfile =
  | 'education_culture'
  | 'tourism_leisure'
  | 'commercial_life'
  | 'urban_history'
  | 'ecology_waterfront'
  | 'transport_access'
  | 'mixed_exploration'

// 5. 解说风格（§7）
export type NarrationTone = 'science' | 'tour' | 'humanity'

// 6. 视口（§0.2 L2）
export interface ViewportBBox {
  west: number
  south: number
  east: number
  north: number
  zoom: number
  center: [number, number]
}

// 7. POI 节点（§2 / §8.1）
export interface NarrativePoi {
  id: string
  lon: number
  lat: number
  display_name: string
  tier: VisualTier
  role: NarrativeRoleInternal
  category_main?: string
}

// 8. 片区光晕（§4 / §8.1）
//    使用简化的多边形环表示，避免引入 GeoJSON 类型依赖
export interface PolygonRing {
  // 第一个环为外环，后续环为洞（mock 阶段不使用洞）
  rings: Array<Array<[number, number]>>
}

export interface GlowLayers {
  core: PolygonRing
  inner: PolygonRing
  outer: PolygonRing
}

// 9. 区域候选（§4 / §8.1）
export interface NarrativeRegion {
  id: string
  display_name: string
  role: NarrativeRoleInternal
  core_anchor: { id: string; lon: number; lat: number }
  boundary: PolygonRing
  glow_layers: GlowLayers
  pois: NarrativePoi[]
  // LLM 允许使用的事实（§7.2）
  narrative_facts: string[]
  // 用户可见的中文章节标签（§8.2 白名单字段）
  chapter_label: string
}

// 10. 路径节点（§6 / §8.1）
export type PathNarrationRole =
  | 'core'
  | 'related'
  | 'cultural'
  | 'landmark'
  | 'educational'
  | 'ecological'

export interface NarrativePathNode {
  region_id: string
  narration_role: PathNarrationRole
  transition_reason: string
}

// 11. 章节文本（§8.1）
export interface NarrativeChapter {
  region_id: string
  text: string
  web_source?: { title: string; url: string }
  length_ms?: number
}

// 12. 上下文（§5.2）
export interface UserContext {
  time_label: string
  weather_label: string
  preference_label: string
  history_label: string
}

// 13. 顶层响应（§8.1）
export interface NarrativeResponse {
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
  // §8.3 调试字段，仅开发模式可见
  debug?: Record<string, unknown>
}

// 14. UI 派生统计（前端本地计算）
export interface TierStats {
  core: number
  strong: number
  medium: number
  weak: number
  excluded: number
}

// 15. UI 配置（左/右面板控件）
export interface NarrativeUiSettings {
  relevanceThreshold: number  // 0~1
  opacityScale: number        // 0~1
  durationPreset: 'casual' | 'standard' | 'detailed'
  tonePreset: NarrationTone
  centroidStrategy: 'auto' | 'region_first' | 'poi_first'
  autoNarrate: boolean
}

// 16. Mode 切换（§0.1 三档）
export type NarrativeMode = 'explore' | 'narrate' | 'compare'
