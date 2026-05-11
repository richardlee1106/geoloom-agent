import { randomUUID } from 'node:crypto'

import type { LLMProvider } from '../llm/types.js'
import type { SpatialFeature, SpatialFetchRequest } from '../spatial/fetchSpatialFeatures.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import { attachCompanionCuesToChapters, buildNarrativeCompanionCues, type NarrativeCompanionCuesDebug } from './companionCues.js'
import type {
  NarrativeChapter,
  NarrativeEnrichmentJob,
  NarrativeEnrichmentMode,
  NarrativeEnrichmentSummary,
  NarrativeExplorationControls,
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
import { buildGraphNarrationChapter, LlmNarratorError, type ChapterNarrationResult, type LlmNarratorDebug } from './llmNarrator.js'
import { classifyLod } from './lodPolicy.js'
import { NarrativeWebFactCache, type NarrativeWebFactCacheStatus } from './NarrativeWebFactCache.js'
import { focusSearchHints, resolveExplorationFocus, type ExplorationFocus } from './explorationFocus.js'
import { sampleNarrativePath, type PathSamplerResult } from './pathSampler.js'
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

type ChapterWebFactBuild = { chapters: NarrativeChapter[]; debug: WebFactDebugItem[] }

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
const WEB_INTRO_FORBIDDEN_RE = /(广告|优惠|团购|预订|招商|加盟|联系电话|热线|小红书|大众点评|携程|马蜂窝|去哪儿|营销中心|售楼处|开盘|开业三日|盛大开业|盛大开放|客流累计|零售额|销售额|引爆|脱口秀|抽奖|招聘|加盟|扫码|小程序|优惠券|户型|置业|楼盘|返现|特价|秒杀|直播)/iu
const WEB_NAME_CANDIDATE_RE = /([\u4e00-\u9fa5A-Za-z0-9·]{2,18}(?:步行街|商业街|美食街|夜市|商圈|街区|汉街|天地|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|购物中心|购物广场|商业广场|K11|SKP|路|街|大道|巷))/giu
const WEB_FACT_SEARCHER_UNAVAILABLE_ERROR = 'web_fact_searcher_unavailable: 未配置 DEEPSEEK_SEARCH_* / NEWAPI_SEARCH_* 搜索端点'
const ENRICHMENT_JOB_CANCELLED_ERROR = 'narrative_enrichment_cancelled'
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

function resolveProgressiveLlmChapterTimeoutMs(index: number): number {
  const fallback = index === 0 ? 12000 : 16000
  return resolveBoundedInteger(process.env.NARRATIVE_PROGRESSIVE_LLM_CHAPTER_TIMEOUT_MS, fallback, 1000, 45000)
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
  controls?: NarrativeExplorationControls
}): string {
  const lodHint = input.viewport.zoom >= 15 ? '街巷 POI 过早 夜市 门店' : input.viewport.zoom >= 12 ? '片区 商圈 街区 公园 高校' : '城市结构 大片区 江湖 商圈 生态'
  const toneHint = input.tone === 'humanity' ? '历史 老街 生活气息 本地人' : input.tone === 'science' ? '空间结构 功能分区 人流热度' : '游览 地标 文旅 消费'
  return `武汉 ${lodHint} ${toneHint} ${explorationSemanticHint(input.controls)} ${input.userContext.preference_label} ${input.userContext.time_label}`
}

function explorationSemanticHint(controls?: NarrativeExplorationControls): string {
  if (!controls) return ''
  return [
    controls.scope_query ? `${controls.scope_query} 周边 片区 POI` : '',
    controls.theme ? `主题 ${controls.theme}` : '',
    controls.granularity === 'district' ? '商圈 街区 抽象区域' : '',
    controls.granularity === 'aoi' ? '真实 AOI 边界 公园 高校 商业街' : '',
    controls.granularity === 'poi_cluster' ? '近景 点簇 门店 设施 街巷' : '',
    controls.localness === 'local' ? '本地生活 街巷 夜市 口头高频片区' : '',
    controls.localness === 'tourist' ? '游客友好 地标 景区 步行街' : '',
  ].filter(Boolean).join(' ')
}

function describeRuntimeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withBudget<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), Math.max(1, timeoutMs))
    timer.unref?.()
    promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function isBudgetTimeoutMessage(error: string): boolean {
  return /_timeout$/iu.test(error)
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

function resolveExplorationControls(value: unknown): NarrativeExplorationControls {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const relevanceThreshold = readFiniteNumber(raw.relevance_threshold)
  const candidateCount = readFiniteNumber(raw.candidate_count)
  return {
    theme: isExplorationTheme(raw.theme) ? raw.theme : undefined,
    granularity: isGranularity(raw.granularity) ? raw.granularity : undefined,
    evidence_strictness: isEvidenceStrictness(raw.evidence_strictness) ? raw.evidence_strictness : undefined,
    relevance_threshold: relevanceThreshold === null ? undefined : Math.max(0, Math.min(relevanceThreshold, 1)),
    diversity: isDiversity(raw.diversity) ? raw.diversity : undefined,
    localness: isLocalness(raw.localness) ? raw.localness : undefined,
    duration_preset: isDurationPreset(raw.duration_preset) ? raw.duration_preset : undefined,
    candidate_count: candidateCount === null ? undefined : Math.max(3, Math.min(Math.trunc(candidateCount), 12)),
    scope_query: typeof raw.scope_query === 'string' ? raw.scope_query.trim().slice(0, 80) || undefined : undefined,
    centroid_strategy: isCentroidStrategy(raw.centroid_strategy) ? raw.centroid_strategy : undefined,
  }
}

function isExplorationTheme(value: unknown): value is NonNullable<NarrativeExplorationControls['theme']> {
  return value === 'comprehensive' || value === 'commerce' || value === 'nightlife' || value === 'memory' || value === 'family' || value === 'education' || value === 'commute' || value === 'tourism'
}

function isGranularity(value: unknown): value is NonNullable<NarrativeExplorationControls['granularity']> {
  return value === 'auto' || value === 'district' || value === 'aoi' || value === 'poi_cluster'
}

function isEvidenceStrictness(value: unknown): value is NonNullable<NarrativeExplorationControls['evidence_strictness']> {
  return value === 'strict' || value === 'balanced' || value === 'loose'
}

function isDiversity(value: unknown): value is NonNullable<NarrativeExplorationControls['diversity']> {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isLocalness(value: unknown): value is NonNullable<NarrativeExplorationControls['localness']> {
  return value === 'tourist' || value === 'balanced' || value === 'local'
}

function isDurationPreset(value: unknown): value is NonNullable<NarrativeExplorationControls['duration_preset']> {
  return value === 'casual' || value === 'standard' || value === 'detailed'
}

function isCentroidStrategy(value: unknown): value is NonNullable<NarrativeExplorationControls['centroid_strategy']> {
  return value === 'auto' || value === 'region_first' || value === 'poi_first'
}

function hasExplicitExplorationPreference(userContext: UserContext, controls?: NarrativeExplorationControls): boolean {
  if (controls && Object.values(controls).some((value) => value !== undefined && value !== '')) return true
  const label = userContext.preference_label.trim()
  return Boolean(label) && label !== DEFAULT_USER_CONTEXT.preference_label
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
  const cleaned = String(value || '')
    .replace(/\[\d+\]\((?:https?:\/\/|www\.)[^\s。！？）)]*\)?/giu, '')
    .replace(/\[([^\]]{1,40})\]\((?:https?:\/\/|www\.)[^\s。！？）)]*\)?/giu, '$1')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/www\.\S+/giu, '')
    .replace(/(?:\[\d+\]|【\d+】|（\d+）|\(\d+\))/gu, '')
    .replace(/[*_`~#>]/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[，,、；;：:]*[…]+.*$/u, '')
    .replace(/\s+/gu, ' ')
    .replace(/^详细介绍了?/u, '')
    .replace(/^[\s"'“”‘’：:，,。；;]+|[\s"'“”‘’]+$/gu, '')
    .trim()
  if (!cleaned || cleaned.length < 8 || WEB_INTRO_FORBIDDEN_RE.test(cleaned)) return ''
  const clipped = clipWebIntroSnippet(cleaned, 96)
  if (!clipped || clipped.length < 8 || WEB_INTRO_FORBIDDEN_RE.test(clipped)) return ''
  return /[。！？]$/u.test(clipped) ? clipped : `${clipped}。`
}

function clipWebIntroSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const window = text.slice(0, maxLength)
  const sentenceEnd = Math.max(window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'))
  if (sentenceEnd >= 20) return window.slice(0, sentenceEnd + 1)
  const softEnd = Math.max(window.lastIndexOf('，'), window.lastIndexOf('；'), window.lastIndexOf('、'))
  if (softEnd >= 24) return window.slice(0, softEnd)
  return window.replace(/[，,、；;：:\s]+$/u, '')
}

function describeWebFactError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error || 'unknown_error')
}

function buildWebIntroSentence(sources: NarrativeWebSource[], regionName: string): string {
  const source = sources.find((item) => isWebIntroSourceRelevant(item, regionName))
    || sources.find((item) => isFallbackWebIntroSourceUsable(item, regionName))
  if (!source) return ''
  const snippet = normalizeWebIntroSnippet(source.snippet)
  if (!snippet) return ''
  return `${webIntroPrefix(snippet, regionName)}${snippet}`
}

function webIntroPrefix(snippet: string, regionName: string): string {
  const historicalPrefixes = ['顺带讲个来历，', '这块有个来头，', '老武汉聊到这儿会提一句，']
  const generalPrefixes = ['顺带补一句，', '这块还有个细节，', '说到这里可以带一嘴，']
  const prefixes = /(前身|原来|以前|历史|始于|源于|起源|建于|通车|改造)/u.test(snippet) ? historicalPrefixes : generalPrefixes
  return prefixes[stableTextIndex(`${regionName}:${snippet}`, prefixes.length)]
}

function stableTextIndex(text: string, modulo: number): number {
  if (modulo <= 1) return 0
  let hash = 0
  for (const char of text) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  }
  return hash % modulo
}

function attachIntroToChapterText(text: string, sources: NarrativeWebSource[], regionName: string): string {
  const intro = buildWebIntroSentence(sources, regionName)
  if (!intro || text.includes(intro)) return text
  const insertAt = firstSentenceEndIndex(text)
  if (insertAt <= 0 || insertAt >= text.length) return `${text}${intro}`
  return `${text.slice(0, insertAt)}${intro}${text.slice(insertAt)}`
}

function firstSentenceEndIndex(text: string): number {
  const match = String(text || '').match(/[。！？]/u)
  return match?.index === undefined ? -1 : match.index + match[0].length
}

function webFactQueryRegionName(regionName: string): string {
  return String(regionName || '').replace(/[（(](视野内片区|A区|B区|C区|D区|东区|西区|南区|北区|琴园|歌笛湖)[）)]/gu, '').trim() || regionName
}

function webFactQueriesForRegion(regionName: string, region: RegionCandidate | undefined, focus: ExplorationFocus, useFocusSearch: boolean): string[] {
  const name = webFactQueryRegionName(regionName)
  const storyHint = region?.story_tags?.some((tag) => tag === 'heritage' || tag === 'culture') ? '历史文化' : region?.story_tags?.some((tag) => tag === 'commerce' || tag === 'food' || tag === 'nightlife') ? '商业生活' : ''
  const focusHints = useFocusSearch ? focusSearchHints(focus) : []
  return [...new Set([
    focusHints[0] ? `${name} 武汉 ${focusHints[0]}` : '',
    focusHints[1] ? `${name} ${focusHints[1]}` : '',
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
    const region = regionById.get(chapter.region_id)
    // 失败章节保留 text='' 与 generation_error，不再注入 web intro，避免用 grounded snippet 假装 LLM 已经生成。
    if (chapter.generation_error) {
      return { ...chapter, story_tags: chapter.story_tags || region?.story_tags }
    }
    const grounded = groundedByRegionId.get(chapter.region_id)
    const sources = grounded?.web_sources || chapter.web_sources
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
  companionCuesDebug?: NarrativeCompanionCuesDebug
  performance: NarrativeBuildPerformanceDebug
  explorationControls: NarrativeExplorationControls
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
    exploration_controls: input.explorationControls,
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
        business_profile: candidate.business_profile ? {
          summary_hint: candidate.business_profile.summary_hint,
          confidence: candidate.business_profile.confidence,
          sample_size: candidate.business_profile.sample_size,
          dominant_main_types: candidate.business_profile.dominant_main_types,
          dominant_sub_types: candidate.business_profile.dominant_sub_types,
        } : null,
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
    companion_cues: input.companionCuesDebug,
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
  focus: ExplorationFocus
  useFocusSearch: boolean
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
    const queries = webFactQueriesForRegion(region?.display_name || chapter.region_id, region, input.focus, input.useFocusSearch)
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

function effectiveLodForExploration(lod: ReturnType<typeof classifyLod>['lod'], controls: NarrativeExplorationControls): ReturnType<typeof classifyLod>['lod'] {
  if (controls.granularity === 'district' || controls.granularity === 'aoi') return 'meso'
  if (controls.granularity === 'poi_cluster') return 'micro'
  return lod
}

function explorationScoreBonus(candidate: RegionCandidate, controls: NarrativeExplorationControls, focus: ExplorationFocus): number {
  let bonus = 0
  const text = `${candidate.display_name} ${candidate.pois.map((poi) => `${poi.display_name} ${poi.category_main || ''} ${poi.category_sub || ''}`).join(' ')} ${(candidate.story_tags || []).join(' ')}`
  if (controls.scope_query && text.includes(controls.scope_query)) bonus += 1.2
  if (controls.granularity === 'aoi' && candidate.source === 'aoi') bonus += 0.18
  if (controls.granularity === 'district' && candidate.source === 'abstract_region') bonus += 0.2
  if (controls.granularity === 'poi_cluster' && candidate.coverage <= 0.08) bonus += 0.16
  if (controls.evidence_strictness === 'strict') bonus += Math.min(0.18, candidate.effectivePoiCount * 0.018)
  if (controls.evidence_strictness === 'loose' && candidate.effectivePoiCount >= 2) bonus += 0.06
  if (controls.localness === 'local' && (candidate.source === 'abstract_region' || /(夜市|粮道街|水塔街|万松园|吉庆街|保成路|山海关路|台北路|胜利街|market|nightlife|food|urban_life)/u.test(text))) bonus += 0.16
  if (controls.localness === 'tourist' && /(景区|公园|博物馆|纪念馆|地标|步行街|风景名胜|tourism|landmark)/u.test(text)) bonus += 0.12
  bonus += regionFocusBonus(candidate, focus, controls.theme)
  return bonus
}

function regionFocusBonus(candidate: RegionCandidate, focus: ExplorationFocus, theme: NarrativeExplorationControls['theme']): number {
  if (!theme || theme === 'comprehensive') return 0
  return regionExplorationFocusScoreForRuntime(candidate, focus) * 0.42
}

function regionExplorationFocusScoreForRuntime(candidate: RegionCandidate, focus: ExplorationFocus): number {
  if (focus === 'comprehensive') return 0
  const text = `${candidate.display_name} ${(candidate.story_tags || []).join(' ')} ${candidate.pois.map((poi) => `${poi.display_name} ${poi.category_main || ''}`).join(' ')}`
  if (focus === 'commerce') return /(购物|商业|商圈|商场|广场|餐饮|commerce|food)/u.test(text) ? 1 : 0
  if (focus === 'nightlife') return /(夜市|酒吧|餐饮|小吃|晚间|nightlife|food|market)/u.test(text) ? 1 : 0
  if (focus === 'memory') return /(历史|文化|老街|博物馆|纪念|heritage|culture)/u.test(text) ? 1 : 0
  if (focus === 'family') return /(公园|绿地|儿童|游乐|亲子|ecology|leisure)/u.test(text) ? 1 : 0
  if (focus === 'education') return /(大学|学院|学校|书店|图书|education|campus)/u.test(text) ? 1 : 0
  if (focus === 'commute') return /(地铁|公交|车站|交通|换乘|transit)/u.test(text) ? 1 : 0
  return /(景区|地标|步行街|江滩|博物馆|tourism|landmark)/u.test(text) ? 1 : 0
}

function minimumEvidenceForExploration(controls: NarrativeExplorationControls): number {
  if (controls.evidence_strictness === 'strict' || (controls.relevance_threshold ?? 0) >= 0.5) return 4
  if (controls.evidence_strictness === 'loose' || (controls.relevance_threshold ?? 1) <= 0.18) return 2
  return 3
}

function applyExplorationCandidatePolicy(candidates: RegionCandidate[], controls: NarrativeExplorationControls, focus: ExplorationFocus): RegionCandidate[] {
  if (!hasExplorationControls(controls)) return candidates
  const minEvidence = minimumEvidenceForExploration(controls)
  const filtered = candidates.filter((candidate) => candidate.effectivePoiCount >= minEvidence || (controls.scope_query && `${candidate.display_name} ${candidate.pois.map((poi) => poi.display_name).join(' ')}`.includes(controls.scope_query)))
  const source = filtered.length > 0 ? filtered : candidates
  return [...source].sort((left, right) =>
    right.score + explorationScoreBonus(right, controls, focus)
    - (left.score + explorationScoreBonus(left, controls, focus))
    || right.effectivePoiCount - left.effectivePoiCount)
}

function hasExplorationControls(controls: NarrativeExplorationControls): boolean {
  return Object.values(controls).some((value) => value !== undefined && value !== '')
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
  const errors = [...new Set(items
    .map((item) => item.error)
    .filter((error): error is string => typeof error === 'string' && error.length > 0 && !isBudgetTimeoutMessage(error)))]
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
  private readonly latestEnrichmentJobBySession = new Map<string, string>()

  constructor(private readonly options: NarrativePhase3RuntimeOptions) {
    this.webFactCache = options.webFactCache || new NarrativeWebFactCache()
  }

  async build(input: NarrativeRequest): Promise<NarrativeResponse> {
    const mode = resolveEnrichmentMode(input.enrichment_mode)
    if (mode === 'async') {
      const initialResponse = await this.buildOnce({ ...input, enrichment_mode: 'cache_only' }, 'cache_only')
      const job = this.createEnrichmentJob(initialResponse)
      this.cancelPreviousSessionEnrichmentJob(initialResponse.session_id, job.job_id)
      this.latestEnrichmentJobBySession.set(initialResponse.session_id, job.job_id)
      this.pruneEnrichmentJobs()
      initialResponse.enrichment = job.summary
      this.runEnrichmentJob(job.job_id, { ...input, session_id: initialResponse.session_id })
      return initialResponse
    }
    return this.buildOnce(input, mode)
  }

  getEnrichmentJob(jobId: string): NarrativeEnrichmentJob | undefined {
    return this.enrichmentJobs.get(jobId)
  }

  private cancelPreviousSessionEnrichmentJob(sessionId: string, nextJobId: string) {
    const previousJobId = this.latestEnrichmentJobBySession.get(sessionId)
    if (!previousJobId || previousJobId === nextJobId) return
    this.cancelEnrichmentJob(previousJobId, ENRICHMENT_JOB_CANCELLED_ERROR)
  }

  private cancelEnrichmentJob(jobId: string, reason: string) {
    const current = this.enrichmentJobs.get(jobId)
    if (!current || current.status === 'completed' || current.status === 'failed') return
    const updatedAt = new Date().toISOString()
    this.enrichmentJobs.set(jobId, {
      ...current,
      status: 'failed',
      summary: {
        ...current.summary,
        status: 'failed',
        error: reason,
        updated_at: updatedAt,
        completed_at: updatedAt,
      },
      response: current.response ? {
        ...current.response,
        enrichment: {
          ...(current.response.enrichment || current.summary),
          status: 'failed',
          error: reason,
          updated_at: updatedAt,
          completed_at: updatedAt,
        },
      } : current.response,
      error: reason,
    })
  }

  private isEnrichmentJobActive(jobId: string): boolean {
    const current = this.enrichmentJobs.get(jobId)
    return Boolean(current && current.status !== 'failed' && current.status !== 'completed')
  }

  private pruneEnrichmentJobs() {
    const maxJobs = resolveBoundedInteger(process.env.NARRATIVE_ENRICHMENT_JOB_CACHE_LIMIT, 32, 4, 256)
    const overflow = this.enrichmentJobs.size - maxJobs
    if (overflow <= 0) return
    const entries = [...this.enrichmentJobs.entries()]
    const removable = entries.filter(([, job]) => job.status === 'completed' || job.status === 'failed')
    for (const [jobId, job] of removable.slice(0, overflow)) {
      this.enrichmentJobs.delete(jobId)
      if (job.response?.session_id && this.latestEnrichmentJobBySession.get(job.response.session_id) === jobId) {
        this.latestEnrichmentJobBySession.delete(job.response.session_id)
      }
    }
  }

  private async buildOnce(input: NarrativeRequest, mode: NarrativeEnrichmentMode): Promise<NarrativeResponse> {
    const buildStarted = Date.now()
    const timings: Record<string, number> = {}
    const warnings: string[] = []
    const viewport = normalizeViewport(input.viewport)
    const tone = resolveTone(input.tone)
    const userContext = mergeUserContext(input.user_context)
    const explorationControls = resolveExplorationControls(input.exploration)
    const activeExplorationControls = hasExplorationControls(explorationControls) ? explorationControls : undefined
    const focus = resolveExplorationFocus(userContext, tone, explorationControls)
    const useFocusSearch = hasExplicitExplorationPreference(userContext, explorationControls)
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
    const semanticQuery = buildNarrativeSemanticQuery({ tone, userContext, viewport, controls: explorationControls })
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
    const rankedCandidates = applyExplorationCandidatePolicy(builtCandidates, explorationControls, focus)
    const fallbackUsed = rankedCandidates.length === 0
    const fallbackCandidate = fallbackUsed ? buildFallbackRegion({ viewport, pois, scene }) : null
    const candidates = fallbackCandidate ? [fallbackCandidate].filter(isRegionCandidateNarratable) : rankedCandidates
    const dominantCoverage = Math.max(...candidates.map((candidate) => candidate.coverage), 0)
    const semanticDiversityValue = semanticDiversity(renderablePois)
    const rawLodDecision = classifyLod({
      dominantCoverage,
      candidateCount: candidates.length,
      semanticDiversity: semanticDiversityValue,
    })
    const lodDecision = { ...rawLodDecision, lod: effectiveLodForExploration(rawLodDecision.lod, explorationControls) }
    timings.candidate_build = Date.now() - candidateStarted
    const pathStarted = Date.now()
    const path = sampleNarrativePath({ candidates, viewport, lod: lodDecision.lod, seed, focus: useFocusSearch ? focus : 'comprehensive', controls: activeExplorationControls })
    timings.path_sample = Date.now() - pathStarted
    const factsStarted = Date.now()
    const responseRegions = candidates.map((region) => ({ ...region, narrative_facts: buildRegionFacts({ region, scene }) }))
    const selectedRegions = resolveSelectedRegions(responseRegions, path.nodes.map((node) => node.region_id))
    const responseStoryTags = path.storyTags.length > 0 ? path.storyTags : inferPathStoryTags(selectedRegions)
    timings.fact_grounding = Date.now() - factsStarted
    const webFactStarted = Date.now()
    const scaffolds = buildNarrationChapters({ regions: selectedRegions, tone, scene, lod: lodDecision.lod, strategy: path.strategy, pathNodes: path.nodes, viewport, userContext, controls: activeExplorationControls })
    const chapterBuild = await attachWebSources({
      chapters: scaffolds,
      regions: selectedRegions,
      searchWebFacts: this.options.searchWebFacts,
      webFactCache: this.webFactCache,
      mode,
      focus,
      useFocusSearch,
    })
    timings.web_fact_attach = Date.now() - webFactStarted
    const llmEnabled = mode === 'sync' && resolveNarrativeLlmEnabled()
    const llmStarted = Date.now()
    let llmNarratorDebug: LlmNarratorDebug = {
      used: false,
      provider: this.options.llmProvider?.getStatus(),
    }
    let generatedChapters: NarrativeChapter[] = chapterBuild.chapters
    if (llmEnabled) {
      const settled = await Promise.allSettled(chapterBuild.chapters.map((scaffold) =>
        buildGraphNarrationChapter({
          chapter: scaffold,
          allChapters: chapterBuild.chapters,
          regions: selectedRegions,
          path,
          scene,
          tone,
          userContext,
          llmProvider: this.options.llmProvider,
          enabled: true,
        })))
      const errorMessages: string[] = []
      let lastSuccessDebug: LlmNarratorDebug | undefined
      generatedChapters = settled.map((result, index) => {
        const scaffold = chapterBuild.chapters[index]
        if (result.status === 'fulfilled') {
          lastSuccessDebug = result.value.debug
          return result.value.chapter
        }
        const reason = result.reason
        const message = reason instanceof Error ? reason.message : String(reason)
        const errorCode = reason instanceof LlmNarratorError ? reason.code : undefined
        errorMessages.push(`${scaffold.region_id}: ${message}`)
        return { ...scaffold, generation_error: errorCode ? `${errorCode}: ${message}` : message }
      })
      if (lastSuccessDebug) {
        llmNarratorDebug = { ...lastSuccessDebug }
        if (errorMessages.length > 0) llmNarratorDebug.error = errorMessages.join(' | ')
      } else if (errorMessages.length > 0) {
        const firstFailure = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
        const firstReason = firstFailure?.reason
        llmNarratorDebug = {
          used: false,
          provider: this.options.llmProvider?.getStatus(),
          error: errorMessages.join(' | '),
          error_code: firstReason instanceof LlmNarratorError ? firstReason.code : 'request_failed',
        }
      }
    }
    timings.llm_narration = Date.now() - llmStarted
    let chapters = mergeWebFactsIntoFinalChapters({
      chapters: generatedChapters,
      groundedChapters: chapterBuild.chapters,
      regions: selectedRegions,
    })
    let companionCuesDebug: NarrativeCompanionCuesDebug = {
      used: false,
      provider: this.options.llmProvider?.getStatus(),
    }
    const companionCueStarted = Date.now()
    if (mode === 'sync') {
      const companionCueBuild = await attachCompanionCuesToChapters({
        chapters,
        regions: selectedRegions,
        llmProvider: this.options.llmProvider,
        enabled: resolveNarrativeLlmEnabled(),
      })
      chapters = companionCueBuild.chapters
      companionCuesDebug = companionCueBuild.debug
      timings.companion_cues = Date.now() - companionCueStarted
    }
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
        relations: path.relations,
        lod_policy: path.lodPolicy,
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
        llmNarratorDebug,
        companionCuesDebug,
        performance,
        explorationControls,
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
      completed_region_count: 0,
      cached_region_count: 0,
      source_count: 0,
      error: undefined,
      started_at: now,
      updated_at: now,
    }
    const job: NarrativeEnrichmentJob = {
      job_id: jobId,
      status: 'pending',
      summary,
      response: { ...response, enrichment: summary },
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
    void this.runProgressiveEnrichmentJob(jobId, input, startedAt).catch((error) => {
      if (!this.isEnrichmentJobActive(jobId)) return
      const updatedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      const current = this.enrichmentJobs.get(jobId)
      this.enrichmentJobs.set(jobId, {
        job_id: jobId,
        status: 'failed',
        summary: {
          ...(current?.summary || job.summary),
          status: 'failed',
          error: message,
          updated_at: updatedAt,
          completed_at: updatedAt,
        },
        response: current?.response,
        error: message,
      })
    })
  }

  private async runProgressiveEnrichmentJob(jobId: string, input: NarrativeRequest, startedAt: string) {
    const currentJob = this.enrichmentJobs.get(jobId)
    if (!currentJob) return
    const missingProgressiveNarrator = !this.options.searchWebFacts && !this.options.llmProvider?.isReady()
    if (missingProgressiveNarrator) {
      if (!this.isEnrichmentJobActive(jobId)) return
      const updatedAt = new Date().toISOString()
      this.enrichmentJobs.set(jobId, {
        job_id: jobId,
        status: 'failed',
        summary: {
          ...currentJob.summary,
          status: 'failed',
          phase: 'enriched',
          source_count: 0,
          error: WEB_FACT_SEARCHER_UNAVAILABLE_ERROR,
          updated_at: updatedAt,
          completed_at: updatedAt,
        },
        error: WEB_FACT_SEARCHER_UNAVAILABLE_ERROR,
      })
      return
    }
    const seedResponse = currentJob.response || await this.buildOnce({ ...input, enrichment_mode: 'cache_only' }, 'cache_only')
    const selectedRegions = resolveSelectedRegions(seedResponse.regions as RegionCandidate[], seedResponse.path.nodes.map((node) => node.region_id))
    const chapters = seedResponse.narration.chapters.map((chapter) => ({ ...chapter }))
    const path = this.pathFromResponse(seedResponse)
    const explorationControls = resolveExplorationControls(input.exploration)
    const focus = resolveExplorationFocus(seedResponse.user_context, seedResponse.narration.tone, explorationControls)
    const useFocusSearch = hasExplicitExplorationPreference(seedResponse.user_context, explorationControls)
    const webFactDebug: WebFactDebugItem[] = []
    const upsertWebFactDebug = (items: WebFactDebugItem[]) => {
      for (const item of items) {
        const debugKey = item.query === 'llm_narration' ? `${item.region_id}:llm_narration` : `${item.region_id}:web_fact`
        const existingIndex = webFactDebug.findIndex((debugItem) => {
          const existingKey = debugItem.query === 'llm_narration' ? `${debugItem.region_id}:llm_narration` : `${debugItem.region_id}:web_fact`
          return existingKey === debugKey
        })
        if (existingIndex >= 0) {
          webFactDebug[existingIndex] = item
        } else {
          webFactDebug.push(item)
        }
      }
    }
    const buildChapterWebFacts = async (index: number): Promise<ChapterWebFactBuild> => {
      const chapterWebFactStarted = Date.now()
      try {
        return await attachWebSources({
          chapters: [chapters[index]],
          regions: selectedRegions,
          searchWebFacts: this.options.searchWebFacts,
          webFactCache: this.webFactCache,
          mode: 'sync',
          focus,
          useFocusSearch,
        })
      } catch (error) {
        return {
          chapters: [chapters[index]],
          debug: [{
            region_id: chapters[index].region_id,
            query: chapters[index].region_id,
            source_count: 0,
            latency_ms: Date.now() - chapterWebFactStarted,
            error: describeWebFactError(error),
          }],
        }
      }
    }
    let llmNarratorDebug: LlmNarratorDebug = {
      used: false,
      provider: this.options.llmProvider?.getStatus(),
    }
    let companionCuesDebug: NarrativeCompanionCuesDebug = {
      used: false,
      provider: this.options.llmProvider?.getStatus(),
      generated_count: 0,
    }
    if (!resolveNarrativeLlmEnabled()) {
      llmNarratorDebug = { ...llmNarratorDebug, error: 'LLM 解说已禁用', error_code: 'disabled' }
    } else if (!this.options.llmProvider?.isReady()) {
      llmNarratorDebug = { ...llmNarratorDebug, error: 'LLM provider 未就绪', error_code: 'provider_not_ready' }
    }

    const publish = (status: NarrativeEnrichmentSummary['status'], completedCount: number, completedAt?: string) => {
      if (!this.isEnrichmentJobActive(jobId)) return
      const updatedAt = new Date().toISOString()
      const sourceCount = sumWebFactSources(webFactDebug)
      const cachedRegionCount = countCachedWebFactRegions(webFactDebug)
      const summary: NarrativeEnrichmentSummary = {
        job_id: jobId,
        mode: 'async',
        status,
        phase: completedCount > 0 || sourceCount > 0 || cachedRegionCount > 0 || status === 'completed' ? 'enriched' : 'initial',
        total_region_count: chapters.length,
        completed_region_count: completedCount,
        cached_region_count: cachedRegionCount,
        source_count: sourceCount,
        error: summarizeWebFactErrors(webFactDebug),
        started_at: startedAt,
        updated_at: updatedAt,
        completed_at: completedAt,
      }
      const response: NarrativeResponse = {
        ...seedResponse,
        narration: { ...seedResponse.narration, chapters: chapters.map((chapter) => ({ ...chapter })) },
        enrichment: summary,
        debug: seedResponse.debug ? {
          ...seedResponse.debug,
          web_facts: {
            queried_region_count: webFactDebug.length,
            source_count: sumWebFactSources(webFactDebug),
            items: webFactDebug,
          },
          llm_narrator: llmNarratorDebug,
          companion_cues: companionCuesDebug,
        } : seedResponse.debug,
      }
      this.enrichmentJobs.set(jobId, {
        job_id: jobId,
        status,
        summary,
        response,
        error: status === 'failed' ? summary.error : undefined,
      })
    }

    publish('running', 0)
    const webFactTasks = chapters.map((_, index) => buildChapterWebFacts(index))
    let completedChapterCount = 0
    const publishWebFactUpdate = (index: number, chapterBuild: ChapterWebFactBuild) => {
      if (!this.isEnrichmentJobActive(jobId)) return
      upsertWebFactDebug(chapterBuild.debug)
      const groundedChapter = chapterBuild.chapters[0]
      if (groundedChapter?.web_sources?.length) {
        chapters[index] = mergeWebFactsIntoFinalChapters({
          chapters: [chapters[index]],
          groundedChapters: [groundedChapter],
          regions: selectedRegions,
        })[0] || chapters[index]
      }
      const current = this.enrichmentJobs.get(jobId)
      if (!current || current.status === 'failed' || current.status === 'completed') return
      publish('running', completedChapterCount)
    }
    webFactTasks.forEach((task, index) => {
      void task.then((chapterBuild) => {
        if (!this.isEnrichmentJobActive(jobId)) return
        publishWebFactUpdate(index, chapterBuild)
      })
    })
    const processChapter = async (index: number): Promise<void> => {
      if (!this.isEnrichmentJobActive(jobId)) return
      const chapterWebFactStarted = Date.now()
      const webFactTimeoutMs = index === 0
        ? resolveBoundedInteger(process.env.NARRATIVE_FIRST_CHAPTER_WEB_FACT_TIMEOUT_MS, 1200, 500, 15000)
        : resolveBoundedInteger(process.env.NARRATIVE_PROGRESSIVE_WEB_FACT_TIMEOUT_MS, 10000, 1000, 30000)
      let chapterBuild: ChapterWebFactBuild
      try {
        chapterBuild = await withBudget(webFactTasks[index], webFactTimeoutMs, `progressive_web_fact_${index}`)
      } catch (error) {
        chapterBuild = {
          chapters: [chapters[index]],
          debug: [{
            region_id: chapters[index].region_id,
            query: chapters[index].region_id,
            source_count: 0,
            latency_ms: Date.now() - chapterWebFactStarted,
            error: describeWebFactError(error),
          }],
        }
      }
      if (!this.isEnrichmentJobActive(jobId)) return
      publishWebFactUpdate(index, chapterBuild)
      const groundedChapter = chapterBuild.chapters[0] || chapters[index]
      const contextChapters = chapters.map((chapter, chapterIndex) => chapterIndex === index ? groundedChapter : chapter)
      if (!this.isEnrichmentJobActive(jobId)) return
      const llmStarted = Date.now()
      try {
        const result = await withBudget(buildGraphNarrationChapter({
          chapter: groundedChapter,
          allChapters: contextChapters,
          regions: selectedRegions,
          path,
          scene: seedResponse.scene_profile,
          tone: seedResponse.narration.tone,
          userContext: seedResponse.user_context,
          llmProvider: this.options.llmProvider,
          enabled: resolveNarrativeLlmEnabled(),
        }), resolveProgressiveLlmChapterTimeoutMs(index), `progressive_llm_chapter_${index}`)
        if (!this.isEnrichmentJobActive(jobId)) return
        llmNarratorDebug = result.debug
        chapters[index] = mergeWebFactsIntoFinalChapters({
          chapters: [result.chapter],
          groundedChapters: [groundedChapter],
          regions: selectedRegions,
        })[0] || result.chapter
        const cueResult = await buildNarrativeCompanionCues({
          chapter: chapters[index],
          region: selectedRegions.find((region) => region.id === chapters[index].region_id),
          llmProvider: this.options.llmProvider,
          enabled: resolveNarrativeLlmEnabled(),
        })
        chapters[index] = { ...chapters[index], companion_cues: cueResult.cues }
        companionCuesDebug = {
          used: companionCuesDebug.used || cueResult.debug.used,
          provider: cueResult.debug.provider || companionCuesDebug.provider,
          latency_ms: (companionCuesDebug.latency_ms ?? 0) + (cueResult.debug.latency_ms ?? 0),
          generated_count: (companionCuesDebug.generated_count ?? 0) + cueResult.cues.length,
          error: [companionCuesDebug.error, cueResult.debug.error].filter(Boolean).join(' | ') || undefined,
        }
        completedChapterCount += 1
      } catch (error) {
        if (!this.isEnrichmentJobActive(jobId)) return
        const message = error instanceof Error ? error.message : String(error)
        const errorCode = error instanceof LlmNarratorError ? error.code : undefined
        // 该章 LLM 失败：保留 text=''，把错误显式记入 chapter.generation_error 和 llmNarratorDebug。
        // 不再用 grounded 模板章节兜底，避免误导用户认为 LLM 生成成功。
        llmNarratorDebug = {
          used: false,
          provider: this.options.llmProvider?.getStatus(),
          error: message,
          error_code: errorCode || 'request_failed',
          fallback_reason: error instanceof LlmNarratorError ? 'invalid_llm_output' : 'llm_error',
          latency_ms: Date.now() - llmStarted,
        }
        chapters[index] = {
          ...chapters[index],
          text: '',
          web_sources: groundedChapter.web_sources || chapters[index].web_sources,
          generation_error: errorCode ? `${errorCode}: ${message}` : message,
        }
      }
      publish('running', completedChapterCount)
    }
    // 关键并发改造：原 for 循环串行 await 每章 LLM，导致第二章等第一章完才开始；
    // 现改成 Promise.allSettled 并发处理所有章节，第一章先到时其它章节早已并行写入，
    // 用户读首章的时间正好覆盖后续章节生成延迟。
    await Promise.allSettled(chapters.map((_, index) => processChapter(index)))
    if (!this.isEnrichmentJobActive(jobId)) return
    const finalWebFactTimeoutMs = resolveBoundedInteger(process.env.NARRATIVE_PROGRESSIVE_FINAL_WEB_FACT_TIMEOUT_MS, 2000, 0, 10000)
    if (finalWebFactTimeoutMs > 0) {
      const lateBuilds = await Promise.all(webFactTasks.map((task, index) =>
        withBudget(task, finalWebFactTimeoutMs, `progressive_web_fact_final_${index}`).then(
          (value) => ({ status: 'fulfilled' as const, value, index }),
          (reason) => ({ status: 'rejected' as const, reason, index }),
        )))
      for (const item of lateBuilds) {
        if (!this.isEnrichmentJobActive(jobId)) return
        if (item.status !== 'fulfilled') continue
        publishWebFactUpdate(item.index, item.value)
      }
    }
    if (!this.isEnrichmentJobActive(jobId)) return
    publish('completed', chapters.length, new Date().toISOString())
  }

  private pathFromResponse(response: NarrativeResponse): PathSamplerResult {
    return {
      nodes: response.path.nodes,
      alternativesCount: response.path.alternatives_count,
      engine: 'seeded_lod_bbox_sampler',
      strategy: response.path.strategy || 'seeded_spatial_story',
      storyTags: response.path.story_tags || response.story_tags || [],
      relations: (Array.isArray(response.path.relations) ? response.path.relations : []) as PathSamplerResult['relations'],
      lodPolicy: ((response.path.lod_policy || {
        lod: response.lod,
        max_nodes: response.path.nodes.length,
        top_k: 4,
        beta: 8,
        distance_bias: 'balanced',
        continuity_bias: 'balanced',
        diversity_bias: 'mixed_cluster',
      }) as unknown) as PathSamplerResult['lodPolicy'],
    }
  }

}
