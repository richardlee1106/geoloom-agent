import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { Writable } from 'node:stream'

import { SSEWriter } from '../chat/SSEWriter.js'
import type {
  AreaInsightInput,
  UserLocationContext,
  ChatRequestV4,
  ComparisonPair,
  DeterministicIntent,
  EvidenceView,
  EvidenceItem,
  PoiFeatureTag,
  RegionFeatureTag,
  RepresentativePoiProfile,
  RenderedAnswer,
  ResolvedAnchor,
  ToolIntentMode,
  ToolExecutionTrace,
} from '../chat/types.js'
import { EvidenceViewFactory } from '../evidence/EvidenceViewFactory.js'
import { buildPoiProfileInputFromEvidence, buildRepresentativePoiProfile } from '../evidence/areaInsight/poiProfile.js'
import { buildRegionSnapshotFromEvidence } from '../evidence/areaInsight/regionSnapshot.js'
import {
  IntentAwareAreaSemanticDenoiser,
  type AreaSemanticDenoiser,
} from '../evidence/areaInsight/semanticDenoiser.js'
import { Renderer } from '../evidence/Renderer.js'
import { InMemoryLLMProvider } from '../llm/InMemoryLLMProvider.js'
import { createDefaultLLMProvider } from '../llm/createDefaultLLMProvider.js'
import { buildToolSchemas } from '../llm/toolSchemaBuilder.js'
import type { LLMAssistantMessage, LLMProvider, ToolCallRequest } from '../llm/types.js'
import { runFunctionCallingLoop } from '../llm/FunctionCallingLoop.js'
import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillDefinition } from '../skills/types.js'
import { createLogger } from '../utils/logger.js'
import { AlivePromptBuilder } from './AlivePromptBuilder.js'
import { ConfidenceGate } from './ConfidenceGate.js'
import { ConversationMemory } from './ConversationMemory.js'
import type { AgentTurnState, MemorySnapshot, SpatialAnalysisConstraint, SpatialAnalysisRegion } from './types.js'
import { SessionManager } from './SessionManager.js'
import { SkillManifestLoader } from '../skills/SkillManifestLoader.js'
import { loadCategoryTreeFromDatabase } from '../catalog/categoryCatalog.js'
import { CategoryEmbeddingIndex } from '../catalog/categoryEmbeddingIndex.js'
import { PoiEmbeddingCache } from '../catalog/poiEmbeddingCache.js'
import { EmbeddingIntentClassifier, type EmbeddingIntentResult } from '../catalog/embeddingIntentClassifier.js'
import type { EmbedRerankBridge } from '../integration/jinaBridge.js'
import { MemoryManager } from '../memory/MemoryManager.js'
import { ShortTermMemory } from '../memory/ShortTermMemory.js'
import { LongTermMemory } from '../memory/LongTermMemory.js'
import { ProfileManager } from '../memory/ProfileManager.js'
import { RuntimeMetrics } from '../metrics/RuntimeMetrics.js'
import { detectUnnecessaryAnalysis } from '../metrics/UnnecessaryAnalysisDetector.js'
import { NLContractCompiler } from '../contract/NLContractCompiler.js'
import type { NLContract } from '../contract/types.js'
import { RequirementResolver } from '../evidence/RequirementResolver.js'
import { DeterministicEvidenceRuntime } from '../evidence/DeterministicEvidenceRuntime.js'
import { isSoftScopedNearbyIntent, resolveNearbyMacroScope } from '../evidence/nearbyScope.js'
import { buildAreaOverviewView } from '../evidence/views/AreaOverviewView.js'
import { buildSimilarRegionEvidence, buildSimilarRegionSearchText } from '../evidence/similarRegions.js'
import { IntentAlignmentGuard } from './IntentAlignmentGuard.js'
import {
  appendAgentExecutionEvent,
  appendToolTraceEvent,
  createAgentExecutionJournal,
  finalizeAgentExecutionJournal,
  toAgentExecutionLogPayload,
  type AgentExecutionStepStatus,
  updateAgentExecutionStep,
} from './executionJournal.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import {
  mergeSemanticEvidenceStatuses,
  type DependencyStatus,
  type SemanticEvidenceStatus,
} from '../integration/dependencyStatus.js'
import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'

const SCHEMA_VERSION = 'v4.agent.v1'
const DEFAULT_POI_COORD_SYS = 'gcj02'
const DEFAULT_LLM_QUERY_MAX_ROUNDS = 4
const DEFAULT_LLM_ANALYSIS_MAX_ROUNDS = 6
const STRUCTURED_CATEGORY_HINTS = [
  {
    key: 'coffee',
    label: '咖啡',
    aliases: ['咖啡', '咖啡店', '咖啡馆', 'coffee', 'cafe', 'café', 'coffee shop'],
  },
  {
    key: 'food',
    label: '餐饮',
    aliases: ['餐饮', '吃饭', '小吃', '餐馆', '美食'],
  },
  {
    key: 'hotel',
    label: '酒店',
    aliases: ['酒店', '宾馆', '旅店', '住宿', '旅馆', 'hotel', 'inn', 'hostel'],
  },
  {
    key: 'supermarket',
    label: '商超',
    aliases: ['商超', '超市', '商场', '便利店'],
  },
  {
    key: 'fashion',
    label: '服装店',
    aliases: ['服装', '服装店', '服饰', '服饰店', '鞋帽', '箱包', '皮具', '买衣服'],
  },
  {
    key: 'metro_station',
    label: '地铁站',
    aliases: ['地铁站', '地铁', '站点'],
  },
] as const
const PRIMARY_TOOL_ROLE_ALIASES = new Set(['primary', 'anchor', 'main', 'origin', 'source'])
const SECONDARY_TOOL_ROLE_ALIASES = new Set(['secondary', 'compare', 'comparison', 'target'])
const POSTGIS_TEMPLATE_DIR = resolveResourceUrl(import.meta.url, [
  '../skills/postgis/templates/',
  '../../../src/skills/postgis/templates/',
])
const POSTGIS_TEMPLATE_FILE_MAP: Record<string, string> = {
  area_category_histogram: 'areaCategoryHistogram.sql',
  area_ring_distribution: 'areaRingDistribution.sql',
  area_representative_sample: 'areaRepresentativeSample.sql',
  area_representative_sample_large_viewport: 'areaRepresentativeSampleViewport.sql',
  area_competition_density: 'areaCompetitionDensity.sql',
  area_h3_hotspots: 'areaH3Hotspots.sql',
  area_aoi_context: 'areaAoiContext.sql',
  area_aoi_context_large_viewport: 'areaAoiContextViewport.sql',
  area_landuse_context: 'areaLanduseContext.sql',
}
const POSTGIS_TEMPLATE_CACHE = new Map<string, string>()

interface CompositeRecommendationStagePlan {
  stageText: string
  categoryKey: string
  targetCategory: string
}

interface CompositeRecommendationPlan {
  rawQuery: string
  corridor: CompositeRecommendationStagePlan & {
    startPlaceName: string
    endPlaceName: string
  }
  destination: CompositeRecommendationStagePlan & {
    placeName: string
  }
}

class ToolExecutionAbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolExecutionAbortError'
  }
}

function formatNumericLiteral(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(numeric) : String(fallback)
}

function resolveTimeoutMs(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback
}

function getDefaultLlmRequestTimeoutMs() {
  return resolveTimeoutMs(process.env.LLM_TIMEOUT_MS, 12000)
}

function getDefaultLlmQueryTimeoutMs() {
  const requestTimeoutMs = getDefaultLlmRequestTimeoutMs()
  return resolveTimeoutMs(process.env.LLM_QUERY_TIMEOUT_MS, Math.max(requestTimeoutMs, 15000))
}

function getDefaultLlmAnalysisTimeoutMs() {
  const requestTimeoutMs = getDefaultLlmRequestTimeoutMs()
  return resolveTimeoutMs(process.env.LLM_ANALYSIS_TIMEOUT_MS, Math.max(requestTimeoutMs, 30000))
}

function getDefaultLlmSynthesisTimeoutMs() {
  const requestTimeoutMs = getDefaultLlmRequestTimeoutMs()
  return resolveTimeoutMs(process.env.LLM_SYNTHESIS_TIMEOUT_MS, Math.max(requestTimeoutMs, 18000))
}

function isProviderLedFastTrackEnabled() {
  const normalized = String(process.env.GEOLOOM_PROVIDER_LED_FAST_TRACK || '').trim().toLowerCase()
  if (!normalized) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''")
}

function hasCoordinates(anchor: ResolvedAnchor | null | undefined): anchor is ResolvedAnchor {
  return Boolean(anchor && Number.isFinite(anchor.lon) && Number.isFinite(anchor.lat))
}

function normalizeCoordSys(value: unknown, fallback = DEFAULT_POI_COORD_SYS) {
  return String(value || fallback).trim().toLowerCase() || fallback
}

function trimText(value: unknown) {
  return String(value || '').trim()
}

function loadPostgisTemplate(templateName: string) {
  const cached = POSTGIS_TEMPLATE_CACHE.get(templateName)
  if (cached) {
    return cached
  }

  const fileName = POSTGIS_TEMPLATE_FILE_MAP[templateName]
  if (!fileName) {
    return null
  }

  const sql = readFileSync(new URL(fileName, POSTGIS_TEMPLATE_DIR), 'utf8')
  POSTGIS_TEMPLATE_CACHE.set(templateName, sql)
  return sql
}

function renderPostgisTemplate(template: string, replacements: Record<string, string>) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, token) => replacements[token] ?? '')
}

function readSpatialContext(request: ChatRequestV4) {
  return request.options?.spatialContext as Record<string, unknown> | undefined
}

function readLonLatCandidate(candidate: unknown) {
  if (Array.isArray(candidate) && candidate.length >= 2) {
    const lon = Number(candidate[0])
    const lat = Number(candidate[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
    return null
  }

  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>
    const lon = Number(record.lon ?? record.lng ?? record.longitude)
    const lat = Number(record.lat ?? record.latitude)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
  }

  return null
}

function readUserLocation(request: ChatRequestV4) {
  const spatialContext = readSpatialContext(request)
  const raw = spatialContext?.userLocation as Record<string, unknown> | undefined
  const lon = Number(raw?.lon ?? raw?.lng ?? raw?.longitude)
  const lat = Number(raw?.lat ?? raw?.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  const accuracyM = Number(raw?.accuracyM ?? raw?.accuracy ?? raw?.accuracy_m)
  return {
    lon,
    lat,
    accuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
    source: String(raw?.source || 'browser_geolocation'),
    capturedAt: String(raw?.capturedAt || raw?.captured_at || ''),
    coordSys: String(raw?.coordSys || raw?.coord_sys || 'wgs84'),
  } satisfies UserLocationContext
}

function normalizeSelectedCategories(selectedCategories: unknown[] = []) {
  return selectedCategories
    .flatMap((item) => {
      if (Array.isArray(item)) {
        return item[item.length - 1] ? [item[item.length - 1]] : []
      }
      return [item]
    })
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function inferCategoryFromSelections(selectedCategories: string[]) {
  const probes = selectedCategories
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)

  for (const hint of STRUCTURED_CATEGORY_HINTS) {
    if (probes.some((probe) => hint.aliases.some((alias) => probe.includes(alias.toLowerCase())))) {
      return {
        categoryKey: hint.key,
        targetCategory: hint.label,
      }
    }
  }

  const fallbackLabel = selectedCategories[selectedCategories.length - 1] || null
  return {
    categoryKey: null,
    targetCategory: fallbackLabel,
  }
}

function normalizeToolRole(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'primary'
  if (PRIMARY_TOOL_ROLE_ALIASES.has(normalized)) return 'primary'
  if (SECONDARY_TOOL_ROLE_ALIASES.has(normalized)) return 'secondary'
  return normalized
}

function normalizeCategoryKey(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''

  for (const hint of STRUCTURED_CATEGORY_HINTS) {
    if (hint.key === normalized) {
      return hint.key
    }

    if (hint.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return hint.key
    }
  }

  if (['restaurant', 'restaurants', 'dining'].includes(normalized)) {
    return 'food'
  }

  if (['metro', 'subway', 'station'].includes(normalized)) {
    return 'metro_station'
  }

  if (['grocery', 'convenience', 'convenience_store', 'mall'].includes(normalized)) {
    return 'supermarket'
  }

  return normalized
}

function readRequestRegions(request: ChatRequestV4) {
  const topLevelRegions = Array.isArray(request.options?.regions) ? request.options?.regions : []
  if (topLevelRegions.length > 0) {
    return topLevelRegions
  }

  const spatialContext = readSpatialContext(request)
  return Array.isArray(spatialContext?.regions) ? spatialContext.regions : []
}

function readRegionName(region: unknown) {
  if (!region || typeof region !== 'object') {
    return null
  }

  const name = String((region as Record<string, unknown>).name || (region as Record<string, unknown>).id || '').trim()
  return name || null
}

function formatCoordinateFragment(value: number) {
  return Number(value).toString()
}

function collectPoints(candidate: unknown): Array<{ lon: number, lat: number }> {
  if (!candidate) return []

  if (Array.isArray(candidate)) {
    if (candidate.length >= 2 && Number.isFinite(Number(candidate[0])) && Number.isFinite(Number(candidate[1]))) {
      return [{
        lon: Number(candidate[0]),
        lat: Number(candidate[1]),
      }]
    }
    return candidate.flatMap((item) => collectPoints(item))
  }

  if (candidate && typeof candidate === 'object') {
    const point = readLonLatCandidate(candidate)
    if (point) {
      return [point]
    }

    if ('coordinates' in (candidate as Record<string, unknown>)) {
      return collectPoints((candidate as Record<string, unknown>).coordinates)
    }
  }

  return []
}

function closeRing(points: Array<{ lon: number, lat: number }>) {
  if (points.length < 3) return null

  const ring = [...points]
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!last || first.lon !== last.lon || first.lat !== last.lat) {
    ring.push(first)
  }

  return ring
}

function ringPointsToWkt(points: Array<{ lon: number, lat: number }>) {
  const ring = closeRing(points)
  if (!ring) return null
  return `(${ring.map((point) => `${formatCoordinateFragment(point.lon)} ${formatCoordinateFragment(point.lat)}`).join(', ')})`
}

function boundaryToPolygonWkt(boundary: unknown) {
  if (!Array.isArray(boundary)) return null
  const ring = ringPointsToWkt(boundary.flatMap((point) => {
    const normalized = readLonLatCandidate(point)
    return normalized ? [normalized] : []
  }))
  return ring ? `POLYGON(${ring})` : null
}

function viewportToPolygonWkt(viewport: unknown) {
  if (!Array.isArray(viewport) || viewport.length < 4) return null

  const swLon = Number(viewport[0])
  const swLat = Number(viewport[1])
  const neLon = Number(viewport[2])
  const neLat = Number(viewport[3])
  if (![swLon, swLat, neLon, neLat].every(Number.isFinite)) {
    return null
  }

  return `POLYGON((${formatCoordinateFragment(Math.min(swLon, neLon))} ${formatCoordinateFragment(Math.min(swLat, neLat))}, ${formatCoordinateFragment(Math.max(swLon, neLon))} ${formatCoordinateFragment(Math.min(swLat, neLat))}, ${formatCoordinateFragment(Math.max(swLon, neLon))} ${formatCoordinateFragment(Math.max(swLat, neLat))}, ${formatCoordinateFragment(Math.min(swLon, neLon))} ${formatCoordinateFragment(Math.max(swLat, neLat))}, ${formatCoordinateFragment(Math.min(swLon, neLon))} ${formatCoordinateFragment(Math.min(swLat, neLat))}))`
}

function polygonCoordinatesToWktBody(coordinates: unknown) {
  if (!Array.isArray(coordinates)) return null
  const rings = coordinates
    .map((ring) => ringPointsToWkt(collectPoints(ring)))
    .filter((ring): ring is string => Boolean(ring))
  if (rings.length === 0) {
    return null
  }
  return `(${rings.join(', ')})`
}

function geometryToWkt(geometry: unknown) {
  if (!geometry || typeof geometry !== 'object') {
    return null
  }

  const record = geometry as Record<string, unknown>
  const type = String(record.type || '').trim()
  if (type === 'Polygon') {
    const body = polygonCoordinatesToWktBody(record.coordinates)
    return body ? `POLYGON${body}` : null
  }

  if (type === 'MultiPolygon' && Array.isArray(record.coordinates)) {
    const polygons = record.coordinates
      .map((polygon) => polygonCoordinatesToWktBody(polygon))
      .filter((polygon): polygon is string => Boolean(polygon))
    if (polygons.length === 0) {
      return null
    }
    return `MULTIPOLYGON(${polygons.join(', ')})`
  }

  return null
}

function sanitizeWkt(value: unknown) {
  const candidate = String(value || '').trim()
  if (!candidate) return null
  if (!/^(POLYGON|MULTIPOLYGON)\s*\([\d\s,().-]+\)$/i.test(candidate)) {
    return null
  }
  return candidate.replace(/\s+/g, ' ').trim()
}

function combineRegionWkts(regionWkts: string[]) {
  const bodies = regionWkts.flatMap((wkt) => {
    const polygonMatch = wkt.match(/^POLYGON\s*\((.+)\)$/i)
    if (polygonMatch?.[1]) {
      return [polygonMatch[1]]
    }

    const multiPolygonMatch = wkt.match(/^MULTIPOLYGON\s*\((.+)\)$/i)
    if (multiPolygonMatch?.[1]) {
      return [multiPolygonMatch[1]]
    }

    return []
  })

  if (bodies.length === 0) {
    return null
  }

  return `MULTIPOLYGON(${bodies.join(', ')})`
}

function averagePoints(points: Array<{ lon: number, lat: number }>) {
  if (points.length === 0) {
    return null
  }

  return {
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  }
}

function readRegionArea(region: unknown) {
  if (!region || typeof region !== 'object') {
    return null
  }

  const record = region as Record<string, unknown>
  return geometryToWkt(record.geometry) || sanitizeWkt(record.boundaryWKT)
}

function readRegionCenter(region: unknown) {
  if (!region || typeof region !== 'object') {
    return null
  }

  const record = region as Record<string, unknown>
  return readLonLatCandidate(record.center)
    || averagePoints(collectPoints(record.geometry))
}

function buildSpatialConstraintFromRequest(request: ChatRequestV4): SpatialAnalysisConstraint {
  const spatialContext = readSpatialContext(request)
  const selectedCategories = normalizeSelectedCategories(request.options?.selectedCategories || [])
  const regions = readRequestRegions(request)
    .map((region) => {
      const areaWkt = readRegionArea(region)
      if (!areaWkt) {
        return null
      }

      const center = readRegionCenter(region)
      const record = region as Record<string, unknown>
      return {
        id: (record.id as string | number | null | undefined) ?? null,
        name: String(record.name || `选区${String(record.id || '').trim() || ''}` || '选区').trim() || '选区',
        areaWkt,
        lon: center?.lon,
        lat: center?.lat,
      } as SpatialAnalysisRegion
    })
    .filter(Boolean) as SpatialAnalysisRegion[]

  if (regions.length > 0) {
    return {
      scope: 'regions',
      areaWkt: regions.length === 1 ? regions[0].areaWkt : combineRegionWkts(regions.map((region) => region.areaWkt)),
      selectedCategories,
      regions,
    }
  }

  const boundaryWkt = boundaryToPolygonWkt(spatialContext?.boundary)
  if (boundaryWkt) {
    return {
      scope: 'boundary',
      areaWkt: boundaryWkt,
      selectedCategories,
      regions: [],
    }
  }

  const viewportWkt = viewportToPolygonWkt(spatialContext?.viewport)
  if (viewportWkt) {
    return {
      scope: 'viewport',
      areaWkt: viewportWkt,
      selectedCategories,
      regions: [],
    }
  }

  const hasCircle = Number.isFinite(Number(spatialContext?.radius)) && Boolean(readLonLatCandidate(spatialContext?.center))
  return {
    scope: hasCircle ? 'circle' : 'anchor_radius',
    areaWkt: null,
    selectedCategories,
    regions: [],
  }
}

function readMapViewAnchor(request: ChatRequestV4, role = 'primary'): ResolvedAnchor | null {
  const spatialContext = readSpatialContext(request)
  if (!spatialContext) return null

  const directCenter = readLonLatCandidate(spatialContext.center)
  const viewport = Array.isArray(spatialContext.viewport) ? spatialContext.viewport : []
  const boundary = Array.isArray(spatialContext.boundary) ? spatialContext.boundary : []
  const regionCenter = averagePoints(
    readRequestRegions(request)
      .map((region) => readRegionCenter(region))
      .filter((center): center is { lon: number, lat: number } => Boolean(center)),
  )

  const viewportCenter = viewport.length >= 4
    ? {
      lon: (Number(viewport[0]) + Number(viewport[2])) / 2,
      lat: (Number(viewport[1]) + Number(viewport[3])) / 2,
    }
    : null

  let boundaryCenter = null as { lon: number, lat: number } | null
  if (boundary.length >= 3) {
    const points = boundary
      .map((point) => readLonLatCandidate(point))
      .filter((point): point is { lon: number, lat: number } => Boolean(point))
    if (points.length > 0) {
      boundaryCenter = {
        lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
        lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      }
    }
  }

  const center = regionCenter || boundaryCenter || directCenter || viewportCenter
  if (!center || !Number.isFinite(center.lon) || !Number.isFinite(center.lat)) {
    return null
  }

  return {
    place_name: '当前区域',
    display_name: '当前区域',
    role,
    source: 'map_view',
    resolved_place_name: '当前区域',
    poi_id: null,
    lon: center.lon,
    lat: center.lat,
    coord_sys: normalizeCoordSys(spatialContext.coordSys || spatialContext.coord_sys, DEFAULT_POI_COORD_SYS),
  }
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineDistanceMeters(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
) {
  const earthRadiusM = 6371000
  const dLat = toRadians(endLat - startLat)
  const dLon = toRadians(endLon - startLon)
  const lat1 = toRadians(startLat)
  const lat2 = toRadians(endLat)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function deriveViewportContext(request: ChatRequestV4): DeterministicIntent['viewportContext'] {
  const spatialContext = readSpatialContext(request)
  const viewport = Array.isArray(spatialContext?.viewport) ? spatialContext.viewport : []
  if (viewport.length < 4) {
    return undefined
  }

  const swLon = Number(viewport[0])
  const swLat = Number(viewport[1])
  const neLon = Number(viewport[2])
  const neLat = Number(viewport[3])
  if (![swLon, swLat, neLon, neLat].every((value) => Number.isFinite(value))) {
    return { diagonalM: null, scale: 'unknown' }
  }

  const minLon = Math.min(swLon, neLon)
  const minLat = Math.min(swLat, neLat)
  const maxLon = Math.max(swLon, neLon)
  const maxLat = Math.max(swLat, neLat)
  const diagonalM = haversineDistanceMeters(swLat, swLon, neLat, neLon)
  const scale = diagonalM >= 5000
    ? 'large'
    : diagonalM >= 2500
      ? 'medium'
      : 'small'

  return {
    diagonalM: Number(diagonalM.toFixed(0)),
    scale,
    bounds: {
      swLon: minLon,
      swLat: minLat,
      neLon: maxLon,
      neLat: maxLat,
    },
  }
}

function extractLastUserText(messages: ChatRequestV4['messages'] = []) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => String(message?.role || '').toLowerCase() === 'user')

  if (!lastUserMessage) return ''

  if (typeof lastUserMessage.content === 'string') {
    return lastUserMessage.content.trim()
  }

  if (Array.isArray(lastUserMessage.content)) {
    return lastUserMessage.content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '')
        }
        return ''
      })
      .join(' ')
      .trim()
  }

  if (
    lastUserMessage.content
    && typeof lastUserMessage.content === 'object'
    && 'text' in (lastUserMessage.content as Record<string, unknown>)
  ) {
    return String((lastUserMessage.content as { text?: unknown }).text || '').trim()
  }

  return String(lastUserMessage.content || '').trim()
}

function defaultRadiusForQueryType(queryType: DeterministicIntent['queryType']) {
  if (queryType === 'area_overview' || queryType === 'similar_regions' || queryType === 'compare_places' || queryType === 'composite_recommendation') {
    return 1200
  }
  return 800
}

function shouldForceDefaultWebEvidence(intent: Pick<
  DeterministicIntent,
  'queryType' | 'rawQuery' | 'categoryKey' | 'categoryMain' | 'categorySub' | 'targetCategory'
>) {
  if (intent.queryType !== 'nearby_poi') {
    return false
  }

  if (intent.categoryKey === 'metro_station') {
    return false
  }

  if (intent.categoryMain || intent.categorySub || intent.categoryKey) {
    return true
  }

  return /美食|餐饮|餐厅|餐馆|小吃|咖啡|奶茶|甜品|火锅|烧烤|面馆|酒店|宾馆|民宿|景点|景区|公园|绿道|江滩|湿地/u
    .test(String(intent.rawQuery || ''))
}

function resolveWebRequirementMode(input: {
  needsWebEvidence: boolean
  baseNeedsWebSearch: boolean
  forcedDefaultWebEvidence: boolean
}) {
  if (!input.needsWebEvidence) {
    return 'local_first'
  }

  if (input.forcedDefaultWebEvidence && !input.baseNeedsWebSearch) {
    return 'default_on'
  }

  return 'required'
}

function shouldDefaultToCandidateReputation(rawQuery: string) {
  return /(高分|评分|口碑|推荐|必吃|排行榜|排名|榜单|测评|探店)/u.test(String(rawQuery || ''))
}

function resolveExpandedNearbyRadiusM(
  intent: Pick<DeterministicIntent, 'queryType' | 'anchorSource' | 'placeName' | 'categoryKey' | 'radiusM'>,
) {
  if (!isSoftScopedNearbyIntent(intent)) {
    return Math.max(Number(intent.radiusM || 0), 1)
  }
  return Math.max(Number(intent.radiusM || 0), 8000)
}

function shouldRelaxNearbyDistanceConstraint(
  intent: Pick<DeterministicIntent, 'queryType' | 'anchorSource' | 'placeName' | 'categoryKey' | 'radiusM'>,
  spatialConstraint?: SpatialAnalysisConstraint | null,
) {
  return intent.queryType === 'nearby_poi'
    && intent.categoryKey !== 'metro_station'
    && isSoftScopedNearbyIntent(intent)
    && !spatialConstraint?.areaWkt
}

function looksLikeSpatialQuestion(rawQuery: string) {
  return /附近|周边|旁边|这里|这边|这块|当前位置|最近|地铁|站点|区域|片区|商圈|业态|热点|供给|需求|竞争|开店|总结|解读|读懂|相似|类似|比较|对比|选区|地图/u
    .test(String(rawQuery || ''))
}

function sanitizePlaceCandidate(value: unknown) {
  let candidate = String(value || '').trim()
  if (!candidate) return null
  candidate = candidate
    .replace(/^(请|帮我|请问|想看|想问|告诉我|比较|对比|看看|分析一下|分析|解读一下|解读|总结一下|总结|读懂一下|读懂|如果要在|如果在|在|到|去|离)+/u, '')
    .replace(/[，。？?！!,:：]/g, '')
    .trim()
  if (!candidate || candidate.length < 2 || candidate.length > 20) return null
  if (/^(我|这里|这边|这块|当前区域|当前片区|当前位置|附近|周边|旁边|最近)$/u.test(candidate)) {
    return null
  }
  if (/这块|这里|这边|当前|有哪些|有什么|有没有|推荐|高分|口碑|评分/u.test(candidate)) {
    return null
  }
  return candidate
}

function extractComparePlaceNames(rawQuery: string) {
  const normalized = String(rawQuery || '').trim()
  const match = normalized.match(/(?:比较|对比)\s*(.+?)\s*和\s*(.+?)(?:附近|周边|片区|区域|的|，|。|？|\?|$)/u)
  if (!match) {
    return { primary: null, secondary: null }
  }
  return {
    primary: sanitizePlaceCandidate(match[1]),
    secondary: sanitizePlaceCandidate(match[2]),
  }
}

function extractExplicitPlaceName(rawQuery: string) {
  const normalized = String(rawQuery || '').trim()
  const patterns = [
    /(?:解读|读懂|总结|看看|分析)(?:一下)?(.+?)(?:周边|附近|片区|区域)/u,
    /^(.+?)(?:附近|周边|旁边|周围)/u,
    /^(.+?)(?:最近的地铁站|地铁站是什么|地铁分布|餐饮活跃度|业态结构)/u,
    /^(.+?)(?:美食|餐饮|咖啡|咖啡店|酒店|宾馆|景点|公园|商场|超市|便利店|书店|药店|医院|健身房|停车场|充电站)/u,
    /和(.+?)(?:周边|附近)?(?:气质)?相似/u,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    const candidate = sanitizePlaceCandidate(match?.[1])
    if (candidate) {
      return candidate
    }
  }

  return null
}

function inferStructuredCategoryFromRawQuery(rawQuery: string) {
  const normalized = String(rawQuery || '').trim().toLowerCase()
  if (!normalized) {
    return { categoryKey: null, targetCategory: null }
  }

  for (const hint of STRUCTURED_CATEGORY_HINTS) {
    if (hint.aliases.some((alias) => normalized.includes(alias.toLowerCase()))) {
      return {
        categoryKey: hint.key,
        targetCategory: hint.label,
      }
    }
  }

  return { categoryKey: null, targetCategory: null }
}

function extractCompositeStageSplit(rawQuery: string) {
  const normalized = String(rawQuery || '').trim()
  if (!normalized) {
    return null
  }

  const match = normalized.match(
    /^(?<first>.+?)(?:[，,。；;]\s*)?(?:吃完(?:了)?|吃好(?:了)?|然后|之后|再|接着|顺路|后面|接下来)(?<second>.+)$/u,
  )
  if (!match?.groups) {
    return null
  }

  const firstStage = String(match.groups.first || '').trim()
  const secondStage = String(match.groups.second || '').trim()
  if (!firstStage || !secondStage) {
    return null
  }

  return { firstStage, secondStage }
}

function extractCompositeBetweenPlaceNames(stageText: string) {
  const match = String(stageText || '').trim().match(/(?:在)?\s*(.+?)\s*和\s*(.+?)\s*之间/u)
  if (!match) {
    return { startPlaceName: null, endPlaceName: null }
  }

  return {
    startPlaceName: sanitizePlaceCandidate(match[1]),
    endPlaceName: sanitizePlaceCandidate(match[2]),
  }
}

function extractCompositeDestinationPlaceName(stageText: string) {
  const patterns = [
    /(?:去|到)\s*(.+?)(?:逛一逛|逛逛|逛一下|逛街|逛|看看|转转|买东西|购物|买买|走走)(?:[，,。！？?]|$)/u,
    /(?:去|到)\s*(.+?)(?:[，,。！？?]|$)/u,
  ]

  for (const pattern of patterns) {
    const match = String(stageText || '').trim().match(pattern)
    const candidate = sanitizePlaceCandidate(match?.[1])
    if (candidate) {
      return candidate
    }
  }

  return null
}

function parseCompositeRecommendationQuery(rawQuery: string): CompositeRecommendationPlan | null {
  const split = extractCompositeStageSplit(rawQuery)
  if (!split) {
    return null
  }

  const corridorAnchors = extractCompositeBetweenPlaceNames(split.firstStage)
  const destinationPlaceName = extractCompositeDestinationPlaceName(split.secondStage)
  const corridorCategory = inferStructuredCategoryFromRawQuery(split.firstStage)
  const destinationCategory = inferStructuredCategoryFromRawQuery(split.secondStage)

  if (
    !corridorAnchors.startPlaceName
    || !corridorAnchors.endPlaceName
    || !destinationPlaceName
    || !corridorCategory.categoryKey
    || !destinationCategory.categoryKey
  ) {
    return null
  }

  return {
    rawQuery,
    corridor: {
      stageText: split.firstStage,
      startPlaceName: corridorAnchors.startPlaceName,
      endPlaceName: corridorAnchors.endPlaceName,
      categoryKey: corridorCategory.categoryKey,
      targetCategory: corridorCategory.targetCategory || '候选点',
    },
    destination: {
      stageText: split.secondStage,
      placeName: destinationPlaceName,
      categoryKey: destinationCategory.categoryKey,
      targetCategory: destinationCategory.targetCategory || '候选点',
    },
  }
}

