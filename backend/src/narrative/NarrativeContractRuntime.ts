import { randomUUID } from 'node:crypto'

import type { SpatialFeature, SpatialFetchRequest } from '../spatial/fetchSpatialFeatures.js'
import type {
  LODLevel,
  NarrationTone,
  NarrativeBoundaryGeometry,
  NarrativeBuilder,
  NarrativeFact,
  NarrativePoi,
  NarrativeRequest,
  NarrativeResponse,
  SceneProfile,
  UserContext,
  ViewportBBox,
} from './contract.js'
import { classifyNarrativeEntity } from './entityClassifier.js'

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

export interface NarrativeContractRuntimeOptions {
  fetchSpatialFeatures: (input: SpatialFetchRequest) => Promise<SpatialFeature[]>
}

const DEFAULT_USER_CONTEXT: UserContext = {
  time_label: '当前时段',
  weather_label: '天气未指定',
  preference_label: '通用解说',
  history_label: '首次进入',
}

const REGION_COLOR_BY_SCENE: Record<SceneProfile, string> = {
  education_culture: '#ef4444',
  heritage_tourism: '#f97316',
  commercial_leisure: '#eab308',
  natural_ecology: '#14b8a6',
  mixed_urban: '#a855f7',
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
  const [lon, lat] = feature.geometry.coordinates
  if (![lon, lat].every(Number.isFinite)) return null
  const properties = feature.properties || {}
  const id = String(properties.id ?? feature.id ?? `${lon.toFixed(6)},${lat.toFixed(6)}`)
  const displayName = String(properties.name || properties['名称'] || '未命名地点')
  const categoryMain = String(properties.category_main || properties.category_big || '未分类')
  const categorySub = String(properties.category_sub || properties.category_mid || '')
  const classification = classifyNarrativeEntity({
    name: displayName,
    categoryMain,
    categorySub,
  })
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

function resolveLod(viewport: ViewportBBox, poiCount: number): LODLevel {
  if (viewport.zoom >= 15 || poiCount <= 80) return 'micro'
  if (viewport.zoom >= 12 || poiCount <= 600) return 'meso'
  return 'macro'
}

function computeAreaKm2(viewport: ViewportBBox): number {
  const midLat = ((viewport.south + viewport.north) / 2) * Math.PI / 180
  const widthM = Math.abs(viewport.east - viewport.west) * 111_320 * Math.cos(midLat)
  const heightM = Math.abs(viewport.north - viewport.south) * 110_540
  return Math.max(0.0001, (widthM * heightM) / 1_000_000)
}

function computeSemanticDiversity(pois: NarrativePoi[]): number {
  const counts = new Map<string, number>()
  for (const poi of pois) {
    const key = poi.category_main || '未分类'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (pois.length === 0) return 0
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / pois.length
    entropy -= p * Math.log2(p)
  }
  return Number(entropy.toFixed(3))
}

function boundaryFromPois(pois: NarrativePoi[], viewport: ViewportBBox): NarrativeBoundaryGeometry {
  const visible = pois.filter((p) => p.tier !== 'excluded')
  if (visible.length === 0) return boundaryFromViewport(viewport)
  const lons = visible.map((p) => p.lon)
  const lats = visible.map((p) => p.lat)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const lonPad = Math.max((east - west) * 0.08, 0.001)
  const latPad = Math.max((north - south) * 0.08, 0.001)
  return polygonFromBounds(west - lonPad, south - latPad, east + lonPad, north + latPad)
}

function boundaryFromViewport(viewport: ViewportBBox): NarrativeBoundaryGeometry {
  return polygonFromBounds(viewport.west, viewport.south, viewport.east, viewport.north)
}

function polygonFromBounds(west: number, south: number, east: number, north: number): NarrativeBoundaryGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  }
}

function centerFromPois(pois: NarrativePoi[], viewport: ViewportBBox): [number, number] {
  const visible = pois.filter((p) => p.tier !== 'excluded')
  if (visible.length === 0) return viewport.center
  const lon = visible.reduce((sum, p) => sum + p.lon, 0) / visible.length
  const lat = visible.reduce((sum, p) => sum + p.lat, 0) / visible.length
  return [lon, lat]
}

