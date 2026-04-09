import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Writable } from 'node:stream'

import { DeterministicRouter } from '../chat/DeterministicRouter.js'
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
  ToolExecutionTrace,
} from '../chat/types.js'
import { EvidenceViewFactory } from '../evidence/EvidenceViewFactory.js'
import { buildPoiProfileInputFromEvidence, buildRepresentativePoiProfile } from '../evidence/areaInsight/poiProfile.js'
import { buildRegionSnapshotFromEvidence } from '../evidence/areaInsight/regionSnapshot.js'
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
import type { AgentTurnState, SpatialAnalysisConstraint, SpatialAnalysisRegion } from './types.js'
import { SessionManager } from './SessionManager.js'
import { SkillManifestLoader } from '../skills/SkillManifestLoader.js'
import { MemoryManager } from '../memory/MemoryManager.js'
import { ShortTermMemory } from '../memory/ShortTermMemory.js'
import { LongTermMemory } from '../memory/LongTermMemory.js'
import { ProfileManager } from '../memory/ProfileManager.js'
import { RuntimeMetrics } from '../metrics/RuntimeMetrics.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import {
  mergeSemanticEvidenceStatuses,
  type DependencyStatus,
  type SemanticEvidenceStatus,
} from '../integration/dependencyStatus.js'
import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'

const SCHEMA_VERSION = 'v4.agent.v1'
const DEFAULT_POI_COORD_SYS = 'gcj02'
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = resolveTimeoutMs(process.env.LLM_TIMEOUT_MS, 12000)
const DEFAULT_LLM_QUERY_TIMEOUT_MS = resolveTimeoutMs(process.env.LLM_QUERY_TIMEOUT_MS, Math.max(DEFAULT_LLM_REQUEST_TIMEOUT_MS, 15000))
const DEFAULT_LLM_ANALYSIS_TIMEOUT_MS = resolveTimeoutMs(process.env.LLM_ANALYSIS_TIMEOUT_MS, Math.max(DEFAULT_LLM_REQUEST_TIMEOUT_MS, 30000))
const DEFAULT_LLM_SYNTHESIS_TIMEOUT_MS = resolveTimeoutMs(process.env.LLM_SYNTHESIS_TIMEOUT_MS, Math.max(DEFAULT_LLM_REQUEST_TIMEOUT_MS, 18000))
const DEFAULT_LLM_QUERY_MAX_ROUNDS = 4
const DEFAULT_LLM_ANALYSIS_MAX_ROUNDS = 6
const AREA_INSIGHT_TEMPLATES = [
  'area_category_histogram',
  'area_ring_distribution',
  'area_representative_sample',
  'area_competition_density',
  'area_h3_hotspots',
  'area_aoi_context',
  'area_landuse_context',
] as const
const AREA_INSIGHT_CORE_TEMPLATES = [
  'area_category_histogram',
  'area_ring_distribution',
  'area_representative_sample',
  'area_competition_density',
  'area_h3_hotspots',
] as const
const AREA_INSIGHT_SEMANTIC_TEMPLATES = [
  'area_aoi_context',
  'area_landuse_context',
] as const
const POSTGIS_TEMPLATE_DIR = resolveResourceUrl(import.meta.url, [
  '../skills/postgis/templates/',
  '../../src/skills/postgis/templates/',
])
const POSTGIS_TEMPLATE_FILE_MAP: Record<string, string> = {
  area_category_histogram: 'areaCategoryHistogram.sql',
  area_ring_distribution: 'areaRingDistribution.sql',
  area_representative_sample: 'areaRepresentativeSample.sql',
  area_competition_density: 'areaCompetitionDensity.sql',
  area_h3_hotspots: 'areaH3Hotspots.sql',
  area_aoi_context: 'areaAoiContext.sql',
  area_landuse_context: 'areaLanduseContext.sql',
}
const POSTGIS_TEMPLATE_CACHE = new Map<string, string>()

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

function readRequestRegions(request: ChatRequestV4) {
  const topLevelRegions = Array.isArray(request.options?.regions) ? request.options?.regions : []
  if (topLevelRegions.length > 0) {
    return topLevelRegions
  }

  const spatialContext = readSpatialContext(request)
  return Array.isArray(spatialContext?.regions) ? spatialContext.regions : []
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
      } satisfies SpatialAnalysisRegion
    })
    .filter((region): region is SpatialAnalysisRegion => Boolean(region))

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

function readCategoryValue(row: Record<string, unknown> = {}, keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] || '').trim()
    if (value) return value
  }
  return ''
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
    if (!template || !AREA_INSIGHT_TEMPLATES.includes(template as typeof AREA_INSIGHT_TEMPLATES[number])) {
      continue
    }

    latestByTemplate.set(template, (trace.result as Record<string, unknown> | undefined) || {})
  }

  return latestByTemplate
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
      } satisfies RegionFeatureTag
    })
    .filter((item): item is RegionFeatureTag => Boolean(item))

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

function classifyTaskMode(input: {
  intent: DeterministicIntent
  rawQuery: string
}): 'query' | 'analysis' {
  if (['area_overview', 'compare_places', 'similar_regions'].includes(input.intent.queryType)) {
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
  return ['nearby_poi', 'nearest_station', 'area_overview', 'similar_regions', 'compare_places', 'unsupported']
    .includes(String(value || '').trim())
}

function isSupportedAnchorSource(value: unknown): value is NonNullable<DeterministicIntent['anchorSource']> {
  return ['place', 'map_view', 'user_location'].includes(String(value || '').trim())
}

function intentModeFromQueryType(queryType: DeterministicIntent['queryType']): DeterministicIntent['intentMode'] {
  return queryType === 'nearby_poi' ? 'deterministic_visible_loop' : 'agent_full_loop'
}

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
  router?: DeterministicRouter
  alivePromptBuilder?: AlivePromptBuilder
  confidenceGate?: ConfidenceGate
  metrics?: RuntimeMetrics
}