function buildStructuredFallbackIntent(request: ChatRequestV4, rawQuery: string): DeterministicIntent {
  const selectedCategories = normalizeSelectedCategories(request.options?.selectedCategories || [])
  const selectedCategoryHint = inferCategoryFromSelections(selectedCategories)
  const rawCategoryHint = inferStructuredCategoryFromRawQuery(rawQuery)
  const categoryKey = selectedCategoryHint.categoryKey || rawCategoryHint.categoryKey
  const targetCategory = selectedCategoryHint.targetCategory || rawCategoryHint.targetCategory
  const hasMapView = Boolean(readMapViewAnchor(request))
  const hasUserLocation = Boolean(readUserLocation(request))
  const selectedRegionNames = readRequestRegions(request)
    .map((region) => readRegionName(region))
    .filter((name): name is string => Boolean(name))
  const comparePlaces = extractComparePlaceNames(rawQuery)
  const explicitPlaceName = extractExplicitPlaceName(rawQuery)
  const nearestStationQuery = /地铁站/u.test(rawQuery) && /最近|离我最近|最近的/u.test(rawQuery)
  const similarRegionQuery = /相似|类似|气质相似/u.test(rawQuery)
    || (/像.+片区/u.test(rawQuery) && !/更像/u.test(rawQuery))
  const compareQuery = /比较|对比|差异/u.test(rawQuery)
  const areaInsightQuery = /读懂|解读|总结|主导业态|活力热点|异常点|机会|供给|需求|竞争|开什么店|更像.*片区|居住区|商业区|混合片区|业态结构/u.test(rawQuery)
  const nearbyLookupQuery = /附近|周边|旁边|周围|这里|这边|这块|当前位置|我附近|有哪些|有什么|有没有|推荐/u.test(rawQuery)
    || Boolean(categoryKey)

  let clarificationHint = '这轮我没有稳定理解你的自然语言意图。请直接说明你想查附近点位、最近地铁站、区域解读、相似片区，还是双地点对比。'
  if (hasMapView) {
    clarificationHint = '这轮我没有稳定理解你的自然语言意图，不过当前地图范围已经拿到了。请重试，或更明确地说明你想做区域解读、附近查询、相似片区，还是双地点对比。'
  } else if (hasUserLocation) {
    clarificationHint = '这轮我没有稳定理解你的自然语言意图，不过当前位置已经拿到了。请重试，或更明确地说明你想查附近点位、最近地铁站，还是做区域解读。'
  } else if (selectedRegionNames.length >= 2) {
    clarificationHint = `这轮我没有稳定理解你的自然语言意图，不过你当前选中了 ${selectedRegionNames.slice(0, 2).join(' 和 ')}。请重试，或明确说明你是想比较它们、解读其中一个，还是查询周边点位。`
  }

  if (!looksLikeSpatialQuestion(rawQuery)) {
    return {
      queryType: 'unsupported',
      intentMode: 'deterministic_visible_loop',
      rawQuery,
      placeName: null,
      anchorSource: hasMapView ? 'map_view' : hasUserLocation ? 'user_location' : 'place',
      secondaryPlaceName: null,
      targetCategory: null,
      comparisonTarget: null,
      categoryKey: null,
      radiusM: defaultRadiusForQueryType('nearby_poi'),
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      toolIntent: null,
      searchIntentHint: null,
    }
  }

  let queryType: DeterministicIntent['queryType'] = 'unsupported'
  if (compareQuery && ((comparePlaces.primary && comparePlaces.secondary) || selectedRegionNames.length >= 2)) {
    queryType = 'compare_places'
  } else if (similarRegionQuery) {
    queryType = 'similar_regions'
  } else if (nearestStationQuery) {
    queryType = 'nearest_station'
  } else if (areaInsightQuery && (hasMapView || Boolean(explicitPlaceName) || selectedRegionNames.length > 0)) {
    queryType = 'area_overview'
  } else if (nearbyLookupQuery) {
    queryType = 'nearby_poi'
  }

  let anchorSource: NonNullable<DeterministicIntent['anchorSource']> = hasMapView ? 'map_view' : hasUserLocation ? 'user_location' : 'place'
  if (queryType === 'compare_places') {
    anchorSource = (comparePlaces.primary && comparePlaces.secondary) ? 'place' : 'map_view'
  } else if ((/我附近|离我最近|当前位置/u.test(rawQuery)) && hasUserLocation) {
    anchorSource = 'user_location'
  } else if (explicitPlaceName) {
    anchorSource = 'place'
  } else if (hasMapView && queryType !== 'unsupported') {
    anchorSource = 'map_view'
  }

  const primaryPlaceName = queryType === 'compare_places'
    ? (comparePlaces.primary || selectedRegionNames[0] || null)
    : queryType === 'area_overview' && anchorSource === 'map_view'
      ? (selectedRegionNames[0] || '当前区域')
      : queryType === 'nearby_poi' && anchorSource === 'map_view'
        ? (selectedRegionNames[0] || '当前区域')
        : anchorSource === 'place'
          ? explicitPlaceName
          : null
  const secondaryPlaceName = queryType === 'compare_places'
    ? (comparePlaces.secondary || selectedRegionNames[1] || null)
    : null
  const needsWebSearch = shouldSearchWeb(rawQuery)
  const toolIntent = defaultToolIntentForQueryType(queryType === 'unsupported' ? 'nearby_poi' : queryType, needsWebSearch, rawQuery)
  const needsClarification = queryType !== 'unsupported' && (
    (anchorSource === 'place' && !primaryPlaceName)
    || (anchorSource === 'map_view' && !hasMapView && queryType !== 'compare_places')
    || (anchorSource === 'user_location' && !hasUserLocation)
    || (queryType === 'compare_places' && (!primaryPlaceName || !secondaryPlaceName))
  )

  return {
    queryType,
    intentMode: intentModeFromQueryType(queryType === 'unsupported' ? 'nearby_poi' : queryType),
    rawQuery,
    placeName: primaryPlaceName,
    anchorSource,
    secondaryPlaceName,
    targetCategory: queryType === 'area_overview'
      ? '区域洞察'
      : queryType === 'nearest_station'
        ? '地铁站'
        : targetCategory,
    comparisonTarget: null,
    categoryKey,
    radiusM: defaultRadiusForQueryType(queryType === 'unsupported' ? 'nearby_poi' : queryType),
    needsClarification,
    clarificationHint: needsClarification ? clarificationHint : null,
    needsWebSearch,
    toolIntent,
    searchIntentHint: buildDefaultSearchIntentHint({
      queryType: queryType === 'unsupported' ? 'nearby_poi' : queryType,
      toolIntent,
      targetCategory: queryType === 'nearest_station' ? '地铁站' : targetCategory,
      needsWebSearch,
    }),
  }
}

function buildUserLocationAnchor(userLocation: UserLocationContext, role = 'primary'): ResolvedAnchor {
  return {
    place_name: '当前位置',
    display_name: '当前位置',
    role,
    source: 'user_location',
    resolved_place_name: '当前位置',
    poi_id: null,
    lon: userLocation.lon,
    lat: userLocation.lat,
    coord_sys: String(userLocation.coordSys || 'wgs84').trim().toLowerCase() || 'wgs84',
  }
}

function normalizePoiRows(rows: Record<string, unknown>[] = []): EvidenceItem[] {
  return rows.map((row) => ({
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    coordSys: normalizeCoordSys(row.coord_sys || row.coordSys, DEFAULT_POI_COORD_SYS),
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
    meta: row,
  }))
}

function comparisonPairToAnchor(pair: ComparisonPair | undefined, role: string): ResolvedAnchor | null {
  if (!pair) {
    return null
  }

  return {
    place_name: pair.anchor.placeName,
    display_name: pair.anchor.displayName,
    role,
    source: pair.anchor.source || 'comparison_pair',
    resolved_place_name: pair.anchor.resolvedPlaceName,
    poi_id: null,
    lon: pair.anchor.lon,
    lat: pair.anchor.lat,
  }
}

function readTemplateName(trace: ToolExecutionTrace) {
  const result = trace.result as { meta?: Record<string, unknown> } | undefined
  const metaTemplate = String(result?.meta?.template || '').trim()
  if (metaTemplate) {
    return metaTemplate
  }

  const payloadTemplate = String((trace.payload as Record<string, unknown>)?.template || '').trim()
  return payloadTemplate || null
}

function collectAreaInsightTemplateResults(toolCalls: ToolExecutionTrace[]) {
  const latestByTemplate = new Map<string, Record<string, unknown>>()

  for (const trace of toolCalls) {
    if (trace.skill !== 'postgis' || trace.action !== 'execute_spatial_sql' || trace.status !== 'done') {
      continue
    }

    const template = readTemplateName(trace)
    if (!template || !POSTGIS_TEMPLATE_FILE_MAP[template]) {
      continue
    }

    latestByTemplate.set(template, (trace.result as Record<string, unknown> | undefined) || {})
  }

  return latestByTemplate
}

function mergeAreaInsightInput(
  base: AreaInsightInput | undefined,
  override: AreaInsightInput | undefined,
): AreaInsightInput {
  const baseValue = base || {}
  const overrideValue = override || {}

  const pickRows = (key: keyof AreaInsightInput) => {
    const overrideRows = overrideValue[key]
    if (Array.isArray(overrideRows)) {
      return overrideRows as Record<string, unknown>[]
    }
    const baseRows = baseValue[key]
    return Array.isArray(baseRows) ? baseRows as Record<string, unknown>[] : []
  }

  return {
    categoryHistogram: pickRows('categoryHistogram'),
    ringDistribution: pickRows('ringDistribution'),
    representativeSamples: pickRows('representativeSamples'),
    competitionDensity: pickRows('competitionDensity'),
    hotspotCells: pickRows('hotspotCells'),
    aoiContext: pickRows('aoiContext'),
    landuseContext: pickRows('landuseContext'),
  }
}

function preferNonEmptyComparisonPairs(...candidates: Array<ComparisonPair[] | null | undefined>) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate
    }
  }
  return []
}

function readAreaInsightRows(
  results: Map<string, Record<string, unknown>>,
  templateName: string,
) {
  const primaryRows = results.get(templateName)?.rows as Record<string, unknown>[] | undefined
  if (Array.isArray(primaryRows) && primaryRows.length > 0) {
    return primaryRows
  }
  const viewportRows = results.get(`${templateName}_large_viewport`)?.rows as Record<string, unknown>[] | undefined
  return Array.isArray(viewportRows) ? viewportRows : []
}

function collectLatestAreaEvidenceSelection(toolCalls: ToolExecutionTrace[]) {
  return [...toolCalls]
    .reverse()
    .find((trace) => trace.skill === 'semantic_selector' && trace.action === 'select_area_evidence' && trace.status === 'done')
    ?.result as {
      selected_rows?: Record<string, unknown>[]
      selected_area_insight?: AreaInsightInput
      semantic_evidence?: SemanticEvidenceStatus
      diagnostics?: Record<string, unknown>
    } | undefined
}

function extractAssistantTextContent(message: LLMAssistantMessage | null | undefined) {
  if (!message) return ''

  const directContent = String(message.content || '').trim()
  if (directContent) {
    return directContent
  }

  const contentBlocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : []
  return contentBlocks
    .filter((block) => ['text', 'output_text', 'final', 'message'].includes(String(block.type || '').trim().toLowerCase()))
    .map((block) => String(block.text || block.content || block.message || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function serializeToolResultContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  const serialized = JSON.stringify(content ?? {})
  return typeof serialized === 'string' ? serialized : '{}'
}

function collectLatestLookupRows(
  toolCalls: ToolExecutionTrace[],
  templateName: 'nearby_poi' | 'nearest_station',
) {
  return [...toolCalls]
    .reverse()
    .find((trace) => {
      if (trace.skill !== 'postgis' || trace.action !== 'execute_spatial_sql' || trace.status !== 'done') {
        return false
      }
      return readTemplateName(trace) === templateName
    })
    ?.result as { rows?: Record<string, unknown>[] } | undefined
}

function hasAreaInsightPayload(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false
  }

  const areaInsight = value as AreaInsightInput
  return [
    areaInsight.categoryHistogram,
    areaInsight.ringDistribution,
    areaInsight.representativeSamples,
    areaInsight.competitionDensity,
    areaInsight.hotspotCells,
    areaInsight.aoiContext,
    areaInsight.landuseContext,
  ].some((items) => Array.isArray(items) && items.length > 0)
}

function readSemanticEvidenceStatus(result: unknown): SemanticEvidenceStatus | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const raw = (result as Record<string, unknown>).semantic_evidence
    || (result as Record<string, unknown>).semanticEvidence
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>
  const dependency = String(record.dependency || '').trim()
  const level = String(record.level || '').trim()
  const mode = String(record.mode || '').trim()
  if (!dependency || !level || !mode) {
    return null
  }

  return {
    dependency,
    level: level as SemanticEvidenceStatus['level'],
    weakEvidence: Boolean(record.weakEvidence ?? record.weak_evidence ?? true),
    mode: mode as SemanticEvidenceStatus['mode'],
    reason: record.reason == null ? null : String(record.reason),
    target: record.target == null ? null : String(record.target),
  }
}

function collectSemanticEvidence(toolCalls: ToolExecutionTrace[]) {
  return mergeSemanticEvidenceStatuses(toolCalls.map((trace) => readSemanticEvidenceStatus(trace.result)))
}

function collectSemanticHints(toolCalls: ToolExecutionTrace[]) {
  const hints: Array<{ label: string, detail?: string, score?: number | null }> = []

  for (const trace of [...toolCalls].reverse()) {
    if (trace.status !== 'done') continue

    const semanticEvidence = readSemanticEvidenceStatus(trace.result)
    const evidenceTail = semanticEvidence
      ? semanticEvidence.level === 'available'
        ? '语义证据可用'
        : semanticEvidence.reason
          ? `弱语义证据（${semanticEvidence.reason}）`
          : '弱语义证据'
      : undefined

    const result = (trace.result as Record<string, unknown> | undefined) || {}
    if (trace.skill === 'spatial_vector' && trace.action === 'search_similar_regions' && Array.isArray(result.regions)) {
      for (const region of result.regions.slice(0, 3) as Array<Record<string, unknown>>) {
        hints.push({
          label: String(region.name || '相似片区').trim() || '相似片区',
          detail: [String(region.summary || '').trim(), evidenceTail].filter(Boolean).join('；') || undefined,
          score: Number.isFinite(Number(region.score)) ? Number(region.score) : null,
        })
      }
    }

    if (trace.skill === 'spatial_vector' && trace.action === 'search_semantic_pois' && Array.isArray(result.candidates)) {
      for (const candidate of result.candidates.slice(0, 3) as Array<Record<string, unknown>>) {
        const category = String(candidate.category || '').trim()
        hints.push({
          label: String(candidate.name || '语义候选').trim() || '语义候选',
          detail: [category, evidenceTail].filter(Boolean).join('；') || undefined,
          score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
        })
      }
    }

    if (trace.skill === 'spatial_encoder' && trace.action === 'encode_region_snapshot' && Array.isArray(result.feature_tags)) {
      for (const feature of result.feature_tags.slice(0, 4) as Array<Record<string, unknown>>) {
        hints.push({
          label: String(feature.label || '片区特征').trim() || '片区特征',
          detail: [String(feature.detail || '').trim(), evidenceTail].filter(Boolean).join('；') || undefined,
          score: Number.isFinite(Number(feature.score)) ? Number(feature.score) : null,
        })
      }
    }

    if (trace.skill === 'spatial_encoder' && trace.action === 'encode_poi_profile' && Array.isArray(result.feature_tags)) {
      for (const feature of result.feature_tags.slice(0, 3) as Array<Record<string, unknown>>) {
        hints.push({
          label: String(feature.label || '代表点角色').trim() || '代表点角色',
          detail: [String(result.feature_summary || result.summary || '').trim(), evidenceTail].filter(Boolean).join('；') || undefined,
          score: Number.isFinite(Number(feature.score)) ? Number(feature.score) : null,
        })
      }
    }
  }

  return hints.slice(0, 5)
}

function readRegionFeatureEncoding(result: unknown) {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>
  const rawTags = Array.isArray(record.feature_tags)
    ? record.feature_tags
    : Array.isArray(record.featureTags)
      ? record.featureTags
      : []
  const featureTags = rawTags
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const feature = item as Record<string, unknown>
      const key = String(feature.key || '').trim()
      const label = String(feature.label || '').trim()
      const score = Number(feature.score)
      if (!key || !label || !Number.isFinite(score)) {
        return null
      }
      return {
        key,
        label,
        score,
        detail: feature.detail == null ? null : String(feature.detail),
      } as RegionFeatureTag
    })
    .filter(Boolean) as RegionFeatureTag[]

  const summary = String(record.feature_summary || record.featureSummary || record.summary || '').trim()
  if (!summary && featureTags.length === 0) {
    return null
  }

  return {
    summary,
    featureTags,
  }
}

function readPoiProfileEncoding(result: unknown) {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>
  const rawTags = Array.isArray(record.feature_tags)
    ? record.feature_tags
    : Array.isArray(record.featureTags)
      ? record.featureTags
      : []
  const featureTags = rawTags
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const feature = item as Record<string, unknown>
      const key = String(feature.key || '').trim()
      const label = String(feature.label || '').trim()
      const score = Number(feature.score)
      if (!key || !label || !Number.isFinite(score)) {
        return null
      }
      return {
        key,
        label,
        score,
        detail: feature.detail == null ? null : String(feature.detail),
      } satisfies PoiFeatureTag
    })
    .filter((item): item is PoiFeatureTag => Boolean(item))

  const summary = String(record.feature_summary || record.featureSummary || record.summary || '').trim()
  if (!summary && featureTags.length === 0) {
    return null
  }

  return {
    summary,
    featureTags,
  }
}

function readVectorRef(result: unknown) {
  if (!result || typeof result !== 'object') {
    return null
  }

  const vectorRef = String((result as Record<string, unknown>).vector_ref || (result as Record<string, unknown>).vectorRef || '').trim()
  return vectorRef || null
}

function readSimilarRegionCandidates(result: unknown) {
  if (!result || typeof result !== 'object') {
    return []
  }

  const rawRegions = Array.isArray((result as Record<string, unknown>).regions)
    ? (result as Record<string, unknown>).regions as unknown[]
    : []

  return rawRegions
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const region = item as Record<string, unknown>
      const name = String(region.name || '').trim()
      if (!name) return null
      return {
        regionId: String(region.region_id || region.regionId || region.id || '').trim() || null,
        name,
        score: Number.isFinite(Number(region.score)) ? Number(region.score) : null,
        summary: String(region.summary || '').trim(),
        tags: Array.isArray(region.tags)
          ? region.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
          : [],
      }
    })
    .filter((item): item is {
      regionId: string | null
      name: string
      score: number | null
      summary: string
      tags: string[]
    } => Boolean(item))
}

function readSimilarityScores(result: unknown) {
  if (!result || typeof result !== 'object') {
    return new Map<string, number>()
  }

  const rawScores = Array.isArray((result as Record<string, unknown>).scores)
    ? (result as Record<string, unknown>).scores as unknown[]
    : []
  const scores = new Map<string, number>()

  for (const item of rawScores) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const candidateId = String(record.candidate_id || record.candidateId || '').trim()
    const score = Number(record.score)
    if (!candidateId || !Number.isFinite(score)) continue
    scores.set(candidateId, score)
  }

  return scores
}

function toResolvedAnchorFromEvidenceView(view: EvidenceView): ResolvedAnchor {
  return {
    place_name: view.anchor.placeName || view.anchor.resolvedPlaceName || view.anchor.displayName || '参考片区',
    display_name: view.anchor.displayName || view.anchor.resolvedPlaceName || view.anchor.placeName || '参考片区',
    role: 'primary',
    source: view.anchor.source || 'semantic_candidate_view',
    resolved_place_name: view.anchor.resolvedPlaceName || view.anchor.displayName || view.anchor.placeName || '参考片区',
    poi_id: null,
    lon: view.anchor.lon,
    lat: view.anchor.lat,
    coord_sys: view.anchor.coordSys || null,
  }
}

function isFallbackToolTrace(trace: ToolExecutionTrace) {
  return String(trace.id || '').startsWith('fallback_')
}

function hasAgentLedAreaInsightEvidence(toolCalls: ToolExecutionTrace[]) {
  return toolCalls.some((trace) => {
    if (trace.status !== 'done' || isFallbackToolTrace(trace)) {
      return false
    }

    const result = trace.result as {
      rows?: Record<string, unknown>[]
      regions?: Array<Record<string, unknown>>
      candidates?: Array<Record<string, unknown>>
    } | undefined

    if (trace.skill === 'postgis' && trace.action === 'execute_spatial_sql') {
      return Array.isArray(result?.rows) && result.rows.length > 0
    }

    return false
  })
}

function formatIntentQueryType(queryType: DeterministicIntent['queryType']) {
  if (queryType === 'nearby_poi') return '附近检索'
  if (queryType === 'nearest_station') return '最近地铁站'
  if (queryType === 'area_overview') return '区域解读'
  if (queryType === 'similar_regions') return '相似片区'
  if (queryType === 'compare_places') return '双地点比较'
  if (queryType === 'composite_recommendation') return '复合行程推荐'
  return queryType
}

function splitStreamableText(text: string, chunkSize = 28) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!normalized) return []

  const chunks: string[] = []

  let buffer = ''
  const pushBuffer = () => {
    if (!buffer) return
    chunks.push(buffer)
    buffer = ''
  }

  for (const char of normalized) {
    buffer += char
    const isBoundary = /[。！？\n]/u.test(char)
    if (buffer.length >= chunkSize || isBoundary) {
      pushBuffer()
    }
  }

  pushBuffer()

  return chunks
}

function unwrapToolResult(result: unknown) {
  if (!result || typeof result !== 'object') {
    return {} as Record<string, unknown>
  }
  const record = result as Record<string, unknown>
  if (record.data && typeof record.data === 'object') {
    return record.data as Record<string, unknown>
  }
  return record
}

function extractWebSearchItems(result: unknown, source: string) {
  const inner = unwrapToolResult(result)
  if (Array.isArray(inner.merged)) {
    return inner.merged.slice(0, 5).map((item) => {
      const record = item as Record<string, unknown>
      return {
        title: String(record.title || '').trim(),
        snippet: String(record.snippet || '').trim(),
        url: String(record.url || '').trim(),
        source,
      }
    }).filter((item) => item.title || item.url)
  }

  if (Array.isArray(inner.results)) {
    return inner.results.slice(0, 5).map((item) => {
      const record = item as Record<string, unknown>
      return {
        title: String(record.title || '').trim(),
        snippet: String(record.content || record.snippet || '').trim(),
        url: String(record.url || '').trim(),
        source,
      }
    }).filter((item) => item.title || item.url)
  }

  return [] as Array<{ title: string, snippet: string, url: string, source: string }>
}

function extractWebAnswerPreview(result: unknown) {
  const inner = unwrapToolResult(result)
  return String(inner.answer || inner.summary || '').trim()
}

function collectWebSearchObservations(toolCalls: ToolExecutionTrace[]) {
  const latestBySource = new Map<string, {
    source: string
    query: string
    items: Array<{ title: string, snippet: string, url: string, source: string }>
    answerPreview: string
  }>()

  for (const trace of toolCalls) {
    if (trace.status !== 'done') continue
    if (trace.skill !== 'multi_search_engine' && trace.skill !== 'tavily_search') continue
    const source = trace.skill === 'tavily_search' ? 'tavily' : 'multi_search'
    latestBySource.set(source, {
      source,
      query: String((trace.payload as Record<string, unknown>)?.query || '').trim(),
      items: extractWebSearchItems(trace.result, source),
      answerPreview: extractWebAnswerPreview(trace.result),
    })
  }

  return [...latestBySource.values()]
}

function classifyTaskMode(input: {
  intent: DeterministicIntent
  rawQuery: string
}): 'query' | 'analysis' {
  if (['area_overview', 'compare_places', 'similar_regions', 'composite_recommendation'].includes(input.intent.queryType)) {
    return 'analysis'
  }

  if (/读懂|总结|主导业态|活力热点|异常点|机会|供给|需求|竞争|开店|补什么配套|更像.*片区/u.test(input.rawQuery)) {
    return 'analysis'
  }

  return 'query'
}

function extractJsonObject(text: string) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const firstBrace = raw.indexOf('{')
  if (firstBrace < 0) return null

  let depth = 0
  for (let index = firstBrace; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return raw.slice(firstBrace, index + 1)
    }
  }

  return null
}

function isSupportedQueryType(value: unknown): value is DeterministicIntent['queryType'] {
  return ['nearby_poi', 'nearest_station', 'area_overview', 'similar_regions', 'compare_places', 'composite_recommendation', 'unsupported']
    .includes(String(value || '').trim())
}

function isSupportedAnchorSource(value: unknown): value is NonNullable<DeterministicIntent['anchorSource']> {
  return ['place', 'map_view', 'user_location'].includes(String(value || '').trim())
}