function buildFacts(poiCount: number, density: number, scene: SceneProfile): NarrativeFact[] {
  return [
    {
      claim: `当前视野内检索到 ${poiCount} 个可用于空间解说的 POI 样本。`,
      source: 'postgis',
      confidence: 0.95,
      verified: true,
      related_entity: { type: 'region', id: 'viewport-overview' },
    },
    {
      claim: `当前视野 POI 密度约为每平方公里 ${density.toFixed(1)} 个。`,
      source: 'postgis',
      confidence: 0.9,
      verified: true,
      related_entity: { type: 'region', id: 'viewport-overview' },
    },
    {
      claim: `当前视野的初步场景画像为 ${sceneLabel(scene)}。`,
      source: 'spatial_encoder',
      confidence: 0.72,
      verified: true,
      related_entity: { type: 'region', id: 'viewport-overview' },
    },
  ]
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

export class NarrativeContractRuntime implements NarrativeBuilder {
  constructor(private readonly options: NarrativeContractRuntimeOptions) {}

  async build(input: NarrativeRequest): Promise<NarrativeResponse> {
    const viewport = normalizeViewport(input.viewport)
    const tone = resolveTone(input.tone)
    const userContext = mergeUserContext(input.user_context)
    const features = await this.options.fetchSpatialFeatures({
      bounds: [viewport.west, viewport.south, viewport.east, viewport.north],
      limit: resolveLimit(input.limit),
    })
    const pois = features.map((feature) => featureToPoi(feature)).filter((poi): poi is NarrativePoi => Boolean(poi))
    const renderablePois = pois.filter((poi) => poi.tier !== 'excluded')
    const scene = resolveSceneProfile(renderablePois)
    const lod = resolveLod(viewport, renderablePois.length)
    const areaKm2 = computeAreaKm2(viewport)
    const density = renderablePois.length / areaKm2
    const semanticDiversity = computeSemanticDiversity(renderablePois)
    const [centerLon, centerLat] = centerFromPois(renderablePois, viewport)
    const boundary = boundaryFromPois(renderablePois, viewport)
    const color = REGION_COLOR_BY_SCENE[scene]
    const sessionId = input.session_id?.trim() || randomUUID()

    return {
      session_id: sessionId,
      state_version: 1,
      scene_profile: scene,
      lod,
      viewport,
      dominant_coverage: 1,
      candidate_count: 1,
      poi_density: Number(density.toFixed(1)),
      semantic_diversity: semanticDiversity,
      regions: [
        {
          id: 'viewport-overview',
          display_name: `${sceneLabel(scene)}概览`,
          role: 'scene_evidence',
          core_anchor: { id: 'viewport-center', lon: centerLon, lat: centerLat },
          boundary,
          visual_layer: {
            mode: 'region_glow',
            region_glow: {
              core: boundary,
              color,
              opacity_profile: { core: 0.24, inner: 0.12, outer: 0.06 },
            },
            poi_heat: {
              radius: 24,
              points: renderablePois.map((poi) => ({ lon: poi.lon, lat: poi.lat, tier: poi.tier })),
            },
          },
          pois: renderablePois,
          narrative_facts: buildFacts(renderablePois.length, density, scene),
        },
      ],
      path: {
        nodes: [
          {
            region_id: 'viewport-overview',
            narration_role: 'core',
            transition_reason: '先用当前视野的真实 POI 分布建立空间解说的场景基线。',
          },
        ],
        seed: randomUUID(),
        alternatives_count: 0,
      },
      narration: {
        tone,
        chapters: [
          {
            region_id: 'viewport-overview',
            text: `当前视野呈现出${sceneLabel(scene)}特征，共有 ${renderablePois.length} 个可渲染 POI 样本。这个版本先用于验证 narrative 数据契约、坐标闭环和前端渲染链路，后续阶段会替换为真实区域候选与路径采样。`,
            length_ms: 14000,
          },
        ],
      },
      user_context: userContext,
    }
  }
}
