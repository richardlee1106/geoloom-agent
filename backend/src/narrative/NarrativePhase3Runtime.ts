import { randomUUID } from 'node:crypto'

import type { LLMProvider } from '../llm/types.js'
import type { SpatialFeature, SpatialFetchRequest } from '../spatial/fetchSpatialFeatures.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import type {
  NarrativeChapter,
  NarrativeEnrichmentJob,
  NarrativeEnrichmentMode,
  NarrativeEnrichmentSummary,
  NarrationTone,
  NarrativeBuilder,
  NarrativePoi,
  NarrativeRequest,
  NarrativeResponse,
  NarrativeWebSource,
  SceneProfile,
  UserContext,
  ViewportBBox,
} from './contract.js'
import { classifyNarrativeEntity } from './entityClassifier.js'
import { gcj02ToWgs84 } from './gcj02.js'
import { buildNarrationChapters, buildRegionFacts } from './factGrounding.js'
import { semanticDiversity, viewportAreaKm2 } from './geometry.js'
import { buildGraphNarration, type LlmNarratorDebug } from './llmNarrator.js'
import { classifyLod } from './lodPolicy.js'
import { NarrativeWebFactCache, type NarrativeWebFactCacheStatus } from './NarrativeWebFactCache.js'
import { sampleNarrativePath } from './pathSampler.js'
import { buildFallbackRegion, buildRegionCandidates, isRegionCandidateNarratable, type AoiCandidateRow, type RegionCandidate } from './regionCandidate.js'
import { countStoryTags, inferPathStoryTags, inferPoiStoryTags } from './storyTags.js'

export class NarrativeContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'NarrativeContractError'
  }
}

export interface NarrativePhase3RuntimeOptions {
  fetchSpatialFeatures: (input: SpatialFetchRequest) => Promise<SpatialFeature[]>
  fetchAoiCandidates?: (viewport: ViewportBBox) => Promise<AoiCandidateRow[]>
  searchWebFacts?: (query: string, maxResults: number) => Promise<NarrativeWebSource[]>
  llmProvider?: LLMProvider
  webFactCache?: NarrativeWebFactCache
  embedNarrativeQuery?: (query: string) => Promise<number[] | null>
}

interface WebFactDebugItem {
  region_id: string
  query: string
  source_count: number
  latency_ms: number
  cache_status?: NarrativeWebFactCacheStatus
  error?: string
}

interface WebNameCandidateDebugItem {
  name: string
  query: string
  confidence: number
  source_title: string
  source_url: string
  source_quality?: NarrativeWebSource['quality']
  evidence_snippet?: string
}

interface NarrativeBuildPerformanceDebug {
  timings_ms: Record<string, number>
  budgets_ms: Record<string, number>
  limits: Record<string, number>
  semantic_recall: {
    enabled: boolean
    used_query_vector: boolean
    query: string
    vector_dim: number
    weight: number
    embedding_ms: number
    top_score: number | null
    avg_score: number | null
  }
  warnings: string[]
}

const DEFAULT_USER_CONTEXT: UserContext = {
  time_label: '当前时段',
  weather_label: '天气未指定',
  preference_label: '通用解说',
  history_label: '首次进入',
}

const OFFICIAL_SOURCE_RE = /(gov\.cn|edu\.cn|org\.cn|wuhan\.gov|wh\.gov|官网|管理处|委员会|人民政府|文旅局|园林|规划|自然资源)/iu
const ENCYCLOPEDIA_SOURCE_RE = /(baike\.baidu\.com|wikipedia\.org|百科)/iu
const MEDIA_SOURCE_RE = /(news|xinhuanet|people\.com\.cn|cctv|chinanews|thepaper|长江日报|湖北日报|新华社|人民网|央视|澎湃)/iu
const LOW_QUALITY_SOURCE_RE = /(广告|优惠|团购|预订|点评|论坛|贴吧|小红书|营销|软文|自媒体|携程|马蜂窝|去哪儿|美团|大众点评)/iu
const WEB_INTRO_FORBIDDEN_RE = /(广告|优惠|团购|预订|招商|加盟|联系电话|热线|小红书|大众点评|携程|马蜂窝|去哪儿|营销中心|售楼处|开盘|盛大开放|引爆|脱口秀|抽奖|招聘|扫码|小程序|优惠券|户型|置业|楼盘|返现|特价|秒杀|直播)/iu
const WEB_NAME_CANDIDATE_RE = /([\u4e00-\u9fa5A-Za-z0-9·]{2,18}(?:步行街|商业街|美食街|夜市|商圈|街区|汉街|天地|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|购物中心|购物广场|商业广场|K11|SKP|路|街|大道|巷))/giu
const WEB_FACT_SEARCHER_UNAVAILABLE_ERROR = 'web_fact_searcher_unavailable: 未配置 DEEPSEEK_SEARCH_* / NEWAPI_SEARCH_* 搜索端点'
const WEB_INTRO_ABSTRACT_REGION_NAMES = [
  '江汉路步行街',
  '楚河汉街',
  '光谷步行街',
  '武广商圈',
  '中南中北商圈',
  '徐东商圈',
  '街道口商圈',
  '广埠屯商圈',
  '虎泉夜市',
  '王家湾商圈',
  '钟家村商圈',
  '菱角湖商圈',
  '武汉天地',
  '红钢城',
  '汉正街',
  '司门口商圈',
  '粮道街',
  '大成路夜市',
  '万松园',
  '台北路',
  '吉庆街',
  '山海关路',
  '胜利街',
  '保成路夜市',
  '黎黄陂路',
  '昙华林',
  '水塔街',
]
const NARRATIVE_RUNTIME_BUILD = 'phase3-wuhan-profile-bounds-no-point-cloud-2026-05-03'

function readFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeViewport(value: unknown): ViewportBBox {
  if (!value || typeof value !== 'object') {
    throw new NarrativeContractError('invalid_viewport', 'viewport is required')
  }
  const raw = value as Record<string, unknown>
  const west = readFiniteNumber(raw.west)
  const south = readFiniteNumber(raw.south)
  const east = readFiniteNumber(raw.east)
  const north = readFiniteNumber(raw.north)
  const zoom = readFiniteNumber(raw.zoom) ?? 13
  const centerRaw = raw.center
  if (west === null || south === null || east === null || north === null) {
    throw new NarrativeContractError('invalid_viewport', 'viewport must include finite west/south/east/north')
  }
  if (west >= east || south >= north) {
    throw new NarrativeContractError('invalid_viewport', 'viewport bounds are invalid')
  }
  if (west < -180 || east > 180 || south < -90 || north > 90) {
    throw new NarrativeContractError('invalid_viewport', 'viewport must use WGS84 lon/lat bounds')
  }
  let center: [number, number] = [(west + east) / 2, (south + north) / 2]
  if (Array.isArray(centerRaw) && centerRaw.length >= 2) {
    const lon = readFiniteNumber(centerRaw[0])
    const lat = readFiniteNumber(centerRaw[1])
    if (lon !== null && lat !== null && lon >= west && lon <= east && lat >= south && lat <= north) center = [lon, lat]
  }
  return { west, south, east, north, zoom, center }
}

function resolveSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveLimit(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 20000
  return Math.max(500, Math.min(Math.trunc(n), 50000))
}

function resolveNarrativePoiLimit(value: unknown, viewport: ViewportBBox): number {
  const configured = Number(value)
  if (Number.isFinite(configured)) return resolveLimit(configured)
  const area = viewportAreaKm2(viewport)
  const zoom = viewport.zoom
  const fallback = zoom >= 15 || area <= 1.6
    ? resolveBoundedInteger(process.env.NARRATIVE_POI_LIMIT_MICRO, 5000, 500, 50000)
    : zoom >= 12 || area <= 24
      ? resolveBoundedInteger(process.env.NARRATIVE_POI_LIMIT_MESO, 12000, 500, 50000)
      : resolveBoundedInteger(process.env.NARRATIVE_POI_LIMIT_MACRO, 20000, 500, 50000)
  return Math.min(fallback, resolveBoundedInteger(process.env.NARRATIVE_POI_LIMIT_MAX, 24000, 500, 50000))
}

function resolveNarrativeBudget(name: string, fallback: number, min: number, max: number): number {
  return resolveBoundedInteger(process.env[name], fallback, min, max)
}

function resolveNarrativeSemanticWeight(): number {
  const parsed = Number(process.env.NARRATIVE_POI_EMBEDDING_WEIGHT)
  if (!Number.isFinite(parsed)) return 0.42
  return Math.max(0, Math.min(parsed, 0.85))
}

function resolveNarrativeSemanticCandidateLimit(poiLimit: number): number {
  return resolveBoundedInteger(process.env.NARRATIVE_POI_SEMANTIC_CANDIDATE_LIMIT, Math.max(poiLimit * 3, 2000), poiLimit, 80000)
}

function narrativeSemanticEnabled(options: NarrativePhase3RuntimeOptions): boolean {
  return process.env.NARRATIVE_POI_EMBEDDING_ENABLED !== 'false' && Boolean(options.embedNarrativeQuery)
}

function isVector512(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 512 && value.every((item) => Number.isFinite(Number(item)))
}

function buildNarrativeSemanticQuery(input: {
  tone: NarrationTone
  userContext: UserContext
  viewport: ViewportBBox
}): string {
  const lodHint = input.viewport.zoom >= 15 ? '街巷 POI 过早 夜市 门店' : input.viewport.zoom >= 12 ? '片区 商圈 街区 公园 高校' : '城市结构 大片区 江湖 商圈 生态'
  const toneHint = input.tone === 'humanity' ? '历史 老街 生活气息 本地人' : input.tone === 'science' ? '空间结构 功能分区 人流热度' : '游览 地标 文旅 消费'
  return `武汉 ${lodHint} ${toneHint} ${input.userContext.preference_label} ${input.userContext.time_label}`
}

function describeRuntimeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withBudget<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), Math.max(1, timeoutMs))
    promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function resolveTone(value: unknown): NarrationTone {
  return value === 'science' || value === 'tour' || value === 'humanity' ? value : 'tour'
}

function mergeUserContext(value: unknown): UserContext {
  if (!value || typeof value !== 'object') return DEFAULT_USER_CONTEXT
  const raw = value as Record<string, unknown>
  return {
    time_label: String(raw.time_label || DEFAULT_USER_CONTEXT.time_label),
    weather_label: String(raw.weather_label || DEFAULT_USER_CONTEXT.weather_label),
    preference_label: String(raw.preference_label || DEFAULT_USER_CONTEXT.preference_label),
    history_label: String(raw.history_label || DEFAULT_USER_CONTEXT.history_label),
  }
}

function classifyWebSourceQuality(source: Pick<NarrativeWebSource, 'title' | 'url' | 'snippet'>): Required<Pick<NarrativeWebSource, 'quality' | 'quality_score'>> {
  const text = `${source.title} ${source.url} ${source.snippet || ''}`
  if (OFFICIAL_SOURCE_RE.test(text)) return { quality: 'official', quality_score: 0.95 }
  if (ENCYCLOPEDIA_SOURCE_RE.test(text)) return { quality: 'encyclopedia', quality_score: 0.78 }
  if (MEDIA_SOURCE_RE.test(text)) return { quality: 'media', quality_score: 0.68 }
  if (LOW_QUALITY_SOURCE_RE.test(text)) return { quality: 'general', quality_score: 0.35 }
  return { quality: 'general', quality_score: 0.5 }
}

function enrichWebSourceQuality(source: NarrativeWebSource): NarrativeWebSource {
  const quality = classifyWebSourceQuality(source)
  return { ...source, ...quality }
}

function sortWebSourcesByQuality(sources: NarrativeWebSource[]): NarrativeWebSource[] {
  return sources
    .map(enrichWebSourceQuality)
    .sort((left, right) => (right.quality_score ?? 0) - (left.quality_score ?? 0))
}

function normalizeWebIntroSnippet(value: unknown): string {
  const normalized = String(value || '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'“”‘’：:，,。；;]+|[\s"'“”‘’]+$/gu, '')
    .trim()
  if (!normalized || WEB_INTRO_FORBIDDEN_RE.test(normalized)) return ''
  const clipped = normalized.length > 96 ? `${normalized.slice(0, 96)}…` : normalized
  return /[。！？]$/u.test(clipped) ? clipped : `${clipped}。`
}

function describeWebFactError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error || 'unknown_error')
}

function buildWebIntroSentence(sources: NarrativeWebSource[], regionName: string): string {
  const source = sources.find((item) => isWebIntroSourceRelevant(item, regionName))
    || sources.find((item) => isFallbackWebIntroSourceUsable(item, regionName))
  if (!source) return ''
  return `参考资料显示，${normalizeWebIntroSnippet(source.snippet)}`
}

