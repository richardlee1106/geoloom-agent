/**
 * Web POI Discovery Skill 类型定义 — V2 新链路
 *
 * 新链路: SceneProfile -> DB shortlist -> Tavily Search -> Tavily Extract
 *       -> LLM mention extraction -> mention归一化 -> shortlist匹配 -> 输出分桶
 */

/** 场景画像 */
export interface SceneProfile {
  key: 'food' | 'hotel' | 'scenic' | 'park' | 'metro_station'
  label: string
  matchedScenes: string[]
  resolvedCategoryKeys: string[]
  preferredDomains: string[]
  includeKeywords: string[]
  excludeKeywords: string[]
  searchTokens: string[]
  dbCategoryMains: string[]
  dbCategorySubs: string[]
}

// ── Tavily Extract 相关 ──

/** Tavily Extract 单个 chunk 结果 */
export interface ExtractedChunkItem {
  url: string
  title: string
  text: string
}

/** @deprecated 使用 ExtractedChunkItem */
export type ExtractedChunk = ExtractedChunkItem

/** Tavily Extract 返回结构 */
export interface TavilyExtractResult {
  chunks: ExtractedChunk[]
  failedUrls: string[]
  latencyMs: number
}

// ── LLM Mention 提取相关 ──

/** LLM 提取的单个 mention */
export interface WebMention {
  /** 地名文本 */
  mention: string
  /** 原文证据片段 */
  evidenceSpan: string
  /** 来源网页标题 */
  pageTitle: string
  /** 来源 URL */
  url: string
  /** 面积/区域提示 */
  areaHint: string
  /** 品类提示 */
  categoryHint: string
  /** LLM 置信度 0-1 */
  confidence: number
  /** 是否是泛词（"附近好吃的"、"推荐景点"等） */
  isGeneric: boolean
}

// ── DB Shortlist 相关 ──

/** 本地权威候选 POI */
export interface ShortlistPoi {
  id: number | string
  name: string
  categoryMain: string | null
  categorySub: string | null
  city: string | null
  longitude: number
  latitude: number
  /** pois 表自有评分（0 = 无评分），用于 dbOnlyPois 排序 */
  poiScore: number
}

export interface DiscoveryScopeInput {
  districts?: string[]
  districtIds?: number[]
  areaWkt?: string | null
  anchorLon?: number | null
  anchorLat?: number | null
  radiusM?: number | null
  scopeContext?: Record<string, unknown> | null
}

export interface PoiDiscoveryTopVenue {
  poiId?: number | string | null
  poiName: string
  poiCategory?: string | null
  poiScore?: number | null
  nerName?: string | null
  matchType?: string | null
  confidence?: number | null
  source: 'verified' | 'db_only'
}

// ── 匹配结果 ──

/** mention 与 shortlist POI 的匹配结果 */
export interface MentionMatch {
  mention: string
  evidenceSpan: string
  url: string
  confidence: number
  /** 匹配方式 */
  matchType: 'exact' | 'prefix' | 'contains' | 'ilike' | 'fuzzy' | 'vector' | 'rerank' | 'web_only'
  /** 匹配到的 POI，null 表示 web_only */
  poi: ShortlistPoi | null
  /** 匹配置信度（名称/向量/rerank 综合） */
  matchScore: number
  /** mention 在多chunk中出现的次数 */
  mentionCount: number
}

// ── Pipeline 阶段耗时 ──

export interface PipelineTimings {
  /** 场景画像推断 */
  profile: number
  /** DB shortlist 召回 */
  shortlist: number
  /** Tavily Search */
  search: number
  /** Tavily Extract */
  extract: number
  /** LLM mention 提取 */
  mentionExtraction: number
  /** mention 归一化 */
  normalization: number
  /** shortlist 匹配 */
  matching: number
  /** 总耗时 */
  total: number
}

export interface ExtractStats {
  /** 实际送入 Tavily Extract 的 URL 数 */
  attemptedUrls: number
  /** 至少成功返回一个 chunk 的 URL 数 */
  succeededUrls: number
  /** Extract 明确失败的 URL 数 */
  failedUrls: number
  /** 成功率：succeededUrls / attemptedUrls */
  successRate: number
  /** 当前请求累计拉黑的失败 URL 数 */
  blockedUrls: number
  /** 当前请求累计拉黑的失败域名数 */
  blockedDomains: number
}

// ── 最终输出 ──

/** Skill 最终输出 */
export interface PoiDiscoveryResult {
  /** DB 已验证 POI（mention + DB 双重命中） */
  verifiedDbPois: MentionMatch[]
  /** 按场景重排后的 shortlist 预览 */
  shortlist: ShortlistPoi[]
  /** 仅 DB 侧 POI（shortlist 中未被 web mention 命中的） */
  dbOnlyPois: ShortlistPoi[]
  /** web 未匹配 mention（web 提取但未匹配到 shortlist 的） */
  webUnresolvedMentions: WebMention[]
  topVenues: PoiDiscoveryTopVenue[]
  dbMatchCount: number
  /** 场景画像 */
  profile: SceneProfile
  /** 各阶段耗时 */
  timings: PipelineTimings
  /** Extract 成功率观测 */
  extractStats: ExtractStats
  /** 搜索轮次 */
  searchRounds: number
}

/** Skill 配置 */
export interface WebPoiDiscoveryConfig {
  tavilyApiKey: string
  tavilyTimeoutMs: number
  /** LLM provider（用于 mention 提取） */
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  /** Jina bridge（用于向量召回/rerank） */
  jinaApiKey?: string
  qualitySiteConfigPath: string
  maxSearchRounds: number
  maxResults: number
}

// ── 向后兼容别名（供外部消费） ──

/** @deprecated V2 使用 MentionMatch 替代 */
export type PoiMatch = MentionMatch
