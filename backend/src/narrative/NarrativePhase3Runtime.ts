import { randomUUID } from 'node:crypto'

import type { SpatialFeature, SpatialFetchRequest } from '../spatial/fetchSpatialFeatures.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import type {
  NarrativeChapter,
  NarrationTone,
  NarrativeBuilder,
  NarrativePoi,
  NarrativeRequest,
  NarrativeResponse,
  SceneProfile,
  UserContext,
  ViewportBBox,
} from './contract.js'
import { classifyNarrativeEntity } from './entityClassifier.js'
import { gcj02ToWgs84 } from './gcj02.js'
import { buildNarrationChapters, buildRegionFacts } from './factGrounding.js'
import { semanticDiversity, viewportAreaKm2 } from './geometry.js'
import { classifyLod } from './lodPolicy.js'
import { sampleNarrativePath } from './pathSampler.js'
import { buildFallbackRegion, buildRegionCandidates, type AoiCandidateRow, type RegionCandidate } from './regionCandidate.js'

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
}

interface NarrativeWebSource {
  title: string
  url: string
  snippet?: string
  quality?: 'official' | 'encyclopedia' | 'media' | 'general'
  quality_score?: number
}

interface WebFactDebugItem {
  region_id: string
  query: string
  source_count: number
  latency_ms: number
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

function readFiniteNumber(value: unknown): number | null {
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
    if (lon !== null && lat !== null) center = [lon, lat]
  }
  return { west, south, east, north, zoom, center }
}