function attachIntroToChapterText(text: string, sources: NarrativeWebSource[], regionName: string): string {
  const intro = buildWebIntroSentence(sources, regionName)
  if (!intro || text.includes(intro)) return text
  return `${text}${intro}`
}

function webFactQueryRegionName(regionName: string): string {
  return String(regionName || '').replace(/[（(](视野内片区|A区|B区|C区|D区|东区|西区|南区|北区|琴园|歌笛湖)[）)]/gu, '').trim() || regionName
}

function webFactQueriesForRegion(regionName: string, region?: RegionCandidate): string[] {
  const name = webFactQueryRegionName(regionName)
  const storyHint = region?.story_tags?.some((tag) => tag === 'heritage' || tag === 'culture') ? '历史文化' : region?.story_tags?.some((tag) => tag === 'commerce' || tag === 'food' || tag === 'nightlife') ? '商业生活' : ''
  return [...new Set([
    `${name} 介绍`,
    `${name} 武汉 介绍`,
    storyHint ? `${name} 武汉 ${storyHint} 介绍` : '',
  ].filter(Boolean))]
}

function mergeWebFactsIntoFinalChapters(input: {
  chapters: NarrativeChapter[]
  groundedChapters: NarrativeChapter[]
  regions: RegionCandidate[]
}): NarrativeChapter[] {
  const groundedByRegionId = new Map(input.groundedChapters.map((chapter) => [chapter.region_id, chapter]))
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  return input.chapters.map((chapter) => {
    const grounded = groundedByRegionId.get(chapter.region_id)
    const sources = grounded?.web_sources || chapter.web_sources
    const region = regionById.get(chapter.region_id)
    if (!sources?.length) return { ...chapter, story_tags: chapter.story_tags || region?.story_tags }
    const regionName = region?.display_name || chapter.region_id
    return {
      ...chapter,
      text: attachIntroToChapterText(chapter.text, sources, regionName),
      web_sources: sources,
      story_tags: chapter.story_tags || grounded?.story_tags || region?.story_tags,
    }
  })
}

function isWebIntroSourceRelevant(source: NarrativeWebSource, regionName: string): boolean {
  const snippet = normalizeWebIntroSnippet(source.snippet)
  if (!snippet) return false
  const searchableText = `${source.title || ''} ${snippet}`
  if (WEB_INTRO_FORBIDDEN_RE.test(searchableText)) return false
  const tokens = webIntroRegionTokens(regionName)
  if (tokens.length === 0) return true
  if (!tokens.some((token) => searchableText.includes(token))) return false
  return !mentionsOtherAbstractRegion(searchableText, tokens)
}

function isFallbackWebIntroSourceUsable(source: NarrativeWebSource, regionName: string): boolean {
  const snippet = normalizeWebIntroSnippet(source.snippet)
  if (!snippet) return false
  const searchableText = `${source.title || ''} ${snippet}`
  if (WEB_INTRO_FORBIDDEN_RE.test(searchableText)) return false
  const tokens = webIntroRegionTokens(regionName)
  if (tokens.length > 0 && mentionsOtherAbstractRegion(searchableText, tokens)) return false
  return source.quality === 'official' || source.quality === 'encyclopedia' || source.quality === 'media' || (source.quality_score ?? 0) >= 0.68
}

function webIntroRegionTokens(regionName: string): string[] {
  const compact = String(regionName || '').replace(/\s+/gu, '').trim()
  if (!compact) return []
  const baseName = compact.replace(/[（(](视野内片区|A区|B区|C区|D区|东区|西区|南区|北区|琴园|歌笛湖)[）)]/gu, '')
  const stripped = baseName.replace(/(步行街|商业街|商圈|街区)$/u, '')
  return [...new Set([compact, baseName, stripped].filter((token) => token.length >= 2))]
}

function mentionsOtherAbstractRegion(snippet: string, targetTokens: string[]): boolean {
  return WEB_INTRO_ABSTRACT_REGION_NAMES.some((name) => {
    const tokens = webIntroRegionTokens(name)
    const sameRegion = tokens.some((token) => targetTokens.includes(token)) || targetTokens.some((token) => tokens.includes(token))
    if (sameRegion) return false
    return tokens.some((token) => snippet.includes(token))
  })
}

function coordinatesNearlyEqual(leftLon: number, leftLat: number, rightLon: number, rightLat: number): boolean {
  return Math.abs(leftLon - rightLon) < 0.00002 && Math.abs(leftLat - rightLat) < 0.00002
}

function resolveFeatureWgs84LonLat(input: {
  rawLon: number
  rawLat: number
  geomLon: number | null
  geomLat: number | null
  coordSys: string
}): [number, number] {
  if (input.geomLon !== null && input.geomLat !== null) {
    if (input.coordSys === 'gcj02' && coordinatesNearlyEqual(input.geomLon, input.geomLat, input.rawLon, input.rawLat)) {
      return gcj02ToWgs84(input.rawLon, input.rawLat)
    }
    return [input.geomLon, input.geomLat]
  }
  return input.coordSys === 'gcj02'
    ? gcj02ToWgs84(input.rawLon, input.rawLat)
    : [input.rawLon, input.rawLat]
}

function featureToPoi(feature: SpatialFeature): NarrativePoi | null {
  const properties = feature.properties || {}
  const geomLon = readFiniteNumber(properties.geom_longitude)
  const geomLat = readFiniteNumber(properties.geom_latitude)
  const [rawLon, rawLat] = feature.geometry.coordinates
  if (![rawLon, rawLat].every(Number.isFinite)) return null
  const coordSys = String(properties.coordSys || properties._coordSys || '').trim().toLowerCase()
  const [lon, lat] = resolveFeatureWgs84LonLat({ rawLon, rawLat, geomLon, geomLat, coordSys })
  const id = String(properties.id ?? feature.id ?? `${lon.toFixed(6)},${lat.toFixed(6)}`)
  const displayName = String(properties.name || properties['名称'] || '未命名地点')
  const categoryMain = String(properties.category_main || properties.category_big || '未分类')
  const categorySub = String(properties.category_sub || properties.category_mid || '')
  const semanticScore = readFiniteNumber(properties.semantic_score)
  const semanticDistance = readFiniteNumber(properties.semantic_distance)
  const fusionScore = readFiniteNumber(properties.fusion_score)
  const classification = classifyNarrativeEntity({ name: displayName, categoryMain, categorySub })
  const storyTags = inferPoiStoryTags({ display_name: displayName, category_main: categoryMain, category_sub: categorySub })
  return {
    id,
    lon,
    lat,
    display_name: displayName,
    tier: classification.tier,
    role: classification.role,
    category_main: categoryMain,
    category_sub: categorySub || undefined,
    semantic_score: semanticScore ?? undefined,
    semantic_distance: semanticDistance ?? undefined,
    fusion_score: fusionScore ?? undefined,
    story_tags: storyTags,
  }
}