function readOptionalText(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function shouldSearchWeb(rawQuery: string) {
  return /怎么样|好不好|体验|评价|推荐|口碑|排名|评分|高分|好评|差评|最推荐|最好|最佳|高评分|高评价|还在|营业|开门|关门|今天|最近|新开|最新|现在|目前|人均|价格|多少钱|房价|租金|消费|便宜|贵|性价比/u.test(rawQuery)
}

function shouldPreferLlmIntentPlanner(input: {
  request: ChatRequestV4
  rawQuery: string
  followUpHint?: RecentFollowUpIntentHint | null
  embeddingResult: EmbeddingIntentResult
}) {
  if (input.embeddingResult.queryType === 'unsupported') {
    return true
  }

  const hasSpatialView = Boolean(readMapViewAnchor(input.request))
  const explicitPlaceName = extractExplicitPlaceName(input.rawQuery)
  const rawCategoryHint = inferStructuredCategoryFromRawQuery(input.rawQuery)
  if (hasSpatialView) {
    if (explicitPlaceName && (rawCategoryHint.categoryKey || /附近|周边|旁边|周围/u.test(input.rawQuery))) {
      return false
    }
    return true
  }

  return Boolean(input.followUpHint) && input.embeddingResult.confidence < 0.85
}

function looksLikeMarkdownAnswer(text: string) {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return /(^|\n)#{2,3}\s/u.test(normalized)
    || /(^|\n)-\s/u.test(normalized)
    || /(^|\n)\d+\.\s/u.test(normalized)
    || /(^|\n)\|.+\|/u.test(normalized)
}

function buildViewportTileConfig(viewportContext?: DeterministicIntent['viewportContext']) {
  if (!viewportContext || viewportContext.scale !== 'large' || !viewportContext.bounds) {
    return null
  }

  const { swLon, swLat, neLon, neLat } = viewportContext.bounds
  const lonSpan = Math.max(Math.abs(neLon - swLon), 0.0001)
  const latSpan = Math.max(Math.abs(neLat - swLat), 0.0001)
  const diagonalM = Number(viewportContext.diagonalM || 0)
  const tileCols = diagonalM >= 10000 ? 3 : 2
  const tileRows = diagonalM >= 10000 ? 3 : 2

  return {
    minLon: Math.min(swLon, neLon),
    minLat: Math.min(swLat, neLat),
    tileWidth: lonSpan / tileCols,
    tileHeight: latSpan / tileRows,
    tileCols,
    tileRows,
  }
}

function inferStructuredCategoryKeyFromText(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null

  for (const hint of STRUCTURED_CATEGORY_HINTS) {
    if (
      normalized.includes(hint.key.toLowerCase())
      || normalized.includes(hint.label.toLowerCase())
      || hint.aliases.some((alias) => normalized.includes(alias.toLowerCase()))
    ) {
      return hint.key
    }
  }

  return null
}

function isEllipticalFollowUpQuery(rawQuery: string) {
  const normalized = String(rawQuery || '')
    .replace(/[？?！!。．.,，、\s]/g, '')
    .trim()

  if (!normalized || normalized.length > 12) {
    return false
  }

  return /^(这|那)(这|那)?(里|儿|边|附近|个地方|片区|一片)?(呢|怎么样|如何|咋样|有吗|有没有)?$/u.test(normalized)
}

function buildContextualFollowUpQuery(input: {
  rawQuery: string
  memorySnapshot: MemorySnapshot
}) {
  if (!isEllipticalFollowUpQuery(input.rawQuery)) {
    return input.rawQuery
  }

  const previousTurns = [...input.memorySnapshot.recentTurns]
    .reverse()
    .map((turn) => String(turn.userQuery || '').trim())
    .filter(Boolean)
  const previousUserQuery = previousTurns.find((query) => !isEllipticalFollowUpQuery(query))
    || previousTurns[0]

  if (!previousUserQuery) {
    return input.rawQuery
  }

  return `${previousUserQuery}。补充追问：${input.rawQuery}`
}

function readRecentIntentForFollowUp(snapshot: MemorySnapshot) {
  for (const turn of [...snapshot.recentTurns].reverse()) {
    const record = turn.intent
    if (!record || typeof record !== 'object') {
      continue
    }

    const queryType = isSupportedQueryType((record as Record<string, unknown>).queryType)
      ? (record as Record<string, unknown>).queryType as DeterministicIntent['queryType']
      : null
    if (!queryType || queryType === 'unsupported' || queryType === 'compare_places' || queryType === 'composite_recommendation') {
      continue
    }

    const targetCategory = readOptionalText((record as Record<string, unknown>).targetCategory)
    const categoryKey = readOptionalText((record as Record<string, unknown>).categoryKey)
      || inferStructuredCategoryKeyFromText((record as Record<string, unknown>).targetCategory)
      || inferStructuredCategoryKeyFromText(turn.userQuery)
    const categoryMain = readOptionalText((record as Record<string, unknown>).categoryMain)
    const categorySub = readOptionalText((record as Record<string, unknown>).categorySub)
    const placeName = readOptionalText((record as Record<string, unknown>).placeName)
    const anchorSource = isSupportedAnchorSource((record as Record<string, unknown>).anchorSource)
      ? (record as Record<string, unknown>).anchorSource as NonNullable<DeterministicIntent['anchorSource']>
      : null
    const rawNeedsWebSearch = (record as Record<string, unknown>).needsWebSearch
    const toolIntent = normalizeToolIntentMode((record as Record<string, unknown>).toolIntent)
    const searchIntentHint = readOptionalText((record as Record<string, unknown>).searchIntentHint)

    return {
      queryType,
      rawQuery: turn.userQuery,
      placeName,
      anchorSource,
      targetCategory,
      categoryKey,
      categoryMain,
      categorySub,
      needsWebSearch: typeof rawNeedsWebSearch === 'boolean'
        ? rawNeedsWebSearch
        : shouldSearchWeb(turn.userQuery),
      toolIntent,
      searchIntentHint,
    }
  }

  return null
}

function inheritIntentForEllipticalFollowUp(input: {
  request: ChatRequestV4
  rawQuery: string
  fallbackIntent: DeterministicIntent
  memorySnapshot: MemorySnapshot
}) {
  if (!isEllipticalFollowUpQuery(input.rawQuery)) {
    return input.fallbackIntent
  }

  const recentIntent = readRecentIntentForFollowUp(input.memorySnapshot)
  if (!recentIntent) {
    return input.fallbackIntent
  }

  const hasMapView = Boolean(readMapViewAnchor(input.request))
  const hasUserLocation = Boolean(readUserLocation(input.request))
  const selectedRegionNames = readRequestRegions(input.request)
    .map((region) => readRegionName(region))
    .filter((name): name is string => Boolean(name))

  let clarificationHint = '这轮我没有稳定理解你的自然语言意图。请直接说明你想查附近点位、最近地铁站、区域解读、相似片区，还是双地点对比。'
  if (hasMapView) {
    clarificationHint = '这轮我没有稳定理解你的自然语言意图，不过当前地图范围已经拿到了。请重试，或更明确地说明你想做区域解读、附近查询、相似片区，还是双地点对比。'
  } else if (hasUserLocation) {
    clarificationHint = '这轮我没有稳定理解你的自然语言意图，不过当前位置已经拿到了。请重试，或更明确地说明你想查附近点位、最近地铁站，还是做区域解读。'
  } else if (selectedRegionNames.length >= 2) {
    clarificationHint = `这轮我没有稳定理解你的自然语言意图，不过你当前选中了 ${selectedRegionNames.slice(0, 2).join(' 和 ')}。请重试，或明确说明你是想比较它们、解读其中一个，还是查询周边点位。`
  }

  const needsWebSearch = recentIntent.needsWebSearch ?? input.fallbackIntent.needsWebSearch
  const toolIntent = recentIntent.toolIntent
    || defaultToolIntentForQueryType(
      input.fallbackIntent.queryType,
      Boolean(needsWebSearch),
      recentIntent.rawQuery || input.fallbackIntent.rawQuery,
    )

  return {
    ...input.fallbackIntent,
    placeName: recentIntent.placeName || input.fallbackIntent.placeName,
    anchorSource: recentIntent.anchorSource || input.fallbackIntent.anchorSource,
    targetCategory: recentIntent.targetCategory || input.fallbackIntent.targetCategory,
    categoryKey: recentIntent.categoryKey || input.fallbackIntent.categoryKey,
    categoryMain: recentIntent.categoryMain || input.fallbackIntent.categoryMain,
    categorySub: recentIntent.categorySub || input.fallbackIntent.categorySub,
    needsClarification: false,
    clarificationHint: null,
    needsWebSearch,
    toolIntent,
    searchIntentHint: recentIntent.searchIntentHint || input.fallbackIntent.searchIntentHint || buildDefaultSearchIntentHint({
      queryType: input.fallbackIntent.queryType,
      toolIntent,
      targetCategory: recentIntent.targetCategory || input.fallbackIntent.targetCategory,
      needsWebSearch: Boolean(needsWebSearch),
    }),
  } satisfies DeterministicIntent
}

function isAreaStructureClassificationQuery(rawQuery: string) {
  return /更像.*片区|居住片区|商业片区|混合片区|业态结构/u.test(String(rawQuery || ''))
}

function normalizeTopicHint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function intentModeFromQueryType(queryType: DeterministicIntent['queryType']): DeterministicIntent['intentMode'] {
  return queryType === 'nearby_poi' || queryType === 'composite_recommendation'
    ? 'deterministic_visible_loop'
    : 'agent_full_loop'
}

function defaultToolIntentForQueryType(
  queryType: DeterministicIntent['queryType'],
  needsWebSearch = false,
  rawQuery = '',
): ToolIntentMode | null {
  if (queryType === 'nearby_poi') {
    return needsWebSearch && shouldDefaultToCandidateReputation(rawQuery)
      ? 'candidate_reputation'
      : 'candidate_lookup'
  }
  if (queryType === 'nearest_station') {
    return 'nearest_transit'
  }
  if (queryType === 'area_overview') {
    return 'area_insight'
  }
  if (queryType === 'compare_places') {
    return 'place_comparison'
  }
  if (queryType === 'similar_regions') {
    return 'similar_region_search'
  }
  return null
}

function normalizeToolIntentMode(value: unknown): ToolIntentMode | null {
  const normalized = String(value || '').trim()
  if (
    normalized === 'candidate_lookup'
    || normalized === 'candidate_reputation'
    || normalized === 'nearest_transit'
    || normalized === 'area_insight'
    || normalized === 'place_comparison'
    || normalized === 'similar_region_search'
  ) {
    return normalized
  }
  return null
}

function buildDefaultSearchIntentHint(input: {
  queryType: DeterministicIntent['queryType']
  toolIntent?: ToolIntentMode | null
  targetCategory?: string | null
  categoryMain?: string | null
  categorySub?: string | null
  needsWebSearch?: boolean
}) {
  if (!input.needsWebSearch) {
    return null
  }

  const categoryLabel = [
    input.targetCategory,
    input.categorySub,
    input.categoryMain,
  ]
    .map((value) => String(value || '').trim())
    .find(Boolean)

  if (input.toolIntent === 'candidate_reputation') {
    return [categoryLabel || '地点', '评分', '推荐']
      .filter(Boolean)
      .join(' ')
  }

  if (input.toolIntent === 'candidate_lookup') {
    return categoryLabel || null
  }

  if (input.toolIntent === 'area_insight') {
    return [categoryLabel || '片区', '口碑', '评价']
      .filter(Boolean)
      .join(' ')
  }

  if (input.queryType === 'nearest_station') {
    return '地铁站 出口 换乘'
  }

  return categoryLabel ? `${categoryLabel} 推荐` : null
}

type RecentFollowUpIntentHint = NonNullable<ReturnType<typeof readRecentIntentForFollowUp>>

function extractAssistantReasoningSnippet(message: LLMAssistantMessage | null | undefined) {
  if (!message) return ''

  const contentBlocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : []
  const reasoningFromBlocks = contentBlocks
    .filter((block) => ['thinking', 'reasoning'].includes(String(block.type || '').trim().toLowerCase()))
    .map((block) => String(block.thinking || block.reasoning || block.text || block.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (reasoningFromBlocks) {
    return reasoningFromBlocks
  }

  return String(message.content || '').trim()
}

function describeToolIntent(call: ToolCallRequest) {
  const skill = String(call.name || 'tool').trim() || 'tool'
  const action = String(call.arguments.action || '').trim()
  const payload = (call.arguments.payload as Record<string, unknown> | undefined) || {}

  if (skill === 'postgis' && action === 'resolve_anchor') {
    const placeName = String(payload.place_name || '目标地点').trim() || '目标地点'
    return `先把“${placeName}”定位准，再基于真实锚点去查周边或片区结构，避免一开始就拿错范围。`
  }

  if (skill === 'postgis' && action === 'execute_spatial_sql') {
    const template = String(payload.template || '').trim()
    const templateHints: Record<string, string> = {
      area_category_histogram: '先统计范围内各大类 POI 的真实分布，确认主导业态是不是稳定。',
      area_ring_distribution: '再看点位是围绕中心扩散，还是明显往某一圈层偏移。',
      area_representative_sample: '补一层空间上分散的代表性样本，避免标签和样本都只挤在中心附近。',
      area_competition_density: '把竞争密度单独拉出来，看哪些方向已经很卷，哪些还没卷起来。',
      area_h3_hotspots: '通过热点网格确认活力是不是集中在很小一片区域，而不是平均铺开。',
      area_aoi_context: '补 AOI 语义，判断这里更像校园、居住还是商业带。',
      area_landuse_context: '补用地结构，看看供给和需求背后的空间语义是不是一致。',
      nearby_poi: '先把范围内候选点抓出来，再决定最后应该怎么回答。',
      compare_places: '先拿到两边同维度样本，再做差异判断，避免拿不同口径硬比。',
      nearest_station: '先锁定站点和站口距离，避免“最近”这种结论凭感觉下。',
    }
    return templateHints[template] || `正在调取 ${template || '空间查询'} 的结构证据，确保后面的判断落在可验证数据上。`
  }

  if (skill === 'spatial_encoder') {
    if (action === 'encode_region_snapshot') {
      return '正在把当前片区的结构化快照送进空间编码器，提取校园/混合/热点/竞争等片区特征。'
    }
    if (action === 'encode_poi_profile') {
      return '正在给代表样本做 poi-level 角色编码，判断它更像交通入口、消费锚点还是日常配套支点。'
    }
    return '正在补充空间语义向量，看看当前问题是否需要更抽象的区域语义匹配。'
  }

  if (skill === 'spatial_vector') {
    return '正在召回相似区域或语义近邻，验证当前片区判断是不是只停留在表层计数。'
  }

  return `正在执行 ${skill}${action ? `.${action}` : ''}，补齐回答所需的关键证据。`
}

export interface GeoLoomAgentOptions {
  registry: SkillRegistry
  version: string
  provider?: LLMProvider
  manifestLoader?: SkillManifestLoader
  memory?: MemoryManager
  sessionManager?: SessionManager
  conversationMemory?: ConversationMemory
  evidenceFactory?: EvidenceViewFactory
  renderer?: Renderer
  alivePromptBuilder?: AlivePromptBuilder
  confidenceGate?: ConfidenceGate
  metrics?: RuntimeMetrics
  areaSemanticDenoiser?: AreaSemanticDenoiser
  /** 品类 Embedding 索引（启动时预计算，查询时语义匹配） */
  categoryIndex?: CategoryEmbeddingIndex
  /** EmbedRerankBridge 实例（JinaBridge），供品类 embedding 解析使用 */
  bridge?: EmbedRerankBridge
  /** POI Embedding 缓存 + 语义重排序 */
  poiEmbeddingCache?: PoiEmbeddingCache
  /** Embedding-First 意图分类器（替代 LLM 意图识别） */
  intentClassifier?: EmbeddingIntentClassifier
}

export class GeoLoomAgent {
  private readonly provider: LLMProvider
  private readonly manifestLoader: SkillManifestLoader
  private readonly memory: MemoryManager
  private readonly sessionManager: SessionManager
  private readonly conversationMemory: ConversationMemory
  private readonly evidenceFactory: EvidenceViewFactory
  private readonly renderer: Renderer
  private readonly alivePromptBuilder: AlivePromptBuilder
  private readonly confidenceGate: ConfidenceGate
  private readonly metrics: RuntimeMetrics
  private readonly areaSemanticDenoiser: AreaSemanticDenoiser
  private readonly categoryIndex: CategoryEmbeddingIndex | undefined
  private readonly bridge: EmbedRerankBridge | undefined
  private readonly poiEmbeddingCache: PoiEmbeddingCache | undefined
  private readonly intentClassifier: EmbeddingIntentClassifier | undefined

  constructor(private readonly options: GeoLoomAgentOptions) {
    this.provider = options.provider || createDefaultLLMProvider()
    this.manifestLoader = options.manifestLoader || new SkillManifestLoader({
      rootDir: resolveResourceUrl(import.meta.url, ['../../SKILLS/', '../../../SKILLS/']),
    })
    const sharedShortTerm = new ShortTermMemory()
    this.memory = options.memory || new MemoryManager({
      shortTerm: sharedShortTerm,
      longTerm: new LongTermMemory({
        dataDir: resolveResourceUrl(import.meta.url, ['../../data/memory/', '../../../data/memory/']),
      }),
      profiles: new ProfileManager({
        profileDir: resolveResourceUrl(import.meta.url, ['../../profiles/', '../../../profiles/']),
      }),
    })
    this.sessionManager = options.sessionManager || new SessionManager({ memory: sharedShortTerm })
    this.conversationMemory = options.conversationMemory || new ConversationMemory()
    this.evidenceFactory = options.evidenceFactory || new EvidenceViewFactory()
    this.renderer = options.renderer || new Renderer()
    this.alivePromptBuilder = options.alivePromptBuilder || new AlivePromptBuilder()
    this.confidenceGate = options.confidenceGate || new ConfidenceGate()
    this.metrics = options.metrics || new RuntimeMetrics()
    this.areaSemanticDenoiser = options.areaSemanticDenoiser || new IntentAwareAreaSemanticDenoiser()
    this.categoryIndex = options.categoryIndex
    this.bridge = options.bridge
    this.poiEmbeddingCache = options.poiEmbeddingCache
    this.intentClassifier = options.intentClassifier
  }

  private initializeExecutionJournal(input: {
    state: AgentTurnState
    rawQuery: string
    intent: DeterministicIntent
    taskMode: 'query' | 'analysis'
    plannerSource: string
    recommendedTrack: string
    needsWebSearch: boolean
    logger: ReturnType<typeof createLogger>
  }) {
    input.state.executionJournal = createAgentExecutionJournal({
      rawQuery: input.rawQuery,
      intent: input.intent,
      taskMode: input.taskMode,
      plannerSource: input.plannerSource,
      recommendedTrack: input.recommendedTrack,
      needsWebSearch: input.needsWebSearch,
    })
    appendAgentExecutionEvent(
      input.state.executionJournal,
      'note',
      'execution_plan_initialized',
      {
        plannerSource: input.plannerSource,
        recommendedTrack: input.recommendedTrack,
        taskMode: input.taskMode,
      },
    )
    input.logger.info('agent_plan', {
      journal: toAgentExecutionLogPayload(input.state.executionJournal),
    })
  }

  private noteExecutionStep(input: {
    state: AgentTurnState
    stepId: string
    status: AgentExecutionStepStatus
    detail?: string
    logger?: ReturnType<typeof createLogger>
    eventMessage?: string
    eventMeta?: Record<string, unknown>
  }) {
    updateAgentExecutionStep(input.state.executionJournal, input.stepId, input.status, input.detail)
    if (input.eventMessage) {
      appendAgentExecutionEvent(
        input.state.executionJournal,
        'note',
        input.eventMessage,
        input.eventMeta,
      )
    }
    if (input.logger && input.state.executionJournal) {
      input.logger.debug('agent_step', {
        stepId: input.stepId,
        status: input.status,
        detail: input.detail || null,
      })
    }
  }

  private finalizeExecutionJournal(input: {
    state: AgentTurnState
    logger?: ReturnType<typeof createLogger>
    verificationStatus: 'allow' | 'clarify' | 'degraded'
    verificationReason: string
    answerGrounded: boolean
    evidenceCount: number
    answerSource?: string | null
  }) {
    finalizeAgentExecutionJournal(input.state.executionJournal, {
      verificationStatus: input.verificationStatus,
      verificationReason: input.verificationReason,
      answerGrounded: input.answerGrounded,
      evidenceCount: input.evidenceCount,
      toolCallCount: input.state.toolCalls.length,
      answerSource: input.answerSource || null,
    })
    if (input.logger && input.state.executionJournal) {
      input.logger.info('agent_verification', {
        journal: toAgentExecutionLogPayload(input.state.executionJournal),
      })
    }
  }

  private buildSpatialConstraint(request: ChatRequestV4) {
    return buildSpatialConstraintFromRequest(request)
  }

  createWriter(stream: Writable, traceId = randomUUID()) {
    return new SSEWriter({
      stream,
      traceId,
      schemaVersion: SCHEMA_VERSION,
    })
  }

  async getHealth() {
    const providerStatus = this.provider.getStatus()
    const memoryHealth = await this.memory.getHealth()
    const dependencies: Record<string, DependencyStatus> = {
      ...memoryHealth.dependencies,
    }
    const skills = this.options.registry.list()
      .map((summary) => this.options.registry.get(summary.name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))

    for (const skill of skills) {
      if (!skill.getStatus) continue
      Object.assign(dependencies, await skill.getStatus())
    }

    const degradedDependencies = Object.values(dependencies)
      .filter((status) => status.degraded || !status.ready)
      .map((status) => status.name)

    if (!providerStatus.ready) {
      degradedDependencies.unshift('llm_provider')
    }

    return {
      provider_ready: providerStatus.ready,
      llm: providerStatus,
      memory: memoryHealth,
      metrics: this.metrics.snapshot(),
      dependencies,
      degraded_dependencies: [...new Set(degradedDependencies)],
    }
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    const startedAt = Date.now()
    const traceId = writer.traceId
    const requestId = String(request.options?.requestId || traceId)
    const lastUserText = extractLastUserText(request.messages)
    const session = await this.sessionManager.getOrCreate({
      requestId,
      sessionId: request.options?.sessionId,
    })
    const logger = createLogger().child({
      traceId,
      requestId,
      sessionId: session.id,
    })
    const skillContext = createSkillExecutionContext({
      traceId,
      requestId,
      sessionId: session.id,
      logger,
    })
    const memorySnapshot = await this.memory.getSnapshot(session.id)
    const conversationSnapshot = this.conversationMemory.summarize(memorySnapshot)
    const recentFollowUpIntentHint = isEllipticalFollowUpQuery(lastUserText)
      ? readRecentIntentForFollowUp(memorySnapshot)
      : null
    const contextualUserText = buildContextualFollowUpQuery({
      rawQuery: lastUserText,
      memorySnapshot,
    })
    const activeProvider = this.provider.isReady() ? this.provider : new InMemoryLLMProvider()
    const fallbackIntent = inheritIntentForEllipticalFollowUp({
      request,
      rawQuery: lastUserText,
      fallbackIntent: buildStructuredFallbackIntent(request, contextualUserText),
      memorySnapshot,
    })
    // 阶段 3：Clarification Guard — 检查空间上下文充分性
    const guard = new IntentAlignmentGuard()
    const guardResult = guard.evaluate({
      rawQuery: lastUserText,
      hasViewport: Boolean(readMapViewAnchor(request)),
      hasBoundary: Boolean(readSpatialContext(request)?.boundary),
      hasDrawnRegion: readRequestRegions(request).length > 0,
      hasUserLocation: Boolean(readUserLocation(request)),
      hasExplicitRadius: Number.isFinite(Number(readSpatialContext(request)?.radius)),
    })

    if (guardResult.needsClarification) {
      const clarificationIntent: DeterministicIntent = {
        ...fallbackIntent,
        needsClarification: true,
        clarificationHint: guardResult.reason,
      }
      const guardState: AgentTurnState = {
        requestId,
        traceId,
        sessionId: session.id,
        toolCalls: [],
        anchors: {},
        spatialConstraint: undefined,
        sqlValidationAttempts: 0,
        sqlValidationPassed: 0,
      }
      this.initializeExecutionJournal({
        state: guardState,
        rawQuery: lastUserText,
        intent: clarificationIntent,
        taskMode: classifyTaskMode({
          intent: clarificationIntent,
          rawQuery: lastUserText,
        }),
        plannerSource: 'alignment_guard',
        recommendedTrack: 'guardrail',
        needsWebSearch: Boolean(clarificationIntent.needsWebSearch),
        logger,
      })
      this.noteExecutionStep({
        state: guardState,
        stepId: 'understand_request',
        status: 'completed',
        detail: '已完成输入理解，但空间上下文守卫判定当前信息不足以继续执行。',
        logger,
        eventMessage: 'clarification_guard_triggered',
        eventMeta: {
          reason: guardResult.reason,
        },
      })
      this.noteExecutionStep({
        state: guardState,
        stepId: 'resolve_scope',
        status: 'failed',
        detail: guardResult.reason || '当前输入缺少稳定空间上下文。',
        logger,
      })
      await this.finishWithoutEvidence({
        writer, answer: guardResult.reason!, intent: clarificationIntent,
        parserModel: 'structured-intent-fallback',
        parserProvider: 'rule',
        state: guardState,
        startedAt, providerReady: this.provider.isReady(),
        logger,
      })
      return
    }

    if (await this.tryHandleCompositeRecommendation({
      request,
      writer,
      startedAt,
      requestId,
      traceId,
      sessionId: session.id,
      rawQuery: lastUserText,
      contextualUserText,
      skillContext,
      logger,
    })) {
      return
    }

    // 阶段 0：意图理解计时开始
    const intentStartedAt = Date.now()
    const intentResolution = await this.resolveIntent({
      request,
      rawQuery: contextualUserText,
      fallbackIntent,
      followUpHint: recentFollowUpIntentHint,
      providerReady: this.provider.isReady(),
    })
    const intentMs = Date.now() - intentStartedAt
    let intent = intentResolution.intent
    intent.viewportContext = deriveViewportContext(request) || intent.viewportContext
    const parserModel = intentResolution.source === 'embedding'
      ? 'embedding-intent-classifier'
      : (intentResolution.source === 'llm' ? 'agent-intent-understanding' : 'structured-intent-fallback')
    const parserProvider = intentResolution.source === 'embedding'
      ? 'embedding'
      : (intentResolution.source === 'llm' ? 'llm' : 'rule')
    let categoryMatchScore: number | null = null

    const shouldKeepFollowUpCategory = isEllipticalFollowUpQuery(lastUserText)
      && Boolean(intent.categoryKey || intent.categoryMain || intent.categorySub)

    if (this.categoryIndex?.isReady && this.bridge && intent.queryType !== 'area_overview' && !shouldKeepFollowUpCategory) {
      const categoryMatch = await this.categoryIndex.resolve(intent.rawQuery, this.bridge)
      categoryMatchScore = categoryMatch.score
      if (categoryMatch.matched) {
        intent.categoryMain = categoryMatch.categoryMain
        intent.categorySub = categoryMatch.categorySub
        if (!intent.targetCategory || intent.targetCategory === intent.categoryKey) {
          intent.targetCategory = categoryMatch.categorySub !== categoryMatch.categoryMain
            ? `${categoryMatch.categoryMain}·${categoryMatch.categorySub}`
            : categoryMatch.categoryMain
        }
      }
      // 保存 queryVec 供语义重排序复用（避免重复 embed API 调用）
      if (categoryMatch.queryVec) {
        intent.queryVec = categoryMatch.queryVec
      }
    }
    const baseNeedsWebSearch = Boolean(intent.needsWebSearch)
    const forcedDefaultWebEvidence = !baseNeedsWebSearch && shouldForceDefaultWebEvidence(intent)
    intent.needsWebSearch = baseNeedsWebSearch || forcedDefaultWebEvidence
    intent.toolIntent = intent.toolIntent || defaultToolIntentForQueryType(
      intent.queryType,
      Boolean(intent.needsWebSearch),
      intent.rawQuery,
    )
    intent.searchIntentHint = intent.searchIntentHint || buildDefaultSearchIntentHint({
      queryType: intent.queryType,
      toolIntent: intent.toolIntent,
      targetCategory: intent.targetCategory,
      categoryMain: intent.categoryMain,
      categorySub: intent.categorySub,
      needsWebSearch: Boolean(intent.needsWebSearch),
    })

    // 阶段 5：编译 NL-Contract + 解析证据需求（已从 shadow 升级为 active）
    const contractCompiler = new NLContractCompiler()
    const contract = contractCompiler.compileFromIntent(intent, contextualUserText)
    const requirementResolver = new RequirementResolver()
    const requirements = requirementResolver.resolve({ contract, intent })
    const webEvidencePlanned = Boolean(intent.needsWebSearch) || contract.meta.needsWebEvidence
    const webRequirementMode = resolveWebRequirementMode({
      needsWebEvidence: webEvidencePlanned,
      baseNeedsWebSearch,
      forcedDefaultWebEvidence,
    })
    logger.info('nl_contract', {
      question: contextualUserText,
      scope: contract.meta.scope,
      depth: contract.meta.depth,
      meta: contract.meta,
      actualQueryType: intent.queryType,
      recommendedTrack: requirements.recommendedTrack,
      requiredAtoms: requirements.requiredAtoms,
    })
    const intentInferredByLlm = intentResolution.source === 'llm'
    const requestUserLocation = readUserLocation(request)
    const requestMapViewAnchor = readMapViewAnchor(request)
    const spatialConstraint = this.buildSpatialConstraint(request)
    const state: AgentTurnState = {
      requestId,
      traceId,
      sessionId: session.id,
      toolCalls: [],
      anchors: {},
      spatialConstraint,
      sqlValidationAttempts: 0,
      sqlValidationPassed: 0,
    }
    if (
      intent.queryType === 'compare_places'
      && spatialConstraint?.regions.length >= 2
      && (intent.needsClarification || !intent.placeName || !intent.secondaryPlaceName)
    ) {
      intent = {
        ...intent,
        anchorSource: 'map_view',
        placeName: intent.placeName || spatialConstraint.regions[0]?.name || null,
        secondaryPlaceName: intent.secondaryPlaceName || spatialConstraint.regions[1]?.name || null,
        needsClarification: false,
        clarificationHint: null,
      }
    }
    if (intent.anchorSource === 'user_location' && requestUserLocation) {
      state.anchors.primary = buildUserLocationAnchor(requestUserLocation)
    } else if (intent.anchorSource === 'map_view' && requestMapViewAnchor) {
      state.anchors.primary = requestMapViewAnchor
    }
    const taskMode = classifyTaskMode({
      intent,
      rawQuery: contextualUserText,
    })
    this.initializeExecutionJournal({
      state,
      rawQuery: lastUserText,
      intent,
      taskMode,
      plannerSource: intentResolution.source,
      recommendedTrack: requirements.recommendedTrack,
      needsWebSearch: webEvidencePlanned,
      logger,
    })
    this.noteExecutionStep({
      state,
      stepId: 'understand_request',
      status: 'completed',
      detail: `已识别为 ${intent.queryType}，锚点来源 ${intent.anchorSource || 'unknown'}，计划按 ${requirements.recommendedTrack} 路径执行。`,
      logger,
      eventMessage: 'intent_resolved',
      eventMeta: {
        queryType: intent.queryType,
        anchorSource: intent.anchorSource || null,
        plannerSource: intentResolution.source,
        recommendedTrack: requirements.recommendedTrack,
      },
    })
    this.noteExecutionStep({
      state,
      stepId: 'resolve_scope',
      status: 'running',
      detail: '正在准备锚点、空间范围和执行上下文。',
      logger,
    })
    const previewAnchorLabel = intent.anchorSource === 'user_location' && requestUserLocation
      ? '当前位置'
      : intent.placeName

    await writer.trace({
      request_id: requestId,
      session_id: session.id,
      provider_ready: this.provider.isReady(),
      version: this.options.version,
    })
    await writer.job({
      mode: this.provider.isReady() ? 'agent_full_loop' : 'deterministic_visible_loop',
      provider_ready: this.provider.isReady(),
      version: this.options.version,
      session_id: session.id,
    })
    await writer.stage('intent')
    await writer.thinking({
      status: 'start',
      message: '正在识别问题类型与锚点...',
    })
    await writer.intentPreview({
      queryType: intent.queryType,
      anchorSource: intent.anchorSource || null,
      placeName: intent.placeName,
      secondaryPlaceName: intent.secondaryPlaceName || null,
      rawAnchor: previewAnchorLabel,
      normalizedAnchor: previewAnchorLabel,
      displayAnchor: previewAnchorLabel,
      targetCategory: intent.targetCategory,
      confidence: intentResolution.confidence ?? undefined,
      sourceConfidence: intentResolution.confidence ?? undefined,
      sourceLatencyMs: intentResolution.latencyMs ?? undefined,
      needsClarification: intent.needsClarification,
      clarificationHint: intent.clarificationHint,
      needsWebSearch: Boolean(intent.needsWebSearch),
      webEvidencePlanned,
      webSearchStrategy: contract.meta.webSearchStrategy,
      webRequirementMode,
      intentSource: intentResolution.source,
      parserModel,
      parserProvider,
      categoryMain: intent.categoryMain || null,
      categorySub: intent.categorySub || null,
      categoryResolved: Boolean(intent.categoryMain),
      categoryScore: categoryMatchScore ?? undefined,
    })
    await writer.reasoning({
      content: [
        previewAnchorLabel ? `锚点已经锁定为「${previewAnchorLabel}」` : `NL 理解：将问题判为「${formatIntentQueryType(intent.queryType)}」`,
        previewAnchorLabel ? `，问题判为「${formatIntentQueryType(intent.queryType)}」` : '',
        intent.targetCategory ? `，目标类别是「${intent.targetCategory}」` : '',
        `，来源是 ${parserProvider === 'embedding' ? 'Embedding' : parserProvider === 'llm' ? 'LLM' : '规则'}${intentResolution.confidence != null ? `（${Math.round(intentResolution.confidence * 100)}%）` : ''}`,
        webRequirementMode === 'required'
          ? '，需要联网补充证据。'
          : webRequirementMode === 'default_on'
            ? '，默认联网补充证据。'
            : '，先基于本地空间证据。',
      ].join(''),
    })
    if (intentResolution.usedFallbackProvider && intentResolution.fallbackReason) {
      await writer.reasoning({
        content: `上游意图解析暂时不可用，已回退到确定性链路继续完成：${intentResolution.fallbackReason}`,
      })
    }

    if (intent.queryType === 'unsupported' || intent.needsClarification) {
      if (intent.needsClarification) {
        this.noteExecutionStep({
          state,
          stepId: 'resolve_scope',
          status: 'failed',
          detail: intent.clarificationHint || '当前输入仍缺少继续执行所需的空间信息。',
          logger,
        })
      } else {
        this.noteExecutionStep({
          state,
          stepId: 'collect_evidence',
          status: 'skipped',
          detail: '当前问题超出已支持能力，本轮不进入取证。',
          logger,
        })
      }
      const answer = intent.clarificationHint || this.buildUnsupportedAnswer()
      await this.finishWithoutEvidence({
        writer,
        answer,
        intent,
        parserModel,
        parserProvider,
        state,
        startedAt,
        providerReady: this.provider.isReady(),
      })
      return
    }

    await writer.stage('memory')
    await writer.thinking({
      status: 'start',
      message: '正在读取会话上下文...',
    })
    const profiles = await this.memory.loadProfiles()
    const manifests = await this.manifestLoader.loadAll()
    const skills = this.options.registry.list()
      .map((summary) => this.options.registry.get(summary.name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))
    const tools = buildToolSchemas({ skills, manifests })
    const toolLoopMaxRounds = this.resolveToolLoopMaxRounds(taskMode)
    const toolLoopTimeoutMs = taskMode === 'analysis'
      ? getDefaultLlmAnalysisTimeoutMs()
      : getDefaultLlmQueryTimeoutMs()
    const toolLoopUserMessage = this.buildToolLoopUserMessage({
      rawQuery: contextualUserText,
      intent,
      intentSource: intentResolution.source,
    })
    const systemPrompt = this.alivePromptBuilder.build({
      sessionId: session.id,
      profiles,
      memory: {
        summary: conversationSnapshot.summary,
        recentTurns: conversationSnapshot.recentTurns,
      },
      skillSnippets: manifests.map((manifest) => manifest.promptSnippet),
      requestContext: {
        rawQuery: contextualUserText,
        intentHint: intent.queryType,
        intentSource: intentResolution.source,
        anchorHint: intent.anchorSource || null,
        spatialScopeHint: this.describeSpatialConstraint(state.spatialConstraint || null),
        taskModeHint: taskMode,
      },
    })

    await writer.stage('tool_select')
    await writer.thinking({
      status: 'start',
      message: requirements.recommendedTrack === 'fast'
        ? '已规划确定性 Fast Track，零 LLM 并行取证...'
        : '已规划 Deep Track，确定性取证 + LLM 补充...',
    })
    this.noteExecutionStep({
      state,
      stepId: 'collect_evidence',
      status: 'running',
      detail: `正在按 ${requirements.recommendedTrack} 路径执行 ${requirements.executionSpecs.length} 个证据探针。`,
      logger,
    })
    if (intent.queryType === 'area_overview' || webEvidencePlanned) {
      this.noteExecutionStep({
        state,
        stepId: 'enrich_evidence',
        status: 'running',
        detail: intent.queryType === 'area_overview'
          ? '正在补 AOI、用地、热点与语义证据。'
          : '正在补充联网或外部对齐证据。',
        logger,
      })
    }

    let execution: Awaited<ReturnType<typeof runFunctionCallingLoop>>
    let toolLoopUsedFallbackProvider = Boolean(intentResolution.usedFallbackProvider)
    // 阶段 0：证据采集计时开始
    const evidenceStartedAt = Date.now()

    // 阶段 5+7：Fast Track / Deep Track 分流
    const executeToolCallDelegate = async (call: { id: string, name: string, arguments: Record<string, unknown> }) => {
      const result = await this.executeToolCall(call as ToolCallRequest, intent, state, skillContext)
      return { content: result.content, trace: result.trace }
    }
    const executeProviderLoopToolCallDelegate = async (call: { id: string, name: string, arguments: Record<string, unknown> }) => {
      const result = await this.executeToolCall(call as ToolCallRequest, intent, state, skillContext)
      return {
        content: serializeToolResultContent(result.content),
        trace: result.trace,
      }
    }
    const useProviderLedFastTrack = requirements.recommendedTrack === 'fast'
      && isProviderLedFastTrackEnabled()
      && this.provider.isReady()
      && !(this.provider instanceof InMemoryLLMProvider)
      && intentResolution.source !== 'llm'

    if (requirements.recommendedTrack === 'fast') {
      if (useProviderLedFastTrack) {
        await writer.reasoning({
          content: 'Fast Track 启动：当前使用自定义 provider，优先走 provider-led tool loop，避免把确定性兜底误当成 provider 已完成的证据链。',
        })
        try {
          execution = await runFunctionCallingLoop({
            provider: activeProvider,
            tools,
            maxRounds: toolLoopMaxRounds,
            requestTimeoutMs: toolLoopTimeoutMs,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: toolLoopUserMessage },
            ],
            onAssistantMessage: async (assistantMessage, meta) => {
              if (meta.finishReason !== 'tool_calls') return
              const reasoningSnippet = extractAssistantReasoningSnippet(assistantMessage)
              if (!reasoningSnippet) return
              await writer.reasoning({
                round: meta.round + 1,
                content: reasoningSnippet,
              })
            },
            onToolCall: async (call) => {
              await writer.stage('tool_run')
              await writer.reasoning({
                content: describeToolIntent(call),
              })
              return executeProviderLoopToolCallDelegate(call)
            },
          })
        } catch (error) {
          if (error instanceof ToolExecutionAbortError) throw error
          await writer.reasoning({
            content: '自定义 provider 的 Fast Track tool loop 失败，已回退到确定性取证，避免整轮中断。',
          })
          const fastRuntime = new DeterministicEvidenceRuntime()
          const traces = await fastRuntime.execute({
            specs: requirements.executionSpecs,
            intent,
            state,
            writer,
            executeToolCall: executeToolCallDelegate,
          })
          execution = { assistantMessage: null, traces }
          toolLoopUsedFallbackProvider = true
        }
      } else {
        // ── Fast Track：确定性并行执行，零 LLM ──
        await writer.reasoning({
          content: `Fast Track 启动：${requirements.requiredAtoms.join(', ')}，共 ${requirements.executionSpecs.length} 个探针并行执行。`,
        })
        const fastRuntime = new DeterministicEvidenceRuntime()
        const traces = await fastRuntime.execute({
          specs: requirements.executionSpecs,
          intent,
          state,
          writer,
          executeToolCall: executeToolCallDelegate,
        })
        execution = { assistantMessage: null, traces }
      }
    } else {
      // ── Deep Track：确定性先跑一轮，不足则最多 1 轮 LLM 补充（逃逸阀）──
      await writer.reasoning({
        content: `Deep Track 启动：先确定性执行 ${requirements.requiredAtoms.join(', ')}，再按需补充。`,
      })
      const fastRuntime = new DeterministicEvidenceRuntime()
      const deterministicTraces = await fastRuntime.execute({
        specs: requirements.executionSpecs,
        intent,
        state,
        writer,
        executeToolCall: executeToolCallDelegate,
      })

      // 阶段 7：检查证据是否足够，不足则启动逃逸阀
      const evidenceGap = this.assessEvidenceGap(state, requirements)
      if (evidenceGap.needsSupplement) {
        await writer.reasoning({
          content: `证据缺口检测：已有 ${evidenceGap.availableAtoms.join(', ')}，仍需补充。启动逃逸阀（最多 1 轮 LLM）。`,
        })
        try {
          const supplementExecution = await runFunctionCallingLoop({
            provider: activeProvider,
            tools,
            maxRounds: 1,
            requestTimeoutMs: toolLoopTimeoutMs,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  toolLoopUserMessage,
                  `⚠️ 逃逸阀模式：你已经拿到了这些证据：${evidenceGap.availableAtoms.join(', ')}。`,
                  '请判断还需要补什么，最多再调用一轮工具。',
                ].join('\n'),
              },
            ],
            onAssistantMessage: async (assistantMessage, meta) => {
              if (meta.finishReason !== 'tool_calls') return
              const reasoningSnippet = extractAssistantReasoningSnippet(assistantMessage)
              if (!reasoningSnippet) return
              await writer.reasoning({
                round: meta.round + 1,
                content: reasoningSnippet,
              })
            },
            onToolCall: async (call) => {
              await writer.stage('tool_run')
              await writer.reasoning({
                content: describeToolIntent(call),
              })
              await writer.thinking({
                status: 'start',
                message: `正在执行 ${call.name}.${String(call.arguments.action || '')}...`,
              })
              const result = await this.executeToolCall(call, intent, state, skillContext)
              return {
                content: serializeToolResultContent(result.content),
                trace: result.trace,
              }
            },
          })
          execution = {
            assistantMessage: supplementExecution.assistantMessage,
            traces: [...deterministicTraces, ...supplementExecution.traces],
          }
        } catch (error) {
          if (error instanceof ToolExecutionAbortError) throw error
          // 逃逸阀 LLM 失败，仍然用确定性结果
          execution = { assistantMessage: null, traces: deterministicTraces }
          toolLoopUsedFallbackProvider = true
        }
      } else {
        execution = { assistantMessage: null, traces: deterministicTraces }
      }
    }

    // 阶段 0：证据采集计时结束
    const evidenceRuntimeMs = Date.now() - evidenceStartedAt

    // resolve_anchor 返回 unresolved（无坐标）时，fallback 到 viewport center
    if (hasCoordinates(requestMapViewAnchor) && state.anchors.primary) {
      const primary = state.anchors.primary as ResolvedAnchor
      if (!Number.isFinite(primary.lon) || !Number.isFinite(primary.lat)) {
        console.log(`[AnchorFallback] resolve_anchor 未命中坐标，fallback 到 viewport center`)
        state.anchors.primary = {
          ...requestMapViewAnchor,
          place_name: primary.place_name || requestMapViewAnchor.place_name,
          display_name: primary.display_name || requestMapViewAnchor.display_name,
          resolved_place_name: primary.resolved_place_name || primary.place_name || requestMapViewAnchor.resolved_place_name,
          source: 'map_view_fallback',
        }
      }
    }

    if (
      intent.queryType === 'nearest_station'
      && intent.anchorSource === 'place'
      && intent.placeName
      && !hasCoordinates(state.anchors.primary)
    ) {
      await writer.reasoning({
        content: 'provider 没有先完成锚点解析，正在按地点名补做最近地铁站兜底取证。',
      })
      try {
        await this.executeToolCall({
          id: 'fallback_resolve_anchor_primary',
          name: 'postgis',
          arguments: {
            action: 'resolve_anchor',
            payload: {
              place_name: intent.placeName,
              role: 'primary',
            },
          },
        }, intent, state, skillContext)

        if (hasCoordinates(state.anchors.primary)) {
          await this.executeToolCall({
            id: 'fallback_nearest_station_lookup',
            name: 'postgis',
            arguments: {
              action: 'execute_spatial_sql',
              payload: {
                template: 'nearest_station',
                category_key: 'metro_station',
                limit: 8,
              },
            },
          }, intent, state, skillContext)
        }
      } catch (error) {
        if (error instanceof ToolExecutionAbortError) {
          await writer.reasoning({
            content: '最近地铁站兜底取证没有成功，接下来会按现有证据继续判断。',
          })
        } else {
          throw error
        }
      }
    }

    const primaryAnchor = state.anchors.primary
    const secondaryAnchor = state.anchors.secondary
    this.noteExecutionStep({
      state,
      stepId: 'resolve_scope',
      status: 'completed',
      detail: hasCoordinates(primaryAnchor)
        ? `已锁定主锚点 ${primaryAnchor?.resolved_place_name || primaryAnchor?.display_name || primaryAnchor?.place_name || intent.placeName || '目标地点'}。`
        : `已完成范围准备，当前按 ${this.describeSpatialConstraint(state.spatialConstraint || null)} 执行。`,
      logger,
    })
    const unresolvedPrimaryPlaceAnchor = intent.anchorSource === 'place'
      && ['nearby_poi', 'nearest_station', 'area_overview'].includes(intent.queryType)
      && !hasCoordinates(primaryAnchor)
      && state.toolCalls.some((trace) =>
        trace.skill === 'postgis'
        && trace.action === 'resolve_anchor'
        && trace.status === 'error'
        && normalizeToolRole(trace.payload?.role) === 'primary',
      )
    if (unresolvedPrimaryPlaceAnchor) {
      const clarificationIntent: DeterministicIntent = {
        ...intent,
        needsClarification: true,
        clarificationHint: `我这轮没有定位到「${intent.placeName || '目标地点'}」。请告诉我更完整的地名，或者把地图移动到目标区域后再问我。`,
      }
      this.noteExecutionStep({
        state,
        stepId: 'resolve_scope',
        status: 'failed',
        detail: clarificationIntent.clarificationHint || '当前主锚点未能稳定解析。',
        logger,
      })
      await this.finishWithoutEvidence({
        writer,
        answer: clarificationIntent.clarificationHint || `我这轮没有定位到「${intent.placeName || '目标地点'}」。请告诉我更完整的地名，或者把地图移动到目标区域后再问我。`,
        intent: clarificationIntent,
        parserModel,
        parserProvider,
        state,
        startedAt,
        providerReady: this.provider.isReady(),
        logger,
      })
      return
    }
    const evidenceView = await this.buildEvidenceView(intent, state, primaryAnchor, secondaryAnchor)
    await this.enrichAreaViewWithRegionEncodingIfNeeded({
      intent,
      state,
      context: skillContext,
      writer,
      view: evidenceView,
    })
    await this.enrichAreaViewWithPoiProfilesIfNeeded({
      intent,
      state,
      context: skillContext,
      writer,
      view: evidenceView,
    })
    await this.enrichSimilarRegionViewIfNeeded({
      intent,
      state,
      context: skillContext,
      writer,
      view: evidenceView,
    })
    state.evidenceView = evidenceView

    const evidenceCount = this.resolveEvidenceCount(evidenceView)
    this.noteExecutionStep({
      state,
      stepId: 'collect_evidence',
      status: 'completed',
      detail: `已整理 ${evidenceCount} 条核心证据，累计工具调用 ${state.toolCalls.length} 次。`,
      logger,
      eventMessage: 'evidence_collected',
      eventMeta: {
        evidenceCount,
        toolCallCount: state.toolCalls.length,
        viewType: evidenceView.type,
      },
    })
    if (intent.queryType === 'area_overview' || webEvidencePlanned) {
      this.noteExecutionStep({
        state,
        stepId: 'enrich_evidence',
        status: 'completed',
        detail: intent.queryType === 'area_overview'
          ? '已补充区域分析所需的结构化证据。'
          : '已完成本轮外部证据补充与对齐。',
        logger,
      })
    }
    console.log(`[诊断] evidenceCount=${evidenceCount}, items=${evidenceView.items.length}, type=${evidenceView.type}, anchor=${!!primaryAnchor}, hasCoord=${hasCoordinates(primaryAnchor)}`)
    const decision = this.confidenceGate.evaluate({
      anchorResolved: intent.queryType === 'similar_regions' || hasCoordinates(primaryAnchor),
      evidenceCount,
      hasConflict: false,
    })
    console.log(`[诊断] decision=${decision.status}, reason=${decision.reason}`)

    await writer.stage('evidence')
    await writer.thinking({
      status: 'start',
      message: '正在整理证据视图...',
    })

    if (evidenceView.boundary) {
      await writer.boundary(evidenceView.boundary)
    }
    if (evidenceView.spatialClusters) {
      await writer.spatialClusters(evidenceView.spatialClusters)
    }
    if (evidenceView.vernacularRegions?.length) {
      await writer.vernacularRegions(evidenceView.vernacularRegions)
    }
    if (evidenceView.fuzzyRegions?.length) {
      await writer.fuzzyRegions(evidenceView.fuzzyRegions)
    }

    const rendered = this.renderAnswer(evidenceView)
    const renderedEvidenceCount = Math.max(
      rendered.pois.length || 0,
      this.resolveEvidenceCount(evidenceView),
    )
    const llmAnswer = extractAssistantTextContent(execution.assistantMessage)
    const shouldSkipFinalSynthesis = requirements.recommendedTrack === 'fast'
      && ['nearby_poi', 'nearest_station'].includes(intent.queryType)
      && renderedEvidenceCount > 0
    // 阶段 0：合成回答计时开始
    const synthesisStartedAt = Date.now()
    this.noteExecutionStep({
      state,
      stepId: 'synthesize_answer',
      status: 'running',
      detail: '正在整合证据并选择最终回答来源。',
      logger,
    })
    const synthesizedAnswer = decision.status === 'allow' && !shouldSkipFinalSynthesis
      ? await this.synthesizeGroundedAnswer({
        provider: this.provider,
        contract,
        intent,
        evidenceView,
        rendered,
        toolCalls: state.toolCalls,
        spatialConstraint: state.spatialConstraint || null,
        rawQuery: lastUserText,
      })
      : null
    const synthesisMs = Date.now() - synthesisStartedAt
    const groundedSynthesizedAnswer = synthesizedAnswer && this.isAnswerGrounded(synthesizedAnswer, evidenceView)
      ? synthesizedAnswer
      : null
    const providerMentionsEvidence = llmAnswer
      && (
        rendered.pois.some((item) => llmAnswer.toLowerCase().includes(String(item.name || '').trim().toLowerCase()))
        || [evidenceView.anchor.placeName, evidenceView.anchor.displayName, evidenceView.anchor.resolvedPlaceName]
          .some((name) => llmAnswer.toLowerCase().includes(String(name || '').trim().toLowerCase()))
      )
    const groundedLlmAnswer = intent.queryType !== 'area_overview' && this.isAnswerGrounded(llmAnswer, evidenceView)
      ? llmAnswer
      : intent.queryType !== 'area_overview' && providerMentionsEvidence
        ? llmAnswer
      : ''
    const providerReady = this.provider.isReady()
    // 阶段 8：Fast Track 的确定性 trace 也算有效证据，不再仅依赖 agent-led 判断
    const hasFastTrackEvidence = requirements.recommendedTrack === 'fast'
      && state.toolCalls.some(t => t.status === 'done' && t.skill === 'postgis' && t.action === 'execute_spatial_sql')
    const areaInsightAgentLedEvidence = intent.queryType === 'area_overview'
      && (hasFastTrackEvidence || hasAgentLedAreaInsightEvidence(state.toolCalls))
    const prefersTransparentAnalysisFailure = providerReady
      && intent.queryType === 'area_overview'
      && !areaInsightAgentLedEvidence
    let answerSource = 'deterministic_renderer'
    let answer = ''

    if (decision.status === 'allow') {
      if (groundedLlmAnswer) {
        answer = groundedLlmAnswer
        answerSource = 'llm_direct'
      } else if (groundedSynthesizedAnswer) {
        answer = groundedSynthesizedAnswer
        answerSource = 'llm_synthesized'
      } else if (prefersTransparentAnalysisFailure) {
        answer = '当前还没有拿到足够的分析级证据，这一轮我先不把固定草稿冒充成结论。你可以继续追问更具体的方向，或者让我重新分析当前区域。'
        answerSource = 'insufficient_evidence'
      } else {
        answer = rendered.answer
        answerSource = 'deterministic_renderer'
      }
    } else if (prefersTransparentAnalysisFailure && decision.reason === 'insufficient_evidence') {
      answer = '当前还没有拿到足够的分析级证据，这一轮先不下高置信结论。你可以继续追问更具体的方向，或者让我重新分析当前区域。'
      answerSource = 'insufficient_evidence'
    } else {
      answer = decision.message || rendered.answer
      answerSource = decision.status === 'clarify' ? 'clarification' : 'deterministic_renderer'
    }

    if (
      evidenceView.type === 'area_overview'
      && (answerSource.includes('insufficient_evidence') || !areaInsightAgentLedEvidence)
    ) {
      evidenceView.areaSubject = undefined
    }

    if (toolLoopUsedFallbackProvider && answerSource === 'deterministic_renderer') {
      answerSource = 'fallback_deterministic_renderer'
    } else if (toolLoopUsedFallbackProvider && answerSource === 'insufficient_evidence') {
      answerSource = 'fallback_insufficient_evidence'
    }

    const markdownAnswer = this.ensureMarkdownAnswer({
      answer,
      renderedAnswer: rendered.answer,
      queryType: intent.queryType,
      answerSource,
    })
    answer = markdownAnswer.answer
    if (markdownAnswer.usedRenderedAnswer && answerSource === 'llm_synthesized') {
      answerSource = 'deterministic_renderer'
    }

    if (decision.status === 'allow' && groundedLlmAnswer) {
      await writer.reasoning({
        content: '这一轮最终回答直接沿用了模型基于已验证证据给出的结论，没有再退回确定性模板。',
      })
    } else if (decision.status === 'allow' && groundedSynthesizedAnswer) {
      await writer.reasoning({
        content: '已根据已验证的结构证据、区域主语和热点分布重新组织最终回答，避免直接复读兜底模板。',
      })
    } else if (decision.status === 'allow' && synthesizedAnswer && !groundedSynthesizedAnswer && !prefersTransparentAnalysisFailure) {
      await writer.reasoning({
        content: '模型给出了润色稿，但它没有充分落到已验证样本上，所以这一轮继续以证据版回答为准，避免“说得像但证据没跟上”。',
      })
    } else if (prefersTransparentAnalysisFailure && answerSource === 'insufficient_evidence') {
      await writer.reasoning({
        content: 'provider 虽然可用，但这一轮没有真正形成分析级证据链，所以我没有再把 deterministic area template 当成最终回答。',
      })
    }
    this.noteExecutionStep({
      state,
      stepId: 'synthesize_answer',
      status: 'completed',
      detail: `最终采用 ${answerSource} 输出结果。`,
      logger,
      eventMessage: 'answer_synthesized',
      eventMeta: {
        answerSource,
        decision: decision.status,
        reason: decision.reason,
      },
    })

    await writer.stage('answer')
    await writer.thinking({
      status: 'end',
      message: '证据整理完成，正在生成结果...',
    })
    await writer.pois(rendered.pois)

    const stats = this.buildStats({
      intent,
      startedAt,
      traceId,
      sessionId: session.id,
      providerReady,
      evidenceCount: renderedEvidenceCount,
      anchor: primaryAnchor || null,
      toolCalls: state.toolCalls,
      decision: decision.reason,
      taskMode,
      answerSource,
      recommendedTrack: requirements.recommendedTrack,
    })
    this.noteExecutionStep({
      state,
      stepId: 'verify_answer',
      status: 'running',
      detail: '正在核对最终回答与证据是否一致。',
      logger,
    })
    this.finalizeExecutionJournal({
      state,
      logger,
      verificationStatus: decision.status,
      verificationReason: decision.reason,
      answerGrounded: this.isAnswerGrounded(answer, evidenceView),
      evidenceCount: renderedEvidenceCount,
      answerSource,
    })

    await writer.stats(stats)
    await this.streamAnswerChunks(writer, answer)
    await writer.refinedResult({
      answer,
      answer_source: answerSource,
      results: {
        pois: rendered.pois,
        stats,
        evidence_view: evidenceView,
      },
      intent: {
        queryType: intent.queryType,
        intentMode: intent.intentMode,
        placeName: intent.placeName,
        targetCategory: intent.targetCategory,
        categoryMain: intent.categoryMain,
        categorySub: intent.categorySub,
        needsWebSearch: Boolean(intent.needsWebSearch),
        webEvidencePlanned,
        webSearchStrategy: contract.meta.webSearchStrategy,
        webRequirementMode,
        toolIntent: intent.toolIntent || null,
        searchIntentHint: intent.searchIntentHint || null,
        intentSource: intentResolution.source,
        sourceConfidence: intentResolution.confidence ?? null,
        sourceLatencyMs: intentResolution.latencyMs ?? null,
        categoryScore: categoryMatchScore,
        parserModel,
        parserProvider,
      },
      tool_calls: state.toolCalls,
      trace_id: traceId,
    })
    // 阶段 8：计算 LLM 调用轮次 — Phase 1 意图理解 + Phase 2 逃逸阀
    const llmRoundCount = (intentInferredByLlm ? 1 : 0)
      + (requirements.recommendedTrack === 'fast' ? 0 : (execution.assistantMessage ? 1 : 0))
    this.recordRequestMetrics({
      startedAt,
      state,
      answer,
      evidenceView,
      intentMs,
      evidenceRuntimeMs,
      synthesisMs,
      rawQuery: lastUserText,
      queryType: intent.queryType,
      llmRoundCount,
    })
    await writer.done({
      duration_ms: Date.now() - startedAt,
      session_id: session.id,
    })

    try {
      await this.memory.recordTurn(session.id, {
        traceId,
        userQuery: extractLastUserText(request.messages),
        answer,
        intent: {
          queryType: intent.queryType,
          targetCategory: intent.targetCategory,
          categoryKey: intent.categoryKey,
          categoryMain: intent.categoryMain,
          categorySub: intent.categorySub,
          needsWebSearch: intent.needsWebSearch,
          toolIntent: intent.toolIntent,
          searchIntentHint: intent.searchIntentHint,
        },
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      logger.warn('Failed to persist completed chat turn after SSE response finished', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async finishWithoutEvidence(input: {
    writer: SSEWriter
    answer: string
    intent: DeterministicIntent
    parserModel?: string
    parserProvider?: string
    state: AgentTurnState
    startedAt: number
    providerReady: boolean
    logger?: ReturnType<typeof createLogger>
  }) {
    const answerSource = input.intent.needsClarification ? 'clarification' : 'insufficient_evidence'
    const verificationStatus = input.intent.needsClarification ? 'clarify' : 'degraded'
    const verificationReason = input.intent.needsClarification ? 'unresolved_anchor' : 'insufficient_evidence'
    if (input.intent.queryType !== 'composite_recommendation') {
      this.noteExecutionStep({
        state: input.state,
        stepId: input.intent.needsClarification ? 'resolve_scope' : 'collect_evidence',
        status: 'failed',
        detail: input.answer,
        logger: input.logger,
      })
      this.noteExecutionStep({
        state: input.state,
        stepId: 'enrich_evidence',
        status: 'skipped',
        detail: '主流程已提前结束，本轮不再继续补充证据。',
        logger: input.logger,
      })
    }
    this.noteExecutionStep({
      state: input.state,
      stepId: 'synthesize_answer',
      status: 'completed',
      detail: '根据当前不足的输入或证据，返回澄清/降级回答。',
      logger: input.logger,
    })
    this.noteExecutionStep({
      state: input.state,
      stepId: 'verify_answer',
      status: 'running',
      detail: '正在核对澄清/降级回答的触发原因。',
      logger: input.logger,
    })
    this.finalizeExecutionJournal({
      state: input.state,
      logger: input.logger,
      verificationStatus,
      verificationReason,
      answerGrounded: false,
      evidenceCount: 0,
      answerSource,
    })
    await input.writer.stage('answer')
    await input.writer.thinking({
      status: 'end',
      message: '当前问题需要补充信息后才能继续。',
    })
    const stats = this.buildStats({
      intent: input.intent,
      startedAt: input.startedAt,
      traceId: input.state.traceId,
      sessionId: input.state.sessionId,
      providerReady: input.providerReady,
      evidenceCount: 0,
      anchor: null,
      toolCalls: input.state.toolCalls,
      decision: verificationReason,
      taskMode: classifyTaskMode({
        intent: input.intent,
        rawQuery: input.intent.rawQuery,
      }),
      answerSource,
    })
    await input.writer.stats(stats)
    await this.streamAnswerChunks(input.writer, input.answer)
    await input.writer.refinedResult({
      answer: input.answer,
      answer_source: answerSource,
      results: {
        pois: [],
        stats,
        evidence_view: {
          type: 'poi_list',
          anchor: {
            placeName: input.intent.placeName || '',
            displayName: input.intent.placeName || '',
            resolvedPlaceName: input.intent.placeName || '',
          },
          items: [],
          meta: {},
        },
      },
      intent: {
        queryType: input.intent.queryType,
        intentMode: input.intent.intentMode,
        placeName: input.intent.placeName,
        targetCategory: input.intent.targetCategory,
        categoryMain: input.intent.categoryMain,
        categorySub: input.intent.categorySub,
        needsWebSearch: Boolean(input.intent.needsWebSearch),
        webEvidencePlanned: Boolean(input.intent.needsWebSearch),
        webSearchStrategy: null,
        webRequirementMode: input.intent.needsWebSearch ? 'required' : 'local_first',
        parserModel: input.parserModel || null,
        parserProvider: input.parserProvider || null,
      },
      tool_calls: input.state.toolCalls,
      trace_id: input.state.traceId,
    })
    this.recordRequestMetrics({
      startedAt: input.startedAt,
      state: input.state,
      answer: input.answer,
      evidenceView: input.state.evidenceView,
    })
    await input.writer.done({
      duration_ms: Date.now() - input.startedAt,
      session_id: input.state.sessionId,
    })
  }

  private async tryHandleCompositeRecommendation(input: {
    request: ChatRequestV4
    writer: SSEWriter
    startedAt: number
    requestId: string
    traceId: string
    sessionId: string
    rawQuery: string
    contextualUserText: string
    skillContext: ReturnType<typeof createSkillExecutionContext>
    logger: ReturnType<typeof createLogger>
  }) {
    const plan = parseCompositeRecommendationQuery(input.contextualUserText)
    if (!plan) {
      return false
    }

    await this.handleCompositeRecommendation({
      ...input,
      plan,
    })
    return true
  }

  private buildCompositeRecommendationIntent(plan: CompositeRecommendationPlan): DeterministicIntent {
    return {
      queryType: 'composite_recommendation',
      intentMode: 'deterministic_visible_loop',
      rawQuery: plan.rawQuery,
      placeName: `${plan.corridor.startPlaceName} - ${plan.corridor.endPlaceName}`,
      anchorSource: 'place',
      secondaryPlaceName: plan.destination.placeName,
      targetCategory: `${plan.corridor.targetCategory} + ${plan.destination.targetCategory}`,
      comparisonTarget: null,
      categoryKey: null,
      radiusM: defaultRadiusForQueryType('composite_recommendation'),
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      toolIntent: null,
      searchIntentHint: null,
    }
  }

  private buildCompositeStageIntent(input: {
    rawQuery: string
    placeName: string
    targetCategory: string
    categoryKey: string
    categoryMain?: string | null
    categorySub?: string | null
  }): DeterministicIntent {
    return {
      queryType: 'nearby_poi',
      intentMode: 'deterministic_visible_loop',
      rawQuery: input.rawQuery,
      placeName: input.placeName,
      anchorSource: 'place',
      secondaryPlaceName: null,
      targetCategory: input.targetCategory,
      comparisonTarget: null,
      categoryKey: input.categoryKey,
      categoryMain: input.categoryMain || null,
      categorySub: input.categorySub || null,
      radiusM: defaultRadiusForQueryType('nearby_poi'),
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      toolIntent: 'candidate_lookup',
      searchIntentHint: null,
    }
  }

  private async resolveCompositeAnchor(input: {
    intent: DeterministicIntent
    placeName: string
    role: string
    state: AgentTurnState
    skillContext: ReturnType<typeof createSkillExecutionContext>
  }) {
    await this.executeToolCall({
      id: randomUUID(),
      name: 'postgis',
      arguments: {
        action: 'resolve_anchor',
        payload: {
          place_name: input.placeName,
          role: input.role,
        },
      },
    }, input.intent, input.state, input.skillContext)

    const anchor = input.state.anchors[input.role]
    return hasCoordinates(anchor) ? anchor : null
  }

  private buildCompositeCorridorSql(input: {
    intent: DeterministicIntent
    startAnchor: ResolvedAnchor
    endAnchor: ResolvedAnchor
    destinationAnchor?: ResolvedAnchor | null
    limit: number
  }) {
    const startPointGeography = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(input.startAnchor.lon)}, ${formatNumericLiteral(input.startAnchor.lat)}), 4326)::geography`
    const endPointGeography = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(input.endAnchor.lon)}, ${formatNumericLiteral(input.endAnchor.lat)}), 4326)::geography`
    const corridorBufferM = Math.min(Math.max(Math.round((input.intent.radiusM || 800) * 0.45), 240), 420)
    const corridorGeometry = `ST_ConvexHull(ST_Collect(ST_Buffer(${startPointGeography}, ${corridorBufferM})::geometry, ST_Buffer(${endPointGeography}, ${corridorBufferM})::geometry))`
    const categoryFilters = this.buildCategoryFilters(
      input.intent.categoryKey || '',
      [],
      input.intent.categoryMain,
      input.intent.categorySub,
    )
    const destinationPointGeography = input.destinationAnchor && hasCoordinates(input.destinationAnchor)
      ? `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(input.destinationAnchor.lon)}, ${formatNumericLiteral(input.destinationAnchor.lat)}), 4326)::geography`
      : null

    const selectLines = [
      'SELECT id, name, category_main, category_sub, longitude, latitude,',
      `  LEAST(ST_Distance(geom::geography, ${startPointGeography}), ST_Distance(geom::geography, ${endPointGeography})) AS distance_m,`,
      `  ST_Distance(geom::geography, ${startPointGeography}) AS distance_to_start_m,`,
      `  ST_Distance(geom::geography, ${endPointGeography}) AS distance_to_end_m,`,
      `  (ST_Distance(geom::geography, ${startPointGeography}) + ST_Distance(geom::geography, ${endPointGeography})) AS corridor_score_m${destinationPointGeography ? ',' : ''}`,
    ]

    if (destinationPointGeography) {
      selectLines.push(`  ST_Distance(geom::geography, ${destinationPointGeography}) AS destination_distance_m`)
    }

    return [
      ...selectLines,
      'FROM pois',
      `WHERE ST_Intersects(geom, ${corridorGeometry})`,
      ...categoryFilters.where,
      `ORDER BY corridor_score_m ASC${destinationPointGeography ? ', destination_distance_m ASC' : ''}`,
      `LIMIT ${Math.max(input.limit, 1)}`,
    ].join('\n')
  }

  private async executeCompositeSql(input: {
    intent: DeterministicIntent
    sql: string
    stage: string
    state: AgentTurnState
    skillContext: ReturnType<typeof createSkillExecutionContext>
  }) {
    const validation = await this.executeToolCall({
      id: randomUUID(),
      name: 'postgis',
      arguments: {
        action: 'validate_spatial_sql',
        payload: {
          sql: input.sql,
          stage: input.stage,
        },
      },
    }, input.intent, input.state, input.skillContext)
    input.state.sqlValidationAttempts += 1
    if (validation.trace.status !== 'done') {
      return []
    }
    input.state.sqlValidationPassed += 1

    const execution = await this.executeToolCall({
      id: randomUUID(),
      name: 'postgis',
      arguments: {
        action: 'execute_spatial_sql',
        payload: {
          sql: input.sql,
          stage: input.stage,
        },
      },
    }, input.intent, input.state, input.skillContext)

    const result = execution.trace.result as { rows?: Record<string, unknown>[] } | undefined
    return Array.isArray(result?.rows) ? result.rows : []
  }

  private enrichCompositeStageItems(input: {
    items: EvidenceItem[]
    stage: 'corridor' | 'destination'
    anchorName: string
  }) {
    return input.items.map((item, index) => ({
      ...item,
      rank: index + 1,
      meta: {
        ...(item.meta || {}),
        compositeStage: input.stage,
        compositeAnchorName: input.anchorName,
      },
    }))
  }

  private formatCompositeDistance(value: unknown) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 0) {
      return ''
    }

    if (numeric >= 1000) {
      return `${(numeric / 1000).toFixed(numeric >= 3000 ? 0 : 1)}km`
    }

    return `${Math.round(numeric)}m`
  }

  private buildCompositeRecommendationAnswer(input: {
    plan: CompositeRecommendationPlan
    corridorItems: EvidenceItem[]
    destinationItems: EvidenceItem[]
    destinationAnchor: ResolvedAnchor
  }) {
    const corridorLines = input.corridorItems.slice(0, 3).map((item, index) => {
      const rawMeta = item.meta && typeof item.meta === 'object'
        ? item.meta as Record<string, unknown>
        : {}
      const toDestination = this.formatCompositeDistance(rawMeta.destination_distance_m)
      const stageHint = toDestination ? `，去${input.destinationAnchor.resolved_place_name}大约 ${toDestination}` : ''
      return `${index + 1}. ${item.name}（${item.category || '候选点'}${stageHint}）`
    })

    const destinationLines = input.destinationItems.slice(0, 4).map((item, index) => {
      const distanceLabel = this.formatCompositeDistance(item.distance_m)
      const distanceTail = distanceLabel ? `，距${input.destinationAnchor.resolved_place_name}约 ${distanceLabel}` : ''
      return `${index + 1}. ${item.name}（${item.category || '候选点'}${distanceTail}）`
    })

    const routeSummary = input.corridorItems[0]
      ? `建议先在 ${input.plan.corridor.startPlaceName} 和 ${input.plan.corridor.endPlaceName} 之间选一家顺路餐饮，吃完再去 ${input.destinationAnchor.resolved_place_name} 继续逛 ${input.plan.destination.targetCategory}。`
      : `我先帮你锁定了 ${input.destinationAnchor.resolved_place_name} 一带的 ${input.plan.destination.targetCategory}，如果你还想补“中途先吃哪家”我可以继续放宽走廊范围再筛一轮。`

    return [
      `## 中途${input.plan.corridor.targetCategory}`,
      corridorLines.length > 0
        ? corridorLines.join('\n')
        : `在 ${input.plan.corridor.startPlaceName} 和 ${input.plan.corridor.endPlaceName} 之间，这一轮还没筛到稳定的 ${input.plan.corridor.targetCategory} 候选。`,
      '',
      `## 到${input.destinationAnchor.resolved_place_name}后逛什么`,
      destinationLines.length > 0
        ? destinationLines.join('\n')
        : `目前在 ${input.destinationAnchor.resolved_place_name} 周边还没筛到稳定的 ${input.plan.destination.targetCategory} 候选。`,
      '',
      '## 推荐走法',
      routeSummary,
      '如果你还想把“值得逛”进一步细化成品牌偏好、价格带或口碑排序，我可以继续补一轮联网筛选。',
    ].join('\n')
  }

  private async handleCompositeRecommendation(input: {
    request: ChatRequestV4
    writer: SSEWriter
    startedAt: number
    requestId: string
    traceId: string
    sessionId: string
    rawQuery: string
    contextualUserText: string
    plan: CompositeRecommendationPlan
    skillContext: ReturnType<typeof createSkillExecutionContext>
    logger: ReturnType<typeof createLogger>
  }) {
    const intent = this.buildCompositeRecommendationIntent(input.plan)
    const state: AgentTurnState = {
      requestId: input.requestId,
      traceId: input.traceId,
      sessionId: input.sessionId,
      toolCalls: [],
      anchors: {},
      spatialConstraint: this.buildSpatialConstraint(input.request),
      sqlValidationAttempts: 0,
      sqlValidationPassed: 0,
    }
    this.initializeExecutionJournal({
      state,
      rawQuery: input.rawQuery,
      intent,
      taskMode: 'analysis',
      plannerSource: 'rule_composite_detector',
      recommendedTrack: 'composite',
      needsWebSearch: false,
      logger: input.logger,
    })

    await input.writer.trace({
      request_id: input.requestId,
      session_id: input.sessionId,
      provider_ready: this.provider.isReady(),
      version: this.options.version,
    })
    await input.writer.job({
      mode: 'deterministic_visible_loop',
      provider_ready: this.provider.isReady(),
      version: this.options.version,
      session_id: input.sessionId,
    })
    await input.writer.stage('intent')
    await input.writer.thinking({
      status: 'start',
      message: '正在拆解复合行程问题...',
    })
    await input.writer.intentPreview({
      queryType: intent.queryType,
      anchorSource: intent.anchorSource,
      placeName: intent.placeName,
      secondaryPlaceName: input.plan.destination.placeName,
      rawAnchor: intent.placeName,
      normalizedAnchor: intent.placeName,
      displayAnchor: intent.placeName,
      targetCategory: intent.targetCategory,
      needsClarification: false,
      clarificationHint: null,
      needsWebSearch: false,
      webEvidencePlanned: false,
      webSearchStrategy: 'local_first',
      webRequirementMode: 'local_first',
      intentSource: 'rule',
      parserModel: 'composite-intent-detector',
      parserProvider: 'rule',
      categoryMain: null,
      categorySub: null,
      categoryResolved: false,
    })
    await input.writer.reasoning({
      content: `识别到这是“先在 ${input.plan.corridor.startPlaceName} 和 ${input.plan.corridor.endPlaceName} 之间找 ${input.plan.corridor.targetCategory}，再去 ${input.plan.destination.placeName} 继续逛 ${input.plan.destination.targetCategory}”的复合问题，我会分两段取证后再合并回答。`,
    })
    this.noteExecutionStep({
      state,
      stepId: 'decompose_request',
      status: 'completed',
      detail: `已拆成“走廊 ${input.plan.corridor.targetCategory}”和“${input.plan.destination.placeName} ${input.plan.destination.targetCategory}”两段任务。`,
      logger: input.logger,
      eventMessage: 'composite_plan_ready',
      eventMeta: {
        corridorTarget: input.plan.corridor.targetCategory,
        destinationTarget: input.plan.destination.targetCategory,
      },
    })

    const corridorIntent = this.buildCompositeStageIntent({
      rawQuery: input.plan.corridor.stageText,
      placeName: `${input.plan.corridor.startPlaceName} - ${input.plan.corridor.endPlaceName}`,
      targetCategory: input.plan.corridor.targetCategory,
      categoryKey: input.plan.corridor.categoryKey,
    })
    const destinationIntent = this.buildCompositeStageIntent({
      rawQuery: input.plan.destination.stageText,
      placeName: input.plan.destination.placeName,
      targetCategory: input.plan.destination.targetCategory,
      categoryKey: input.plan.destination.categoryKey,
    })

    await input.writer.stage('tool_run')
    await input.writer.reasoning({
      content: '先锁定走廊两端和后续商场锚点。',
    })
    this.noteExecutionStep({
      state,
      stepId: 'resolve_stage_anchors',
      status: 'running',
      detail: '正在定位走廊起点、终点和后续目的地。',
      logger: input.logger,
    })

    const startAnchor = await this.resolveCompositeAnchor({
      intent: corridorIntent,
      placeName: input.plan.corridor.startPlaceName,
      role: 'primary',
      state,
      skillContext: input.skillContext,
    })
    const endAnchor = await this.resolveCompositeAnchor({
      intent: corridorIntent,
      placeName: input.plan.corridor.endPlaceName,
      role: 'secondary',
      state,
      skillContext: input.skillContext,
    })
    const destinationAnchor = await this.resolveCompositeAnchor({
      intent: destinationIntent,
      placeName: input.plan.destination.placeName,
      role: 'destination',
      state,
      skillContext: input.skillContext,
    })

    const unresolvedAnchors = [
      !startAnchor ? input.plan.corridor.startPlaceName : null,
      !endAnchor ? input.plan.corridor.endPlaceName : null,
      !destinationAnchor ? input.plan.destination.placeName : null,
    ].filter((value): value is string => Boolean(value))

    if (unresolvedAnchors.length > 0) {
      this.noteExecutionStep({
        state,
        stepId: 'resolve_stage_anchors',
        status: 'failed',
        detail: `未能稳定定位：${unresolvedAnchors.join('、')}。`,
        logger: input.logger,
      })
      this.noteExecutionStep({
        state,
        stepId: 'collect_corridor_evidence',
        status: 'skipped',
        detail: '锚点未完整定位，走廊证据采集跳过。',
        logger: input.logger,
      })
      this.noteExecutionStep({
        state,
        stepId: 'collect_destination_evidence',
        status: 'skipped',
        detail: '锚点未完整定位，目的地证据采集跳过。',
        logger: input.logger,
      })
      await this.finishWithoutEvidence({
        writer: input.writer,
        answer: `我还没稳定定位到 ${unresolvedAnchors.join('、')}，你可以换一个更明确的名称再试一次。`,
        intent: {
          ...intent,
          needsClarification: true,
          clarificationHint: `我还没稳定定位到 ${unresolvedAnchors.join('、')}，你可以换一个更明确的名称再试一次。`,
        },
        parserModel: 'composite-intent-detector',
        parserProvider: 'rule',
        state,
        startedAt: input.startedAt,
        providerReady: this.provider.isReady(),
        logger: input.logger,
      })
      return
    }

    if (!startAnchor || !endAnchor || !destinationAnchor) {
      return
    }

    const resolvedStartAnchor = startAnchor
    const resolvedEndAnchor = endAnchor
    const resolvedDestinationAnchor = destinationAnchor
    this.noteExecutionStep({
      state,
      stepId: 'resolve_stage_anchors',
      status: 'completed',
      detail: `已锁定 ${resolvedStartAnchor.resolved_place_name}、${resolvedEndAnchor.resolved_place_name} 和 ${resolvedDestinationAnchor.resolved_place_name}。`,
      logger: input.logger,
    })
    this.noteExecutionStep({
      state,
      stepId: 'collect_corridor_evidence',
      status: 'running',
      detail: `正在收集 ${input.plan.corridor.startPlaceName} - ${input.plan.corridor.endPlaceName} 之间的 ${input.plan.corridor.targetCategory}。`,
      logger: input.logger,
    })

    const corridorSql = this.buildCompositeCorridorSql({
      intent: corridorIntent,
      startAnchor: resolvedStartAnchor,
      endAnchor: resolvedEndAnchor,
      destinationAnchor: resolvedDestinationAnchor,
      limit: 8,
    })
    const corridorRows = await this.executeCompositeSql({
      intent: corridorIntent,
      sql: corridorSql,
      stage: 'composite_corridor_search',
      state,
      skillContext: input.skillContext,
    })
    this.noteExecutionStep({
      state,
      stepId: 'collect_corridor_evidence',
      status: 'completed',
      detail: `已拿到 ${corridorRows.length} 条走廊候选。`,
      logger: input.logger,
    })
    this.noteExecutionStep({
      state,
      stepId: 'collect_destination_evidence',
      status: 'running',
      detail: `正在收集 ${input.plan.destination.placeName} 周边的 ${input.plan.destination.targetCategory}。`,
      logger: input.logger,
    })

    const destinationSql = this.buildTemplateSQL(
      destinationIntent,
      resolvedDestinationAnchor,
      destinationIntent.categoryKey || '',
      8,
      'nearby_poi',
      null,
    )
    let destinationRows = await this.executeCompositeSql({
      intent: destinationIntent,
      sql: destinationSql,
      stage: 'composite_destination_search',
      state,
      skillContext: input.skillContext,
    })

    if (destinationRows.length === 0 && destinationIntent.categoryKey === 'fashion') {
      const destinationFallbackIntent = this.buildCompositeStageIntent({
        rawQuery: input.plan.destination.stageText,
        placeName: input.plan.destination.placeName,
        targetCategory: input.plan.destination.targetCategory,
        categoryKey: '',
        categoryMain: '购物服务',
      })
      const fallbackSql = this.buildTemplateSQL(
        destinationFallbackIntent,
        resolvedDestinationAnchor,
        '',
        8,
        'nearby_poi',
        null,
      )
      destinationRows = await this.executeCompositeSql({
        intent: destinationFallbackIntent,
        sql: fallbackSql,
        stage: 'composite_destination_search_fallback',
        state,
        skillContext: input.skillContext,
      })
    }
    this.noteExecutionStep({
      state,
      stepId: 'collect_destination_evidence',
      status: 'completed',
      detail: `已拿到 ${destinationRows.length} 条目的地候选。`,
      logger: input.logger,
    })

    const corridorItems = this.enrichCompositeStageItems({
      items: normalizePoiRows(corridorRows),
      stage: 'corridor',
      anchorName: `${input.plan.corridor.startPlaceName} - ${input.plan.corridor.endPlaceName}`,
    })
    const destinationItems = this.enrichCompositeStageItems({
      items: normalizePoiRows(destinationRows),
      stage: 'destination',
      anchorName: resolvedDestinationAnchor.resolved_place_name,
    })
    const mergedItems = this.mergeEvidenceItems(corridorItems, destinationItems, 12)

    if (mergedItems.length === 0) {
      this.noteExecutionStep({
        state,
        stepId: 'synthesize_answer',
        status: 'completed',
        detail: '两段候选均不稳定，本轮返回降级说明。',
        logger: input.logger,
      })
      await this.finishWithoutEvidence({
        writer: input.writer,
        answer: `我已经拆成“走廊 ${input.plan.corridor.targetCategory} + ${input.plan.destination.placeName} ${input.plan.destination.targetCategory}”两段检索了，但这轮还没拿到稳定候选。你可以换一个更具体的商场或放宽一下范围再试。`,
        intent,
        parserModel: 'composite-intent-detector',
        parserProvider: 'rule',
        state,
        startedAt: input.startedAt,
        providerReady: this.provider.isReady(),
        logger: input.logger,
      })
      return
    }

    await input.writer.stage('evidence')
    await input.writer.reasoning({
      content: `已拿到 ${corridorItems.length} 个走廊 ${input.plan.corridor.targetCategory} 候选，以及 ${destinationItems.length} 个 ${input.plan.destination.placeName} 周边 ${input.plan.destination.targetCategory} 候选，正在合并成一条行程建议。`,
    })

    const evidenceView: EvidenceView = {
      type: 'poi_list',
      anchor: {
        placeName: intent.placeName || '',
        displayName: intent.placeName || '',
        resolvedPlaceName: intent.placeName || '',
      },
      secondaryAnchor: {
        placeName: resolvedDestinationAnchor.place_name,
        displayName: resolvedDestinationAnchor.display_name,
        resolvedPlaceName: resolvedDestinationAnchor.resolved_place_name,
        lon: resolvedDestinationAnchor.lon,
        lat: resolvedDestinationAnchor.lat,
        source: resolvedDestinationAnchor.source,
        coordSys: resolvedDestinationAnchor.coord_sys || null,
      },
      items: mergedItems,
      meta: {
        queryType: 'composite_recommendation',
        composite_plan: {
          corridor: {
            startPlaceName: input.plan.corridor.startPlaceName,
            endPlaceName: input.plan.corridor.endPlaceName,
            targetCategory: input.plan.corridor.targetCategory,
            itemCount: corridorItems.length,
          },
          destination: {
            placeName: resolvedDestinationAnchor.resolved_place_name,
            targetCategory: input.plan.destination.targetCategory,
            itemCount: destinationItems.length,
          },
        },
      },
    }

    const answer = this.buildCompositeRecommendationAnswer({
      plan: input.plan,
      corridorItems,
      destinationItems,
      destinationAnchor: resolvedDestinationAnchor,
    })
    this.noteExecutionStep({
      state,
      stepId: 'synthesize_answer',
      status: 'completed',
      detail: `已把 ${corridorItems.length} 个中途候选和 ${destinationItems.length} 个目的地候选合并成顺路建议。`,
      logger: input.logger,
      eventMessage: 'composite_answer_synthesized',
      eventMeta: {
        corridorCount: corridorItems.length,
        destinationCount: destinationItems.length,
      },
    })

    await input.writer.stage('answer')
    await input.writer.thinking({
      status: 'end',
      message: '两段证据已经合并完成，正在输出结果...',
    })
    await input.writer.pois(mergedItems)

    const stats = this.buildStats({
      intent,
      startedAt: input.startedAt,
      traceId: input.traceId,
      sessionId: input.sessionId,
      providerReady: this.provider.isReady(),
      evidenceCount: mergedItems.length,
      anchor: null,
      toolCalls: state.toolCalls,
      decision: 'composite_recommendation',
      taskMode: 'analysis',
      answerSource: 'deterministic_renderer',
    })
    this.noteExecutionStep({
      state,
      stepId: 'verify_answer',
      status: 'running',
      detail: '正在核对复合推荐答案是否与两段证据一致。',
      logger: input.logger,
    })
    this.finalizeExecutionJournal({
      state,
      logger: input.logger,
      verificationStatus: 'allow',
      verificationReason: 'ok',
      answerGrounded: this.isAnswerGrounded(answer, evidenceView),
      evidenceCount: mergedItems.length,
      answerSource: 'deterministic_renderer',
    })

    await input.writer.stats(stats)
    await this.streamAnswerChunks(input.writer, answer)
    await input.writer.refinedResult({
      answer,
      answer_source: 'deterministic_renderer',
      results: {
        pois: mergedItems,
        stats,
        evidence_view: evidenceView,
      },
      intent: {
        queryType: intent.queryType,
        intentMode: intent.intentMode,
        placeName: intent.placeName,
        secondaryPlaceName: intent.secondaryPlaceName,
        targetCategory: intent.targetCategory,
        categoryMain: null,
        categorySub: null,
        needsWebSearch: false,
        webEvidencePlanned: false,
        webSearchStrategy: 'local_first',
        webRequirementMode: 'local_first',
        toolIntent: null,
        searchIntentHint: null,
        intentSource: 'rule',
        sourceConfidence: 1,
        sourceLatencyMs: null,
        categoryScore: null,
        parserModel: 'composite-intent-detector',
        parserProvider: 'rule',
      },
      tool_calls: state.toolCalls,
      trace_id: input.traceId,
    })
    this.recordRequestMetrics({
      startedAt: input.startedAt,
      state,
      answer,
      evidenceView,
      rawQuery: input.rawQuery,
      queryType: intent.queryType,
      llmRoundCount: 0,
    })
    await input.writer.done({
      duration_ms: Date.now() - input.startedAt,
      session_id: input.sessionId,
    })

    try {
      await this.memory.recordTurn(input.sessionId, {
        traceId: input.traceId,
        userQuery: input.rawQuery,
        answer,
        intent: {
          queryType: intent.queryType,
          placeName: intent.placeName,
          targetCategory: intent.targetCategory,
          categoryKey: null,
          categoryMain: null,
          categorySub: null,
          needsWebSearch: false,
          toolIntent: null,
          searchIntentHint: null,
        },
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      input.logger.warn('Failed to persist composite chat turn after SSE response finished', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async resolveIntent(input: {
    request: ChatRequestV4
    rawQuery: string
    fallbackIntent: DeterministicIntent
    followUpHint?: RecentFollowUpIntentHint | null
    providerReady: boolean
  }): Promise<{
    intent: DeterministicIntent
    source: 'llm' | 'fallback' | 'embedding'
    confidence?: number | null
    latencyMs?: number | null
    fallbackReason?: string | null
    usedFallbackProvider?: boolean
  }> {
    const attemptLlmResolution = async () => {
      if (!input.providerReady) {
        return null
      }

      const llmStartedAt = Date.now()
      const hint = await this.inferIntentWithLlm({
        request: input.request,
        rawQuery: input.rawQuery,
        followUpHint: input.followUpHint || null,
        embeddingResult: embResult,
      })
      const llmLatencyMs = Date.now() - llmStartedAt
      const intent = this.buildIntentFromLlmHint({
        request: input.request,
        fallbackIntent: input.fallbackIntent,
        hint,
      })
      if (!intent) {
        return {
          intent: input.fallbackIntent,
          source: 'fallback' as const,
          latencyMs: llmLatencyMs,
          fallbackReason: hint?.providerErrorMessage || null,
          usedFallbackProvider: Boolean(hint?.providerErrorMessage),
        }
      }

      return {
        intent,
        source: 'llm' as const,
        latencyMs: llmLatencyMs,
        fallbackReason: null,
        usedFallbackProvider: false,
      }
    }

    let embResult: EmbeddingIntentResult | null = null
    let llmAttempted = false

    if (this.intentClassifier?.isReady) {
      embResult = await this.intentClassifier.classify(input.rawQuery)
      if (embResult.usedEmbedding) {
        const preferLlmPlanner = shouldPreferLlmIntentPlanner({
          request: input.request,
          rawQuery: input.rawQuery,
          followUpHint: input.followUpHint,
          embeddingResult: embResult,
        })
        if (preferLlmPlanner) {
          llmAttempted = true
          const llmResolution = await attemptLlmResolution()
          if (llmResolution?.source === 'llm') {
            return llmResolution
          }
        }

        if (embResult.confidence >= 0.5 && embResult.queryType !== 'unsupported') {
          const intent = { ...input.fallbackIntent }
          intent.queryType = embResult.queryType
          intent.needsWebSearch = embResult.needsWebSearch || intent.needsWebSearch
          intent.toolIntent = defaultToolIntentForQueryType(intent.queryType, Boolean(intent.needsWebSearch), intent.rawQuery)
          intent.searchIntentHint = buildDefaultSearchIntentHint({
            queryType: intent.queryType,
            toolIntent: intent.toolIntent,
            targetCategory: intent.targetCategory,
            categoryMain: intent.categoryMain,
            categorySub: intent.categorySub,
            needsWebSearch: Boolean(intent.needsWebSearch),
          })
          // Embedding 分类成功时清除 clarification 标记
          intent.needsClarification = false
          intent.clarificationHint = null
          // Embedding 分类时从 rawQuery 提取锚点地名
          if (!intent.placeName && input.rawQuery) {
            const placeMatch = input.rawQuery.match(/^(.+?)(?:附近|周边|这附近|周围|旁边)/)
              || input.rawQuery.match(/^(.+?)(?:有什么|有没有|哪有|哪有|找)/)
              // 支持"汉口美食推荐""光谷咖啡店推荐"等 地名+品类+推荐/排行 模式
              || input.rawQuery.match(/^([\u4e00-\u9fa5]{2,8}?)(?:美食|餐厅|咖啡|咖啡店|奶茶|小吃|火锅|烧烤|酒店|宾馆|住宿|商场|超市|公园|景点|健身房|影院|药店|便利店|书店|花店|面包|甜品|酒吧|KTV|网吧|洗浴|理发|美容|宠物|医院|诊所|学校|幼儿园|银行|邮局|加油站|停车场|充电站|充电桩|洗车|汽车|房产|租房|中介|装修|家具|家电|数码|手机|电脑|服装|鞋|箱包|珠宝|眼镜|钟表|礼品|玩具|母婴|运动|户外|乐器|书画|古玩|收藏)(?:推荐|排行|排名|榜单|口碑|评价|高分|好评|必吃|必去|网红|人气|特色|好吃|哪家好|哪里好|怎么样|哪个好)/)
            if (placeMatch) {
              const candidate = placeMatch[1].replace(/^(这|那|我|当前|附近)/, '').trim()
              if (candidate.length >= 2 && candidate.length <= 10) {
                intent.placeName = candidate
                // 提取到明确地名时，anchorSource 必须同步切换为 place，
                // 否则后续 handle() 会用 viewport center 作为锚点
                if (intent.anchorSource === 'map_view') {
                  intent.anchorSource = 'place'
                }
              }
            }
          }
          console.log(`[EmbeddingIntent] ✓ queryType=${embResult.queryType} confidence=${embResult.confidence} needsWebSearch=${embResult.needsWebSearch} placeName=${intent.placeName} toolIntent=${intent.toolIntent} (${embResult.latencyMs}ms)`)
          return {
            intent,
            source: 'embedding',
            confidence: embResult.confidence,
            latencyMs: embResult.latencyMs,
            fallbackReason: null,
            usedFallbackProvider: false,
          }
        }
        console.log(`[EmbeddingIntent] ✗ confidence=${embResult.confidence} unsupported=${embResult.queryType === 'unsupported'} preferLlm=${preferLlmPlanner}, fallback to LLM`)
      }
    }

    if (!input.providerReady) {
      return {
        intent: input.fallbackIntent,
        source: 'fallback',
        latencyMs: null,
        fallbackReason: null,
        usedFallbackProvider: false,
      }
    }

    if (!llmAttempted) {
      const llmResolution = await attemptLlmResolution()
      if (llmResolution) {
        return llmResolution
      }
    }

    return {
      intent: input.fallbackIntent,
      source: 'fallback',
      latencyMs: null,
      fallbackReason: null,
      usedFallbackProvider: false,
    }
  }

  private async reinterpretIntentWithLlmIfNeeded(input: {
    request: ChatRequestV4
    rawQuery: string
    fallbackIntent: DeterministicIntent
    providerReady: boolean
  }) {
    const resolved = await this.resolveIntent(input)
    return resolved.intent
  }

  private buildIntentFromLlmHint(input: {
    request: ChatRequestV4
    fallbackIntent: DeterministicIntent
    hint: Awaited<ReturnType<GeoLoomAgent['inferIntentWithLlm']>>
  }) {
    const hint = input.hint
    if (!hint || hint.queryType === 'unsupported') {
      return null
    }

    const hasMapView = Boolean(readMapViewAnchor(input.request))
    const hasUserLocation = Boolean(readUserLocation(input.request))
    const selectedRegions = readRequestRegions(input.request)
    const selectedRegionNames = selectedRegions
      .map((region) => readRegionName(region))
      .filter((name): name is string => Boolean(name))
    const { categoryKey: structuredCategoryKey, targetCategory: structuredTargetCategory } = inferCategoryFromSelections(
      normalizeSelectedCategories(input.request.options?.selectedCategories || []),
    )
    const rawQueryCategoryHint = inferStructuredCategoryFromRawQuery(input.fallbackIntent.rawQuery)
    const explicitPlaceName = readOptionalText(hint.placeName) || extractExplicitPlaceName(input.fallbackIntent.rawQuery)
    const explicitSecondaryPlaceName = readOptionalText(hint.secondaryPlaceName)
    const shouldNormalizeSimilarRegionToAreaOverview = hint.queryType === 'similar_regions'
      && isAreaStructureClassificationQuery(input.fallbackIntent.rawQuery)
      && (hasMapView || Boolean(explicitPlaceName) || selectedRegionNames.length > 0)
    const shouldNormalizeAreaHintToNearbyPoi = hint.queryType === 'area_overview'
      && /附近|周边|旁边|有哪些|有什么|美食|咖啡|酒店|景点/u.test(input.fallbackIntent.rawQuery)
      && Boolean(structuredCategoryKey || rawQueryCategoryHint.categoryKey)
      && !/解读|读懂|总结|业态结构|供给|需求|竞争|开店|片区|区域/u.test(input.fallbackIntent.rawQuery)
    const normalizedQueryType = shouldNormalizeSimilarRegionToAreaOverview
      ? 'area_overview'
      : shouldNormalizeAreaHintToNearbyPoi
        ? 'nearby_poi'
        : hint.queryType
    const lacksStructuredCompareTargets = hint.queryType === 'compare_places'
      && !explicitSecondaryPlaceName
      && selectedRegions.length < 2

    if (lacksStructuredCompareTargets && hasMapView) {
      return {
        ...input.fallbackIntent,
        queryType: 'area_overview',
        intentMode: intentModeFromQueryType('area_overview'),
        placeName: '当前区域',
        secondaryPlaceName: null,
        anchorSource: 'map_view',
        targetCategory: '区域洞察',
        comparisonTarget: null,
        categoryKey: null,
        needsClarification: false,
        clarificationHint: null,
      } satisfies DeterministicIntent
    }

    const fallbackAnchorSource: NonNullable<DeterministicIntent['anchorSource']> = normalizedQueryType === 'compare_places' && selectedRegionNames.length >= 2
      ? 'map_view'
      : explicitPlaceName
        ? 'place'
        : hasMapView && normalizedQueryType === 'area_overview'
        ? 'map_view'
        : hasUserLocation
          ? 'user_location'
          : (input.fallbackIntent.anchorSource || 'place')
    const anchorSource: NonNullable<DeterministicIntent['anchorSource']> = explicitPlaceName && normalizedQueryType !== 'area_overview'
      ? 'place'
      : hint.anchorSource === 'map_view' && hasMapView
        ? 'map_view'
        : hint.anchorSource === 'user_location' && hasUserLocation
        ? 'user_location'
          : hint.anchorSource === 'place' && explicitPlaceName
            ? 'place'
            : fallbackAnchorSource

    const placeName = anchorSource === 'map_view'
      ? (normalizedQueryType === 'compare_places'
          ? (explicitPlaceName || selectedRegionNames[0] || null)
          : (selectedRegionNames[0] || '当前区域'))
      : anchorSource === 'user_location'
        ? null
        : explicitPlaceName
    const secondaryPlaceName = normalizedQueryType === 'compare_places'
      ? (anchorSource === 'map_view'
          ? (explicitSecondaryPlaceName || selectedRegionNames[1] || null)
          : explicitSecondaryPlaceName)
      : null
    const needsClarification = anchorSource === 'map_view'
      ? (normalizedQueryType === 'compare_places'
          ? (!placeName || !secondaryPlaceName)
          : !hasMapView)
      : anchorSource === 'user_location'
        ? !hasUserLocation
        : normalizedQueryType === 'compare_places'
          ? (!placeName || !secondaryPlaceName || Boolean(hint.needsClarification))
          : (!placeName || Boolean(hint.needsClarification))
    const needsWebSearch = Boolean(hint.needsWebSearch)
    const toolIntent = normalizeToolIntentMode(hint.toolIntent)
      || defaultToolIntentForQueryType(normalizedQueryType, needsWebSearch, input.fallbackIntent.rawQuery)
    const searchIntentHint = readOptionalText(hint.searchIntentHint)
      || buildDefaultSearchIntentHint({
        queryType: normalizedQueryType,
        toolIntent,
        targetCategory: readOptionalText(hint.targetCategory) || structuredTargetCategory || rawQueryCategoryHint.targetCategory || input.fallbackIntent.targetCategory,
        needsWebSearch,
      })
    const normalizedTargetCategory = shouldNormalizeAreaHintToNearbyPoi
      ? (input.fallbackIntent.targetCategory || structuredTargetCategory || rawQueryCategoryHint.targetCategory)
      : normalizedQueryType === 'area_overview'
        ? '区域洞察'
        : normalizedQueryType === 'nearest_station'
          ? '地铁站'
          : readOptionalText(hint.targetCategory) || structuredTargetCategory || rawQueryCategoryHint.targetCategory || input.fallbackIntent.targetCategory
    const normalizedCategoryKey = shouldNormalizeAreaHintToNearbyPoi
      ? (structuredCategoryKey || rawQueryCategoryHint.categoryKey || input.fallbackIntent.categoryKey)
      : normalizedQueryType === 'nearest_station'
        ? (readOptionalText(hint.categoryKey) || 'metro_station')
        : readOptionalText(hint.categoryKey) || structuredCategoryKey || rawQueryCategoryHint.categoryKey || input.fallbackIntent.categoryKey

    return {
      ...input.fallbackIntent,
      queryType: normalizedQueryType,
      intentMode: intentModeFromQueryType(normalizedQueryType),
      placeName,
      secondaryPlaceName,
      anchorSource,
      targetCategory: normalizedTargetCategory,
      comparisonTarget: readOptionalText(hint.comparisonTarget) || input.fallbackIntent.comparisonTarget,
      categoryKey: normalizedCategoryKey,
      radiusM: defaultRadiusForQueryType(normalizedQueryType),
      needsClarification,
      clarificationHint: needsClarification
        ? (hint.clarificationHint || this.buildClarificationHintForQueryType(normalizedQueryType))
        : null,
      needsWebSearch,
      toolIntent,
      searchIntentHint,
    } satisfies DeterministicIntent
  }

  private async inferIntentWithLlm(input: {
    request: ChatRequestV4
    rawQuery: string
    followUpHint?: RecentFollowUpIntentHint | null
    embeddingResult?: EmbeddingIntentResult | null
  }): Promise<{
    queryType: DeterministicIntent['queryType']
    anchorSource?: NonNullable<DeterministicIntent['anchorSource']> | null
    placeName?: string | null
    secondaryPlaceName?: string | null
    targetCategory?: string | null
    comparisonTarget?: string | null
    categoryKey?: string | null
    needsClarification?: boolean
    clarificationHint?: string | null
    needsWebSearch?: boolean
    toolIntent?: ToolIntentMode | null
    searchIntentHint?: string | null
    providerErrorMessage?: string | null
  } | null> {
    try {
      const selectedCategories = normalizeSelectedCategories(input.request.options?.selectedCategories || [])
      const selectedRegionNames = readRequestRegions(input.request)
        .map((region) => readRegionName(region))
        .filter((name): name is string => Boolean(name))
      const response = await this.provider.complete({
        messages: [
          {
            role: 'system',
            content: '你是 GeoLoom V4 的意图理解器。你只能返回一个 JSON 对象，不能输出解释，不能调用 tools。',
          },
          {
            role: 'user',
            content: [
              '请先理解用户原问题，再判断应该进入哪条 GeoLoom 主链路。',
              '可选 queryType: nearby_poi | nearest_station | area_overview | similar_regions | compare_places | unsupported。',
              '可选 anchorSource: place | map_view | user_location | unknown。',
              '如果 anchorSource=place，请尽量直接给出 placeName；如果是双地点比较，请补 secondaryPlaceName。',
              '如果 queryType 涉及明确品类，也可以补 categoryKey / targetCategory。',
              '不要因为用户换一种说法就判 unsupported。',
              'selectedCategories 和 selectedRegions 只是结构化上下文线索，不能替代对 user_query 的自然语言理解。',
              '如果用户是在让系统解读、分析、读懂、看看某片区域，而当前有地图范围上下文，这通常应判成 area_overview + map_view。',
              '⚠️ 重要区分：当用户问「有哪些+具体品类」（如"有哪些高分酒店"、"附近有什么好吃的"、"周边有哪些咖啡店"），这是 nearby_poi 而不是 area_overview。只有问片区整体特征（配套、业态、结构、机会）时才是 area_overview。',
              '请同时给出 toolIntent，用来指导下游工具编排。可选值：candidate_lookup | candidate_reputation | nearest_transit | area_insight | place_comparison | similar_region_search。',
              '如果这是“附近有哪些高分/推荐/口碑好的X”这类问题，请把 toolIntent 设为 candidate_reputation，并补 searchIntentHint，例如“酒店 评分 推荐”。',
              '如果这是普通“附近有什么X”这类问题，请把 toolIntent 设为 candidate_lookup。',
              '如果这是区域解读题，请把 toolIntent 设为 area_insight；最近地铁站设为 nearest_transit；双地点比较设为 place_comparison；相似片区设为 similar_region_search。',
              '如果 user_query 里出现“补充追问：”，说明前半句是上一轮原问题，后半句是本轮省略式追问；你要结合两部分一起判断主问题类型，不要只看最后那句短追问。',
              '像“那这儿呢 / 这边呢 / 这里呢”这类追问，如果前半句已经明确是在查某类 POI、地铁站或区域解读，通常应延续同一主任务类型，再结合当前空间上下文理解。',
              'follow_up_recent_intent 是上一轮稳定意图摘要，只能作为理解线索，不能机械照抄；如果它和本轮上下文冲突，以完整 user_query 为准。',
              '同时判断 needsWebSearch（布尔值）：当用户问题涉及评价、评分、口碑、推荐、排名、高分、好不好、体验、实时营业状态、价格、人均消费、新开、最新动态、趋势、规划等需要互联网实时/UGC信息才能回答时，设为 true；纯空间查询（如"附近有什么"、"最近地铁站"等）设为 false。',
              `user_query: ${input.rawQuery}`,
              `follow_up_recent_intent: ${JSON.stringify(input.followUpHint || null)}`,
              `embedding_prior: ${JSON.stringify(input.embeddingResult && input.embeddingResult.usedEmbedding ? {
                queryType: input.embeddingResult.queryType,
                confidence: input.embeddingResult.confidence,
                needsWebSearch: input.embeddingResult.needsWebSearch,
              } : null)}`,
              `has_spatial_view: ${Boolean(readMapViewAnchor(input.request))}`,
              `has_user_location: ${Boolean(readUserLocation(input.request))}`,
              `selected_categories: ${JSON.stringify(selectedCategories)}`,
              `selected_regions: ${JSON.stringify(selectedRegionNames)}`,
              '返回 JSON，例如：{"queryType":"area_overview","anchorSource":"map_view","placeName":null,"secondaryPlaceName":null,"categoryKey":null,"targetCategory":"区域洞察","needsClarification":false,"clarificationHint":null,"needsWebSearch":false,"toolIntent":"area_insight","searchIntentHint":null}',
            ].join('\n'),
          },
        ],
        tools: [],
        timeoutMs: getDefaultLlmSynthesisTimeoutMs(),
      })

      const raw = String(response.assistantMessage.content || '').trim()
      const jsonText = extractJsonObject(raw)
      if (!jsonText) {
        return null
      }

      const parsed = JSON.parse(jsonText) as Record<string, unknown>
      if (!isSupportedQueryType(parsed.queryType)) {
        return null
      }

      return {
        queryType: parsed.queryType,
        anchorSource: isSupportedAnchorSource(parsed.anchorSource) ? parsed.anchorSource : null,
        placeName: readOptionalText(parsed.placeName),
        secondaryPlaceName: readOptionalText(parsed.secondaryPlaceName),
        targetCategory: readOptionalText(parsed.targetCategory),
        comparisonTarget: readOptionalText(parsed.comparisonTarget),
        categoryKey: readOptionalText(parsed.categoryKey),
        needsClarification: Boolean(parsed.needsClarification),
        clarificationHint: parsed.clarificationHint == null ? null : String(parsed.clarificationHint),
        needsWebSearch: parsed.needsWebSearch === true,
        toolIntent: normalizeToolIntentMode(parsed.toolIntent),
        searchIntentHint: readOptionalText(parsed.searchIntentHint),
        providerErrorMessage: null,
      }
    } catch (error) {
      return {
        queryType: 'unsupported',
        providerErrorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private buildClarificationHintForQueryType(queryType: DeterministicIntent['queryType']) {
    if (queryType === 'composite_recommendation') {
      return '请把行程拆清楚一点，例如“在 A 和 B 之间先吃饭，之后去 C 逛服装店”。'
    }

    if (queryType === 'area_overview') {
      return '请告诉我一个明确地点，或者把地图移动到你想分析的区域后再问我。'
    }

    if (queryType === 'nearest_station') {
      return '请告诉我一个明确地点，例如“武汉大学最近的地铁站是什么”。'
    }

    if (queryType === 'compare_places') {
      return '请给出两个明确地点，例如“比较武汉大学和湖北大学附近的餐饮活跃度”。'
    }

    if (queryType === 'similar_regions') {
      return '请告诉我一个明确参考地点，例如“和武汉大学周边气质相似的片区有哪些”。'
    }

    return '请告诉我一个明确地点，例如“武汉大学附近有哪些咖啡店”。'
  }

  private buildToolLoopUserMessage(input: {
    rawQuery: string
    intent: DeterministicIntent
    intentSource?: 'llm' | 'fallback' | 'embedding'
  }) {
    const intentSource = input.intentSource || 'fallback'
    const lines = [
      `用户原问题：${input.rawQuery}`,
      `当前意图来源：${intentSource}`,
      `当前意图理解：${input.intent.queryType}`,
      `当前锚点模式：${input.intent.anchorSource || 'unknown'}`,
      input.intent.placeName ? `主锚点：${input.intent.placeName}` : '',
      input.intent.secondaryPlaceName ? `次锚点：${input.intent.secondaryPlaceName}` : '',
      input.intent.targetCategory ? `目标类别：${input.intent.targetCategory}` : '',
      input.intent.categoryKey ? `category_key：${input.intent.categoryKey}` : '',
      input.intent.toolIntent ? `工具意图：${input.intent.toolIntent}` : '',
      input.intent.searchIntentHint ? `联网语义焦点：${input.intent.searchIntentHint}` : '',
      '如果多个工具彼此没有前后输入依赖，应在同一轮直接给出多个 tool calls 并行执行。',
    ]

    if (input.intent.queryType === 'area_overview') {
      lines.push('编排要求：这是区域洞察题，围绕用户原问题按需取证，不要超范围分析。')
      lines.push('拿到 area insight 后，如果用户问题明显聚焦某一类结构线索，再调用 semantic_selector.select_area_evidence 做聚焦筛选。')
    } else if (input.intent.queryType === 'nearby_poi') {
      lines.push('编排要求：这是附近查询题，先锁定锚点，再抓取附近真实候选，不要把查询题答成片区总结。')
      if (input.intent.toolIntent === 'candidate_reputation') {
        lines.push('补充要求：这是候选点评价核验题，联网时优先围绕本地候选点名称核验评分、口碑和推荐信息，而不是原句裸搜。')
      }
    } else if (input.intent.queryType === 'nearest_station') {
      lines.push('编排要求：这是最近地铁站查询题，先锁定锚点，再回答最近站点与可用站口。')
    } else if (input.intent.queryType === 'compare_places') {
      lines.push('编排要求：这是双地点对比题，先确认两个锚点，再围绕同一维度取证并输出可比结论。')
    } else if (input.intent.queryType === 'similar_regions') {
      lines.push('编排要求：这是相似片区题，先明确参考片区，再补结构和语义证据后做相似性判断。优先输出候选片区、整体相似度，以及 2-4 个最有解释力的相似维度。')
    }

    return lines.filter(Boolean).join('\n')
  }

  /**
   * 阶段 7：评估当前证据是否足够覆盖 NLContract 要求
   * 用于 Deep Track 判断是否需要启动逃逸阀（最多 1 轮 LLM 补充）
   */
  private assessEvidenceGap(
    state: AgentTurnState,
    requirements: import('../evidence/RequirementResolver.js').ResolvedRequirements,
  ): { needsSupplement: boolean, availableAtoms: string[], missingAtoms: string[] } {
    const completedTemplates = new Set<string>()
    const completedActions = new Set<string>()
    for (const trace of state.toolCalls) {
      if (trace.status !== 'done') continue
      if (trace.action === 'resolve_anchor') {
        const role = String((trace.payload as Record<string, unknown>)?.role || 'primary')
        completedActions.add(`anchor.${role === 'secondary' ? 'secondary_resolved' : 'resolved'}`)
      } else if (trace.action === 'execute_spatial_sql') {
        const template = String((trace.payload as Record<string, unknown>)?.template || '')
        if (template) completedTemplates.add(template)
      } else if (trace.action === 'select_area_evidence') {
        completedActions.add('area.focused_samples')
      } else if (trace.action === 'encode_region_snapshot') {
        completedActions.add('area.region_encoding')
      } else if (trace.action === 'encode_poi_profile') {
        completedActions.add('poi.profile_encoding')
      }
    }

    // Map atom names to completed templates/actions
    const ATOM_TEMPLATE_MAP: Record<string, string> = {
      'poi.nearby_list': 'nearby_poi',
      'poi.nearest_station': 'nearest_station',
      'area.category_histogram': 'area_category_histogram',
      'area.representative_samples': 'area_representative_sample',
      'area.hotspots': 'area_h3_hotspots',
      'area.ring_distribution': 'area_ring_distribution',
      'area.competition_density': 'area_competition_density',
      'area.aoi_context': 'area_aoi_context',
      'area.landuse_context': 'area_landuse_context',
      'compare.pairs': 'compare_places',
    }

    const availableAtoms: string[] = []
    const missingAtoms: string[] = []

    for (const atom of requirements.requiredAtoms) {
      const template = ATOM_TEMPLATE_MAP[atom]
      if (template && completedTemplates.has(template)) {
        availableAtoms.push(atom)
      } else if (completedActions.has(atom)) {
        availableAtoms.push(atom)
      } else {
        missingAtoms.push(atom)
      }
    }

    return {
      needsSupplement: missingAtoms.length > 0,
      availableAtoms,
      missingAtoms,
    }
  }

  private resolveToolLoopMaxRounds(taskMode: 'query' | 'analysis') {
    return taskMode === 'analysis'
      ? DEFAULT_LLM_ANALYSIS_MAX_ROUNDS
      : DEFAULT_LLM_QUERY_MAX_ROUNDS
  }

  private applyTownPoiCellAnnotationsToView(input: {
    intent: DeterministicIntent
    view: EvidenceView
    result: Record<string, unknown>
  }) {
    if (input.intent.queryType !== 'nearby_poi' || input.view.type !== 'poi_list') {
      return
    }

    const rawResults = Array.isArray(input.result.results) ? input.result.results as Array<Record<string, unknown>> : []
    if (rawResults.length === 0 || input.view.items.length === 0) {
      return
    }

    const buckets = new Map<string, Array<{ item: EvidenceItem, originalIndex: number }>>()
    let annotatedCount = 0

    for (const entry of rawResults) {
      const originalIndex = Number(entry.original_index)
      const item = input.view.items[originalIndex]
      if (!Number.isInteger(originalIndex) || !item) {
        continue
      }

      const cellContext = (entry.cell_context && typeof entry.cell_context === 'object')
        ? entry.cell_context as Record<string, unknown>
        : {}
      const cellId = String(cellContext.cell_id || `cell_${originalIndex}`).trim() || `cell_${originalIndex}`
      const townCell = {
        cellId,
        dominantCategory: String(cellContext.dominant_category || '').trim() || null,
        similarity: Number.isFinite(Number(cellContext.similarity)) ? Number(cellContext.similarity) : null,
      }

      item.meta = {
        ...(item.meta || {}),
        townCell,
      }
      annotatedCount += 1

      const bucket = buckets.get(cellId) || []
      bucket.push({ item, originalIndex })
      buckets.set(cellId, bucket)
    }

    if (buckets.size === 0) {
      return
    }

    const reordered: EvidenceItem[] = []
    const queue = [...buckets.entries()].map(([cellId, items]) => ({ cellId, items: [...items] }))
    while (queue.some((entry) => entry.items.length > 0)) {
      for (const entry of queue) {
        const next = entry.items.shift()
        if (next) {
          reordered.push(next.item)
        }
      }
    }

    input.view.items = reordered
    input.view.meta = {
      ...(input.view.meta || {}),
      town_diversification: {
        applied: true,
        uniqueCellCount: buckets.size,
        annotatedCount,
      },
    }
  }

  private resolveEvidenceCount(view: EvidenceView) {
    const directCount = view.items.length || view.pairs?.length || view.regions?.length || 0
    if (directCount > 0) {
      return directCount
    }

    if (view.type !== 'area_overview') {
      return 0
    }

    return [
      view.areaSubject ? 1 : 0,
      view.areaProfile?.dominantCategories?.length || 0,
      view.hotspots?.length || 0,
      view.regionFeatures?.length || 0,
      view.semanticHints?.length || 0,
      view.aoiContext?.length || 0,
      view.landuseContext?.length || 0,
    ].reduce((sum, value) => sum + value, 0)
  }

  private async executeToolCall(
    call: ToolCallRequest,
    intent: DeterministicIntent,
    state: AgentTurnState,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const normalizedCall = this.normalizeToolCall(call)
    const startedAt = Date.now()
    const skill = this.options.registry.get(normalizedCall.name)
    const payload = this.hydrateToolPayload(normalizedCall, intent, state)
    const action = String(normalizedCall.arguments.action || '')
    if (!skill) {
      const trace: ToolExecutionTrace = {
        id: normalizedCall.id,
        skill: normalizedCall.name,
        action,
        status: 'error',
        error_kind: 'tool_result_error',
        payload,
        error: 'Skill not found',
        latency_ms: Date.now() - startedAt,
      }
      state.toolCalls.push(trace)
      appendToolTraceEvent(state.executionJournal, trace)
      return {
        content: { ok: false, error: 'Skill not found' },
        trace,
      }
    }

    let result: Awaited<ReturnType<SkillDefinition['execute']>>
    try {
      if (
        normalizedCall.name === 'postgis'
        && action === 'resolve_anchor'
        && (intent.anchorSource === 'user_location' || intent.anchorSource === 'map_view')
        && String(payload.role || 'primary') === 'primary'
        && hasCoordinates(state.anchors.primary)
      ) {
        result = {
          ok: true,
          data: {
            anchor: state.anchors.primary,
            role: 'primary',
          },
          meta: {
            action: 'resolve_anchor',
            audited: true,
            synthetic: true,
          },
        }
      } else if (normalizedCall.name === 'postgis' && action === 'execute_spatial_sql' && payload.template) {
        result = await this.executePostgisTemplate(skill, intent, state, payload, context)
      } else {
        result = await skill.execute(action, payload, context)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed'
      context.logger.warn('Tool execution failed during agent loop', {
        traceId: context.traceId,
        requestId: context.requestId,
        sessionId: context.sessionId,
        skill: normalizedCall.name,
        action,
        error: message,
      })

      const trace: ToolExecutionTrace = {
        id: normalizedCall.id,
        skill: normalizedCall.name,
        action,
        status: 'error',
        error_kind: 'execution_exception',
        payload,
        error: message,
        latency_ms: Date.now() - startedAt,
      }
      state.toolCalls.push(trace)
      appendToolTraceEvent(state.executionJournal, trace)

      throw new ToolExecutionAbortError(message)
    }

    const anchorResult = result.data as { anchor?: ResolvedAnchor, role?: string } | undefined
    if (normalizedCall.name === 'postgis' && action === 'resolve_anchor' && result.ok && anchorResult?.anchor) {
      const anchor = anchorResult.anchor
      const role = anchor.role || String(payload.role || 'primary')
      state.anchors[role] = anchor
      anchorResult.role = role
    }

    const trace: ToolExecutionTrace = {
      id: normalizedCall.id,
      skill: normalizedCall.name,
      action,
      status: result.ok ? 'done' : 'error',
      error_kind: result.ok ? null : 'tool_result_error',
      payload,
      result: result.data,
      error: result.error?.message || null,
      latency_ms: Date.now() - startedAt,
    }
    state.toolCalls.push(trace)
    appendToolTraceEvent(state.executionJournal, trace)

    return {
      content: result.data || result.error || {},
      trace,
    }
  }

  private normalizeToolCall(call: ToolCallRequest): ToolCallRequest {
    const action = String(call.arguments.action || '').trim()
    const rawPayload = (call.arguments.payload || {}) as Record<string, unknown>
    let payload = rawPayload

    if (call.name === 'postgis' && action === 'resolve_anchor') {
      const placeName = trimText(
        rawPayload.place_name
        || rawPayload.placeName
        || rawPayload.anchor_text
        || rawPayload.anchor_name
        || rawPayload.anchorName
        || rawPayload.anchor
        || rawPayload.place
        || rawPayload.query
        || rawPayload.name,
      )
      payload = {
        ...rawPayload,
        ...(placeName ? { place_name: placeName } : {}),
        role: normalizeToolRole(rawPayload.role),
      }
    }

    if (call.name === 'postgis' && action === 'execute_spatial_sql') {
      const categoryKey = normalizeCategoryKey(rawPayload.category_key || rawPayload.categoryKey)
      payload = {
        ...payload,
        ...(categoryKey ? {
          categoryKey,
          category_key: categoryKey,
        } : {}),
      }
    }

    return {
      ...call,
      arguments: {
        ...call.arguments,
        action,
        payload,
      },
    }
  }

  private hydrateToolPayload(
    call: ToolCallRequest,
    intent: DeterministicIntent,
    state: AgentTurnState,
  ) {
    const action = String(call.arguments.action || '').trim()
    const rawPayload = (call.arguments.payload || {}) as Record<string, unknown>

    if (call.name !== 'semantic_selector' || action !== 'select_area_evidence') {
      return rawPayload
    }

    const areaInsightResults = collectAreaInsightTemplateResults(state.toolCalls)
    const latestPostgisRows = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'postgis' && trace.action === 'execute_spatial_sql' && trace.status === 'done')
      ?.result as { rows?: Record<string, unknown>[] } | undefined

    const fallbackAreaInsight: AreaInsightInput = {
      categoryHistogram: readAreaInsightRows(areaInsightResults, 'area_category_histogram'),
      ringDistribution: readAreaInsightRows(areaInsightResults, 'area_ring_distribution'),
      representativeSamples: readAreaInsightRows(areaInsightResults, 'area_representative_sample'),
      competitionDensity: readAreaInsightRows(areaInsightResults, 'area_competition_density'),
      hotspotCells: readAreaInsightRows(areaInsightResults, 'area_h3_hotspots'),
      aoiContext: readAreaInsightRows(areaInsightResults, 'area_aoi_context'),
      landuseContext: readAreaInsightRows(areaInsightResults, 'area_landuse_context'),
    }
    const areaInsight: AreaInsightInput = hasAreaInsightPayload(rawPayload.area_insight)
      ? mergeAreaInsightInput(fallbackAreaInsight, rawPayload.area_insight as AreaInsightInput)
      : fallbackAreaInsight

    return {
      ...rawPayload,
      raw_query: trimText(rawPayload.raw_query || intent.rawQuery),
      semantic_focus: trimText(rawPayload.semantic_focus || rawPayload.focus_query),
      anchor_name: trimText(rawPayload.anchor_name || state.anchors.primary?.resolved_place_name || intent.placeName || ''),
      area_insight: areaInsight,
      fallback_rows: Array.isArray(rawPayload.fallback_rows)
        ? rawPayload.fallback_rows
        : (latestPostgisRows?.rows || []),
    } satisfies Record<string, unknown>
  }

  private async executePostgisTemplate(
    skill: SkillDefinition,
    intent: DeterministicIntent,
    state: AgentTurnState,
    payload: Record<string, unknown>,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const template = String(payload.template || '')
    if (template === 'compare_places') {
      const primary = state.anchors.primary
      const secondary = state.anchors.secondary
      const regionComparisonScopes = state.spatialConstraint?.regions || []
      if ((!hasCoordinates(primary) || !hasCoordinates(secondary)) && regionComparisonScopes.length >= 2) {
        const comparisonCategoryKey = String(payload.category_key || payload.categoryKey || intent.categoryKey || 'food')
        const comparisonLimit = Number(payload.limit || 10)
        const comparisonPairs: ComparisonPair[] = []

        for (const region of regionComparisonScopes) {
          if (!Number.isFinite(region.lon) || !Number.isFinite(region.lat)) {
            continue
          }

          const regionAnchor: ResolvedAnchor = {
            place_name: region.name,
            display_name: region.name,
            role: comparisonPairs.length === 0 ? 'primary' : 'secondary',
            source: 'drawn_region',
            resolved_place_name: region.name,
            poi_id: region.id ?? null,
            lon: region.lon,
            lat: region.lat,
            coord_sys: primary?.coord_sys || 'gcj02',
          }
          const regionConstraint: SpatialAnalysisConstraint = {
            scope: 'regions',
            areaWkt: region.areaWkt,
            selectedCategories: state.spatialConstraint?.selectedCategories || [],
            regions: [region],
          }
          const regionRows = await this.executeTemplateSQL(
            skill,
            intent,
            regionAnchor,
            comparisonCategoryKey,
            comparisonLimit,
            state,
            context,
            undefined,
            regionConstraint,
          )
          comparisonPairs.push({
            label: region.name,
            anchor: {
              placeName: region.name,
              displayName: region.name,
              resolvedPlaceName: region.name,
              lon: region.lon,
              lat: region.lat,
              source: 'drawn_region',
            },
            value: regionRows.length,
            items: normalizePoiRows(regionRows),
          })
        }

        return {
          ok: true,
          data: {
            comparison_pairs: comparisonPairs,
          },
          meta: {
            action: 'execute_spatial_sql',
            audited: true,
          },
        }
      }

      if (!hasCoordinates(primary) || !hasCoordinates(secondary)) {
        return {
          ok: false,
          error: {
            code: 'missing_anchor',
            message: 'Comparison requires two resolved anchors',
          },
          meta: {
            action: 'execute_spatial_sql',
            audited: true,
          },
        }
      }

      const comparisonCategoryKey = String(payload.category_key || payload.categoryKey || intent.categoryKey || 'food')
      const comparisonLimit = Number(payload.limit || 10)
      const primaryRows = await this.executeTemplateSQL(skill, intent, primary, comparisonCategoryKey, comparisonLimit, state, context)
      const secondaryRows = await this.executeTemplateSQL(skill, intent, secondary, comparisonCategoryKey, comparisonLimit, state, context)
      const comparisonPairs: ComparisonPair[] = [
        {
          label: primary.resolved_place_name,
          anchor: {
            placeName: primary.place_name,
            displayName: primary.display_name,
            resolvedPlaceName: primary.resolved_place_name,
            lon: primary.lon,
            lat: primary.lat,
            source: primary.source,
          },
          value: primaryRows.length,
          items: normalizePoiRows(primaryRows),
        },
        {
          label: secondary.resolved_place_name,
          anchor: {
            placeName: secondary.place_name,
            displayName: secondary.display_name,
            resolvedPlaceName: secondary.resolved_place_name,
            lon: secondary.lon,
            lat: secondary.lat,
            source: secondary.source,
          },
          value: secondaryRows.length,
          items: normalizePoiRows(secondaryRows),
        },
      ]

      return {
        ok: true,
        data: {
          comparison_pairs: comparisonPairs,
        },
        meta: {
          action: 'execute_spatial_sql',
          audited: true,
        },
      }
    }

    const anchor = state.anchors.primary
    if (!hasCoordinates(anchor)) {
      return {
        ok: false,
        error: {
          code: 'missing_anchor',
          message: 'SQL template execution requires a resolved anchor',
        },
        meta: {
          action: 'execute_spatial_sql',
          audited: true,
        },
      }
    }

    const rows = await this.executeTemplateSQL(
        skill,
        intent,
        anchor,
        String(payload.category_key || payload.categoryKey || intent.categoryKey || ''),
        Number(payload.limit || 10),
        state,
        context,
        template,
        state.spatialConstraint,
      )
    console.log(`[诊断:PostGIS] template=${template}, rows=${rows.length}, categoryKey=${intent.categoryKey}, categoryMain=${intent.categoryMain}, categorySub=${intent.categorySub}, anchor=(${anchor?.lon},${anchor?.lat})`)

    return {
      ok: true,
      data: {
        rows,
        meta: {
          template,
        },
      },
      meta: {
        action: 'execute_spatial_sql',
        audited: true,
      },
    }
  }

  private async executeTemplateSQL(
    skill: SkillDefinition,
    intent: DeterministicIntent,
    anchor: ResolvedAnchor,
    categoryKey: string,
    limit: number,
    state: AgentTurnState,
    context: ReturnType<typeof createSkillExecutionContext>,
    templateName?: string,
    spatialConstraint?: SpatialAnalysisConstraint | null,
  ) {
    const sql = this.buildTemplateSQL(intent, anchor, categoryKey, limit, templateName, spatialConstraint || state.spatialConstraint)
    const validation = await skill.execute('validate_spatial_sql', { sql }, context)
    state.sqlValidationAttempts += 1
    if (validation.ok) {
      state.sqlValidationPassed += 1
    } else {
      return []
    }
    const execution = await skill.execute('execute_spatial_sql', { sql }, context)
    const rows = (execution.data as { rows?: Record<string, unknown>[] } | undefined)?.rows || []

    if (intent.queryType === 'nearest_station' && rows.length > 0) {
      const routeSkill = this.options.registry.get('route_distance')
      if (routeSkill && hasCoordinates(anchor)) {
        const route = await routeSkill.execute('get_multi_destination_matrix', {
          origin: {
            type: 'Point',
            coordinates: [anchor.lon!, anchor.lat!],
          },
          destinations: rows.map((row, index) => ({
            id: String(row.id || index),
            type: 'Point',
            coordinates: [Number(row.longitude), Number(row.latitude)],
          })),
          mode: 'walking',
        }, context)

        const ranked = (route.data as { results?: Array<{ id: string, distance_m: number, duration_min: number, rank: number }> } | undefined)?.results || []
        return rows.map((row) => {
          const match = ranked.find((item) => item.id === String(row.id))
          return {
            ...row,
            distance_m: match?.distance_m ?? row.distance_m,
            duration_min: match?.duration_min ?? null,
            rank: match?.rank ?? null,
          }
        })
      }
    }

    // 语义重排序：对 nearby_poi 查询结果融合距离 + 语义分数
    if (rows.length > 0 && this.poiEmbeddingCache && intent.queryType === 'nearby_poi') {
      const openNearbyScope = shouldRelaxNearbyDistanceConstraint(intent, spatialConstraint || state.spatialConstraint)
      const prefersSpatialSpread = Number(intent.radiusM || 0) >= 1400 && intent.categoryKey !== 'metro_station'
      const useViewportWideSampling = (spatialConstraint || state.spatialConstraint)?.scope === 'viewport' && Boolean((spatialConstraint || state.spatialConstraint)?.areaWkt) && intent.anchorSource === 'map_view'
      const rankResult = await this.poiEmbeddingCache.semanticRank(
        rows as import('../catalog/poiEmbeddingCache.js').PoiRow[],
        intent.rawQuery,
        {
          maxDistanceM: openNearbyScope ? resolveExpandedNearbyRadiusM(intent) : useViewportWideSampling ? 50000 : (intent.radiusM || 3000),
          queryVec: intent.queryVec,
          semanticWeight: useViewportWideSampling ? 0.82 : openNearbyScope ? 0.72 : (prefersSpatialSpread ? 0.62 : 0.5),
          distanceWeight: useViewportWideSampling ? 0.18 : openNearbyScope ? 0.28 : (prefersSpatialSpread ? 0.38 : 0.5),
        },
      )
      if (rankResult.usedSemanticRank) {
        // 截断到原始 limit
        const ranked = rankResult.rows.slice(0, limit)
        console.log(`[语义重排序] ${rows.length} 条候选 → 语义精排 ${ranked.length} 条, 新缓存=${rankResult.newlyCached}, 耗时=${rankResult.latencyMs}ms`)
        return ranked as Record<string, unknown>[]
      }
    }

    return rows
  }

  private resolvePostgisTemplateName(intent: DeterministicIntent, templateName?: string) {
    if (templateName === 'area_overview') {
      return 'area_representative_sample'
    }

    if (templateName) {
      return templateName
    }

    if (intent.queryType === 'area_overview') {
      return 'area_representative_sample'
    }

    if (intent.queryType === 'nearest_station') {
      return 'nearest_station'
    }

    return 'nearby_poi'
  }

  private buildSpatialSqlFragments(input: {
    intent: DeterministicIntent
    anchor: ResolvedAnchor
    spatialConstraint?: SpatialAnalysisConstraint | null
  }) {
    const relaxNearbyDistanceConstraint = shouldRelaxNearbyDistanceConstraint(input.intent, input.spatialConstraint)
    const pointGeography = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(input.anchor.lon)}, ${formatNumericLiteral(input.anchor.lat)}), 4326)::geography`
    const nearbyRadiusM = relaxNearbyDistanceConstraint
      ? resolveExpandedNearbyRadiusM(input.intent)
      : Math.max(input.intent.radiusM, 1)
    // 当 anchorSource='place'（明确地名如汉口）时，不用 viewport 多边形裁剪，
    // 因为 viewport 可能和地名区域不重叠（如 viewport 在武昌但搜汉口美食），
    // 改为用 anchor 坐标 + 扩大半径搜索
    const useViewportPolygon = input.spatialConstraint?.areaWkt
      && input.intent.anchorSource !== 'place'
    const areaGeometry = useViewportPolygon
      ? `ST_GeomFromText('${escapeSqlLiteral(input.spatialConstraint!.areaWkt!)}', 4326)`
      : `ST_Buffer(${pointGeography}, ${String(nearbyRadiusM)})::geometry`

    return {
      pointGeography,
      areaGeometry,
      areaFilter: `ST_Intersects(geom, ${areaGeometry})`,
      areaJoinFilter: `ST_Intersects(p.geom, ${areaGeometry})`,
    }
  }

  private buildCategoryFilters(
    categoryKey: string,
    selectedCategories: string[] = [],
    categoryMain?: string | null,
    categorySub?: string | null,
  ) {
    const whereFilters: string[] = []
    const joinFilters: string[] = []
    const pushFilter = (field: string, value: string) => {
      whereFilters.push(`AND ${field} = '${escapeSqlLiteral(value)}'`)
      joinFilters.push(`AND p.${field} = '${escapeSqlLiteral(value)}'`)
    }

    // 优先使用 embedding 语义匹配结果（categoryMain/categorySub）
    if (categoryMain) {
      pushFilter('category_main', categoryMain)
      // category_sub 更精确时追加二级过滤
      if (categorySub && categorySub !== categoryMain) {
        pushFilter('category_sub', categorySub)
      }
    } else if (categoryKey === 'metro_station') {
      // 旧硬编码 fallback（embedding 索引不可用时兜底）
      pushFilter('category_main', '交通设施服务')
      pushFilter('category_sub', '地铁站')
    } else if (categoryKey === 'coffee') {
      pushFilter('category_main', '餐饮美食')
      pushFilter('category_sub', '咖啡')
    } else if (categoryKey === 'food') {
      pushFilter('category_main', '餐饮美食')
    } else if (categoryKey === 'hotel') {
      pushFilter('category_main', '住宿服务')
    } else if (categoryKey === 'supermarket') {
      pushFilter('category_main', '购物服务')
    } else if (categoryKey === 'fashion') {
      pushFilter('category_main', '购物服务')
      pushFilter('category_sub', '服装鞋帽皮具店')
    }

    const normalizedSelectedCategories = [...new Set(
      selectedCategories
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    )]
    if (normalizedSelectedCategories.length > 0) {
      const categoryList = normalizedSelectedCategories
        .map((item) => `'${escapeSqlLiteral(item)}'`)
        .join(', ')
      whereFilters.push(`AND (category_main IN (${categoryList}) OR category_sub IN (${categoryList}))`)
      joinFilters.push(`AND (p.category_main IN (${categoryList}) OR p.category_sub IN (${categoryList}))`)
    }

    return {
      where: whereFilters,
      join: joinFilters,
    }
  }

  private buildAreaInsightTemplateSQL(input: {
    templateName: string
    intent: DeterministicIntent
    anchor: ResolvedAnchor
    categoryKey: string
    limit: number
    spatialConstraint?: SpatialAnalysisConstraint | null
  }) {
    const viewportTileConfig = buildViewportTileConfig(input.intent.viewportContext)
    const effectiveTemplateName = viewportTileConfig && input.templateName === 'area_representative_sample'
      ? 'area_representative_sample_large_viewport'
      : viewportTileConfig && input.templateName === 'area_aoi_context'
        ? 'area_aoi_context_large_viewport'
        : input.templateName
    const template = loadPostgisTemplate(effectiveTemplateName)
    if (!template) {
      return null
    }

    const spatialFragments = this.buildSpatialSqlFragments(input)
    const selectedCategories = input.spatialConstraint?.selectedCategories || []
    const categoryFilters = this.buildCategoryFilters(input.categoryKey, selectedCategories, input.intent.categoryMain, input.intent.categorySub)
    const competitionDimension = input.categoryKey || selectedCategories.length > 0 ? 'category_sub' : 'category_main'
    const effectiveLimit = viewportTileConfig
      ? input.templateName === 'area_representative_sample'
        ? Math.max(input.limit, viewportTileConfig.tileCols * viewportTileConfig.tileRows * 2)
        : input.templateName === 'area_aoi_context'
          ? Math.max(input.limit, viewportTileConfig.tileCols * viewportTileConfig.tileRows)
          : input.limit
      : input.limit
    const rendered = renderPostgisTemplate(template, {
      POINT_GEOGRAPHY: spatialFragments.pointGeography,
      AREA_GEOMETRY: spatialFragments.areaGeometry,
      AREA_FILTER: spatialFragments.areaFilter,
      AREA_JOIN_FILTER: spatialFragments.areaJoinFilter,
      RADIUS_M: String(Math.max(input.intent.radiusM, 1)),
      LIMIT: String(Math.max(effectiveLimit, 1)),
      CATEGORY_FILTER: categoryFilters.where.length > 0 ? `\n${categoryFilters.where.join('\n')}` : '',
      CATEGORY_JOIN_FILTER: categoryFilters.join.length > 0 ? `\n${categoryFilters.join.join('\n')}` : '',
      COMPETITION_DIMENSION: competitionDimension,
      CELL_SIZE_DEG: input.intent.radiusM >= 1500 ? '0.003' : input.intent.radiusM >= 1000 ? '0.002' : '0.0015',
      VIEWPORT_MIN_LON: formatNumericLiteral(viewportTileConfig?.minLon),
      VIEWPORT_MIN_LAT: formatNumericLiteral(viewportTileConfig?.minLat),
      VIEWPORT_TILE_WIDTH: formatNumericLiteral(viewportTileConfig?.tileWidth, 0.0001),
      VIEWPORT_TILE_HEIGHT: formatNumericLiteral(viewportTileConfig?.tileHeight, 0.0001),
      VIEWPORT_TILE_COLS: String(viewportTileConfig?.tileCols || 1),
      VIEWPORT_TILE_ROWS: String(viewportTileConfig?.tileRows || 1),
    })

    return rendered.replace(/\n{3,}/g, '\n\n').trim()
  }

  private buildTemplateSQL(
    intent: DeterministicIntent,
    anchor: ResolvedAnchor,
    categoryKey: string,
    limit: number,
    templateName?: string,
    spatialConstraint?: SpatialAnalysisConstraint | null,
  ) {
    const relaxNearbyDistanceConstraint = shouldRelaxNearbyDistanceConstraint(intent, spatialConstraint)
    const resolvedTemplateName = this.resolvePostgisTemplateName(intent, templateName)
    if (POSTGIS_TEMPLATE_FILE_MAP[resolvedTemplateName]) {
      const areaTemplateSql = this.buildAreaInsightTemplateSQL({
        templateName: resolvedTemplateName,
        intent,
        anchor,
        categoryKey,
        limit,
        spatialConstraint,
      })
      if (areaTemplateSql) {
        return areaTemplateSql
      }
    }

    const spatialFragments = this.buildSpatialSqlFragments({
      intent,
      anchor,
      spatialConstraint,
    })
    const expandedNearbyCandidatePool = intent.queryType === 'nearby_poi'
      && categoryKey !== 'metro_station'
    const effectiveLimit = categoryKey === 'metro_station' && intent.queryType === 'nearby_poi'
      ? Math.max(limit, 12)
      : this.poiEmbeddingCache && intent.queryType === 'nearby_poi'
        ? Math.min(
          Math.max(
            limit * (relaxNearbyDistanceConstraint ? 6 : expandedNearbyCandidatePool ? 4 : 3),
            relaxNearbyDistanceConstraint ? 120 : (expandedNearbyCandidatePool ? 42 : 30),
          ),
          180,
        )
        : relaxNearbyDistanceConstraint && intent.queryType === 'nearby_poi'
          ? Math.min(Math.max(limit * 4, 96), 160)
          : Math.max(limit, 1)
    const baseSelect = [
      'SELECT id, name, category_main, category_sub, longitude, latitude,',
      `  ST_Distance(geom::geography, ${spatialFragments.pointGeography}) AS distance_m`,
      'FROM pois',
      `WHERE ${spatialFragments.areaFilter}`,
    ]

    const nearbyMacroScope = resolveNearbyMacroScope({
      intent,
      rawQuery: intent.rawQuery,
      resolvedPlaceName: anchor.resolved_place_name || anchor.place_name,
    })
    const categoryFilters = this.buildCategoryFilters(categoryKey, spatialConstraint?.selectedCategories || [], intent.categoryMain, intent.categorySub)
    const filters: string[] = [...categoryFilters.where]
    if (nearbyMacroScope?.districtIds.length) {
      filters.push(
        `AND EXISTS (
  SELECT 1
  FROM districts d
  WHERE d.id IN (${nearbyMacroScope.districtIds.join(', ')})
    AND ST_Intersects(pois.geom, d.geom)
)`
      )
    }
    const isViewportScope = spatialConstraint?.scope === 'viewport' && Boolean(spatialConstraint?.areaWkt)
    // 仅当锚点是 map_view（viewport 中心）时才用随机排序覆盖全视野
    // 如果 anchorSource 是 'place'（明确地名），保持 distance 排序
    const useViewportWideSampling = isViewportScope && intent.anchorSource === 'map_view'

    if (resolvedTemplateName === 'nearest_station' || intent.queryType === 'nearest_station' || categoryKey === 'metro_station') {
      return [
        ...baseSelect,
        ...filters,
        'ORDER BY distance_m ASC',
        `LIMIT ${effectiveLimit}`,
      ].join('\n')
    }

    // viewport 中心锚点搜索：不用中心点半径排序，用随机采样保证全视野覆盖
    if (useViewportWideSampling) {
      return [
        ...baseSelect,
        ...filters,
        'ORDER BY RANDOM()',
        `LIMIT ${Math.min(effectiveLimit * 2, 360)}`,
      ].join('\n')
    }

    return [
      ...baseSelect,
      ...filters,
      'ORDER BY distance_m ASC',
      `LIMIT ${effectiveLimit}`,
    ].join('\n')
  }

  private async buildEvidenceView(
    intent: DeterministicIntent,
    state: AgentTurnState,
    anchor?: ResolvedAnchor,
    secondaryAnchor?: ResolvedAnchor,
  ) {
    const fallbackAnchor: ResolvedAnchor = anchor || {
      place_name: intent.placeName || '',
      display_name: intent.placeName || '',
      role: 'primary',
      source: 'fallback',
      resolved_place_name: intent.placeName || '',
      poi_id: null,
    }
    const latestPostgisRows = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'postgis' && trace.action === 'execute_spatial_sql' && trace.status === 'done')
      ?.result as { rows?: Record<string, unknown>[], comparison_pairs?: ComparisonPair[] } | undefined
    const latestLookupRows = intent.queryType === 'nearest_station'
      ? collectLatestLookupRows(state.toolCalls, 'nearest_station')
      : intent.queryType === 'nearby_poi'
        ? collectLatestLookupRows(state.toolCalls, 'nearby_poi')
        : latestPostgisRows
    const latestComparisonResult = [...state.toolCalls]
      .reverse()
      .find((trace) => {
        if (trace.skill !== 'postgis' || trace.action !== 'execute_spatial_sql' || trace.status !== 'done') {
          return false
        }
        const result = trace.result as { comparison_pairs?: ComparisonPair[] } | undefined
        return Array.isArray(result?.comparison_pairs) && result.comparison_pairs.length > 0
      })
      ?.result as { comparison_pairs?: ComparisonPair[] } | undefined
    const latestVector = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'spatial_vector' && trace.action === 'search_similar_regions' && trace.status === 'done')
      ?.result as { regions?: Array<{ region_id?: string, name: string, score: number, summary: string, tags?: string[] }> } | undefined
    const semanticEvidence = collectSemanticEvidence(state.toolCalls)
    const semanticHints = collectSemanticHints(state.toolCalls)
    const areaInsightResults = collectAreaInsightTemplateResults(state.toolCalls)
    const areaInsight: AreaInsightInput = {
      categoryHistogram: readAreaInsightRows(areaInsightResults, 'area_category_histogram'),
      ringDistribution: readAreaInsightRows(areaInsightResults, 'area_ring_distribution'),
      representativeSamples: readAreaInsightRows(areaInsightResults, 'area_representative_sample'),
      competitionDensity: readAreaInsightRows(areaInsightResults, 'area_competition_density'),
      hotspotCells: readAreaInsightRows(areaInsightResults, 'area_h3_hotspots'),
      aoiContext: readAreaInsightRows(areaInsightResults, 'area_aoi_context'),
      landuseContext: readAreaInsightRows(areaInsightResults, 'area_landuse_context'),
    }

    const fallbackComparisonPairs: ComparisonPair[] = intent.queryType === 'compare_places'
      ? (state.spatialConstraint?.regions || [])
        .slice(0, 2)
        .map((region, index) => ({
          label: region.name,
          anchor: {
            placeName: region.name,
            displayName: region.name,
            resolvedPlaceName: region.name,
            lon: Number.isFinite(region.lon) ? Number(region.lon) : Number(anchor?.lon ?? fallbackAnchor.lon ?? index),
            lat: Number.isFinite(region.lat) ? Number(region.lat) : Number(anchor?.lat ?? fallbackAnchor.lat ?? index),
            source: 'drawn_region',
          },
          value: 0,
          items: [],
        }))
      : []
    const comparisonPairs: ComparisonPair[] = preferNonEmptyComparisonPairs(
      latestComparisonResult?.comparison_pairs,
      latestPostgisRows?.comparison_pairs,
      fallbackComparisonPairs,
    )
    if (intent.queryType === 'compare_places' && comparisonPairs.length > 0) {
      const comparisonPrimaryAnchor = anchor || comparisonPairToAnchor(comparisonPairs[0], 'primary') || fallbackAnchor
      const comparisonSecondaryAnchor = secondaryAnchor
        || comparisonPairToAnchor(comparisonPairs[1], 'secondary')
        || comparisonPrimaryAnchor
      const view = this.evidenceFactory.create({
        intent,
        anchor: comparisonPrimaryAnchor,
        secondaryAnchor: comparisonSecondaryAnchor,
        pairs: comparisonPairs,
      })
      if (semanticEvidence) {
        view.semanticEvidence = semanticEvidence
      }
      if (semanticHints.length > 0) {
        view.semanticHints = semanticHints
      }
      return view
    }

    if (intent.queryType === 'similar_regions') {
      const view = this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        items: (latestVector?.regions || []).map((region) => ({
          id: region.region_id || null,
          name: region.name,
          score: region.score,
          meta: {
            regionId: region.region_id || null,
            summary: region.summary,
            tags: Array.isArray(region.tags) ? region.tags : [],
          },
        })),
      })
      if (semanticEvidence) {
        view.semanticEvidence = semanticEvidence
      }
      if (semanticHints.length > 0) {
        view.semanticHints = semanticHints
      }
      return view
    }

    if (intent.queryType === 'area_overview') {
      let effectiveAreaInsight = areaInsight
      let representativeRows = areaInsight.representativeSamples?.length
        ? areaInsight.representativeSamples
        : (latestPostgisRows?.rows || [])
      let selectionSemanticEvidence: SemanticEvidenceStatus | undefined
      let selectionDiagnostics: Record<string, unknown> | undefined
      const selectionResult = collectLatestAreaEvidenceSelection(state.toolCalls)

      if (selectionResult) {
        effectiveAreaInsight = mergeAreaInsightInput(
          areaInsight,
          selectionResult.selected_area_insight,
        )
        const selectedRows = Array.isArray(selectionResult.selected_rows)
          ? selectionResult.selected_rows
          : []
        const applied = Boolean((selectionResult.diagnostics as Record<string, unknown> | undefined)?.applied)
        representativeRows = applied
          ? selectedRows
          : (selectedRows.length > 0 ? selectedRows : representativeRows)
        selectionSemanticEvidence = selectionResult.semantic_evidence
        selectionDiagnostics = selectionResult.diagnostics
      }

      const view = this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        rows: representativeRows,
        items: normalizePoiRows(representativeRows),
        areaInsight: effectiveAreaInsight,
      })
      const mergedSemanticEvidence = mergeSemanticEvidenceStatuses([
        semanticEvidence,
        selectionSemanticEvidence,
      ])
      if (mergedSemanticEvidence) {
        view.semanticEvidence = mergedSemanticEvidence
      }
      if (semanticHints.length > 0) {
        view.semanticHints = semanticHints
      }
      if (selectionDiagnostics) {
        view.meta.semantic_selection = selectionDiagnostics
      }

      // entity_alignment 融合排序结果注入 area_overview 视图
      const areaAlignmentTrace = [...state.toolCalls]
        .reverse()
        .find((trace) => trace.skill === 'entity_alignment' && trace.action === 'align_and_rank' && trace.status === 'done')
      const areaAlignmentResult = areaAlignmentTrace?.result as {
        ranked_results?: Array<{
          name: string
          fusionScore: number
          verification: string
          localPoi?: Record<string, unknown>
          distance_m?: number | null
          category?: string | null
        }>
        alignment_summary?: Record<string, unknown>
      } | undefined

      const areaAlignedItems = this.buildDualVerifiedAlignmentItems(
        intent,
        areaAlignmentResult?.ranked_results as Record<string, unknown>[] | undefined,
        this.buildEvidenceItemAuthorityKeys(normalizePoiRows(representativeRows)),
      )
      if (areaAlignedItems.length > 0) {
        // 仅当存在真实双重验证项时才替换，避免 local_only/web_only 伪装成已对齐结果
        view.items = areaAlignedItems
        view.representativeSamples = areaAlignedItems.slice(0, 5)
      }
      if (areaAlignmentResult?.alignment_summary) {
        view.meta.entity_alignment = areaAlignmentResult.alignment_summary
      }

      return view
    }

    // 检查是否有 entity_alignment 融合排序结果
    const alignmentTrace = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'entity_alignment' && trace.action === 'align_and_rank' && trace.status === 'done')
    const alignmentResult = alignmentTrace?.result as {
      ranked_results?: Array<{
        name: string
        fusionScore: number
        verification: string
        localPoi?: Record<string, unknown>
        distance_m?: number | null
        category?: string | null
      }>
      alignment_summary?: Record<string, unknown>
    } | undefined

    const localNearbyItems = normalizePoiRows(latestLookupRows?.rows || latestPostgisRows?.rows || [])
    const dualVerifiedAlignmentItems = this.buildDualVerifiedAlignmentItems(
      intent,
      alignmentResult?.ranked_results as Record<string, unknown>[] | undefined,
      this.buildEvidenceItemAuthorityKeys(localNearbyItems),
    )
    const poiDiscoveryResult = this.readLatestPoiDiscoveryResult(state.toolCalls)
    const discoveryVerifiedItems = this.buildPoiDiscoveryVerifiedItems(poiDiscoveryResult)
    const discoveryDbOnlyItems = this.buildPoiDiscoveryDbOnlyItems(poiDiscoveryResult)
    const latestPoiDiscoveryDbMatchCount = this.readLatestPoiDiscoveryDbMatchCount(state.toolCalls)
    const shouldFallbackToLocalNearbyRows = intent.queryType === 'nearby_poi'
      && intent.toolIntent === 'candidate_reputation'
      && latestPoiDiscoveryDbMatchCount === 0
    console.log(`[诊断:buildEvidenceView] alignmentTrace存在=${!!alignmentTrace}, ranked_results长度=${alignmentResult?.ranked_results?.length ?? 'N/A'}, dual_verified_usable=${dualVerifiedAlignmentItems.length}, latestPostgisRows长度=${latestPostgisRows?.rows?.length ?? 'N/A'}, discovery_db_match_count=${latestPoiDiscoveryDbMatchCount}, fallback_to_local=${shouldFallbackToLocalNearbyRows}`)
    const supportingNearbyItems = this.mergeEvidenceItems(discoveryVerifiedItems, localNearbyItems)
    const rankedLocalItems = dualVerifiedAlignmentItems.length > 0 && !shouldFallbackToLocalNearbyRows
      ? this.mergeEvidenceItems(dualVerifiedAlignmentItems, supportingNearbyItems)
      : supportingNearbyItems
    const items = this.mergeEvidenceItems(rankedLocalItems, discoveryDbOnlyItems)

    const view = this.evidenceFactory.create({
      intent,
      anchor: fallbackAnchor,
      rows: latestLookupRows?.rows || latestPostgisRows?.rows || [],
      items,
    })
    const nearbyMacroScope = resolveNearbyMacroScope({
      intent,
      rawQuery: intent.rawQuery,
      resolvedPlaceName: fallbackAnchor.resolved_place_name || fallbackAnchor.place_name,
    })
    if (nearbyMacroScope) {
      view.meta.scopeLabel = nearbyMacroScope.label
      view.meta.scopeDistricts = nearbyMacroScope.districts
      view.meta.scopeAlias = nearbyMacroScope.alias
    }
    if (alignmentResult?.alignment_summary) {
      view.meta.entity_alignment = alignmentResult.alignment_summary
    }
    if (poiDiscoveryResult) {
      view.meta.poi_discovery = {
        dbMatchCount: latestPoiDiscoveryDbMatchCount,
        verifiedCount: discoveryVerifiedItems.length,
        dbOnlyCount: discoveryDbOnlyItems.length,
      }
    }
    if (semanticEvidence) {
      view.semanticEvidence = semanticEvidence
    }
    if (semanticHints.length > 0) {
      view.semanticHints = semanticHints
    }
    return view
  }

  private buildDualVerifiedAlignmentItems(
    intent: DeterministicIntent,
    rankedResults: Record<string, unknown>[] | undefined,
    authoritativeLocalPoiKeys?: Set<string>,
  ): EvidenceItem[] {
    if (!Array.isArray(rankedResults) || rankedResults.length === 0) {
      return []
    }

    const expectedMain = String(
      intent.categoryMain
      || this.resolveCategoryMainFromCategoryKey(intent.categoryKey || '')
      || '',
    ).trim()
    const expectedSub = String(intent.categorySub || '').trim()

    const isCategoryCompatible = (result: Record<string, unknown>) => {
      if (!expectedMain && !expectedSub) {
        return true
      }

      const localPoi = result.localPoi && typeof result.localPoi === 'object'
        ? result.localPoi as Record<string, unknown>
        : null
      // 无 localPoi 时无法做类别核验，保守放行（仍需 dual_verified）
      if (!localPoi) {
        return true
      }

      const localMain = String(localPoi.categoryMain || localPoi.category_main || '').trim()
      const localSub = String(localPoi.categorySub || localPoi.category_sub || localPoi.category || '').trim()

      if (expectedMain && localMain && localMain !== expectedMain) {
        return false
      }
      if (expectedSub && expectedSub !== expectedMain && localSub && localSub !== expectedSub) {
        return false
      }
      return true
    }

    return rankedResults
      .filter((result) => {
        const verification = String(result?.verification || '').trim().toLowerCase()
        return verification === 'dual_verified'
      })
      .filter(isCategoryCompatible)
      .filter((result) => this.isAlignmentLocalPoiAuthoritative(result, authoritativeLocalPoiKeys))
      .map((result, idx) => {
        const localPoi = result.localPoi && typeof result.localPoi === 'object'
          ? result.localPoi as Record<string, unknown>
          : null
        const name = String(localPoi?.name || result.name || '').trim() || '未命名地点'
        const distanceValue = Number(localPoi?.distance_m)
        const category = String(
          localPoi?.category
          || localPoi?.categorySub
          || localPoi?.category_sub
          || localPoi?.categoryMain
          || localPoi?.category_main
          || result.category
          || '',
        ).trim()
        const fusionScore = Number(result.fusionScore)
        const topLevelDistance = Number(result.distance_m)

        return {
          id: (localPoi?.id as string | number | null | undefined) ?? null,
          name,
          categoryMain: String(localPoi?.categoryMain || localPoi?.category_main || '').trim() || null,
          categorySub: String(localPoi?.categorySub || localPoi?.category_sub || '').trim() || null,
          longitude: Number.isFinite(Number(localPoi?.longitude ?? localPoi?.lon))
            ? Number(localPoi?.longitude ?? localPoi?.lon)
            : undefined,
          latitude: Number.isFinite(Number(localPoi?.latitude ?? localPoi?.lat))
            ? Number(localPoi?.latitude ?? localPoi?.lat)
            : undefined,
          coordSys: String(localPoi?.coordSys || localPoi?.coord_sys || DEFAULT_POI_COORD_SYS).trim().toLowerCase() || DEFAULT_POI_COORD_SYS,
          distance_m: Number.isFinite(distanceValue)
            ? distanceValue
            : (Number.isFinite(topLevelDistance) ? topLevelDistance : null),
          category: category || null,
          score: Number.isFinite(fusionScore) ? fusionScore : null,
          rank: idx + 1,
          meta: {
            verification: 'dual_verified',
            fusionScore: Number.isFinite(fusionScore) ? fusionScore : null,
            source: 'entity_alignment',
            webTitle: String((result.webItem as Record<string, unknown> | undefined)?.title || '').trim() || null,
          },
        }
      })
  }

  private buildEvidenceItemAuthorityKeys(items: EvidenceItem[] = []) {
    const keys = new Set<string>()
    for (const item of items) {
      this.pushLocalPoiAuthorityKeys(keys, item.id, item.name)
    }
    return keys
  }

  private isAlignmentLocalPoiAuthoritative(
    result: Record<string, unknown>,
    authoritativeLocalPoiKeys?: Set<string>,
  ) {
    if (!authoritativeLocalPoiKeys || authoritativeLocalPoiKeys.size === 0) {
      return true
    }

    const localPoi = result.localPoi && typeof result.localPoi === 'object'
      ? result.localPoi as Record<string, unknown>
      : null
    if (!localPoi) {
      return false
    }

    const candidateKeys = new Set<string>()
    this.pushLocalPoiAuthorityKeys(candidateKeys, localPoi.id, localPoi.name)
    for (const key of candidateKeys) {
      if (authoritativeLocalPoiKeys.has(key)) {
        return true
      }
    }

    return false
  }

  private pushLocalPoiAuthorityKeys(keys: Set<string>, id: unknown, name: unknown) {
    if (id !== null && id !== undefined && String(id).trim()) {
      keys.add(`id:${String(id).trim()}`)
    }

    const normalizedName = String(name || '').trim().toLowerCase()
    if (normalizedName) {
      keys.add(`name:${normalizedName}`)
    }
  }

  private readLatestPoiDiscoveryDbMatchCount(toolCalls: ToolExecutionTrace[]) {
    const result = this.readLatestPoiDiscoveryResult(toolCalls)
    const dbMatchCount = Number(result?.dbMatchCount)
    if (Number.isFinite(dbMatchCount)) {
      return dbMatchCount
    }
    return Array.isArray(result?.verifiedDbPois) ? result.verifiedDbPois.length : null
  }

  private readLatestPoiDiscoveryResult(toolCalls: ToolExecutionTrace[]) {
    const discoveryTrace = [...toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'web_poi_discovery' && trace.action === 'discover_pois' && trace.status === 'done')
    return discoveryTrace?.result as {
      verifiedDbPois?: Array<Record<string, unknown>>
      dbOnlyPois?: Array<Record<string, unknown>>
      dbMatchCount?: number
    } | undefined
  }

  private buildPoiDiscoveryVerifiedItems(result?: {
    verifiedDbPois?: Array<Record<string, unknown>>
  }) {
    return Array.isArray(result?.verifiedDbPois)
      ? result.verifiedDbPois.flatMap((entry) => {
          const poi = entry.poi && typeof entry.poi === 'object'
            ? entry.poi as Record<string, unknown>
            : null
          if (!poi) {
            return []
          }
          const name = String(poi.name || '').trim()
          if (!name) {
            return []
          }
          return [{
            id: (poi.id as string | number | null | undefined) ?? null,
            name,
            category: String(poi.categorySub || poi.categoryMain || '').trim() || null,
            categoryMain: String(poi.categoryMain || '').trim() || null,
            categorySub: String(poi.categorySub || '').trim() || null,
            longitude: Number.isFinite(Number(poi.longitude)) ? Number(poi.longitude) : undefined,
            latitude: Number.isFinite(Number(poi.latitude)) ? Number(poi.latitude) : undefined,
            score: Math.max(Number(entry.matchScore) || 0, Number(entry.confidence) || 0, Number(poi.poiScore) || 0),
            meta: {
              source: 'poi_discovery',
              verification: 'verified',
              mention: String(entry.mention || '').trim() || null,
              matchType: String(entry.matchType || '').trim() || null,
              poiScore: Number.isFinite(Number(poi.poiScore)) ? Number(poi.poiScore) : null,
            },
          } satisfies EvidenceItem]
        })
      : []
  }

  private buildPoiDiscoveryDbOnlyItems(result?: {
    dbOnlyPois?: Array<Record<string, unknown>>
  }) {
    return Array.isArray(result?.dbOnlyPois)
      ? result.dbOnlyPois.flatMap((poi) => {
          const name = String(poi.name || '').trim()
          if (!name) {
            return []
          }
          return [{
            id: (poi.id as string | number | null | undefined) ?? null,
            name,
            category: String(poi.categorySub || poi.categoryMain || '').trim() || null,
            categoryMain: String(poi.categoryMain || '').trim() || null,
            categorySub: String(poi.categorySub || '').trim() || null,
            longitude: Number.isFinite(Number(poi.longitude)) ? Number(poi.longitude) : undefined,
            latitude: Number.isFinite(Number(poi.latitude)) ? Number(poi.latitude) : undefined,
            score: Number.isFinite(Number(poi.poiScore)) ? Number(poi.poiScore) : null,
            meta: {
              source: 'poi_discovery',
              verification: 'db_only',
              poiScore: Number.isFinite(Number(poi.poiScore)) ? Number(poi.poiScore) : null,
            },
          } satisfies EvidenceItem]
        })
      : []
  }

  private mergeEvidenceItems(primaryItems: EvidenceItem[], fallbackItems: EvidenceItem[], limit = 30) {
    const merged: EvidenceItem[] = []
    const seen = new Set<string>()

    const pushItem = (item: EvidenceItem) => {
      const key = item.id != null
        ? `id:${String(item.id)}`
        : `name:${String(item.name || '').trim().toLowerCase()}`
      if (!key || seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(item)
    }

    primaryItems.forEach(pushItem)
    fallbackItems.forEach(pushItem)

    return merged.slice(0, Math.max(limit, 1))
  }

  private resolveCategoryMainFromCategoryKey(categoryKey: string) {
    switch (categoryKey) {
      case 'metro_station':
        return '交通设施服务'
      case 'coffee':
      case 'food':
        return '餐饮美食'
      case 'hotel':
        return '住宿服务'
      case 'supermarket':
        return '购物服务'
      case 'fashion':
        return '购物服务'
      default:
        return null
    }
  }

  private applyRegionEncodingToView(view: EvidenceView, result: unknown) {
    const parsed = readRegionFeatureEncoding(result)
    if (!parsed) {
      return
    }

    view.regionFeatures = parsed.featureTags as RegionFeatureTag[]
    view.regionFeatureSummary = parsed.summary || null

    if (parsed.featureTags.length > 0) {
      const nextHints = [
        ...(view.semanticHints || []),
        ...parsed.featureTags.slice(0, 3).filter(Boolean).map((tag) => ({
          label: tag!.label,
          detail: tag!.detail || undefined,
          score: tag!.score,
        })),
      ]
      view.semanticHints = nextHints.slice(0, 6)
    }

    const regionSemanticEvidence = readSemanticEvidenceStatus(result)
    if (regionSemanticEvidence) {
      view.semanticEvidence = mergeSemanticEvidenceStatuses([
        view.semanticEvidence,
        regionSemanticEvidence,
      ]) || view.semanticEvidence
    }
  }

  private applyPoiProfileEncodingToView(input: {
    view: EvidenceView
    item: EvidenceItem
    result: unknown
  }) {
    const parsed = readPoiProfileEncoding(input.result)
    if (!parsed) {
      return
    }

    const existingProfiles = input.view.representativePoiProfiles || []
    const profile = buildRepresentativePoiProfile({
      item: input.item,
      featureTags: parsed.featureTags,
      summary: parsed.summary,
    })
    const nextProfiles: RepresentativePoiProfile[] = [
      ...existingProfiles.filter((item) => item.name !== profile.name),
      profile,
    ]
    input.view.representativePoiProfiles = nextProfiles.slice(0, 3)

    if (parsed.featureTags.length > 0) {
      const nextHints = [
        ...(input.view.semanticHints || []),
        ...parsed.featureTags.slice(0, 2).map((tag) => ({
          label: tag.label,
          detail: parsed.summary || tag.detail || undefined,
          score: tag.score,
        })),
      ]
      input.view.semanticHints = nextHints.slice(0, 8)
    }

    const poiSemanticEvidence = readSemanticEvidenceStatus(input.result)
    if (poiSemanticEvidence) {
      input.view.semanticEvidence = mergeSemanticEvidenceStatuses([
        input.view.semanticEvidence,
        poiSemanticEvidence,
      ]) || input.view.semanticEvidence
    }
  }

  private async enrichAreaViewWithRegionEncodingIfNeeded(input: {
    intent: DeterministicIntent
    state: AgentTurnState
    context: ReturnType<typeof createSkillExecutionContext>
    writer: SSEWriter
    view: EvidenceView
  }) {
    if (input.intent.queryType !== 'area_overview' || input.view.type !== 'area_overview') {
      return
    }

    const existingTrace = [...input.state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'spatial_encoder' && trace.action === 'encode_region_snapshot' && trace.status === 'done')

    if (existingTrace?.result) {
      this.applyRegionEncodingToView(input.view, existingTrace.result)
      return
    }

    const areaInsightResults = collectAreaInsightTemplateResults(input.state.toolCalls)
    const snapshot = buildRegionSnapshotFromEvidence({
      view: input.view,
      rawQuery: input.intent.rawQuery,
      competitionDensity: (areaInsightResults.get('area_competition_density')?.rows as Record<string, unknown>[] | undefined) || [],
    })

    const hasSnapshotEvidence = Boolean(
      (snapshot.dominantCategories || []).length
      || (snapshot.hotspots || []).length
      || (snapshot.aoiContext || []).length
      || (snapshot.landuseContext || []).length
      || (snapshot.representativePois || []).length,
    )
    if (!hasSnapshotEvidence) {
      return
    }

    await input.writer.reasoning({
      content: '结构证据已经齐了，再补一层区域快照编码，确认回答围绕的是片区特征，而不是只围绕分类计数。',
    })

    const result = await this.executeToolCall({
      id: `area_region_snapshot_${input.state.toolCalls.length + 1}`,
      name: 'spatial_encoder',
      arguments: {
        action: 'encode_region_snapshot',
        payload: {
          snapshot,
        },
      },
    }, input.intent, input.state, input.context)

    if (result.trace.status === 'done') {
      this.applyRegionEncodingToView(input.view, result.trace.result)
    }
  }

  private async enrichAreaViewWithPoiProfilesIfNeeded(input: {
    intent: DeterministicIntent
    state: AgentTurnState
    context: ReturnType<typeof createSkillExecutionContext>
    writer: SSEWriter
    view: EvidenceView
  }) {
    if (input.intent.queryType !== 'area_overview' || input.view.type !== 'area_overview') {
      return
    }

    const candidates = (input.view.representativeSamples || input.view.items || [])
      .filter((item) => trimText(item.name))
      .slice(0, 3)
    if (candidates.length === 0) {
      return
    }

    const alreadyEncodedNames = new Set(
      [...input.state.toolCalls]
        .filter((trace) => trace.skill === 'spatial_encoder' && trace.action === 'encode_poi_profile' && trace.status === 'done')
        .map((trace) => String((trace.payload as Record<string, unknown>).profile_name || ((trace.payload as Record<string, unknown>).profile as Record<string, unknown> | undefined)?.name || '').trim())
        .filter(Boolean),
    )

    const missingCandidates = candidates.filter((item) => !alreadyEncodedNames.has(item.name))
    if (missingCandidates.length === 0) {
      for (const trace of input.state.toolCalls.filter((item) => item.skill === 'spatial_encoder' && item.action === 'encode_poi_profile' && item.status === 'done')) {
        const profileName = String((trace.payload as Record<string, unknown>).profile_name || ((trace.payload as Record<string, unknown>).profile as Record<string, unknown> | undefined)?.name || '').trim()
        const item = candidates.find((candidate) => candidate.name === profileName)
        if (item) {
          this.applyPoiProfileEncodingToView({
            view: input.view,
            item,
            result: trace.result,
          })
        }
      }
      return
    }

    await input.writer.reasoning({
      content: '再补一层代表点画像编码，确认这些样本在片区里分别扮演交通入口、消费锚点还是日常配套支点。',
    })

    for (const item of missingCandidates) {
      const profile = buildPoiProfileInputFromEvidence({
        item,
        view: input.view,
      })

      const result = await this.executeToolCall({
        id: `area_poi_profile_${input.state.toolCalls.length + 1}`,
        name: 'spatial_encoder',
        arguments: {
          action: 'encode_poi_profile',
          payload: {
            profile_name: item.name,
            profile,
          },
        },
      }, input.intent, input.state, input.context)

      if (result.trace.status === 'done') {
        this.applyPoiProfileEncodingToView({
          view: input.view,
          item,
          result: result.trace.result,
        })
      }
    }
  }

  private syncAreaReferenceIntoSimilarRegionView(target: EvidenceView, source: EvidenceView) {
    target.areaProfile = source.areaProfile
    target.hotspots = source.hotspots
    target.representativeSamples = source.representativeSamples
    target.confidence = source.confidence
    target.areaSubject = source.areaSubject
    target.aoiContext = source.aoiContext
    target.landuseContext = source.landuseContext
  }

  private async enrichSimilarRegionViewIfNeeded(input: {
    intent: DeterministicIntent
    state: AgentTurnState
    context: ReturnType<typeof createSkillExecutionContext>
    writer: SSEWriter
    view: EvidenceView
  }) {
    if (input.intent.queryType !== 'similar_regions' || input.view.type !== 'semantic_candidate') {
      return
    }

    const areaInsightResults = collectAreaInsightTemplateResults(input.state.toolCalls)
    const areaInsight: AreaInsightInput = {
      categoryHistogram: readAreaInsightRows(areaInsightResults, 'area_category_histogram'),
      ringDistribution: readAreaInsightRows(areaInsightResults, 'area_ring_distribution'),
      representativeSamples: readAreaInsightRows(areaInsightResults, 'area_representative_sample'),
      competitionDensity: readAreaInsightRows(areaInsightResults, 'area_competition_density'),
      hotspotCells: readAreaInsightRows(areaInsightResults, 'area_h3_hotspots'),
      aoiContext: readAreaInsightRows(areaInsightResults, 'area_aoi_context'),
      landuseContext: readAreaInsightRows(areaInsightResults, 'area_landuse_context'),
    }
    const referenceAnchor = toResolvedAnchorFromEvidenceView(input.view)
    const representativeRows = areaInsight.representativeSamples?.length
      ? areaInsight.representativeSamples
      : []
    const referenceView = buildAreaOverviewView({
      anchor: referenceAnchor,
      rows: representativeRows,
      intent: input.intent,
      areaInsight,
    })
    this.syncAreaReferenceIntoSimilarRegionView(input.view, referenceView)

    const snapshot = buildRegionSnapshotFromEvidence({
      view: referenceView,
      rawQuery: input.intent.rawQuery,
      competitionDensity: (areaInsightResults.get('area_competition_density')?.rows as Record<string, unknown>[] | undefined) || [],
    })
    const hasSnapshotEvidence = Boolean(
      (snapshot.dominantCategories || []).length
      || (snapshot.hotspots || []).length
      || (snapshot.aoiContext || []).length
      || (snapshot.landuseContext || []).length
      || (snapshot.representativePois || []).length,
    )

    let regionSnapshotResult: unknown = null
    const existingSnapshotTrace = [...input.state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'spatial_encoder' && trace.action === 'encode_region_snapshot' && trace.status === 'done')
    if (existingSnapshotTrace?.result) {
      regionSnapshotResult = existingSnapshotTrace.result
      this.applyRegionEncodingToView(referenceView, regionSnapshotResult)
      this.applyRegionEncodingToView(input.view, regionSnapshotResult)
    } else if (hasSnapshotEvidence) {
      await input.writer.reasoning({
        content: '先把参考片区编码成结构快照，提取校园、餐饮、交通和活力这类可解释的相似维度。',
      })
      const snapshotEncoding = await this.executeToolCall({
        id: `similar_region_snapshot_${input.state.toolCalls.length + 1}`,
        name: 'spatial_encoder',
        arguments: {
          action: 'encode_region_snapshot',
          payload: {
            snapshot,
          },
        },
      }, input.intent, input.state, input.context)

      if (snapshotEncoding.trace.status === 'done') {
        regionSnapshotResult = snapshotEncoding.trace.result
        this.applyRegionEncodingToView(referenceView, regionSnapshotResult)
        this.applyRegionEncodingToView(input.view, regionSnapshotResult)
      }
    }

    const referenceDimensions = buildSimilarRegionEvidence({
      referenceView,
      candidates: [],
    }).referenceDimensions
    const searchText = buildSimilarRegionSearchText({
      rawQuery: input.intent.rawQuery,
      referenceView,
      featureSummary: String(referenceView.regionFeatureSummary || '').trim(),
      referenceDimensions,
    })

    const existingSearchTrace = [...input.state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'spatial_vector' && trace.action === 'search_similar_regions' && trace.status === 'done')
    let candidates = readSimilarRegionCandidates(existingSearchTrace?.result)
    let latestSearchResult: unknown = existingSearchTrace?.result
    const existingSearchText = trimText((existingSearchTrace?.payload as Record<string, unknown> | undefined)?.text)
    const shouldRefreshSearch = candidates.length === 0
      || (trimText(searchText) && existingSearchText === trimText(input.intent.rawQuery))

    if (shouldRefreshSearch && trimText(searchText)) {
      await input.writer.reasoning({
        content: '候选相似片区会先做一轮召回，再按参考片区的结构特征补充更贴合的查询语义。',
      })
      const searchResult = await this.executeToolCall({
        id: `similar_region_recall_${input.state.toolCalls.length + 1}`,
        name: 'spatial_vector',
        arguments: {
          action: 'search_similar_regions',
          payload: {
            text: searchText,
            top_k: 5,
          },
        },
      }, input.intent, input.state, input.context)

      if (searchResult.trace.status === 'done') {
        latestSearchResult = searchResult.trace.result
        candidates = readSimilarRegionCandidates(searchResult.trace.result)
      }
    }

    if (candidates.length === 0) {
      input.view.meta.referenceDimensions = referenceDimensions
      input.view.meta.referenceFeatureSummary = String(referenceView.regionFeatureSummary || '').trim() || null
      return
    }

    const candidateRerankScores = new Map<string, number>()
    let latestSimilarityScoreResult: unknown = null
    const queryEncoding = trimText(searchText)
      ? await this.executeToolCall({
        id: `similar_region_query_${input.state.toolCalls.length + 1}`,
        name: 'spatial_encoder',
        arguments: {
          action: 'encode_query',
          payload: {
            text: searchText,
          },
        },
      }, input.intent, input.state, input.context)
      : null
    const queryVectorRef = readVectorRef(queryEncoding?.trace.result)

    if (queryVectorRef) {
      await input.writer.reasoning({
        content: '候选已经召回，再用空间编码器做一轮复核，把整体相似度和分维度匹配拆得更直观。',
      })

      const candidateVectorRefs: string[] = []
      const candidateNameByVectorRef = new Map<string, string>()
      for (const candidate of candidates.slice(0, 5)) {
        const candidateText = [
          candidate.name,
          candidate.summary,
          ...(candidate.tags || []),
        ]
          .map((value) => trimText(value))
          .filter(Boolean)
          .join(' ')
        const candidateEncoding = await this.executeToolCall({
          id: `similar_region_candidate_${input.state.toolCalls.length + 1}`,
          name: 'spatial_encoder',
          arguments: {
            action: 'encode_region',
            payload: {
              label: candidate.name,
              text: candidateText,
            },
          },
        }, input.intent, input.state, input.context)

        if (candidateEncoding.trace.status !== 'done') {
          continue
        }
        const candidateVectorRef = readVectorRef(candidateEncoding.trace.result)
        if (!candidateVectorRef) {
          continue
        }
        candidateVectorRefs.push(candidateVectorRef)
        candidateNameByVectorRef.set(candidateVectorRef, candidate.name)
      }

      if (candidateVectorRefs.length > 0) {
        const similarityResult = await this.executeToolCall({
          id: `similar_region_score_${input.state.toolCalls.length + 1}`,
          name: 'spatial_encoder',
          arguments: {
            action: 'score_similarity',
            payload: {
              query_vector_ref: queryVectorRef,
              candidate_vector_refs: candidateVectorRefs,
            },
          },
        }, input.intent, input.state, input.context)

        if (similarityResult.trace.status === 'done') {
          latestSimilarityScoreResult = similarityResult.trace.result
          const similarityScores = readSimilarityScores(similarityResult.trace.result)
          for (const [candidateVectorRef, score] of similarityScores.entries()) {
            const candidateName = candidateNameByVectorRef.get(candidateVectorRef)
            if (!candidateName) continue
            candidateRerankScores.set(candidateName, score)
          }
        }
      }
    }

    const similarityBundle = buildSimilarRegionEvidence({
      referenceView,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        rerankScore: candidateRerankScores.get(candidate.name) ?? null,
      })),
    })

    input.view.meta.referenceDimensions = similarityBundle.referenceDimensions
    input.view.meta.referenceFeatureSummary = String(referenceView.regionFeatureSummary || '').trim() || null
    input.view.meta.similaritySkill = 'spatial_vector+spatial_encoder'
    input.view.regions = similarityBundle.regions
    input.view.items = similarityBundle.regions.map((region) => ({
      id: region.regionId || null,
      name: region.name,
      score: region.score,
      rank: region.rank || null,
      meta: {
        summary: region.summary,
        regionId: region.regionId || null,
        rank: region.rank || null,
        tags: region.tags || [],
        dimensions: region.dimensions || [],
      },
    }))

    const nextHints = [
      ...(input.view.semanticHints || []),
      ...similarityBundle.referenceDimensions.map((dimension) => ({
        label: dimension.label,
        detail: dimension.detail || undefined,
        score: dimension.score,
      })),
      ...similarityBundle.regions.slice(0, 2).map((region) => ({
        label: region.name,
        detail: region.summary,
        score: region.score,
      })),
    ]
    input.view.semanticHints = nextHints.slice(0, 8)

    input.view.semanticEvidence = mergeSemanticEvidenceStatuses([
      input.view.semanticEvidence,
      readSemanticEvidenceStatus(regionSnapshotResult),
      readSemanticEvidenceStatus(queryEncoding?.trace.result),
      readSemanticEvidenceStatus(latestSearchResult),
      readSemanticEvidenceStatus(latestSimilarityScoreResult),
    ]) || input.view.semanticEvidence
  }

  private renderAnswer(view: EvidenceView): RenderedAnswer {
    const answer = this.renderer.render(view)
    const pois = view.items
    return {
      answer,
      summary: answer,
      pois,
      stats: {
        result_count: pois.length,
        query_type: view.meta.queryType,
      },
    }
  }

  private ensureMarkdownAnswer(input: {
    answer: string
    renderedAnswer: string
    queryType: DeterministicIntent['queryType']
    answerSource?: string
  }) {
    const answer = String(input.answer || '').trim()
    const renderedAnswer = String(input.renderedAnswer || '').trim()
    const structuredQuery = ['nearby_poi', 'nearest_station', 'area_overview', 'compare_places', 'similar_regions'].includes(input.queryType)
    const answerHasSectionHeadings = /(^|\n)#{2,3}\s/u.test(answer)
    const renderedHasSectionHeadings = /(^|\n)#{2,3}\s/u.test(renderedAnswer)
    const normalizedAnswerSource = String(input.answerSource || '').trim()
    const preservePlainText = normalizedAnswerSource.includes('insufficient_evidence')
    const preserveUnstructuredFinalAnswer = normalizedAnswerSource === 'llm_direct' || normalizedAnswerSource === 'clarification'

    if (looksLikeMarkdownAnswer(answer) && (!structuredQuery || answerHasSectionHeadings || !renderedHasSectionHeadings)) {
      return {
        answer,
        usedRenderedAnswer: false,
      }
    }

    if (!answer) {
      if (looksLikeMarkdownAnswer(renderedAnswer)) {
        return {
          answer: renderedAnswer,
          usedRenderedAnswer: true,
        }
      }
      return {
        answer: renderedAnswer,
        usedRenderedAnswer: true,
      }
    }

    if (preservePlainText) {
      return {
        answer,
        usedRenderedAnswer: false,
      }
    }

    if (structuredQuery && renderedHasSectionHeadings && !preserveUnstructuredFinalAnswer) {
      return {
        answer: renderedAnswer,
        usedRenderedAnswer: true,
      }
    }

    if (structuredQuery) {
      // 将纯文本答案转为格式化的 Markdown 列表，确保每行都有换行
      const answerLines = answer.split(/\n/).map((line) => line.trim()).filter(Boolean)
      if (answerLines.length > 1) {
        return {
          answer: `## 结论\n${answerLines.map((line) => `- ${line}`).join('\n')}`,
          usedRenderedAnswer: false,
        }
      }
      return {
        answer: `## 结论\n\n${answer}`,
        usedRenderedAnswer: false,
      }
    }

    if (looksLikeMarkdownAnswer(renderedAnswer)) {
      return {
        answer: renderedAnswer,
        usedRenderedAnswer: true,
      }
    }

    return {
      answer,
      usedRenderedAnswer: false,
    }
  }

  private describeSpatialConstraint(spatialConstraint: SpatialAnalysisConstraint | null | undefined) {
    if (!spatialConstraint) return '未显式传入范围，按锚点附近默认范围分析'

    const categoryTail = spatialConstraint.selectedCategories.length > 0
      ? `，并额外限制类别：${spatialConstraint.selectedCategories.join(' / ')}`
      : ''

    if (spatialConstraint.scope === 'regions') {
      const regionNames = spatialConstraint.regions
        .map((region) => String(region.name || '').trim())
        .filter(Boolean)
      return `当前范围是用户选区${regionNames.length > 0 ? `（${regionNames.join('、')}）` : ''}${categoryTail}`
    }

    if (spatialConstraint.scope === 'boundary') {
      return `当前范围是用户手绘边界${categoryTail}`
    }

    if (spatialConstraint.scope === 'viewport') {
      return `当前范围是地图 viewport${categoryTail}`
    }

    if (spatialConstraint.scope === 'circle') {
      return `当前范围是用户指定圆形区域${categoryTail}`
    }

    return `当前范围按锚点邻近空间约束分析${categoryTail}`
  }

  private buildAreaSynthesisEvidence(view: EvidenceView) {
    const lines: string[] = []
    const questionMode = String(view.meta.questionMode || 'summary').trim() || 'summary'
    const subjectConfidence = String(view.areaSubject?.confidence || '').trim()

    if (view.areaSubject?.title && subjectConfidence === 'high') {
      lines.push(`区域主语: ${view.areaSubject.title}`)
    }

    const regionFeatureLabels = (view.regionFeatures || [])
      .slice(0, 5)
      .map((item) => item.label)
      .filter(Boolean)
    if (regionFeatureLabels.length > 0) {
      lines.push(`片区特征: ${regionFeatureLabels.join('、')}`)
    }

    const dominant = (view.areaProfile?.dominantCategories || [])
      .slice(0, 3)
      .map((bucket) => `${bucket.label}${bucket.share ? `(${Math.round(bucket.share * 100)}%)` : ''}`)
    if (dominant.length > 0) {
      lines.push(`${questionMode === 'opportunity' ? '供给结构' : '主要业态'}: ${dominant.join('、')}`)
    }

    const hotspots = (view.hotspots || [])
      .slice(0, 3)
      .map((item) => `${item.label}${item.poiCount ? `(${item.poiCount})` : ''}`)
    if (hotspots.length > 0) {
      lines.push(`热点: ${hotspots.join('、')}`)
    }

    const anomalies = (view.anomalySignals || [])
      .slice(0, 2)
      .map((item) => item.title)
    if (anomalies.length > 0) {
      lines.push(`${questionMode === 'opportunity' ? '风险' : questionMode === 'anomaly' ? '异常' : '补充观察'}: ${anomalies.join('、')}`)
    }

    if (questionMode === 'opportunity') {
      const opportunities = (view.opportunitySignals || [])
        .slice(0, 2)
        .map((item) => item.title)
      if (opportunities.length > 0) {
        lines.push(`机会: ${opportunities.join('、')}`)
      }
    }

    const samples = (view.representativeSamples || [])
      .slice(0, 4)
      .map((item) => item.name)
      .filter(Boolean)
    if (samples.length > 0) {
      lines.push(`代表样本: ${samples.join('、')}`)
    }

    const aoi = (view.aoiContext || [])
      .slice(0, 3)
      .map((item) => item.name)
    if (aoi.length > 0) {
      lines.push(`AOI 参考: ${aoi.join('、')}`)
    }

    const landuse = (view.landuseContext || [])
      .slice(0, 3)
      .map((item) => `${item.landType}${item.totalAreaSqm ? `(${Math.round(item.totalAreaSqm)}㎡)` : ''}`)
    if (landuse.length > 0) {
      lines.push(`用地参考: ${landuse.join('、')}`)
    }

    // entity_alignment 对齐结果证据
    const alignmentMeta = view.meta.entity_alignment as Record<string, unknown> | undefined
    if (alignmentMeta) {
      const dualCount = Number(alignmentMeta.dual_verified || 0)
      lines.push(`联网对齐: 已验证 ${dualCount} 个`)
      // 列出对齐后的 POI 名称（最高优先级证据）
      const alignedItems = (view.items || []).filter(
        (item) => (item.meta as Record<string, unknown>)?.verification === 'dual_verified'
      )
      const dualNames = alignedItems
        .slice(0, 5)
        .map((item) => item.name)
      if (dualNames.length > 0) {
        lines.push(`验证样本: ${dualNames.join('、')}`)
      }
    }

    return lines
  }

  private buildLookupSynthesisEvidence(input: {
    view: EvidenceView
    toolCalls: ToolExecutionTrace[]
  }) {
    const lines: string[] = []
    const anchorName = String(
      input.view.anchor.resolvedPlaceName || input.view.anchor.displayName || input.view.anchor.placeName || ''
    ).trim()

    if (anchorName) {
      lines.push(`查询锚点: ${anchorName}`)
    }

    const scopeLabel = String(input.view.meta.scopeLabel || '').trim()
    const scopeDistricts = Array.isArray(input.view.meta.scopeDistricts)
      ? input.view.meta.scopeDistricts.map((item) => String(item || '').trim()).filter(Boolean)
      : []
    if (scopeLabel) {
      lines.push(`范围约束: ${scopeLabel}${scopeDistricts.length > 0 ? `（${scopeDistricts.join('、')}）` : ''}`)
    }

    const localItems = (input.view.items || [])
      .slice(0, 6)
      .map((item) => {
        const category = String(item.category || item.categorySub || item.categoryMain || '').trim()
        return [item.name, category].filter(Boolean).join('（') + (category ? '）' : '')
      })
      .filter(Boolean)
    if (localItems.length > 0) {
      lines.push(`本地命中: ${localItems.join('、')}`)
    }

    const alignmentMeta = input.view.meta.entity_alignment as Record<string, unknown> | undefined
    if (alignmentMeta) {
      const dualCount = Number(alignmentMeta.dual_verified || 0)
      lines.push(`实体对齐: 已验证 ${dualCount} 个`)
      const alignedSamples = (input.view.items || [])
        .filter((item) => (item.meta as Record<string, unknown> | undefined)?.verification === 'dual_verified')
        .slice(0, 4)
        .map((item) => item.name)
      if (alignedSamples.length > 0) {
        lines.push(`对齐样本: ${alignedSamples.join('、')}`)
      }
    }

    const webObservations = collectWebSearchObservations(input.toolCalls)
    for (const observation of webObservations) {
      const sourceLabel = observation.source === 'tavily' ? 'Tavily' : '多引擎'
      const titles = observation.items
        .slice(0, 3)
        .map((item) => item.title)
        .filter(Boolean)
      lines.push(
        observation.items.length > 0
          ? `联网搜索(${sourceLabel}): 命中 ${observation.items.length} 条；样本：${titles.join('、')}`
          : `联网搜索(${sourceLabel}): 未命中稳定结果`
      )
      if (observation.answerPreview) {
        lines.push(`联网摘要(${sourceLabel}): ${observation.answerPreview}`)
      }
    }

    return lines
  }

  private async streamAnswerChunks(writer: SSEWriter, answer: string) {
    const chunks = splitStreamableText(answer)
    if (chunks.length === 0) {
      return
    }

    for (let index = 0; index < chunks.length; index += 1) {
      await writer.message(chunks[index])
      if (index < chunks.length - 1) {
        await delay(10)
      }
    }
  }

  private async synthesizeGroundedAnswer(input: {
    provider: LLMProvider
    contract?: NLContract
    intent: DeterministicIntent
    evidenceView: EvidenceView
    rendered: RenderedAnswer
    toolCalls: ToolExecutionTrace[]
    spatialConstraint: SpatialAnalysisConstraint | null
    rawQuery: string
  }) {
    if (!input.provider.isReady()) return null
    if (!['nearby_poi', 'nearest_station', 'area_overview', 'compare_places', 'similar_regions'].includes(input.intent.queryType)) return null

    const scopeSummary = this.describeSpatialConstraint(input.spatialConstraint)
    const evidenceLines = ['nearby_poi', 'nearest_station'].includes(input.intent.queryType)
      ? this.buildLookupSynthesisEvidence({ view: input.evidenceView, toolCalls: input.toolCalls })
      : this.buildAreaSynthesisEvidence(input.evidenceView)
    if (evidenceLines.length === 0) return null

    const narrativeClause = input.contract?.narrative
      ? `任务契约：${input.contract.narrative}`
      : ''
    const forbiddenClause = input.contract?.meta.forbiddenBlocks.length
      ? `禁止涉及：${input.contract.meta.forbiddenBlocks.join('、')}。`
      : ''

    const questionMode = String(input.evidenceView.meta.questionMode || 'summary').trim() || 'summary'
    const areaOverviewTailSection = questionMode === 'opportunity' ? '机会与风险' : '补充说明'
    const areaSubjectConfidence = String(input.evidenceView.areaSubject?.confidence || '').trim()
    const explicitAreaSubject = areaSubjectConfidence === 'high'
      ? String(input.evidenceView.areaSubject?.title || '').trim()
      : ''
    const answerStyle = input.intent.queryType === 'nearest_station'
      ? '先直接给出最近结果，再补一句距离或类别依据。'
      : input.intent.queryType === 'nearby_poi'
        ? '必须输出结构化 Markdown，优先使用 ## 推荐结论 / ## 就近可选 / ## 联网补充（仅在有稳定补充证据时） / ## 使用说明。不要使用 --- 分割线。列表项必须用 - 开头并单独一行，禁止 # - 连写。先直接回答最值得关注的对象，再带出 2-4 个证据样本。'
        : input.intent.queryType === 'area_overview'
          ? `必须输出结构化 Markdown，并按 ## 区域主语 / ## 关键特征 / ## 热点与结构 / ## ${areaOverviewTailSection} 四段组织，不要回放 deterministic 草稿。每段 1-3 句，只保留最有解释力的证据。${questionMode === 'opportunity' ? '' : '默认做中性片区总结，不要擅自扩展成商机、投资或开店建议。'}`
          : '写成 1-2 段自然中文，不要写成日志或执行列表。'

    const synthesisPrompt = [
      `问题：${input.rawQuery}`,
      narrativeClause,
      `问题模式：${questionMode}`,
      `范围：${scopeSummary}`,
      forbiddenClause,
      '请只基于下面证据写最终回答，并整理成用户可直接阅读的 Markdown。',
      '铁律：',
      '1. 忠于用户原始提问。用户问的是什么，你就仅仅回答什么。',
      '2. 先给直接结论，再给必要证据。',
      '3. 写成自然中文，不要写成日志、探针列表或系统回放。',
      '4. 如果底层数据没有呈现，直接回答"未包含相关数据"，绝不推演。',
      '5. 如果联网搜索没有命中稳定结果，要明确说联网未提供稳定补充证据，不要编造口碑。',
      '6. 禁止在括号中标注验证状态、距离米数、置信度等内部调试信息（如"✓双重验证""约97米"），用户只看店名和品类。',
      '7. 附近检索和最近地铁站问题必须先回答具体对象，不要扩展成片区分析。',
      input.intent.queryType === 'nearby_poi'
        ? '8. 附近检索题默认用二级标题分段，不要把结论、候选地点和说明揉成一段。'
        : '',
      input.intent.queryType === 'area_overview'
        ? (questionMode === 'opportunity'
            ? '8. 只有在用户明确问开店、供需、竞争或补位方向时，才可以展开经营判断。'
            : '8. 这是普通片区总结题，禁止擅自扩展成经营、投资或开店建议。')
        : '',
      input.intent.queryType === 'area_overview'
        ? (explicitAreaSubject
            ? `必须直接写"${explicitAreaSubject}"，不要只写"当前区域"。`
            : '必须明确写出区域主语，不要只写“当前区域”。如果 AOI / 用地信号是混合的，优先选择更宽、证据更充分的区域主语，不要被单个校园或楼盘名字带偏。')
        : '',
      input.intent.queryType === 'area_overview'
        ? `输出结构固定为：## 区域主语 / ## 关键特征 / ## 热点与结构 / ## ${areaOverviewTailSection}。`
        : '',
      answerStyle,
      '只保留有解释力的数字和样本，不要罗列无意义统计。',
      '证据：',
      ...evidenceLines.map((line) => `- ${line}`),
    ].filter(Boolean).join('\n')

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: 'system',
            content: '你是一个严格基于证据的空间问答助手。你的任务是把已验证空间证据整理成简洁、结构化、可直接阅读的中文 Markdown 回答。禁止脱离证据自由发挥。',
          },
          {
            role: 'user',
            content: synthesisPrompt,
          },
        ],
        tools: [],
        timeoutMs: getDefaultLlmSynthesisTimeoutMs(),
      })

      const answer = String(response.assistantMessage.content || '').trim()
      return answer || null
    } catch {
      return null
    }
  }

  private buildStats(input: {
    intent: DeterministicIntent
    startedAt: number
    traceId: string
    sessionId: string
    providerReady: boolean
    evidenceCount: number
    anchor: ResolvedAnchor | null
    toolCalls: ToolExecutionTrace[]
    decision: string
    taskMode?: 'query' | 'analysis'
    answerSource?: string
    recommendedTrack?: 'fast' | 'deep'
  }) {
    const fallbackAnchorCoordSys = input.intent.anchorSource === 'user_location' ? 'wgs84' : DEFAULT_POI_COORD_SYS
    const semanticEvidence = collectSemanticEvidence(input.toolCalls)
    return {
      query_type: input.intent.queryType,
      task_mode: input.taskMode || classifyTaskMode({
        intent: input.intent,
        rawQuery: input.intent.rawQuery,
      }),
      intent_mode: input.intent.intentMode,
      result_count: input.evidenceCount,
      anchor_name: input.anchor?.resolved_place_name || input.intent.placeName || null,
      anchor_lon: input.anchor?.lon ?? null,
      anchor_lat: input.anchor?.lat ?? null,
      anchor_coord_sys: normalizeCoordSys(input.anchor?.coord_sys, fallbackAnchorCoordSys),
      target_category: input.intent.targetCategory || null,
      latency_ms: Date.now() - input.startedAt,
      version: this.options.version,
      trace_id: input.traceId,
      session_id: input.sessionId,
      provider_ready: input.providerReady,
      tool_call_count: input.toolCalls.length,
      confidence_gate: input.decision,
      answer_source: input.answerSource || (input.providerReady ? 'llm_or_guardrail' : 'deterministic_renderer'),
      // 阶段 8：暴露 Fast/Deep Track 路径指标
      recommended_track: input.recommendedTrack || null,
      semantic_evidence_level: semanticEvidence?.level,
      semantic_evidence_mode: semanticEvidence?.mode,
      semantic_evidence_weak: semanticEvidence?.weakEvidence,
      semantic_evidence_reason: semanticEvidence?.reason ?? null,
    }
  }

  private recordRequestMetrics(input: {
    startedAt: number
    state: AgentTurnState
    answer: string
    evidenceView?: EvidenceView
    /** 阶段 0 新增：分阶段耗时 */
    intentMs?: number
    evidenceRuntimeMs?: number
    synthesisMs?: number
    rawQuery?: string
    queryType?: string
    llmRoundCount?: number
  }) {
    this.metrics.recordRequest({
      latencyMs: Date.now() - input.startedAt,
      sqlValidated: input.state.sqlValidationAttempts > 0,
      sqlAccepted: input.state.sqlValidationAttempts > 0
        && input.state.sqlValidationAttempts === input.state.sqlValidationPassed,
      answerGrounded: this.isAnswerGrounded(input.answer, input.evidenceView),
      // 阶段 0 新增：分阶段耗时
      intentMs: input.intentMs,
      evidenceRuntimeMs: input.evidenceRuntimeMs,
      synthesisMs: input.synthesisMs,
      // 阶段 0 新增：LLM 调用轮次
      llmRoundCount: input.llmRoundCount,
      // 阶段 0 新增：工具调用次数
      toolCallCount: input.state.toolCalls.length,
      // P0 修复：queryType 必须传入真实值，否则 detectUnnecessaryAnalysis 会跳过所有查询类型
      unnecessaryAnalysis: input.rawQuery
        ? detectUnnecessaryAnalysis({
          rawQuery: input.rawQuery,
          answer: input.answer,
          intent: { queryType: input.queryType || '' },
        })
        : false,
    })
  }

  private isAnswerGrounded(answer: string, evidenceView?: EvidenceView) {
    const normalizedAnswer = String(answer || '').trim().toLowerCase()
    if (!normalizedAnswer || !evidenceView) {
      return false
    }

    const hasEvidence = evidenceView.items.length > 0
      || (evidenceView.pairs?.length || 0) > 0
      || (evidenceView.regions?.length || 0) > 0
    if (!hasEvidence) {
      return false
    }

    const ignoredKeywords = new Set(['当前区域', '当前片区', '这里', '此处'].map((value) => value.toLowerCase()))
    const keywordSuffixes = ['片区', '区域', '商圈', '周边', '附近', '生活带', '商业带']
    const collectKeywordVariants = (values: unknown[], anchorName?: unknown) => {
      const variants = new Set<string>()
      const normalizedAnchor = String(anchorName || '').trim().toLowerCase()

      for (const value of values) {
        const normalized = String(value || '').trim().toLowerCase()
        if (!normalized || ignoredKeywords.has(normalized)) {
          continue
        }

        variants.add(normalized)

        if (normalizedAnchor && normalized.includes(normalizedAnchor)) {
          const anchorless = normalized.replace(normalizedAnchor, '').trim()
          if (anchorless.length >= 2 && !ignoredKeywords.has(anchorless)) {
            variants.add(anchorless)
          }
        }

        for (const suffix of keywordSuffixes) {
          if (!normalized.endsWith(suffix) || normalized.length <= suffix.length + 1) {
            continue
          }
          const trimmed = normalized.slice(0, -suffix.length).trim()
          if (trimmed.length >= 2 && !ignoredKeywords.has(trimmed)) {
            variants.add(trimmed)
          }
        }
      }

      return variants
    }
    const countKeywordHits = (keywords: Iterable<string>, minimum = 1) => {
      let hits = 0
      for (const keyword of keywords) {
        if (!keyword || !normalizedAnswer.includes(keyword)) {
          continue
        }
        hits += 1
        if (hits >= minimum) {
          return hits
        }
      }
      return hits
    }
    const keywords = new Set<string>()
    const pushKeyword = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase()
      if (normalized) {
        keywords.add(normalized)
      }
    }

    pushKeyword(evidenceView.anchor.placeName)
    pushKeyword(evidenceView.anchor.displayName)
    pushKeyword(evidenceView.anchor.resolvedPlaceName)
    pushKeyword(evidenceView.areaSubject?.title)
    pushKeyword(evidenceView.areaSubject?.anchorName)

    for (const item of evidenceView.items) {
      pushKeyword(item.name)
    }
    for (const aoi of evidenceView.aoiContext || []) {
      pushKeyword(aoi.name)
    }
    for (const pair of evidenceView.pairs || []) {
      pushKeyword(pair.label)
      pushKeyword(pair.anchor.placeName)
      pushKeyword(pair.anchor.displayName)
      pushKeyword(pair.anchor.resolvedPlaceName)
      for (const item of pair.items) {
        pushKeyword(item.name)
      }
    }
    for (const region of evidenceView.regions || []) {
      pushKeyword(region.name)
    }

    if (evidenceView.type === 'area_overview') {
      const groundedSubjectKeywords = collectKeywordVariants([
        evidenceView.areaSubject?.title,
        evidenceView.areaSubject?.anchorName,
        evidenceView.areaSubject?.typeHint,
        ...(evidenceView.aoiContext || []).map((item) => item.name),
      ], evidenceView.areaSubject?.anchorName)

      if (countKeywordHits(groundedSubjectKeywords, 1) > 0) {
        return true
      }

      const supportingEvidenceKeywords = collectKeywordVariants([
        ...(evidenceView.representativeSamples || []).map((item) => item.name),
        ...(evidenceView.regionFeatures || []).map((item) => item.label),
        ...(evidenceView.hotspots || []).map((item) => item.label),
        ...(evidenceView.areaProfile?.dominantCategories || []).map((item) => item.label),
        ...(evidenceView.semanticHints || []).map((item) => item.label),
      ], evidenceView.areaSubject?.anchorName)

      if (countKeywordHits(supportingEvidenceKeywords, 2) >= 2) {
        return true
      }

      return false
    }

    return [...keywords].some((keyword) => normalizedAnswer.includes(keyword))
  }

  private buildUnsupportedAnswer() {
    return '当前 V4 已支持附近 POI、最近地铁站、当前区域洞察、相似片区、双地点比较，以及“先在一段路径上找点位、再去另一个目的地继续逛”的复合行程问题。你可以继续给我一个明确地点，或者直接让我读懂当前区域。'
  }
}