export class GeoLoomAgent {
  private readonly router: DeterministicRouter
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

  constructor(private readonly options: GeoLoomAgentOptions) {
    this.router = options.router || new DeterministicRouter()
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
    const lastUserText = this.router.extractLastUserText(request.messages)
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
    const activeProvider = this.provider.isReady() ? this.provider : new InMemoryLLMProvider()
    const routerIntent = this.router.route(request)
    const intent = await this.reinterpretIntentWithLlmIfNeeded({
      request,
      rawQuery: lastUserText,
      routerIntent,
      providerReady: this.provider.isReady(),
    })
    const intentInferredByLlm = intent.queryType !== routerIntent.queryType
      || intent.anchorSource !== routerIntent.anchorSource
      || intent.needsClarification !== routerIntent.needsClarification
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
    if (intent.anchorSource === 'user_location' && requestUserLocation) {
      state.anchors.primary = buildUserLocationAnchor(requestUserLocation)
    } else if (intent.anchorSource === 'map_view' && requestMapViewAnchor) {
      state.anchors.primary = requestMapViewAnchor
    }
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
      rawAnchor: previewAnchorLabel,
      normalizedAnchor: previewAnchorLabel,
      displayAnchor: previewAnchorLabel,
      targetCategory: intent.targetCategory,
      confidence: intent.queryType === 'unsupported' ? 0.35 : 0.92,
      needsClarification: intent.needsClarification,
      clarificationHint: intent.clarificationHint,
      parserModel: this.provider.isReady()
        ? (intentInferredByLlm ? 'agent-intent-understanding' : 'agent-router')
        : 'deterministic-router',
      parserProvider: this.provider.isReady() && intentInferredByLlm ? 'llm' : 'rule',
    })

    if (intent.queryType === 'unsupported' || intent.needsClarification) {
      const answer = intent.clarificationHint || this.buildUnsupportedAnswer()
      await this.finishWithoutEvidence({
        writer,
        answer,
        intent,
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
    const snapshot = this.conversationMemory.summarize(await this.memory.getSnapshot(session.id))
    const profiles = await this.memory.loadProfiles()
    const manifests = await this.manifestLoader.loadAll()
    const skills = this.options.registry.list()
      .map((summary) => this.options.registry.get(summary.name))
      .filter((skill): skill is SkillDefinition => Boolean(skill))
    const tools = buildToolSchemas({ skills, manifests })
    const taskMode = classifyTaskMode({
      intent,
      rawQuery: lastUserText,
    })
    const toolLoopMaxRounds = this.resolveToolLoopMaxRounds(taskMode)
    const toolLoopTimeoutMs = taskMode === 'analysis'
      ? DEFAULT_LLM_ANALYSIS_TIMEOUT_MS
      : DEFAULT_LLM_QUERY_TIMEOUT_MS
    const toolLoopUserMessage = this.buildToolLoopUserMessage({
      rawQuery: lastUserText,
      intent,
      routerIntent,
    })
    const systemPrompt = this.alivePromptBuilder.build({
      sessionId: session.id,
      profiles,
      memory: {
        summary: snapshot.summary,
        recentTurns: snapshot.recentTurns,
      },
      skillSnippets: manifests.map((manifest) => manifest.promptSnippet),
      requestContext: {
        rawQuery: lastUserText,
        routerHint: intent.queryType,
        anchorHint: intent.anchorSource || null,
        spatialScopeHint: this.describeSpatialConstraint(state.spatialConstraint || null),
        taskModeHint: taskMode,
      },
    })

    await writer.stage('tool_select')
    await writer.thinking({
      status: 'start',
      message: '正在规划本轮 skill 调用...',
    })

    let execution: Awaited<ReturnType<typeof runFunctionCallingLoop>>
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
          await writer.thinking({
            status: 'start',
            message: `正在执行 ${call.name}.${String(call.arguments.action || '')}...`,
          })
          const result = await this.executeToolCall(call, intent, state, skillContext)
          return {
            content: JSON.stringify(result.content),
            trace: result.trace,
          }
        },
      })
    } catch (error) {
      if (error instanceof ToolExecutionAbortError) {
        throw error
      }
      const errorMessage = error instanceof Error ? error.message : String(error || 'unknown_llm_error')
      await writer.thinking({
        status: 'start',
        message: 'LLM 调用异常，已切换到确定性证据摘要模式。',
      })
      await writer.reasoning({
        content: `主模型这一轮没有顺利完成工具编排，触发原因是：${errorMessage}。当前先退回可验证证据链，保证后续回答来自真实工具结果，而不是猜测。`,
      })
      execution = await runFunctionCallingLoop({
        provider: new InMemoryLLMProvider(),
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
          await writer.thinking({
            status: 'start',
            message: `正在执行 ${call.name}.${String(call.arguments.action || '')}...`,
          })
          const result = await this.executeToolCall(call, intent, state, skillContext)
          return {
            content: JSON.stringify(result.content),
            trace: result.trace,
          }
        },
      })
    }

    await this.recoverCoreSpatialEvidenceIfNeeded({
      intent,
      state,
      writer,
      context: skillContext,
      providerReady: this.provider.isReady(),
    })

    const primaryAnchor = state.anchors.primary
    const secondaryAnchor = state.anchors.secondary
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
    state.evidenceView = evidenceView

    const decision = this.confidenceGate.evaluate({
      anchorResolved: intent.queryType === 'similar_regions' || hasCoordinates(primaryAnchor),
      evidenceCount: evidenceView.items.length || evidenceView.pairs?.length || evidenceView.regions?.length || 0,
      hasConflict: false,
    })

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
    const renderedEvidenceCount = rendered.pois.length
      || evidenceView.pairs?.length
      || evidenceView.regions?.length
      || 0
    const llmAnswer = String(execution.assistantMessage?.content || '').trim()
    const synthesizedAnswer = decision.status === 'allow'
      ? await this.synthesizeGroundedAnswer({
        provider: this.provider,
        intent,
        evidenceView,
        rendered,
        spatialConstraint: state.spatialConstraint || null,
        rawQuery: lastUserText,
      })
      : null
    const groundedSynthesizedAnswer = synthesizedAnswer && this.isAnswerGrounded(synthesizedAnswer, evidenceView)
      ? synthesizedAnswer
      : null
    const groundedLlmAnswer = this.isAnswerGrounded(llmAnswer, evidenceView)
      ? llmAnswer
      : ''
    const providerReady = this.provider.isReady()
    const areaInsightAgentLedEvidence = intent.queryType === 'area_overview'
      && hasAgentLedAreaInsightEvidence(state.toolCalls)
    const prefersTransparentAnalysisFailure = providerReady
      && intent.queryType === 'area_overview'
      && !areaInsightAgentLedEvidence
    let answerSource = 'deterministic_renderer'
    let answer = ''

    if (decision.status === 'allow') {
      if (groundedSynthesizedAnswer) {
        answer = groundedSynthesizedAnswer
        answerSource = 'llm_synthesized'
      } else if (groundedLlmAnswer) {
        answer = groundedLlmAnswer
        answerSource = 'llm_direct'
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

    if (decision.status === 'allow' && groundedSynthesizedAnswer) {
      await writer.reasoning({
        content: '已根据结构证据、热点、异常与机会信号重新组织最终回答，避免直接复读兜底模板。',
      })
    } else if (decision.status === 'allow' && groundedLlmAnswer) {
      await writer.reasoning({
        content: '这一轮最终回答直接沿用了模型基于已验证证据给出的结论，没有再退回确定性模板。',
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
    })

    await writer.stats(stats)
    await writer.refinedResult({
      answer,
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
      },
      tool_calls: state.toolCalls,
      trace_id: traceId,
    })
    this.recordRequestMetrics({
      startedAt,
      state,
      answer,
      evidenceView,
    })
    await writer.done({
      duration_ms: Date.now() - startedAt,
      session_id: session.id,
    })

    try {
      await this.memory.recordTurn(session.id, {
        traceId,
        userQuery: this.router.extractLastUserText(request.messages),
        answer,
        intent: {
          queryType: intent.queryType,
          targetCategory: intent.targetCategory,
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
    state: AgentTurnState
    startedAt: number
    providerReady: boolean
  }) {
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
      decision: input.intent.needsClarification ? 'unresolved_anchor' : 'insufficient_evidence',
      taskMode: classifyTaskMode({
        intent: input.intent,
        rawQuery: input.intent.rawQuery,
      }),
      answerSource: input.intent.needsClarification ? 'clarification' : 'insufficient_evidence',
    })
    await input.writer.stats(stats)
    await input.writer.refinedResult({
      answer: input.answer,
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

  private async reinterpretIntentWithLlmIfNeeded(input: {
    request: ChatRequestV4
    rawQuery: string
    routerIntent: DeterministicIntent
    providerReady: boolean
  }) {
    if (!input.providerReady) {
      return input.routerIntent
    }

    if (!(input.routerIntent.queryType === 'unsupported' || input.routerIntent.needsClarification)) {
      return input.routerIntent
    }

    const hint = await this.inferIntentWithLlm({
      request: input.request,
      rawQuery: input.rawQuery,
      routerIntent: input.routerIntent,
    })
    if (!hint || hint.queryType === 'unsupported') {
      return input.routerIntent
    }

    const hasMapView = Boolean(readMapViewAnchor(input.request))
    const hasUserLocation = Boolean(readUserLocation(input.request))
    const anchorSource: NonNullable<DeterministicIntent['anchorSource']> = hint.anchorSource === 'map_view' && hasMapView
      ? 'map_view'
      : hint.anchorSource === 'user_location' && hasUserLocation
        ? 'user_location'
        : hint.anchorSource === 'place'
          ? 'place'
          : hasMapView
            ? 'map_view'
            : hasUserLocation
              ? 'user_location'
              : (input.routerIntent.anchorSource || 'place')

    const placeName = anchorSource === 'map_view'
      ? '当前区域'
      : anchorSource === 'user_location'
        ? null
        : input.routerIntent.placeName

    const needsClarification = anchorSource === 'map_view'
      ? !hasMapView
      : anchorSource === 'user_location'
        ? !hasUserLocation
        : (!placeName && Boolean(hint.needsClarification))

    return {
      ...input.routerIntent,
      queryType: hint.queryType,
      intentMode: intentModeFromQueryType(hint.queryType),
      anchorSource,
      placeName,
      targetCategory: hint.queryType === 'area_overview'
        ? '区域洞察'
        : hint.queryType === 'nearest_station'
          ? '地铁站'
          : input.routerIntent.targetCategory,
      categoryKey: hint.queryType === 'nearest_station'
        ? (input.routerIntent.categoryKey || 'metro_station')
        : input.routerIntent.categoryKey,
      needsClarification,
      clarificationHint: needsClarification
        ? (hint.clarificationHint || this.buildClarificationHintForQueryType(hint.queryType))
        : null,
    } satisfies DeterministicIntent
  }

  private async inferIntentWithLlm(input: {
    request: ChatRequestV4
    rawQuery: string
    routerIntent: DeterministicIntent
  }): Promise<{
    queryType: DeterministicIntent['queryType']
    anchorSource?: NonNullable<DeterministicIntent['anchorSource']> | null
    needsClarification?: boolean
    clarificationHint?: string | null
  } | null> {
    try {
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
              '不要因为用户换一种说法就判 unsupported。',
              '如果用户是在让系统解读、分析、读懂、看看某片区域，而当前有地图范围上下文，这通常应判成 area_overview + map_view。',
              `user_query: ${input.rawQuery}`,
              `router_hint: ${input.routerIntent.queryType}`,
              `has_spatial_view: ${Boolean(readMapViewAnchor(input.request))}`,
              `has_user_location: ${Boolean(readUserLocation(input.request))}`,
              `has_regions: ${Array.isArray(input.request.options?.regions) && input.request.options?.regions.length > 0}`,
              '返回 JSON，例如：{"queryType":"area_overview","anchorSource":"map_view","needsClarification":false,"clarificationHint":null}',
            ].join('\n'),
          },
        ],
        tools: [],
        timeoutMs: DEFAULT_LLM_SYNTHESIS_TIMEOUT_MS,
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
        needsClarification: Boolean(parsed.needsClarification),
        clarificationHint: parsed.clarificationHint == null ? null : String(parsed.clarificationHint),
      }
    } catch {
      return null
    }
  }

  private buildClarificationHintForQueryType(queryType: DeterministicIntent['queryType']) {
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
    routerIntent: DeterministicIntent
  }) {
    const intentChanged = input.intent.queryType !== input.routerIntent.queryType
      || input.intent.anchorSource !== input.routerIntent.anchorSource
      || input.intent.needsClarification !== input.routerIntent.needsClarification

    if (!intentChanged) {
      return input.rawQuery
    }

    if (input.intent.queryType === 'area_overview') {
      return [
        `用户原问题：${input.rawQuery}`,
        '补充理解：这是一个当前区域 / 片区解读类分析题，请按“读懂当前区域 / 区域洞察 / 业态配套分析”来规划证据链。',
        input.intent.anchorSource === 'map_view'
          ? '补充锚点：优先把当前 map_view 当作分析区域。'
          : '补充锚点：如果缺少当前区域范围，就先确认空间锚点。',
      ].join('\n')
    }

    if (input.intent.queryType === 'nearby_poi') {
      return [
        `用户原问题：${input.rawQuery}`,
        '补充理解：这是一个“某地附近有什么”的查询题，请先锁定锚点，再抓取附近真实候选。',
      ].join('\n')
    }

    if (input.intent.queryType === 'nearest_station') {
      return [
        `用户原问题：${input.rawQuery}`,
        '补充理解：这是一个“最近的地铁站”查询题，请先锁定锚点，再回答最近站点与站口。',
      ].join('\n')
    }

    return input.rawQuery
  }

  private resolveToolLoopMaxRounds(taskMode: 'query' | 'analysis') {
    return taskMode === 'analysis'
      ? DEFAULT_LLM_ANALYSIS_MAX_ROUNDS
      : DEFAULT_LLM_QUERY_MAX_ROUNDS
  }

  private async executeToolCall(
    call: ToolCallRequest,
    intent: DeterministicIntent,
    state: AgentTurnState,
    context: ReturnType<typeof createSkillExecutionContext>,
  ) {
    const startedAt = Date.now()
    const skill = this.options.registry.get(call.name)
    const payload = (call.arguments.payload || {}) as Record<string, unknown>
    const action = String(call.arguments.action || '')
    if (!skill) {
      const trace: ToolExecutionTrace = {
        id: call.id,
        skill: call.name,
        action,
        status: 'error',
        error_kind: 'tool_result_error',
        payload,
        error: 'Skill not found',
        latency_ms: Date.now() - startedAt,
      }
      state.toolCalls.push(trace)
      return {
        content: { ok: false, error: 'Skill not found' },
        trace,
      }
    }

    let result: Awaited<ReturnType<SkillDefinition['execute']>>
    try {
      if (
        call.name === 'postgis'
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
      } else if (call.name === 'postgis' && action === 'execute_spatial_sql' && payload.template) {
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
        skill: call.name,
        action,
        error: message,
      })

      const trace: ToolExecutionTrace = {
        id: call.id,
        skill: call.name,
        action,
        status: 'error',
        error_kind: 'execution_exception',
        payload,
        error: message,
        latency_ms: Date.now() - startedAt,
      }
      state.toolCalls.push(trace)

      throw new ToolExecutionAbortError(message)
    }

    const anchorResult = result.data as { anchor?: ResolvedAnchor, role?: string } | undefined
    if (call.name === 'postgis' && action === 'resolve_anchor' && result.ok && anchorResult?.anchor) {
      const anchor = anchorResult.anchor
      const role = anchor.role || String(payload.role || 'primary')
      state.anchors[role] = anchor
      anchorResult.role = role
    }

    const trace: ToolExecutionTrace = {
      id: call.id,
      skill: call.name,
      action,
      status: result.ok ? 'done' : 'error',
      error_kind: result.ok ? null : 'tool_result_error',
      payload,
      result: result.data,
      error: result.error?.message || null,
      latency_ms: Date.now() - startedAt,
    }
    state.toolCalls.push(trace)

    return {
      content: result.data || result.error || {},
      trace,
    }
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
    const pointGeography = `ST_SetSRID(ST_MakePoint(${formatNumericLiteral(input.anchor.lon)}, ${formatNumericLiteral(input.anchor.lat)}), 4326)::geography`
    const areaGeometry = input.spatialConstraint?.areaWkt
      ? `ST_GeomFromText('${escapeSqlLiteral(input.spatialConstraint.areaWkt)}', 4326)`
      : `ST_Buffer(${pointGeography}, ${String(Math.max(input.intent.radiusM, 1))})::geometry`

    return {
      pointGeography,
      areaGeometry,
      areaFilter: `ST_Intersects(geom, ${areaGeometry})`,
      areaJoinFilter: `ST_Intersects(p.geom, ${areaGeometry})`,
    }
  }

  private buildCategoryFilters(categoryKey: string, selectedCategories: string[] = []) {
    const whereFilters: string[] = []
    const joinFilters: string[] = []
    const pushFilter = (field: string, value: string) => {
      whereFilters.push(`AND ${field} = '${escapeSqlLiteral(value)}'`)
      joinFilters.push(`AND p.${field} = '${escapeSqlLiteral(value)}'`)
    }

    if (categoryKey === 'metro_station') {
      pushFilter('category_main', '交通设施服务')
      pushFilter('category_sub', '地铁站')
    } else if (categoryKey === 'coffee') {
      pushFilter('category_main', '餐饮美食')
      pushFilter('category_sub', '咖啡')
    } else if (categoryKey === 'food') {
      pushFilter('category_main', '餐饮美食')
    } else if (categoryKey === 'supermarket') {
      pushFilter('category_main', '购物服务')
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
    const template = loadPostgisTemplate(input.templateName)
    if (!template) {
      return null
    }

    const spatialFragments = this.buildSpatialSqlFragments(input)
    const selectedCategories = input.spatialConstraint?.selectedCategories || []
    const categoryFilters = this.buildCategoryFilters(input.categoryKey, selectedCategories)
    const competitionDimension = input.categoryKey || selectedCategories.length > 0 ? 'category_sub' : 'category_main'
    const rendered = renderPostgisTemplate(template, {
      POINT_GEOGRAPHY: spatialFragments.pointGeography,
      AREA_GEOMETRY: spatialFragments.areaGeometry,
      AREA_FILTER: spatialFragments.areaFilter,
      AREA_JOIN_FILTER: spatialFragments.areaJoinFilter,
      RADIUS_M: String(Math.max(input.intent.radiusM, 1)),
      LIMIT: String(Math.max(input.limit, 1)),
      CATEGORY_FILTER: categoryFilters.where.length > 0 ? `\n${categoryFilters.where.join('\n')}` : '',
      CATEGORY_JOIN_FILTER: categoryFilters.join.length > 0 ? `\n${categoryFilters.join.join('\n')}` : '',
      COMPETITION_DIMENSION: competitionDimension,
      CELL_SIZE_DEG: input.intent.radiusM >= 1500 ? '0.003' : input.intent.radiusM >= 1000 ? '0.002' : '0.0015',
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
    const resolvedTemplateName = this.resolvePostgisTemplateName(intent, templateName)
    if (AREA_INSIGHT_TEMPLATES.includes(resolvedTemplateName as typeof AREA_INSIGHT_TEMPLATES[number])) {
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
    const effectiveLimit = categoryKey === 'metro_station' && intent.queryType === 'nearby_poi'
      ? Math.max(limit, 12)
      : Math.max(limit, 1)
    const baseSelect = [
      'SELECT id, name, category_main, category_sub, longitude, latitude,',
      `  ST_Distance(geom::geography, ${spatialFragments.pointGeography}) AS distance_m`,
      'FROM pois',
      `WHERE ${spatialFragments.areaFilter}`,
    ]

    const categoryFilters = this.buildCategoryFilters(categoryKey, spatialConstraint?.selectedCategories || [])
    const filters: string[] = [...categoryFilters.where]
    if (resolvedTemplateName === 'nearest_station' || intent.queryType === 'nearest_station' || categoryKey === 'metro_station') {
      return [
        ...baseSelect,
        ...filters,
        'ORDER BY distance_m ASC',
        `LIMIT ${effectiveLimit}`,
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
      ?.result as { regions?: Array<{ name: string, score: number, summary: string }> } | undefined
    const semanticEvidence = collectSemanticEvidence(state.toolCalls)
    const semanticHints = collectSemanticHints(state.toolCalls)
    const areaInsightResults = collectAreaInsightTemplateResults(state.toolCalls)
    const areaInsight: AreaInsightInput = {
      categoryHistogram: (areaInsightResults.get('area_category_histogram')?.rows as Record<string, unknown>[] | undefined) || [],
      ringDistribution: (areaInsightResults.get('area_ring_distribution')?.rows as Record<string, unknown>[] | undefined) || [],
      representativeSamples: (areaInsightResults.get('area_representative_sample')?.rows as Record<string, unknown>[] | undefined) || [],
      competitionDensity: (areaInsightResults.get('area_competition_density')?.rows as Record<string, unknown>[] | undefined) || [],
      hotspotCells: (areaInsightResults.get('area_h3_hotspots')?.rows as Record<string, unknown>[] | undefined) || [],
      aoiContext: (areaInsightResults.get('area_aoi_context')?.rows as Record<string, unknown>[] | undefined) || [],
      landuseContext: (areaInsightResults.get('area_landuse_context')?.rows as Record<string, unknown>[] | undefined) || [],
    }

    const comparisonPairs = latestComparisonResult?.comparison_pairs || latestPostgisRows?.comparison_pairs || []
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
          name: region.name,
          score: region.score,
          meta: {
            summary: region.summary,
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
      const representativeRows = areaInsight.representativeSamples?.length
        ? areaInsight.representativeSamples
        : (latestPostgisRows?.rows || [])
      const view = this.evidenceFactory.create({
        intent,
        anchor: fallbackAnchor,
        rows: representativeRows,
        items: normalizePoiRows(representativeRows),
        areaInsight,
      })
      if (semanticEvidence) {
        view.semanticEvidence = semanticEvidence
      }
      if (semanticHints.length > 0) {
        view.semanticHints = semanticHints
      }
      return view
    }

    const view = this.evidenceFactory.create({
      intent,
      anchor: fallbackAnchor,
      rows: latestPostgisRows?.rows || [],
      items: normalizePoiRows(latestPostgisRows?.rows || []),
    })
    if (semanticEvidence) {
      view.semanticEvidence = semanticEvidence
    }
    if (semanticHints.length > 0) {
      view.semanticHints = semanticHints
    }
    return view
  }

  private applyRegionEncodingToView(view: EvidenceView, result: unknown) {
    const parsed = readRegionFeatureEncoding(result)
    if (!parsed) {
      return
    }

    view.regionFeatures = parsed.featureTags
    view.regionFeatureSummary = parsed.summary || null

    if (parsed.featureTags.length > 0) {
      const nextHints = [
        ...(view.semanticHints || []),
        ...parsed.featureTags.slice(0, 3).map((tag) => ({
          label: tag.label,
          detail: tag.detail || undefined,
          score: tag.score,
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

  private async recoverCoreSpatialEvidenceIfNeeded(input: {
    intent: DeterministicIntent
    state: AgentTurnState
    writer: SSEWriter
    context: ReturnType<typeof createSkillExecutionContext>
    providerReady?: boolean
  }) {
    const { intent, state, writer, context } = input
    const existingAreaTemplates = intent.queryType === 'area_overview'
      ? collectAreaInsightTemplateResults(state.toolCalls)
      : new Map<string, Record<string, unknown>>()
    const allowAreaInsightGapFill = intent.queryType !== 'area_overview'
      || !input.providerReady
      || hasAgentLedAreaInsightEvidence(state.toolCalls)
    if (!['nearby_poi', 'nearest_station', 'compare_places', 'area_overview'].includes(intent.queryType)) {
      return false
    }

    const hasRegionComparison = intent.queryType === 'compare_places'
      && (state.spatialConstraint?.regions.length || 0) >= 2
    const needsPrimaryAnchor = Boolean(intent.placeName) && !hasCoordinates(state.anchors.primary) && !hasRegionComparison
    const needsSecondaryAnchor = intent.queryType === 'compare_places'
      && Boolean(intent.secondaryPlaceName)
      && !hasCoordinates(state.anchors.secondary)
      && !hasRegionComparison
    const needsDeterministicSql = !this.hasAlignedCorePostgisEvidence(intent, state)
      && (
        intent.queryType === 'nearby_poi'
        || intent.queryType === 'nearest_station'
        || intent.queryType === 'compare_places'
        || (intent.queryType === 'area_overview' && allowAreaInsightGapFill)
      )
    const needsOptionalAreaEnhancement = intent.queryType === 'area_overview'
      && allowAreaInsightGapFill
      && hasCoordinates(state.anchors.primary)
      && AREA_INSIGHT_SEMANTIC_TEMPLATES.some((template) => !existingAreaTemplates.has(template))

    if (!needsPrimaryAnchor && !needsSecondaryAnchor && !needsDeterministicSql && !needsOptionalAreaEnhancement) {
      return false
    }

    let recovered = false

    await writer.stage('tool_run')
    await writer.thinking({
      status: 'start',
      message: '核心空间证据不足，正在切换确定性 postgis 兜底...',
    })
    await writer.reasoning({
      content: '首轮工具结果还不足以稳定回答当前问题，正在补齐核心空间证据，优先确保范围内的主导结构、热点和竞争关系是可验证的。',
    })

    if (needsPrimaryAnchor && intent.placeName) {
      await this.executeToolCall({
        id: `fallback_resolve_primary_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'resolve_anchor',
          payload: {
            place_name: intent.placeName,
            role: 'primary',
          },
        },
      }, intent, state, context)
      recovered = true
    }

    if (needsSecondaryAnchor && intent.secondaryPlaceName) {
      await this.executeToolCall({
        id: `fallback_resolve_secondary_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'resolve_anchor',
          payload: {
            place_name: intent.secondaryPlaceName,
            role: 'secondary',
          },
        },
      }, intent, state, context)
      recovered = true
    }

    if (!needsDeterministicSql && !needsOptionalAreaEnhancement) {
      return recovered
    }

    if (intent.queryType === 'compare_places') {
      const canUseRegionComparison = (state.spatialConstraint?.regions.length || 0) >= 2
      if (!canUseRegionComparison && (!hasCoordinates(state.anchors.primary) || !hasCoordinates(state.anchors.secondary))) {
        return recovered
      }

      await this.executeToolCall({
        id: `fallback_compare_sql_${state.toolCalls.length + 1}`,
        name: 'postgis',
        arguments: {
          action: 'execute_spatial_sql',
          payload: {
            template: 'compare_places',
            category_key: intent.categoryKey || 'food',
            limit: 10,
          },
        },
      }, intent, state, context)
      return true
    }

    if (!hasCoordinates(state.anchors.primary)) {
      return recovered
    }

    if (intent.queryType === 'area_overview') {
      const existingTemplates = collectAreaInsightTemplateResults(state.toolCalls)
      const missingTemplates = AREA_INSIGHT_CORE_TEMPLATES
        .filter((template) => !existingTemplates.has(template))
      const optionalTemplates = AREA_INSIGHT_SEMANTIC_TEMPLATES
        .filter((template) => !existingTemplates.has(template))

      if (missingTemplates.length > 0 || optionalTemplates.length > 0) {
        await writer.reasoning({
          content: `当前准备补取的结构证据包括：${[
            ...missingTemplates,
            ...optionalTemplates,
          ].join('、')}。这样后面回答时，才能把“主导业态、热点、异常、机会”对应到真实证据上。`,
        })
      }

      for (const template of missingTemplates) {
        await this.executeToolCall({
          id: `fallback_area_${template}_${state.toolCalls.length + 1}`,
          name: 'postgis',
          arguments: {
            action: 'execute_spatial_sql',
            payload: {
              template,
              category_key: intent.categoryKey || '',
              limit: template === 'area_representative_sample'
                ? 18
                : template === 'area_h3_hotspots'
                  ? 5
                  : 8,
            },
          },
        }, intent, state, context)
      }

      for (const template of optionalTemplates) {
        await this.executeToolCall({
          id: `fallback_area_${template}_${state.toolCalls.length + 1}`,
          name: 'postgis',
          arguments: {
            action: 'execute_spatial_sql',
            payload: {
              template,
              category_key: intent.categoryKey || '',
              limit: template === 'area_aoi_context' ? 5 : 6,
            },
          },
        }, intent, state, context)
      }

      return recovered || missingTemplates.length > 0 || optionalTemplates.length > 0
    }

    await this.executeToolCall({
      id: `fallback_core_sql_${state.toolCalls.length + 1}`,
      name: 'postgis',
      arguments: {
        action: 'execute_spatial_sql',
        payload: {
          template: intent.queryType === 'nearest_station'
            ? 'nearest_station'
            : intent.queryType === 'area_overview'
              ? 'area_overview'
              : 'nearby_poi',
          category_key: intent.categoryKey || '',
          limit: intent.queryType === 'nearest_station'
            ? 1
            : intent.queryType === 'area_overview'
              ? 80
              : 5,
        },
      },
    }, intent, state, context)
    return true
  }

  private hasAlignedCorePostgisEvidence(intent: DeterministicIntent, state: AgentTurnState) {
    const latestPostgisResult = [...state.toolCalls]
      .reverse()
      .find((trace) => trace.skill === 'postgis' && trace.action === 'execute_spatial_sql' && trace.status === 'done')
      ?.result as { rows?: Record<string, unknown>[], comparison_pairs?: ComparisonPair[] } | undefined

    if (!latestPostgisResult) {
      return false
    }

    if (intent.queryType === 'area_overview') {
      const areaInsightResults = collectAreaInsightTemplateResults(state.toolCalls)
      return AREA_INSIGHT_CORE_TEMPLATES.every((template) => {
        const result = areaInsightResults.get(template)
        return Array.isArray(result?.rows) && result.rows.length > 0
      })
    }

    if (intent.queryType === 'compare_places') {
      const pairs = [...state.toolCalls]
        .reverse()
        .find((trace) => {
          if (trace.skill !== 'postgis' || trace.action !== 'execute_spatial_sql' || trace.status !== 'done') {
            return false
          }
          const result = trace.result as { comparison_pairs?: ComparisonPair[] } | undefined
          return Array.isArray(result?.comparison_pairs) && result.comparison_pairs.length > 0
        })
        ?.result as { comparison_pairs?: ComparisonPair[] } | undefined
      const comparisonPairs = pairs?.comparison_pairs || []
      if (comparisonPairs.length === 0) return false
      if (!intent.categoryKey) return true
      return comparisonPairs.every((pair) => pair.items.some((item) => this.matchesIntentCategory(
        intent.categoryKey || '',
        (item.meta as Record<string, unknown> | undefined) || {
          category_main: item.categoryMain,
          category_sub: item.categorySub || item.category,
        },
      )))
    }

    const rows = latestPostgisResult.rows || []
    if (rows.length === 0) {
      return false
    }

    if (!intent.categoryKey) {
      return true
    }

    return rows.some((row) => this.matchesIntentCategory(intent.categoryKey || '', row))
  }

  private matchesIntentCategory(categoryKey: string, row: Record<string, unknown> = {}) {
    const categoryMain = readCategoryValue(row, ['category_main', 'categoryMain'])
    const categorySub = readCategoryValue(row, ['category_sub', 'categorySub', 'category'])

    if (categoryKey === 'coffee') {
      return categoryMain === '餐饮美食' && categorySub === '咖啡'
    }

    if (categoryKey === 'food') {
      return categoryMain === '餐饮美食'
    }

    if (categoryKey === 'metro_station') {
      return categoryMain === '交通设施服务' && categorySub === '地铁站'
    }

    return true
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

    if (view.areaSubject?.title) {
      lines.push(`区域主语: ${view.areaSubject.title}`)
    }

    if (view.regionFeatureSummary) {
      lines.push(`编码器特征摘要: ${view.regionFeatureSummary}`)
    }

    const regionFeatureLabels = (view.regionFeatures || [])
      .slice(0, 6)
      .map((item) => item.label)
      .filter(Boolean)
    if (regionFeatureLabels.length > 0) {
      lines.push(`片区特征标签: ${regionFeatureLabels.join('；')}`)
    }

    const dominant = (view.areaProfile?.dominantCategories || [])
      .slice(0, 4)
      .map((bucket) => `${bucket.label}${bucket.share ? `(${Math.round(bucket.share * 100)}%)` : ''}`)
    if (dominant.length > 0) {
      lines.push(`主导业态: ${dominant.join('；')}`)
    }

    const hotspots = (view.hotspots || [])
      .slice(0, 3)
      .map((item) => item.label)
    if (hotspots.length > 0) {
      lines.push(`热点: ${hotspots.join('；')}`)
    }

    const anomalies = (view.anomalySignals || [])
      .slice(0, 3)
      .map((item) => `${item.title} - ${item.detail}`)
    if (anomalies.length > 0) {
      lines.push(`异常: ${anomalies.join('；')}`)
    }

    const opportunities = (view.opportunitySignals || [])
      .slice(0, 3)
      .map((item) => `${item.title} - ${item.detail}`)
    if (opportunities.length > 0) {
      lines.push(`机会: ${opportunities.join('；')}`)
    }

    const samples = (view.representativeSamples || [])
      .slice(0, 6)
      .map((item) => item.name)
      .filter(Boolean)
    if (samples.length > 0) {
      lines.push(`代表样本: ${samples.join('、')}`)
    }

    const poiProfiles = (view.representativePoiProfiles || [])
      .slice(0, 4)
      .map((item) => `${item.name}:${item.featureTags.map((feature) => feature.label).slice(0, 2).join('、')}`)
      .filter((item) => !item.endsWith(':'))
    if (poiProfiles.length > 0) {
      lines.push(`代表点角色: ${poiProfiles.join('；')}`)
    }

    const aoi = (view.aoiContext || [])
      .slice(0, 4)
      .map((item) => `${item.name}${item.fclass ? `(${item.fclass})` : ''}`)
    if (aoi.length > 0) {
      lines.push(`AOI 参考: ${aoi.join('、')}`)
    }

    const landuse = (view.landuseContext || [])
      .slice(0, 4)
      .map((item) => `${item.landType}:${Math.round(item.totalAreaSqm)}㎡/${item.parcelCount}宗`)
    if (landuse.length > 0) {
      lines.push(`用地参考: ${landuse.join('；')}`)
    }

    if (view.confidence) {
      lines.push(`置信度: ${view.confidence.level}(${view.confidence.score})，原因：${view.confidence.reasons.join('；')}`)
    }

    return lines
  }

  private async synthesizeGroundedAnswer(input: {
    provider: LLMProvider
    intent: DeterministicIntent
    evidenceView: EvidenceView
    rendered: RenderedAnswer
    spatialConstraint: SpatialAnalysisConstraint | null
    rawQuery: string
  }) {
    if (!input.provider.isReady()) return null
    if (input.intent.queryType !== 'area_overview') return null

    const scopeSummary = this.describeSpatialConstraint(input.spatialConstraint)
    const evidenceLines = this.buildAreaSynthesisEvidence(input.evidenceView)
    if (evidenceLines.length === 0) return null

    const questionMode = String(input.evidenceView.meta.questionMode || 'summary').trim() || 'summary'
    const answerStyle = questionMode === 'opportunity'
      ? '用 Markdown 小节先给出区域主语，再回答更值得优先看的 1-2 个方向，并解释供给、需求线索与竞争关系。'
      : questionMode === 'semantic'
        ? '用 Markdown 小节先判断片区更像什么，再给结构证据与语义依据。'
        : '用 Markdown 小节组织语言，至少包含区域主语、关键特征、热点与结构、机会与风险。'

    const synthesisPrompt = [
      '你是 GeoLoom V4 的最终回答撰写器。',
      '必须只基于已验证的空间证据写答案，不允许脑补。',
      '你的任务不是重复模板，而是针对用户原问题，把证据组织成自然、可靠、简洁但有洞察的中文回答。',
      '',
      `用户原问题：${input.rawQuery}`,
      `问题模式：${questionMode}`,
      `分析范围：${scopeSummary}`,
      '',
      '已验证证据：',
      ...evidenceLines.map((line) => `- ${line}`),
      '',
      '机械兜底草稿（只供事实校对，不要照抄句式）：',
      input.rendered.answer,
      '',
      '输出要求：',
      `- ${answerStyle}`,
      '- 输出必须是 Markdown，不要写成单段长文本。',
      '- 优先用 `## 区域主语`、`## 关键特征`、`## 热点与结构`、`## 机会与风险` 这类小节来组织。',
      '- 必须明确说出区域主语，不能只写“当前区域”。',
      '- 可以保留关键数量，但只保留真正有解释力的数字，不要报“范围内多少个”这类无用统计。',
      '- 避免固定起手式，例如“如果快速读这个片区，它更像……；主导业态仍是……”。',
      '- 不要使用整段分号串联的模板腔，优先像分析师一样直接说人话。',
      '- 如果证据不足，要明确说哪里不足，而不是硬下结论。',
    ].join('\n')

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: 'system',
            content: '你负责把已验证空间证据写成最终中文回答。禁止脱离证据自由发挥。',
          },
          {
            role: 'user',
            content: synthesisPrompt,
          },
        ],
        tools: [],
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
  }) {
    this.metrics.recordRequest({
      latencyMs: Date.now() - input.startedAt,
      sqlValidated: input.state.sqlValidationAttempts > 0,
      sqlAccepted: input.state.sqlValidationAttempts > 0
        && input.state.sqlValidationAttempts === input.state.sqlValidationPassed,
      answerGrounded: this.isAnswerGrounded(input.answer, input.evidenceView),
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
      const groundedSubjectKeywords = [
        evidenceView.areaSubject?.title,
        evidenceView.areaSubject?.anchorName,
        ...(evidenceView.aoiContext || []).map((item) => item.name),
        ...(evidenceView.representativeSamples || []).map((item) => item.name),
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => value && !['当前区域', '当前片区', '这里', '此处'].includes(value))

      if (groundedSubjectKeywords.length > 0) {
        return groundedSubjectKeywords.some((keyword) => normalizedAnswer.includes(keyword))
      }
    }

    return [...keywords].some((keyword) => normalizedAnswer.includes(keyword))
  }

  private buildUnsupportedAnswer() {
    return '当前 V4 已支持附近 POI、最近地铁站、当前区域洞察、相似片区和双地点比较这几类问题。你可以继续给我一个明确地点，或者直接让我读懂当前区域。'
  }
}