function resolveSceneProfile(pois: NarrativePoi[]): SceneProfile {
  const text = pois.map((p) => `${p.category_main || ''} ${p.display_name}`).join(' ')
  if (/(大学|学院|学校|科教|图书馆|文化|博物馆|纪念馆)/u.test(text)) return 'education_culture'
  if (/(黄鹤楼|古迹|历史|景区|风景名胜|纪念)/u.test(text)) return 'heritage_tourism'
  if (/(公园|湖|山|自然|生态|绿地)/u.test(text)) return 'natural_ecology'
  if (/(商业|购物|餐饮|咖啡|酒店|住宿|休闲|娱乐)/u.test(text)) return 'commercial_leisure'
  return 'mixed_urban'
}

function effectivePoiCount(pois: NarrativePoi[]): number {
  return pois.filter((poi) => poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium').length
}

function resolveSelectedRegions(candidates: RegionCandidate[], pathRegionIds: string[]): RegionCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  return pathRegionIds.map((id) => byId.get(id)).filter((candidate): candidate is RegionCandidate => Boolean(candidate))
}

function buildDebugSnapshot(input: {
  featuresCount: number
  pois: NarrativePoi[]
  renderablePois: NarrativePoi[]
  aois: AoiCandidateRow[]
  builtCandidates: RegionCandidate[]
  candidates: RegionCandidate[]
  fallbackUsed: boolean
  lodDecision: ReturnType<typeof classifyLod>
  path: ReturnType<typeof sampleNarrativePath>
  selectedRegions: RegionCandidate[]
  webFactDebug: WebFactDebugItem[]
  webNameCandidates: WebNameCandidateDebugItem[]
  llmNarratorDebug: LlmNarratorDebug
  performance: NarrativeBuildPerformanceDebug
}) {
  const poiTierStats = input.pois.reduce<Record<string, number>>((acc, poi) => {
    acc[poi.tier] = (acc[poi.tier] || 0) + 1
    return acc
  }, {})
  return {
    runtime: {
      engine: 'NarrativePhase3Runtime',
      build: NARRATIVE_RUNTIME_BUILD,
    },
    performance: input.performance,
    story_tags: {
      path: input.path.storyTags,
      counts: countStoryTags(input.selectedRegions),
    },
    recall: {
      features_count: input.featuresCount,
      poi_count: input.pois.length,
      renderable_poi_count: input.renderablePois.length,
      aoi_count: input.aois.length,
      poi_tier_stats: poiTierStats,
    },
    candidates: {
      built_count: input.builtCandidates.length,
      response_count: input.candidates.length,
      fallback_used: input.fallbackUsed,
      items: input.candidates.map((candidate, index) => ({
        index,
        id: candidate.id,
        name: candidate.display_name,
        source: candidate.source,
        role: candidate.role,
        score: Number(candidate.score.toFixed(4)),
        coverage: Number(candidate.coverage.toFixed(4)),
        diversity: Number(candidate.diversity.toFixed(4)),
        story_tags: candidate.story_tags || [],
        poi_count: candidate.pois.length,
        effective_poi_count: candidate.effectivePoiCount,
        heat_point_count: candidate.visual_layer.poi_heat?.points.length ?? 0,
      })),
    },
    lod: {
      selected: input.lodDecision.lod,
      scores: input.lodDecision.scores,
    },
    path: {
      node_count: input.path.nodes.length,
      alternatives_count: input.path.alternativesCount,
      engine: input.path.engine,
      strategy: input.path.strategy,
      story_tags: input.path.storyTags,
      lod_policy: input.path.lodPolicy,
      relations: input.path.relations,
      nodes: input.path.nodes.map((node, index) => {
        const region = input.selectedRegions[index]
        return {
          index,
          region_id: node.region_id,
          name: region?.display_name ?? node.region_id,
          narration_role: node.narration_role,
          transition_reason: node.transition_reason,
          story_tags: node.story_tags || region?.story_tags || [],
        }
      }),
    },
    facts: {
      selected_region_count: input.selectedRegions.length,
      selected_regions: input.selectedRegions.map((region) => ({
        id: region.id,
        name: region.display_name,
        fact_count: region.narrative_facts.length,
        facts: region.narrative_facts.map((fact) => ({
          claim: fact.claim,
          source: fact.source,
          confidence: fact.confidence,
          verified: fact.verified,
        })),
      })),
    },
    web_facts: {
      queried_region_count: input.webFactDebug.length,
      source_count: input.webFactDebug.reduce((sum, item) => sum + item.source_count, 0),
      items: input.webFactDebug,
    },
    llm_narrator: input.llmNarratorDebug,
    web_name_candidates: {
      count: input.webNameCandidates.length,
      items: input.webNameCandidates,
      structural_effect: 'debug_only',
    },
  }
}

