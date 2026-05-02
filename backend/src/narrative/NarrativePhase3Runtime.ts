import { randomUUID } from 'node:crypto'

import type { SpatialFeature, SpatialFetchRequest } from '../spatial/fetchSpatialFeatures.js'
import type {
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
}

const DEFAULT_USER_CONTEXT: UserContext = {
  time_label: '当前时段',
  weather_label: '天气未指定',
  preference_label: '通用解说',
  history_label: '首次进入',
}

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
    const candidates = builtCandidates.length > 0 ? builtCandidates : [buildFallbackRegion({ viewport, pois, scene })]
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
    const chapters = buildNarrationChapters({ regions: selectedRegions, tone, scene })
    const density = effectivePoiCount(renderablePois) / viewportAreaKm2(viewport)

    return {
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
  }
}