function resolveLimit(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 3000
  return Math.max(50, Math.min(Math.trunc(n), 10000))
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

function featureToPoi(feature: SpatialFeature): NarrativePoi | null {
  const properties = feature.properties || {}
  const geomLon = readFiniteNumber(properties.geom_longitude)
  const geomLat = readFiniteNumber(properties.geom_latitude)
  const [rawLon, rawLat] = feature.geometry.coordinates
  if (![rawLon, rawLat].every(Number.isFinite)) return null
  const coordSys = String(properties.coordSys || properties._coordSys || '').trim().toLowerCase()
  const [lon, lat] = geomLon !== null && geomLat !== null
    ? [geomLon, geomLat]
    : coordSys === 'gcj02'
      ? gcj02ToWgs84(rawLon, rawLat)
      : [rawLon, rawLat]
  const id = String(properties.id ?? feature.id ?? `${lon.toFixed(6)},${lat.toFixed(6)}`)
  const displayName = String(properties.name || properties['名称'] || '未命名地点')
  const categoryMain = String(properties.category_main || properties.category_big || '未分类')
  const categorySub = String(properties.category_sub || properties.category_mid || '')
  const classification = classifyNarrativeEntity({ name: displayName, categoryMain, categorySub })
  return {
    id,
    lon,
    lat,
    display_name: displayName,
    tier: classification.tier,
    role: classification.role,
    category_main: categoryMain,
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
}) {
  const poiTierStats = input.pois.reduce<Record<string, number>>((acc, poi) => {
    acc[poi.tier] = (acc[poi.tier] || 0) + 1
    return acc
  }, {})
  return {
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
      nodes: input.path.nodes.map((node, index) => {
        const region = input.selectedRegions[index]
        return {
          index,
          region_id: node.region_id,
          name: region?.display_name ?? node.region_id,
          narration_role: node.narration_role,
          transition_reason: node.transition_reason,
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
  }
}

export function buildDeepSeekNarrativeWebFactSearcher(skill: SkillDefinition) {
  return async (query: string, maxResults: number): Promise<NarrativeWebSource[]> => {
    const result = await skill.execute('search_web', { query, max_results: maxResults }, {
      traceId: `narrative-webfact-${Date.now()}`,
      requestId: 'narrative-webfact',
      logger: createLogger({ surface: 'narrative-webfact' }),
    })
    if (!result.ok || !result.data || typeof result.data !== 'object') return []
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

async function attachWebSources(input: {
  chapters: NarrativeChapter[]
  regions: RegionCandidate[]
  searchWebFacts?: (query: string, maxResults: number) => Promise<NarrativeWebSource[]>
}) {
  const debug: WebFactDebugItem[] = []
  if (!input.searchWebFacts) return { chapters: input.chapters, debug }
  const limit = Math.min(Math.max(Number(process.env.NARRATIVE_WEB_FACT_REGION_LIMIT || '3'), 0), input.chapters.length)
  const maxResults = Math.max(1, Math.min(Number(process.env.NARRATIVE_WEB_FACT_RESULT_LIMIT || '3'), 5))
  const pairs = input.chapters.slice(0, limit).map((chapter, index) => ({
    chapter,
    region: input.regions[index],
  }))
  const settled = await Promise.allSettled(pairs.map(async ({ chapter, region }) => {
    const name = region?.display_name || chapter.region_id
    const query = `${name} 官方 介绍 城市空间`
    const started = Date.now()
    const sources = sortWebSourcesByQuality(await input.searchWebFacts?.(query, maxResults) ?? []).slice(0, maxResults)
    return { regionId: chapter.region_id, query, sources, latencyMs: Date.now() - started }
  }))
  const sourcesByRegion = new Map<string, NarrativeWebSource[]>()
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue
    sourcesByRegion.set(item.value.regionId, item.value.sources)
    debug.push({
      region_id: item.value.regionId,
      query: item.value.query,
      source_count: item.value.sources.length,
      latency_ms: item.value.latencyMs,
    })
  }
  return {
    chapters: input.chapters.map((chapter) => ({
      ...chapter,
      web_sources: sourcesByRegion.get(chapter.region_id) || chapter.web_sources,
    })),
    debug,
  }
}

export class NarrativePhase3Runtime implements NarrativeBuilder {
  constructor(private readonly options: NarrativePhase3RuntimeOptions) {}

  async build(input: NarrativeRequest): Promise<NarrativeResponse> {
    const viewport = normalizeViewport(input.viewport)
    const tone = resolveTone(input.tone)
    const userContext = mergeUserContext(input.user_context)
    const sessionId = input.session_id?.trim() || randomUUID()
    const seed = `${sessionId}:${viewport.west.toFixed(4)}:${viewport.south.toFixed(4)}:${viewport.east.toFixed(4)}:${viewport.north.toFixed(4)}:${tone}`
    const features = await this.options.fetchSpatialFeatures({
      bounds: [viewport.west, viewport.south, viewport.east, viewport.north],
      limit: resolveLimit(input.limit),
    })
    const pois = features.map((feature) => featureToPoi(feature)).filter((poi): poi is NarrativePoi => Boolean(poi))
    const renderablePois = pois.filter((poi) => poi.tier !== 'excluded')
    const aois = await (this.options.fetchAoiCandidates?.(viewport) ?? Promise.resolve([]))
    const scene = resolveSceneProfile(renderablePois)
    const builtCandidates = buildRegionCandidates({ viewport, pois, aois, scene })
    const fallbackUsed = builtCandidates.length === 0
    const candidates = fallbackUsed ? [buildFallbackRegion({ viewport, pois, scene })] : builtCandidates
    const dominantCoverage = Math.max(...candidates.map((candidate) => candidate.coverage), 0)
    const semanticDiversityValue = semanticDiversity(renderablePois)
    const lodDecision = classifyLod({
      dominantCoverage,
      candidateCount: candidates.length,
      semanticDiversity: semanticDiversityValue,
    })
    const path = sampleNarrativePath({ candidates, viewport, lod: lodDecision.lod, seed })
    const responseRegions = candidates.map((region) => ({ ...region, narrative_facts: buildRegionFacts({ region, scene }) }))
    const selectedRegions = resolveSelectedRegions(responseRegions, path.nodes.map((node) => node.region_id))
    const chapterBuild = await attachWebSources({
      chapters: buildNarrationChapters({ regions: selectedRegions, tone, scene }),
      regions: selectedRegions,
      searchWebFacts: this.options.searchWebFacts,
    })
    const chapters = chapterBuild.chapters
    const density = effectivePoiCount(renderablePois) / viewportAreaKm2(viewport)

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
      regions: responseRegions,
      path: {
        nodes: path.nodes,
        seed,
        alternatives_count: path.alternativesCount,
      },
      narration: {
        chapters,
        tone,
      },
      user_context: userContext,
    }
    if (input.debug) {
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
      })
    }
    return response
  }
}