export function buildDeepSeekNarrativeWebFactSearcher(skill: SkillDefinition) {
  return async (query: string, maxResults: number): Promise<NarrativeWebSource[]> => {
    const result = await skill.execute('search_web', { query, max_results: maxResults }, {
      traceId: `narrative-webfact-${Date.now()}`,
      requestId: 'narrative-webfact',
      logger: createLogger({ surface: 'narrative-webfact' }),
    })
    if (!result.ok) throw new Error(result.error?.message || result.error?.code || 'deepseek_search_failed')
    if (!result.data || typeof result.data !== 'object') return []
    const data = result.data as { results?: Array<{ title?: unknown; content?: unknown; snippet?: unknown; url?: unknown }> }
    return (data.results || [])
      .map((item) => ({
        title: String(item.title || item.url || '').trim(),
        url: String(item.url || '').trim(),
        snippet: String(item.content || item.snippet || '').trim() || undefined,
      }))
      .filter((item) => item.title && /^https?:\/\//iu.test(item.url))
      .map(enrichWebSourceQuality)
      .sort((left, right) => (right.quality_score ?? 0) - (left.quality_score ?? 0))
      .slice(0, maxResults)
  }
}

function normalizeNarrativeWebSources(value: unknown, maxResults: number): NarrativeWebSource[] {
  if (!value || typeof value !== 'object') return []
  const data = value as {
    results?: Array<{ title?: unknown; content?: unknown; snippet?: unknown; url?: unknown }>
    merged?: Array<{ title?: unknown; content?: unknown; snippet?: unknown; url?: unknown }>
  }
  const items = Array.isArray(data.results) ? data.results : Array.isArray(data.merged) ? data.merged : []
  return items
    .map((item) => ({
      title: String(item.title || item.url || '').trim(),
      url: String(item.url || '').trim(),
      snippet: String(item.content || item.snippet || '').trim() || undefined,
    }))
    .filter((item) => item.title && /^https?:\/\//iu.test(item.url))
    .map(enrichWebSourceQuality)
    .sort((left, right) => (right.quality_score ?? 0) - (left.quality_score ?? 0))
    .slice(0, maxResults)
}

async function executeWebFactSkill(input: {
  skill: SkillDefinition
  action: string
  payload: Record<string, unknown>
  query: string
  maxResults: number
}) {
  const result = await input.skill.execute(input.action, input.payload, {
    traceId: `narrative-webfact-${Date.now()}-${input.skill.name}`,
    requestId: 'narrative-webfact',
    logger: createLogger({ surface: 'narrative-webfact', provider: input.skill.name }),
  })
  if (!result.ok) throw new Error(result.error?.message || result.error?.code || `${input.skill.name}_failed`)
  return normalizeNarrativeWebSources(result.data, input.maxResults)
}

export function buildCompositeNarrativeWebFactSearcher(input: {
  deepSeek?: SkillDefinition
  tavily?: SkillDefinition
}) {
  const providers = [
    input.deepSeek ? {
      skill: input.deepSeek,
      action: 'search_web',
      payload: (query: string, maxResults: number) => ({ query, max_results: maxResults }),
    } : null,
    input.tavily ? {
      skill: input.tavily,
      action: 'search_web',
      payload: (query: string, maxResults: number) => ({ query, max_results: maxResults, search_depth: 'basic' }),
    } : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null)

  if (providers.length === 0) return undefined

  return async (query: string, maxResults: number): Promise<NarrativeWebSource[]> => {
    const failures: string[] = []
    let emptyProviderCount = 0
    for (const provider of providers) {
      if (!provider) continue
      try {
        const sources = await executeWebFactSkill({
          skill: provider.skill,
          action: provider.action,
          payload: provider.payload(query, maxResults),
          query,
          maxResults,
        })
        if (sources.length > 0) return sources
        emptyProviderCount += 1
      } catch (error) {
        failures.push(`${provider.skill.name}: ${describeWebFactError(error)}`)
      }
    }
    if (emptyProviderCount > 0) return []
    throw new Error(failures.join(' | ') || 'narrative_web_fact_search_failed')
  }
}

async function attachWebSources(input: {
  chapters: NarrativeChapter[]
  regions: RegionCandidate[]
  searchWebFacts?: (query: string, maxResults: number) => Promise<NarrativeWebSource[]>
  webFactCache: NarrativeWebFactCache
  mode: NarrativeEnrichmentMode
}) {
  const debug: WebFactDebugItem[] = []
  if (input.mode === 'off') return { chapters: input.chapters, debug }
  const configuredLimit = process.env.NARRATIVE_WEB_FACT_REGION_LIMIT
  const limit = resolveBoundedInteger(configuredLimit, input.chapters.length, 0, input.chapters.length)
  const maxResults = resolveBoundedInteger(process.env.NARRATIVE_WEB_FACT_RESULT_LIMIT, 3, 1, 5)
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  const pairs = input.chapters.slice(0, limit).map((chapter) => ({
    chapter,
    region: regionById.get(chapter.region_id),
  }))
  const settled = await allSettledWithConcurrency(pairs, resolveWebFactConcurrency(), async ({ chapter, region }) => {
    const queries = webFactQueriesForRegion(region?.display_name || chapter.region_id, region)
    const started = Date.now()
    let lastCacheStatus: NarrativeWebFactCacheStatus | undefined
    let lastError: string | undefined
    for (const query of queries) {
      const cached = input.webFactCache.get(query, maxResults)
      lastCacheStatus = cached.status
      if (cached.entry) {
        const cachedSources = sortWebSourcesByQuality(cached.entry.sources).slice(0, maxResults)
        if (cachedSources.length > 0 || input.mode === 'cache_only') {
          return {
            regionId: chapter.region_id,
            query,
            sources: cachedSources,
            latencyMs: Date.now() - started,
            cacheStatus: cached.status,
            error: cached.entry.error,
          }
        }
        // Cached error with no sources — retry instead of serving stale error
        if (cached.entry.error && input.searchWebFacts) {
          lastCacheStatus = 'miss'
        } else {
          lastError = cached.entry.error
          continue
        }
      }
      if (input.mode === 'cache_only') continue
      if (!input.searchWebFacts) {
        lastError = WEB_FACT_SEARCHER_UNAVAILABLE_ERROR
        continue
      }
      try {
        const sources = sortWebSourcesByQuality(await input.searchWebFacts(query, maxResults)).slice(0, maxResults)
        input.webFactCache.set(query, maxResults, sources)
        if (sources.length > 0) {
          return { regionId: chapter.region_id, query, sources, latencyMs: Date.now() - started, cacheStatus: 'stored' as const }
        }
      } catch (error) {
        const message = describeWebFactError(error)
        input.webFactCache.setError(query, maxResults, message)
        lastCacheStatus = 'error_stored'
        lastError = message
      }
    }
    return { regionId: chapter.region_id, query: queries[0] || chapter.region_id, sources: [], latencyMs: Date.now() - started, cacheStatus: lastCacheStatus, error: lastError }
  })
  const sourcesByRegion = new Map<string, NarrativeWebSource[]>()
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue
    sourcesByRegion.set(item.value.regionId, item.value.sources)
    debug.push({
      region_id: item.value.regionId,
      query: item.value.query,
      source_count: item.value.sources.length,
      latency_ms: item.value.latencyMs,
      cache_status: item.value.cacheStatus,
      error: item.value.error,
    })
  }
  return {
    chapters: input.chapters.map((chapter) => ({
      ...chapter,
      text: attachIntroToChapterText(chapter.text, sourcesByRegion.get(chapter.region_id) || [], input.regions.find((region) => region.id === chapter.region_id)?.display_name || chapter.region_id),
      web_sources: sourcesByRegion.get(chapter.region_id) || chapter.web_sources,
    })),
    debug,
  }
}

async function probeWebNameCandidates(input: {
  viewport: ViewportBBox
  scene: SceneProfile
  candidates: RegionCandidate[]
  searchWebFacts?: (query: string, maxResults: number) => Promise<NarrativeWebSource[]>
}): Promise<WebNameCandidateDebugItem[]> {
  if (!input.searchWebFacts) return []
  const anchorNames = input.candidates
    .slice(0, 5)
    .map((candidate) => candidate.display_name)
    .filter(Boolean)
  const query = `${anchorNames.join(' ')} 介绍 商圈 步行街 街区`
  const maxResults = resolveBoundedInteger(process.env.NARRATIVE_WEB_NAME_CANDIDATE_RESULT_LIMIT, 3, 1, 5)
  try {
    const sources = sortWebSourcesByQuality(await input.searchWebFacts(query, maxResults)).slice(0, maxResults)
    return extractWebNameCandidates({ query, sources }).slice(0, 8)
  } catch {
    return []
  }
}

function extractWebNameCandidates(input: {
  query: string
  sources: NarrativeWebSource[]
}): WebNameCandidateDebugItem[] {
  const byName = new Map<string, WebNameCandidateDebugItem>()
  for (const source of input.sources) {
    const text = `${source.title} ${source.snippet || ''}`
    for (const match of text.matchAll(WEB_NAME_CANDIDATE_RE)) {
      const name = normalizeWebNameCandidate(match[1])
      if (!name || byName.has(name)) continue
      byName.set(name, {
        name,
        query: input.query,
        confidence: webNameCandidateConfidence(name, source),
        source_title: source.title,
        source_url: source.url,
        source_quality: source.quality,
        evidence_snippet: source.snippet,
      })
    }
  }
  return [...byName.values()].sort((left, right) => right.confidence - left.confidence)
}

function normalizeWebNameCandidate(value: string): string | null {
  const name = value.trim().replace(/[，。、“”"'（）()【】[\]\s]+$/gu, '')
  if (name.length < 2 || name.length > 18) return null
  if (/^(城市|武汉|商业|购物|街区|商圈|步行街|道路|大道|街道)$/u.test(name)) return null
  return name
}

function webNameCandidateConfidence(name: string, source: NarrativeWebSource): number {
  const suffixScore = /(步行街|商业街|商圈|街区|汉街|天地|购物中心|购物广场|商业广场|万达广场|销品茂|K11|SKP)$/iu.test(name) ? 0.2 : 0.08
  const sourceScore = Math.min(0.25, Math.max(0, (source.quality_score ?? 0.5) - 0.5))
  return Number(Math.min(0.95, 0.55 + suffixScore + sourceScore).toFixed(2))
}

function sceneLabel(scene: SceneProfile): string {
  switch (scene) {
    case 'education_culture': return '教育文化'
    case 'heritage_tourism': return '历史游览'
    case 'commercial_leisure': return '商业休闲'
    case 'natural_ecology': return '自然生态'
    case 'mixed_urban': return '混合城区'
  }
}

function resolveNarrativeLlmEnabled(): boolean {
  const raw = String(process.env.NARRATIVE_LLM_NARRATION_ENABLED || 'true').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(raw)
}

function resolveEnrichmentMode(value: unknown): NarrativeEnrichmentMode {
  return value === 'async' || value === 'cache_only' || value === 'off' || value === 'sync' ? value : 'sync'
}

function resolveWebFactConcurrency(): number {
  const parsed = Number(process.env.NARRATIVE_WEB_FACT_CONCURRENCY || '3')
  if (!Number.isFinite(parsed)) return 3
  return Math.max(1, Math.min(Math.trunc(parsed), 8))
}

function resolveBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  const selected = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.min(Math.trunc(selected), max))
}

async function allSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

function countCompletedWebFactRegions(items: WebFactDebugItem[]): number {
  return items.filter((item) => item.source_count > 0).length
}

function countCachedWebFactRegions(items: WebFactDebugItem[]): number {
  return items.filter((item) => item.cache_status === 'hit').length
}

function sumWebFactSources(items: WebFactDebugItem[]): number {
  return items.reduce((sum, item) => sum + item.source_count, 0)
}

function summarizeWebFactErrors(items: WebFactDebugItem[]): string | undefined {
  const errors = [...new Set(items.map((item) => item.error).filter((error): error is string => Boolean(error)))]
  return errors.length > 0 ? errors.slice(0, 3).join('；') : undefined
}

function resolveWebFactEnrichmentStatus(mode: NarrativeEnrichmentMode, items: WebFactDebugItem[]): NarrativeEnrichmentSummary['status'] {
  if (mode === 'off') return 'disabled'
  const sourceCount = sumWebFactSources(items)
  const error = summarizeWebFactErrors(items)
  return sourceCount === 0 && Boolean(error) ? 'failed' : 'completed'
}

function buildEnrichmentSummary(input: {
  jobId?: string
  mode: NarrativeEnrichmentMode
  status: NarrativeEnrichmentSummary['status']
  phase: NarrativeEnrichmentSummary['phase']
  totalRegionCount: number
  webFactDebug: WebFactDebugItem[]
  error?: string
  startedAt?: string
  updatedAt?: string
  completedAt?: string
}): NarrativeEnrichmentSummary {
  return {
    job_id: input.jobId,
    mode: input.mode,
    status: input.status,
    phase: input.phase,
    total_region_count: input.totalRegionCount,
    completed_region_count: countCompletedWebFactRegions(input.webFactDebug),
    cached_region_count: countCachedWebFactRegions(input.webFactDebug),
    source_count: sumWebFactSources(input.webFactDebug),
    error: input.error || summarizeWebFactErrors(input.webFactDebug),
    started_at: input.startedAt,
    updated_at: input.updatedAt,
    completed_at: input.completedAt,
  }
}

export class NarrativePhase3Runtime implements NarrativeBuilder {
  private readonly webFactCache: NarrativeWebFactCache
  private readonly enrichmentJobs = new Map<string, NarrativeEnrichmentJob>()

  constructor(private readonly options: NarrativePhase3RuntimeOptions) {
    this.webFactCache = options.webFactCache || new NarrativeWebFactCache()
  }

  async build(input: NarrativeRequest): Promise<NarrativeResponse> {
    const mode = resolveEnrichmentMode(input.enrichment_mode)
    if (mode === 'async') {
      const initialResponse = await this.buildOnce({ ...input, enrichment_mode: 'cache_only' }, 'cache_only')
      const job = this.createEnrichmentJob(initialResponse)
      initialResponse.enrichment = job.summary
      this.runEnrichmentJob(job.job_id, { ...input, session_id: initialResponse.session_id })
      return initialResponse
    }
    return this.buildOnce(input, mode)
  }

  getEnrichmentJob(jobId: string): NarrativeEnrichmentJob | undefined {
    return this.enrichmentJobs.get(jobId)
  }

  private async buildOnce(input: NarrativeRequest, mode: NarrativeEnrichmentMode): Promise<NarrativeResponse> {
    const buildStarted = Date.now()
    const timings: Record<string, number> = {}
    const warnings: string[] = []
    const viewport = normalizeViewport(input.viewport)
    const tone = resolveTone(input.tone)
    const userContext = mergeUserContext(input.user_context)
    const debugEnabled = input.debug === true
    const sessionId = resolveSessionId(input.session_id) || randomUUID()
    const seed = `${sessionId}:${viewport.west.toFixed(4)}:${viewport.south.toFixed(4)}:${viewport.east.toFixed(4)}:${viewport.north.toFixed(4)}:${tone}`
    const poiLimit = resolveNarrativePoiLimit(input.limit, viewport)
    const semanticCandidateLimit = resolveNarrativeSemanticCandidateLimit(poiLimit)
    const budgets = {
      poi_query: resolveNarrativeBudget('NARRATIVE_POI_QUERY_TIMEOUT_MS', 2500, 300, 4500),
      aoi_query: resolveNarrativeBudget('NARRATIVE_AOI_QUERY_TIMEOUT_MS', 1000, 200, 3000),
      semantic_embedding: resolveNarrativeBudget('NARRATIVE_POI_EMBEDDING_TIMEOUT_MS', 650, 100, 2000),
    }
    const timed = async <T>(key: string, budgetMs: number, fallback: T, action: () => Promise<T>): Promise<T> => {
      const started = Date.now()
      try {
        return await withBudget(Promise.resolve().then(action), budgetMs + 120, key)
      } catch (error) {
        warnings.push(`${key}:${describeRuntimeError(error)}`)
        return fallback
      } finally {
        timings[key] = Date.now() - started
      }
    }
    const semanticWeight = resolveNarrativeSemanticWeight()
    const semanticQuery = buildNarrativeSemanticQuery({ tone, userContext, viewport })
    const semanticDebug: NarrativeBuildPerformanceDebug['semantic_recall'] = {
      enabled: narrativeSemanticEnabled(this.options),
      used_query_vector: false,
      query: semanticQuery,
      vector_dim: 0,
      weight: semanticWeight,
      embedding_ms: 0,
      top_score: null,
      avg_score: null,
    }
    const aoiPromise = timed('aoi_query', budgets.aoi_query, [] as AoiCandidateRow[], async () => this.options.fetchAoiCandidates?.(viewport) ?? [])
    let semanticVector: number[] | null = null
    if (semanticDebug.enabled && this.options.embedNarrativeQuery) {
      const semanticStarted = Date.now()
      try {
        const vector = await withBudget(this.options.embedNarrativeQuery(semanticQuery), budgets.semantic_embedding, 'semantic_embedding')
        semanticDebug.vector_dim = Array.isArray(vector) ? vector.length : 0
        if (isVector512(vector)) {
          semanticVector = vector.map((item) => Number(item))
          semanticDebug.used_query_vector = true
        } else if (vector) {
          warnings.push(`semantic_embedding:vector_dim_${semanticDebug.vector_dim}`)
        }
      } catch (error) {
        warnings.push(`semantic_embedding:${describeRuntimeError(error)}`)
      } finally {
        semanticDebug.embedding_ms = Date.now() - semanticStarted
        timings.semantic_embedding = semanticDebug.embedding_ms
      }
    }
    const featuresPromise = timed('poi_query', budgets.poi_query, [] as SpatialFeature[], async () => this.options.fetchSpatialFeatures({
      bounds: [viewport.west, viewport.south, viewport.east, viewport.north],
      limit: poiLimit,
      timeoutMs: budgets.poi_query,
      semanticQueryVector: semanticVector ?? undefined,
      semanticWeight,
      semanticCandidateLimit: semanticVector ? semanticCandidateLimit : undefined,
    }))
    const [features, aois] = await Promise.all([featuresPromise, aoiPromise])
    const pois = features.map((feature) => featureToPoi(feature)).filter((poi): poi is NarrativePoi => Boolean(poi))
    const renderablePois = pois.filter((poi) => poi.tier !== 'excluded')
    const semanticScores = renderablePois.map((poi) => poi.semantic_score).filter((score): score is number => Number.isFinite(score))
    semanticDebug.top_score = semanticScores.length > 0 ? Number(Math.max(...semanticScores).toFixed(3)) : null
    semanticDebug.avg_score = semanticScores.length > 0 ? Number((semanticScores.reduce((sum, score) => sum + score, 0) / semanticScores.length).toFixed(3)) : null
    const candidateStarted = Date.now()
    const scene = resolveSceneProfile(renderablePois)
    const builtCandidates = buildRegionCandidates({ viewport, pois, aois, scene })
    const fallbackUsed = builtCandidates.length === 0
    const fallbackCandidate = fallbackUsed ? buildFallbackRegion({ viewport, pois, scene }) : null
    const candidates = fallbackCandidate ? [fallbackCandidate].filter(isRegionCandidateNarratable) : builtCandidates
    const dominantCoverage = Math.max(...candidates.map((candidate) => candidate.coverage), 0)
    const semanticDiversityValue = semanticDiversity(renderablePois)
    const lodDecision = classifyLod({
      dominantCoverage,
      candidateCount: candidates.length,
      semanticDiversity: semanticDiversityValue,
    })
    timings.candidate_build = Date.now() - candidateStarted
    const pathStarted = Date.now()
    const path = sampleNarrativePath({ candidates, viewport, lod: lodDecision.lod, seed })
    timings.path_sample = Date.now() - pathStarted
    const factsStarted = Date.now()
    const responseRegions = candidates.map((region) => ({ ...region, narrative_facts: buildRegionFacts({ region, scene }) }))
    const selectedRegions = resolveSelectedRegions(responseRegions, path.nodes.map((node) => node.region_id))
    const responseStoryTags = path.storyTags.length > 0 ? path.storyTags : inferPathStoryTags(selectedRegions)
    timings.fact_grounding = Date.now() - factsStarted
    const webFactStarted = Date.now()
    const chapterBuild = await attachWebSources({
      chapters: buildNarrationChapters({ regions: selectedRegions, tone, scene, lod: lodDecision.lod, strategy: path.strategy, pathNodes: path.nodes, userContext }),
      regions: selectedRegions,
      searchWebFacts: this.options.searchWebFacts,
      webFactCache: this.webFactCache,
      mode,
    })
    timings.web_fact_attach = Date.now() - webFactStarted
    const llmStarted = Date.now()
    const graphNarration = await buildGraphNarration({
      chapters: chapterBuild.chapters,
      regions: selectedRegions,
      path,
      scene,
      tone,
      userContext,
      llmProvider: this.options.llmProvider,
      enabled: mode === 'sync' && resolveNarrativeLlmEnabled(),
    })
    timings.llm_narration = Date.now() - llmStarted
    const chapters = mergeWebFactsIntoFinalChapters({
      chapters: graphNarration.chapters,
      groundedChapters: chapterBuild.chapters,
      regions: selectedRegions,
    })
    const webNameStarted = Date.now()
    const webNameCandidates = debugEnabled && mode === 'sync'
      ? await probeWebNameCandidates({
        viewport,
        scene,
        candidates,
        searchWebFacts: this.options.searchWebFacts,
      })
      : []
    timings.web_name_probe = Date.now() - webNameStarted
    const density = effectivePoiCount(renderablePois) / viewportAreaKm2(viewport)
    timings.total = Date.now() - buildStarted
    const pathLimit = path.lodPolicy.max_nodes
    const performance: NarrativeBuildPerformanceDebug = {
      timings_ms: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(1))])),
      budgets_ms: budgets,
      limits: {
        poi_limit: poiLimit,
        semantic_candidate_limit: semanticCandidateLimit,
        candidate_limit: 24,
        path_limit: pathLimit,
      },
      semantic_recall: semanticDebug,
      warnings,
    }

    const response: NarrativeResponse = {
      session_id: sessionId,
      state_version: 1,
      scene_profile: scene,
      lod: lodDecision.lod,
      viewport,
      dominant_coverage: Number(dominantCoverage.toFixed(4)),
      candidate_count: candidates.length,
      poi_density: Number(density.toFixed(1)),
      semantic_diversity: semanticDiversityValue,
      story_tags: responseStoryTags,
      regions: responseRegions,
      path: {
        nodes: path.nodes,
        seed,
        alternatives_count: path.alternativesCount,
        strategy: path.strategy,
        story_tags: responseStoryTags,
      },
      narration: {
        chapters,
        tone,
      },
      user_context: userContext,
      enrichment: buildEnrichmentSummary({
        mode,
        status: resolveWebFactEnrichmentStatus(mode, chapterBuild.debug),
        phase: mode === 'sync' ? 'enriched' : 'initial',
        totalRegionCount: chapters.length,
        webFactDebug: chapterBuild.debug,
      }),
    }
    if (debugEnabled) {
      response.debug = buildDebugSnapshot({
        featuresCount: features.length,
        pois,
        renderablePois,
        aois,
        builtCandidates,
        candidates,
        fallbackUsed,
        lodDecision,
        path,
        selectedRegions,
        webFactDebug: chapterBuild.debug,
        webNameCandidates,
        llmNarratorDebug: graphNarration.debug,
        performance,
      })
    }
    return response
  }

  private createEnrichmentJob(response: NarrativeResponse): NarrativeEnrichmentJob {
    const now = new Date().toISOString()
    const jobId = randomUUID()
    const summary: NarrativeEnrichmentSummary = {
      ...(response.enrichment || {
        mode: 'async',
        status: 'pending',
        phase: 'initial',
        total_region_count: response.narration.chapters.length,
        completed_region_count: 0,
        cached_region_count: 0,
        source_count: 0,
      }),
      job_id: jobId,
      mode: 'async',
      status: 'pending',
      phase: 'initial',
      started_at: now,
      updated_at: now,
    }
    const job: NarrativeEnrichmentJob = {
      job_id: jobId,
      status: 'pending',
      summary,
    }
    this.enrichmentJobs.set(jobId, job)
    return job
  }

  private runEnrichmentJob(jobId: string, input: NarrativeRequest) {
    const job = this.enrichmentJobs.get(jobId)
    if (!job) return
    const startedAt = job.summary.started_at || new Date().toISOString()
    job.status = 'running'
    job.summary = {
      ...job.summary,
      status: 'running',
      updated_at: new Date().toISOString(),
    }
    this.enrichmentJobs.set(jobId, job)
    void this.buildOnce({ ...input, enrichment_mode: 'sync' }, 'sync')
      .then((response) => {
        const completedAt = new Date().toISOString()
        const nextStatus = response.enrichment?.status === 'failed' ? 'failed' : 'completed'
        response.enrichment = {
          ...(response.enrichment || {
            mode: 'async',
            status: nextStatus,
            phase: 'enriched',
            total_region_count: response.narration.chapters.length,
            completed_region_count: 0,
            cached_region_count: 0,
            source_count: 0,
          }),
          job_id: jobId,
          mode: 'async',
          status: nextStatus,
          phase: 'enriched',
          started_at: startedAt,
          updated_at: completedAt,
          completed_at: completedAt,
        }
        this.enrichmentJobs.set(jobId, {
          job_id: jobId,
          status: nextStatus,
          summary: response.enrichment,
          response: nextStatus === 'completed' ? response : undefined,
          error: nextStatus === 'failed' ? response.enrichment.error : undefined,
        })
      })
      .catch((error) => {
        const updatedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : String(error)
        this.enrichmentJobs.set(jobId, {
          job_id: jobId,
          status: 'failed',
          summary: {
            ...job.summary,
            status: 'failed',
            error: message,
            updated_at: updatedAt,
            completed_at: updatedAt,
          },
          error: message,
        })
      })
  }
}
