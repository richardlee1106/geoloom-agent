import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import type { ChatRuntime } from '../app.js'
import { buildAreaOverviewView } from '../evidence/views/AreaOverviewView.js'
import {
  buildRegionSnapshotFromEvidence,
  deriveRegionFeatureTags,
  summarizeRegionFeatures,
} from '../evidence/areaInsight/regionSnapshot.js'
import { buildPoiProfileInputFromEvidence } from '../evidence/areaInsight/poiProfile.js'
import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillDefinition, SkillExecutionContext, SkillExecutionResult } from '../skills/types.js'
import type {
  ChatRequestV4,
  DeterministicIntent,
  EvidenceItem,
  RegionFeatureTag,
  RegionSnapshotInput,
  ResolvedAnchor,
} from '../chat/types.js'
import type { LLMMessage, LLMProvider } from '../llm/types.js'
import { createDefaultLLMProvider } from '../llm/createDefaultLLMProvider.js'
import { SSEWriter } from '../chat/SSEWriter.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import { createLogger } from '../utils/logger.js'
import {
  buildNarrativeAnswer,
  buildNarrativeCandidates,
  buildNarrativeSteps,
  buildNarrativeTransitions,
  buildNarrativeViewportSummary,
  normalizeName,
  rankNarrativeNodes,
  resolveNodeRoleFromAoi,
  resolveNodeRoleFromPoi,
  resolveRoleLabel,
  resolveRoleWeight,
} from './planner.js'
import {
  clusterPoisByBrand,
  extractBrandFromName,
  isBrandClusterEligible,
  resolveBrandCategoryLabel,
  resolveBrandRole,
  type BrandCluster,
} from './brandAggregation.js'
import {
  buildNarrativeAreaTemplateSql,
  buildViewportBoundary,
  buildViewportCenter,
  buildViewportDiagonalM,
  type NarrativeAreaTemplateName,
} from './postgisTemplateBuilder.js'
import type {
  NarrativeProbeRequest,
  NarrativeProbeResult,
  ProbeAoiRow,
  ProbeBrandClusterView,
  ProbePoiRow,
} from './probeTypes.js'
import type {
  NarrativeCellEntity,
  NarrativeNode,
  NarrativeNodeBoundary,
  NarrativeNodeFactEnrichment,
  NarrativeNodeGrounding,
  NarrativePopulationHotspot,
  NarrativeSurface,
  NarrativeTourTransition,
  NarrativeViewport,
  NarrativeViewportSummary,
} from './types.js'

function extractLastUserText(messages: ChatRequestV4['messages']) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (String(item?.role || '').trim().toLowerCase() !== 'user') continue
    const text = String(item?.content || '').trim()
    if (text) return text
  }
  return ''
}

function normalizeSurface(value: unknown): NarrativeSurface {
  return String(value || '').trim().toLowerCase() === 'narrative' ? 'narrative' : 'default'
}

function readViewport(request: ChatRequestV4): NarrativeViewport | null {
  const spatialContext = request.options?.spatialContext as Record<string, unknown> | undefined
  const viewport = Array.isArray(spatialContext?.viewport) ? spatialContext.viewport : []
  if (viewport.length < 4) return null
  const swLon = Number(viewport[0])
  const swLat = Number(viewport[1])
  const neLon = Number(viewport[2])
  const neLat = Number(viewport[3])
  if (![swLon, swLat, neLon, neLat].every(Number.isFinite)) {
    return null
  }
  return {
    swLon: Math.min(swLon, neLon),
    swLat: Math.min(swLat, neLat),
    neLon: Math.max(swLon, neLon),
    neLat: Math.max(swLat, neLat),
  }
}

function buildViewportScale(diagonalM: number) {
  if (diagonalM >= 12000) return 'large' as const
  if (diagonalM >= 3500) return 'medium' as const
  return 'small' as const
}

function buildNarrativeIntent(rawQuery: string, viewport: NarrativeViewport): DeterministicIntent {
  const diagonalM = buildViewportDiagonalM(viewport)
  return {
    queryType: 'area_overview',
    intentMode: 'deterministic_visible_loop',
    rawQuery,
    placeName: '当前视口',
    anchorSource: 'map_view',
    secondaryPlaceName: null,
    targetCategory: null,
    radiusM: Math.max(Math.round(diagonalM / 2), 800),
    needsClarification: false,
    clarificationHint: null,
    needsWebSearch: false,
    toolIntent: 'area_insight',
    searchIntentHint: null,
    categoryKey: null,
    categoryMain: null,
    categorySub: null,
    viewportContext: {
      diagonalM,
      scale: buildViewportScale(diagonalM),
      bounds: {
        swLon: viewport.swLon,
        swLat: viewport.swLat,
        neLon: viewport.neLon,
        neLat: viewport.neLat,
      },
    },
  }
}

function buildSyntheticAnchor(viewport: NarrativeViewport): ResolvedAnchor {
  const center = buildViewportCenter(viewport)
  return {
    place_name: '当前视口',
    display_name: '当前视口',
    resolved_place_name: '当前视口',
    role: 'primary',
    source: 'map_view',
    poi_id: null,
    lon: center.lon,
    lat: center.lat,
    coord_sys: 'wgs84',
  }
}

function normalizePoiPreview(nodes: EvidenceItem[]) {
  return nodes.map((item) => ({
    id: item.id ?? item.name,
    name: item.name,
    longitude: item.longitude,
    latitude: item.latitude,
    category_main: item.categoryMain || null,
    category_sub: item.categorySub || item.category || null,
    distance_m: item.distance_m ?? null,
  }))
}

function toFeature(node: { id: string, name: string, center: { lon: number, lat: number } }) {
  return {
    type: 'Feature',
    properties: {
      id: node.id,
      name: node.name,
      名称: node.name,
    },
    geometry: {
      type: 'Point',
      coordinates: [node.center.lon, node.center.lat],
    },
  }
}

function buildEmptyIntentPayload(rawQuery: string) {
  return {
    queryType: 'viewport_tour',
    intentMode: 'narrative_surface',
    rawQuery,
    surface: 'narrative',
    parserModel: 'narrative_runtime_v1',
    parserProvider: 'rule',
  }
}

function formatSqlNumber(value: number, digits = 8) {
  if (!Number.isFinite(value)) return '0'
  const text = value.toFixed(digits)
  return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function toFiniteNumber(value: unknown) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

/**
 * 解析 PostGIS ST_AsGeoJSON 返回的字符串，构造节点模糊边界。
 * 兼容 Polygon / MultiPolygon，无效或空几何返回 null。
 */
function parseBoundaryGeoJson(
  value: unknown,
  source: NarrativeNodeBoundary['source'] = 'aoi_native',
): NarrativeNodeBoundary | null {
  if (!value) return null
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw === 'null') return null
  try {
    const parsed = JSON.parse(raw) as { type?: string, coordinates?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    const type = String(parsed.type || '')
    if (type !== 'Polygon' && type !== 'MultiPolygon') return null
    if (!Array.isArray(parsed.coordinates) || parsed.coordinates.length === 0) return null
    return {
      type: type as NarrativeNodeBoundary['type'],
      coordinates: parsed.coordinates as NarrativeNodeBoundary['coordinates'],
      source,
    }
  } catch {
    return null
  }
}

function resolvePopulationHotness(populationSum: number, populationPeak: number) {
  if (populationPeak >= 200 || populationSum >= 1000) return 'very_high' as const
  if (populationPeak >= 120 || populationSum >= 600) return 'high' as const
  if (populationPeak >= 50 || populationSum >= 200) return 'medium' as const
  return 'low' as const
}

function resolvePopulationHotnessLabel(level: NarrativeNodeGrounding['populationHotness']) {
  if (level === 'very_high') return '极高人流热度'
  if (level === 'high') return '高人流热度'
  if (level === 'medium') return '中等人流热度'
  return '低人流热度'
}

function buildPopulationHotspotLabel(index: number, hotspot: NarrativePopulationHotspot) {
  const rounded = Math.round(hotspot.popSum)
  return hotspot.label || `人口热点${index + 1}（${rounded}）`
}

function normalizePopulationHotspots(rows: Record<string, unknown>[] = []) {
  return rows
    .map((row, index) => {
      const lon = toFiniteNumber(row.center_lon || row.centerLon)
      const lat = toFiniteNumber(row.center_lat || row.centerLat)
      const popSum = toFiniteNumber(row.pop_sum || row.popSum)
      const popPeak = toFiniteNumber(row.pop_peak || row.popPeak)
      const cellCount = toFiniteNumber(row.cell_count || row.cellCount)
      if (lon === null || lat === null || popSum === null || popPeak === null || cellCount === null) return null
      const hotspot: NarrativePopulationHotspot = {
        label: String(row.label || '').trim() || `人口热点${index + 1}`,
        gridWkt: String(row.grid_wkt || row.gridWkt || '').trim() || null,
        center: { lon, lat },
        popSum,
        popPeak,
        cellCount,
      }
      hotspot.label = buildPopulationHotspotLabel(index, hotspot)
      return hotspot
    })
    .filter((item): item is NarrativePopulationHotspot => Boolean(item))
}

function buildNodePopulationGroundingSql(node: NarrativeNode, radiusM: number) {
  const point = `ST_SetSRID(ST_MakePoint(${formatSqlNumber(node.center.lon)}, ${formatSqlNumber(node.center.lat)}), 4326)`
  return `
SELECT
  COUNT(*) AS cell_count,
  COALESCE(SUM(pop_value), 0) AS pop_sum,
  COALESCE(MAX(pop_value), 0) AS pop_peak,
  COALESCE(AVG(pop_value), 0) AS pop_avg
FROM population_grid_100m
WHERE pop_value > 0
  AND ST_DWithin(center_geom::geography, ${point}::geography, ${Math.max(50, Math.round(radiusM))})
LIMIT 1;
`.trim()
}

function buildNodeGrounding(node: NarrativeNode, row: Record<string, unknown> | null | undefined, radiusM: number): NarrativeNodeGrounding {
  const populationSum = toFiniteNumber(row?.pop_sum || row?.popSum) || 0
  const populationPeak = toFiniteNumber(row?.pop_peak || row?.popPeak) || 0
  const populationAvg = toFiniteNumber(row?.pop_avg || row?.popAvg) || 0
  const cellCount = toFiniteNumber(row?.cell_count || row?.cellCount) || 0
  const populationHotness = resolvePopulationHotness(populationSum, populationPeak)
  const hotnessLabel = resolvePopulationHotnessLabel(populationHotness)
  return {
    nodeId: node.id,
    radiusM,
    populationHotness,
    populationSum,
    populationPeak,
    populationAvg,
    cellCount,
    summary: `${hotnessLabel}，${radiusM}米范围内累计人口值约 ${Math.round(populationSum)}，峰值约 ${Math.round(populationPeak)}。`,
  }
}

export class NarrativeRuntime implements ChatRuntime {
  private readonly provider: LLMProvider

  constructor(private readonly options: {
    registry: SkillRegistry
    version: string
    provider?: LLMProvider
  }) {
    this.provider = options.provider || createDefaultLLMProvider()
  }

  createWriter(stream: NodeJS.WritableStream, traceId = randomUUID()) {
    return new SSEWriter({
      stream: stream as Writable,
      traceId,
      schemaVersion: 'v4.narrative.v1',
    })
  }

  async getHealth() {
    return {
      ready: Boolean(this.options.registry.get('postgis')),
      surface: 'narrative',
    }
  }

  /**
   * 诊断端点：给定 viewport，返回视口内原始召回 + 品牌聚合 + 候选节点 + 排名结果。
   * 不生成解说词、不做 encode_poi_profile（该步骤慢且可能污染品类标签）。
   * 用于暴露「数据里到底有什么 / 哪些被品牌吸走 / 哪些被淘汰」的全貌。
   */
  async probe(input: NarrativeProbeRequest): Promise<NarrativeProbeResult> {
    const viewport = input.viewport
    const center = buildViewportCenter(viewport)
    const diagonalM = buildViewportDiagonalM(viewport)
    const rawQuery = input.rawQuery || '诊断当前视口召回数据'
    const topRaw = Math.max(5, Math.min(input.topRaw ?? 20, 60))

    const probeId = `probe:${randomUUID()}`
    const logger = createLogger().child({
      traceId: probeId,
      requestId: probeId,
      surface: 'narrative_probe',
    })
    const context = createSkillExecutionContext({
      traceId: probeId,
      requestId: probeId,
      logger,
    })

    const notes: string[] = []

    // 1. 原始数据召回
    const areaEvidence = await this.collectAreaEvidence(viewport, center, context)

    // 2. 生成 EvidenceItem 形式的 representativeSamples（用于品牌聚合与候选构建）
    const intent = buildNarrativeIntent(rawQuery, viewport)
    const anchor = buildSyntheticAnchor(viewport)
    const areaView = buildAreaOverviewView({
      anchor,
      rows: areaEvidence.representativeSamples,
      intent,
      areaInsight: {
        categoryHistogram: areaEvidence.categoryHistogram,
        representativeSamples: areaEvidence.representativeSamples,
        hotspotCells: areaEvidence.hotspots,
        aoiContext: areaEvidence.aoiContext,
        landuseContext: areaEvidence.landuseContext,
      },
    })
    const poiSamples = areaView.representativeSamples || []
    const snapshot = buildRegionSnapshotFromEvidence({
      view: areaView,
      rawQuery,
    })
    const derivedFeatureTags = deriveRegionFeatureTags(snapshot)
    const derivedFeatureSummary = summarizeRegionFeatures(snapshot, derivedFeatureTags)

    // 3. 品牌聚合
    const mergedPois = this.mergePoisWithBrandPool(poiSamples, areaEvidence.brandPool)
    const allClusters = clusterPoisByBrand(mergedPois)
    const eligibleClusters = allClusters.filter(isBrandClusterEligible)
    const ineligibleClusters = allClusters.filter((c) => !isBrandClusterEligible(c))

    const coveredPoiIds = new Set<string>()
    for (const cluster of eligibleClusters) {
      for (const member of cluster.members) {
        const id = String(member.id ?? member.name ?? '')
        if (id) coveredPoiIds.add(id)
      }
    }

    // 4. 可选：encoder 信号（用户显式 includeEncoder 才调）
    let encoderResult: NarrativeProbeResult['encoder'] = null
    let scopeDataForCells: Record<string, unknown> | null = null
    if (input.includeEncoder) {
      try {
        const signals = await this.collectEncoderSignals({
          context,
          rawQuery,
          center,
          diagonalM,
          snapshot,
        })
        scopeDataForCells = (signals as { scopeData?: Record<string, unknown> }).scopeData ?? null
        encoderResult = {
          available: true,
          regionSummary: signals.regionSummary,
          regionTags: signals.regionTags as Array<{ label: string, score?: number | null }>,
          sceneTags: signals.sceneTags,
          dominantBuckets: signals.dominantBuckets,
          cells: Array.isArray(scopeDataForCells?.cells) ? (scopeDataForCells.cells as Array<Record<string, unknown>>) : [],
        }
      } catch (error) {
        notes.push(`encoder 调用失败：${error instanceof Error ? error.message : String(error)}`)
        encoderResult = {
          available: false,
          regionSummary: null,
          regionTags: [],
          sceneTags: [],
          dominantBuckets: [],
          cells: [],
        }
      }
    }

    // 5. 构建候选节点（跑 brand cluster + cell + aoi 三阶段）
    const cellEntities = this.filterCellEntitiesByViewport(this.extractCellEntities(scopeDataForCells), viewport)
    const candidates = this.buildCellBasedCandidates(
      cellEntities,
      poiSamples,
      areaEvidence.aoiContext,
      areaEvidence.brandPool,
    )
    // 对 aoiContext 未覆盖到的 brand cluster 节点定向回查 aois 表补齐 boundary
    await this.enrichMissingBoundaries(candidates, context)
    // 对仍缺 boundary 的节点做聚合边界生成（DBSCAN→ConcaveHull→Buffer→Landuse吸附 / 单点圆兜底）
    await this.enrichAggregateBoundaries(candidates, viewport, context)
    const rankedCandidates = input.includeEncoder && candidates.length > 0
      ? await this.enrichCandidatesWithEncoder({
          candidates,
          center,
          rawQuery,
          areaView,
          context,
        })
      : candidates

    // 6. 排序：includeEncoder 时尽量复用正式 narrative 的 summary 与候选 enrich 链路
    const viewportSummary = buildNarrativeViewportSummary({
      featureTags: derivedFeatureTags,
      featureSummary: derivedFeatureSummary,
      encoderSummary: encoderResult?.regionSummary ?? null,
      encoderTags: (encoderResult?.regionTags as RegionFeatureTag[]) ?? [],
      encoderSceneTags: encoderResult?.sceneTags ?? [],
      encoderDominantBuckets: encoderResult?.dominantBuckets ?? [],
      candidates: rankedCandidates,
    })
    const rankResult = rankNarrativeNodes(rankedCandidates, viewportSummary, 15)
    const selectedIds = new Set(rankResult.selectedNodes.map((node) => node.id))
    const droppedIds = rankedCandidates
      .filter((node) => !selectedIds.has(node.id))
      .map((node) => node.id)

    // 7. 汇总 byRole / bySource 计数
    const bySource: Record<string, number> = {}
    const byRole: Record<string, number> = {}
    for (const node of rankedCandidates) {
      bySource[node.source] = (bySource[node.source] || 0) + 1
      byRole[node.role] = (byRole[node.role] || 0) + 1
    }

    // 8. 诊断注释
    if (areaEvidence.representativeSamples.length === 0) {
      notes.push('representativeSamples 为空：视口内可能无 POI 数据，或 SQL 模板未命中。')
    }
    if (areaEvidence.brandPool.length === 0) {
      notes.push('brandPool 为空：视口内没有被词典匹配到的 campus / scenic / food_street / commercial POI。')
    }
    if (eligibleClusters.length === 0) {
      notes.push('eligibleClusters 为空：品牌抽取未识别出任何区域性实体。')
    }
    if (candidates.length < 3) {
      notes.push(`candidates 仅 ${candidates.length} 个，视口可能过小或数据稀疏。`)
    }
    if (!input.includeEncoder) {
      notes.push('当前 probe 未开启 encoder enrich，正式 narrative 的入选结果可能与这里不完全一致。')
    }

    return {
      version: this.options.version,
      viewport,
      center,
      diagonalM,
      raw: {
        categoryHistogram: areaEvidence.categoryHistogram,
        representativeSamples: this.normalizeProbePoiRows(areaEvidence.representativeSamples, topRaw),
        brandPool: this.normalizeProbePoiRows(areaEvidence.brandPool, topRaw),
        aoiContext: this.normalizeProbeAoiRows(areaEvidence.aoiContext, topRaw),
        landuseContext: areaEvidence.landuseContext.slice(0, topRaw),
        hotspots: areaEvidence.hotspots.slice(0, topRaw),
      },
      brandAggregation: {
        allClusters: allClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
        eligibleClusters: eligibleClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
        ineligibleClusters: ineligibleClusters.map((c) => this.toBrandClusterView(c, coveredPoiIds)),
        coveredPoiIds: [...coveredPoiIds],
      },
      candidates: {
        total: rankedCandidates.length,
        bySource,
        byRole,
        items: rankedCandidates,
      },
      ranked: {
        limit: 15,
        mode: rankResult.narrativeMode,
        selected: rankResult.selectedNodes,
        droppedIds,
      },
      encoder: encoderResult,
      diagnostics: { notes },
    }
  }

  private normalizeProbePoiRows(rows: Array<Record<string, unknown>>, limit: number): ProbePoiRow[] {
    return rows.slice(0, limit).map((row) => ({
      id: (row.id as string | number | null | undefined) ?? null,
      name: String(row.name ?? ''),
      category_main: typeof row.category_main === 'string' ? row.category_main : null,
      category_sub: typeof row.category_sub === 'string' ? row.category_sub : null,
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
      anchor_priority: Number.isFinite(Number(row.anchor_priority)) ? Number(row.anchor_priority) : null,
      tile_x: Number.isFinite(Number(row.tile_x)) ? Number(row.tile_x) : null,
      tile_y: Number.isFinite(Number(row.tile_y)) ? Number(row.tile_y) : null,
      brand_bucket: typeof row.brand_bucket === 'string' ? row.brand_bucket : null,
    }))
  }

  private normalizeProbeAoiRows(rows: Array<Record<string, unknown>>, limit: number): ProbeAoiRow[] {
    return rows.slice(0, limit).map((row) => ({
      id: (row.id as string | number | null | undefined) ?? null,
      name: String(row.name ?? ''),
      fclass: typeof row.fclass === 'string' ? row.fclass : null,
      code: typeof row.code === 'string' ? row.code : null,
      population: Number.isFinite(Number(row.population)) ? Number(row.population) : null,
      area_sqm: Number.isFinite(Number(row.area_sqm)) ? Number(row.area_sqm) : null,
      longitude: Number(row.longitude),
      latitude: Number(row.latitude),
      anchor_priority: Number.isFinite(Number(row.anchor_priority)) ? Number(row.anchor_priority) : null,
      boundary_geojson: typeof row.boundary_geojson === 'string' ? row.boundary_geojson : null,
    }))
  }

  private toBrandClusterView(cluster: BrandCluster, _covered: Set<string>): ProbeBrandClusterView {
    return {
      brand: cluster.brand,
      type: cluster.type,
      count: cluster.count,
      eligible: isBrandClusterEligible(cluster),
      center: cluster.center,
      members: cluster.members.map((m) => ({
        id: m.id ?? null,
        name: String(m.name || ''),
        longitude: Number(m.longitude),
        latitude: Number(m.latitude),
      })),
    }
  }

  async handle(request: ChatRequestV4, writer: SSEWriter) {
    const startedAt = Date.now()
    const requestId = String(request.options?.requestId || writer.traceId)
    const rawQuery = extractLastUserText(request.messages) || '请按导览顺序介绍当前区域'
    const viewport = readViewport(request)

    await writer.trace({
      request_id: requestId,
      version: this.options.version,
      surface: normalizeSurface(request.options?.surface),
    })
    await writer.job({
      mode: 'narrative_tour',
      version: this.options.version,
      surface: 'narrative',
    })
    await writer.intentPreview({
      queryType: 'viewport_tour',
      displayAnchor: '当前视口',
      needsClarification: !viewport,
      clarificationHint: viewport ? null : '请先把地图移动到要解说的区域。',
      parserModel: 'narrative_runtime_v1',
      parserProvider: 'rule',
      surface: 'narrative',
    })

    if (!viewport) {
      const answer = '请先在 /narrative 页面把地图移动到你想解说的区域，然后再生成导览骨架。'
      await writer.stage('answer')
      await writer.thinking({
        status: 'end',
        message: '当前还没有稳定的视口范围，暂时无法生成区域导览。',
      })
      await writer.stats({
        surface: 'narrative',
        result_count: 0,
        duration_ms: Date.now() - startedAt,
      })
      await writer.refinedResult({
        answer,
        answer_source: 'clarification',
        results: {
          pois: [],
          stats: {
            surface: 'narrative',
            result_count: 0,
          },
        },
        intent: buildEmptyIntentPayload(rawQuery),
      })
      await writer.done({ duration_ms: Date.now() - startedAt })
      return
    }

    const center = buildViewportCenter(viewport)
    const boundary = buildViewportBoundary(viewport)
    const intent = buildNarrativeIntent(rawQuery, viewport)
    const anchor = buildSyntheticAnchor(viewport)
    const logger = createLogger().child({
      traceId: writer.traceId,
      requestId,
      surface: 'narrative',
    })
    const context = createSkillExecutionContext({
      traceId: writer.traceId,
      requestId,
      logger,
    })

    await writer.boundary(boundary)
    await writer.stage('viewport_summary')
    await writer.thinking({
      status: 'start',
      message: '正在读取当前视口的区域结构...',
    })

    const areaEvidence = await this.collectAreaEvidence(viewport, center, context)
    const areaView = buildAreaOverviewView({
      anchor,
      rows: areaEvidence.representativeSamples,
      intent,
      areaInsight: {
        categoryHistogram: areaEvidence.categoryHistogram,
        representativeSamples: areaEvidence.representativeSamples,
        hotspotCells: areaEvidence.hotspots,
        aoiContext: areaEvidence.aoiContext,
        landuseContext: areaEvidence.landuseContext,
      },
    })
    const snapshot = buildRegionSnapshotFromEvidence({
      view: areaView,
      rawQuery,
    })
    const derivedFeatureTags = deriveRegionFeatureTags(snapshot)
    const derivedFeatureSummary = summarizeRegionFeatures(snapshot, derivedFeatureTags)
    const encoderPayload = await this.collectEncoderSignals({
      context,
      rawQuery,
      center,
      diagonalM: buildViewportDiagonalM(viewport),
      snapshot,
    })

    // 用 cell 模型构建区域实体级候选节点，而非 POI 点级
    const cellEntities = this.filterCellEntitiesByViewport(this.extractCellEntities(encoderPayload.scopeData ?? null), viewport)
    const poiSamples = areaView.representativeSamples || []
    const candidates = this.buildCellBasedCandidates(
      cellEntities,
      poiSamples,
      areaEvidence.aoiContext,
      areaEvidence.brandPool,
    )
    // 对 aoiContext 未覆盖到的 brand cluster 节点定向回查 aois 表补齐 boundary
    await this.enrichMissingBoundaries(candidates, context)
    // 对仍缺 boundary 的节点做聚合边界生成（DBSCAN→ConcaveHull→Buffer→Landuse吸附 / 单点圆兜底）
    await this.enrichAggregateBoundaries(candidates, viewport, context)
    const encoderCandidates = candidates.length > 0
      ? await this.enrichCandidatesWithEncoder({
          candidates,
          center,
          rawQuery,
          areaView,
          context,
        })
      : buildNarrativeCandidates({
          representativeSamples: poiSamples,
          aoiContext: areaEvidence.aoiContext,
        })
    const viewportSummary = buildNarrativeViewportSummary({
      featureTags: derivedFeatureTags,
      featureSummary: derivedFeatureSummary,
      encoderSummary: encoderPayload.regionSummary,
      encoderTags: encoderPayload.regionTags,
      encoderSceneTags: encoderPayload.sceneTags,
      encoderDominantBuckets: encoderPayload.dominantBuckets,
      candidates: encoderCandidates,
    })

    await writer.reasoning({
      content: viewportSummary.summarySentence,
    })

    await writer.stage('node_candidates')
    await writer.thinking({
      status: 'start',
      message: '正在挑选候选解说节点...',
    })

    // 统一升级到 top 15（区域概览 + 15 个解说节点 = 16 步）
    const rankResult = rankNarrativeNodes(
      encoderCandidates,
      viewportSummary,
      15,
    )
    const selectedNodes = rankResult.selectedNodes

    // 后置事实补强：只对 selected nodes 做联网搜索，不参与主编排
    await writer.stage('web_enrichment')
    await writer.thinking({
      status: 'start',
      message: '正在为选中节点补充外部事实...',
    })
    const enrichedNodes = await this.enrichSelectedNodesWithWebFacts(selectedNodes, viewportSummary, context)
    await writer.thinking({ status: 'end', message: '事实补强完成' })

    const transitions = buildNarrativeTransitions(enrichedNodes)
    let narrativeSteps = buildNarrativeSteps({
      summary: viewportSummary,
      nodes: enrichedNodes,
      transitions,
    })

    // LLM narration：用确定性证据生成更自然的解说词
    await writer.stage('llm_narration')
    await writer.thinking({
      status: 'start',
      message: '正在生成解说文案...',
    })
    const llmNarration = await this.generateNarration({
      viewportSummary,
      nodes: enrichedNodes,
      transitions,
      context,
    })
    if (llmNarration) {
      narrativeSteps = narrativeSteps.map((step, index) => {
        if (index === 0 && llmNarration.overview) {
          return { ...step, voice_text: llmNarration.overview }
        }
        const nodeNarration = llmNarration.nodes?.[step.node_id || '']
        if (nodeNarration) {
          return { ...step, voice_text: nodeNarration }
        }
        return step
      })
    }
    await writer.thinking({ status: 'end', message: '解说文案已生成' })

    const answer = buildNarrativeAnswer({
      summary: viewportSummary,
      nodes: enrichedNodes,
      transitions,
      narrativeMode: rankResult.narrativeMode,
    })

    await writer.pois(normalizePoiPreview(enrichedNodes.map((node) => ({
      id: node.id,
      name: node.name,
      categoryMain: node.categoryMain || null,
      categorySub: node.categorySub || null,
      longitude: node.center.lon,
      latitude: node.center.lat,
      distance_m: node.distanceM ?? null,
    }))))
    await writer.spatialClusters({
      hotspots: areaView.hotspots || [],
    })
    await writer.stage('tour_plan')
    await writer.thinking({
      status: 'end',
      message: '第一期导览骨架已经生成，正在整理镜头顺序...',
    })

    const stats = {
      surface: 'narrative',
      result_count: enrichedNodes.length,
      candidate_count: encoderCandidates.length,
      narrative_mode: rankResult.narrativeMode,
      scene_mix: viewportSummary.sceneMix,
      viewport_diagonal_m: buildViewportDiagonalM(viewport),
      duration_ms: Date.now() - startedAt,
    }

    await writer.stage('answer')
    await writer.stats(stats)
    await writer.refinedResult({
      answer,
      answer_source: 'narrative_skeleton',
      results: {
        boundary,
        pois: selectedNodes.map((node) => toFeature(node)),
        spatial_clusters: {
          hotspots: areaView.hotspots || [],
        },
        stats,
        evidence_view: {
          ...areaView,
          meta: {
            ...areaView.meta,
            surface: 'narrative',
            narrativeMode: rankResult.narrativeMode,
          },
        },
        narrative_tour: {
          boundary,
          viewport_summary: viewportSummary,
          candidates: encoderCandidates,
          selected_nodes: enrichedNodes,
          transitions,
          narrative_mode: rankResult.narrativeMode,
          narrative_steps: narrativeSteps,
        },
      },
      intent: {
        ...buildEmptyIntentPayload(rawQuery),
        needsClarification: false,
        sceneMix: viewportSummary.sceneMix,
      },
    })
    await writer.done({
      duration_ms: Date.now() - startedAt,
    })
  }

  private requireSkill(name: string): SkillDefinition {
    const skill = this.options.registry.get(name)
    if (!skill) {
      throw new Error(`Missing required skill: ${name}`)
    }
    return skill
  }

  private async executeSkill<TData>(skill: SkillDefinition, action: string, payload: unknown, context: SkillExecutionContext) {
    const result = await skill.execute(action, payload, context) as SkillExecutionResult<TData>
    if (!result.ok || !result.data) {
      throw new Error(result.error?.message || `${skill.name}.${action} failed`)
    }
    return result.data
  }

  private async collectAreaEvidence(viewport: NarrativeViewport, center: { lon: number, lat: number }, context: SkillExecutionContext) {
    if (viewport) {
      // 大视口（对角线 > 20km）时串行执行，避免 6 条 SQL 并行争抢 PostgreSQL shared memory 导致 OOM
      const diagonalM = buildViewportDiagonalM(viewport)
      const largeViewport = diagonalM > 20000

      const execQuery = async (templateName: NarrativeAreaTemplateName, limit: number) => {
        try {
          const result = await this.executeSkill<{ rows: Record<string, unknown>[] }>(this.requireSkill('postgis'), 'execute_spatial_sql', {
            sql: buildNarrativeAreaTemplateSql({ templateName, viewport, center, limit }),
          }, context)
          return result
        } catch (error) {
          context.logger.warn(`${templateName} query failed`, {
            error: error instanceof Error ? error.message : String(error),
          })
          return { rows: [] as Record<string, unknown>[] }
        }
      }

      let categoryHistogram: { rows: Record<string, unknown>[] }
      let representativeSamples: { rows: Record<string, unknown>[] }
      let hotspots: { rows: Record<string, unknown>[] }
      let aoiContext: { rows: Record<string, unknown>[] }
      let landuseContext: { rows: Record<string, unknown>[] }
      let brandPool: { rows: Record<string, unknown>[] }

      if (largeViewport) {
        // 串行执行，降低 shared memory 峰值
        categoryHistogram = await execQuery('area_category_histogram', 8)
        representativeSamples = await execQuery('area_representative_sample', 30)
        hotspots = await execQuery('area_h3_hotspots', 5)
        // aoiContext 从 6 提到 20：沙湖/公园这类自然地物 priority 虽提升到 1，
        // 但视口内 priority=0 的大学 AOI 仍可能把 tile_rank 槽位挤满，
        // 容量过小会导致 water/park 大 polygon 在最终结果里缺席。
        aoiContext = await execQuery('area_aoi_context', 20)
        landuseContext = await execQuery('area_landuse_context', 6)
        brandPool = await execQuery('area_regional_brand_pool', 40)
      } else {
        // 小视口并行执行，速度快
        ;[categoryHistogram, representativeSamples, hotspots, aoiContext, landuseContext, brandPool] = await Promise.all([
          execQuery('area_category_histogram', 8),
          execQuery('area_representative_sample', 30),
          execQuery('area_h3_hotspots', 5),
          execQuery('area_aoi_context', 20),
          execQuery('area_landuse_context', 6),
          execQuery('area_regional_brand_pool', 40),
        ])
      }

      return {
        categoryHistogram: Array.isArray(categoryHistogram.rows) ? categoryHistogram.rows : [],
        representativeSamples: Array.isArray(representativeSamples.rows) ? representativeSamples.rows : [],
        hotspots: Array.isArray(hotspots.rows) ? hotspots.rows : [],
        aoiContext: Array.isArray(aoiContext.rows) ? aoiContext.rows : [],
        landuseContext: Array.isArray(landuseContext.rows) ? landuseContext.rows : [],
        brandPool: Array.isArray(brandPool.rows) ? brandPool.rows : [],
      }
    } else {
      return {
        categoryHistogram: [],
        representativeSamples: [],
        hotspots: [],
        aoiContext: [],
        landuseContext: [],
        brandPool: [],
      }
    }
  }

  private async collectPopulationEvidence(
    viewport: NarrativeViewport,
    center: { lon: number, lat: number },
    nodes: NarrativeNode[],
    context: SkillExecutionContext,
  ) {
    if (nodes.length === 0) {
      return {
        populationHotspots: [] as NarrativePopulationHotspot[],
        nodeGrounding: [] as NarrativeNodeGrounding[],
      }
    }

    const postgis = this.requireSkill('postgis')

    try {
      const hotspotResult = await this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_population_hotspots', viewport, center, limit: 4 }),
      }, context)
      const populationHotspots = normalizePopulationHotspots(Array.isArray(hotspotResult.rows) ? hotspotResult.rows : [])
      const nodeGroundingSettled = await Promise.allSettled(nodes.map(async (node) => {
        const radiusM = node.role === 'district_anchor' ? 260 : 220
        const result = await this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
          sql: buildNodePopulationGroundingSql(node, radiusM),
        }, context)
        const row = Array.isArray(result.rows) ? result.rows[0] : null
        return buildNodeGrounding(node, row, radiusM)
      }))

      return {
        populationHotspots,
        nodeGrounding: nodeGroundingSettled
          .filter((item): item is PromiseFulfilledResult<NarrativeNodeGrounding> => item.status === 'fulfilled')
          .map((item) => item.value),
      }
    } catch (error) {
      context.logger.warn('population evidence unavailable for narrative', {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        populationHotspots: [] as NarrativePopulationHotspot[],
        nodeGrounding: [] as NarrativeNodeGrounding[],
      }
    }
  }

  private async generateNarration(input: {
    viewportSummary: NarrativeViewportSummary
    nodes: NarrativeNode[]
    transitions: NarrativeTourTransition[]
    context: SkillExecutionContext
  }): Promise<{ overview: string, nodes: Record<string, string> } | null> {
    if (!this.provider.isReady()) {
      return null
    }

    const nodeDescriptions = input.nodes.map((node, index) => {
      const transition = index > 0 ? input.transitions[index - 1] : null
      const parts = [
        `节点${index + 1}：${node.name}（${node.roleLabel}）`,
        `品类：${node.categorySub || node.categoryMain || '未知'}`,
        `代表理由：${node.selectionReason || node.encoderSummary || node.reasons.join('、')}`,
      ]
      const factLabels = node.webFacts?.labels || []
      if (factLabels.length > 0) {
        parts.push(`事实标签：${factLabels.join('、')}`)
      }
      const factSnippet = (node.webFacts?.snippets || [])[0]
      if (factSnippet) {
        parts.push(`外部事实：${factSnippet}`)
      }
      if (transition) {
        parts.push(`转场：${transition.rationale}`)
      }
      return parts.join('；')
    }).join('\n')

    const systemPrompt = `你是一位专业的城市空间解说员。根据提供的确定性空间证据，为每个导览节点生成一段自然流畅的解说词。
要求：
1. 每段解说词 30-60 字，口语化，适合语音播报
2. 必须基于提供的证据，不要编造信息
3. 体现区域气质、代表性、转场逻辑
4. 用 JSON 格式输出：{"overview":"区域概览解说","nodes":{"节点id":"该节点解说词"}}`

    const userPrompt = `区域画像：${input.viewportSummary.summarySentence}
场景标签：${input.viewportSummary.sceneMix.join('、')}
${nodeDescriptions}`

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt, toolCalls: [] },
          { role: 'user', content: userPrompt, toolCalls: [] },
        ],
        tools: [],
        timeoutMs: 15000,
      })

      const content = response.assistantMessage.content
      if (!content) return null

      // 从 LLM 响应中提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const parsed = JSON.parse(jsonMatch[0]) as { overview?: string, nodes?: Record<string, string> }
      return {
        overview: typeof parsed.overview === 'string' ? parsed.overview : '',
        nodes: typeof parsed.nodes === 'object' && parsed.nodes ? parsed.nodes : {},
      }
    } catch (error) {
      input.context.logger.warn('LLM narration generation failed, using deterministic fallback', {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  private inferSceneBucketFromText(text: string) {
    if (/(景观|景区|滨水|湖|公园|风景|scenic|park|water)/iu.test(text)) return '景观'
    if (/(校园|高校|大学|学院|education|campus)/iu.test(text)) return '校园'
    if (/(商业|商圈|零售|购物|retail|mall|commercial)/iu.test(text)) return '商业'
    if (/(生活|社区|居住|餐饮|配套|residential|daily|food)/iu.test(text)) return '生活'
    if (/(交通|地铁|公交|枢纽|station|transit)/iu.test(text)) return '交通'
    return '片区'
  }

  private extractCellEntities(scopeData: Record<string, unknown> | null): NarrativeCellEntity[] {
    if (!scopeData) return []
    const rawCells = Array.isArray(scopeData.cells) ? scopeData.cells as Array<Record<string, unknown>> : []
    if (rawCells.length === 0) return []

    return rawCells.map((cell) => {
      const lon = Number(cell.lon || cell.longitude || 0)
      const lat = Number(cell.lat || cell.latitude || 0)
      return {
        cellId: String(cell.cell_id || cell.id || `${lon}_${lat}`),
        cellName: String(cell.region_name || cell.dominant_category || cell.name || '未命名区域'),
        center: { lon, lat },
        dominantCategory: String(cell.dominant_category || cell.category || ''),
        aoiType: String(cell.aoi_type || cell.aoi_fclass || ''),
        sceneTags: Array.isArray(cell.scene_tags) ? cell.scene_tags.map((item: unknown) => String(item)) : [],
        searchScore: Number(cell.search_score || cell.similarity || cell.score || 0),
        childPoiIds: [] as string[],
      } satisfies NarrativeCellEntity
    })
  }

  private filterCellEntitiesByViewport(cells: NarrativeCellEntity[], viewport: NarrativeViewport): NarrativeCellEntity[] {
    if (cells.length === 0) return cells
    const padLon = Math.max((viewport.neLon - viewport.swLon) * 0.05, 0.0015)
    const padLat = Math.max((viewport.neLat - viewport.swLat) * 0.05, 0.0012)
    return cells.filter((cell) => {
      const lon = Number(cell.center.lon)
      const lat = Number(cell.center.lat)
      return Number.isFinite(lon)
        && Number.isFinite(lat)
        && lon >= viewport.swLon - padLon
        && lon <= viewport.neLon + padLon
        && lat >= viewport.swLat - padLat
        && lat <= viewport.neLat + padLat
    })
  }

  private buildCellBasedCandidates(
    cells: NarrativeCellEntity[],
    poiSamples: EvidenceItem[],
    aoiContext: Record<string, unknown>[],
    brandPoolRows: Record<string, unknown>[] = [],
  ): NarrativeNode[] {
    const nodes: NarrativeNode[] = []

    // ============================================================
    // 阶段 1：区域品牌聚合（Brand Cluster）
    // 把 representativeSamples + brandPool 合并后做品牌词抽取与同前缀 POI 聚合。
    // 例：cell 内有「湖北大学三期公寓 / 湖北大学体育馆 / 湖北大学二号教学楼」
    //    → 聚合为 { brand: "湖北大学", type: "campus", count: 3 } 的独立区域实体
    // 这一步让节点名称从具体 POI 升级为「区域性品牌抽象」。
    // ============================================================
    const allPoisForBrand = this.mergePoisWithBrandPool(poiSamples, brandPoolRows)
    const brandClusters = clusterPoisByBrand(allPoisForBrand).filter(isBrandClusterEligible)
    const brandNodeByEntityKey = new Map<string, NarrativeNode>()
    const nodeByEntityKey = new Map<string, NarrativeNode>()

    // 记录被品牌 cluster 覆盖的 POI id，cell-based 阶段遇到时跳过，避免重复
    const brandCoveredPoiIds = new Set<string>()
    for (const cluster of brandClusters) {
      for (const member of cluster.members) {
        const id = String(member.id ?? member.name ?? '')
        if (id) brandCoveredPoiIds.add(id)
      }
    }

    for (const cluster of brandClusters) {
      const node = this.buildBrandClusterNode(cluster)
      nodes.push(node)
      const entityKey = this.buildNarrativeEntityKey(node.name)
      if (entityKey && !brandNodeByEntityKey.has(entityKey)) {
        brandNodeByEntityKey.set(entityKey, node)
      }
      if (entityKey && !nodeByEntityKey.has(entityKey)) {
        nodeByEntityKey.set(entityKey, node)
      }
    }

    // ============================================================
    // 阶段 2：Cell-based 候选（保留原逻辑，跳过已被品牌覆盖的 cell）
    // ============================================================
    if (cells.length > 0) {
      // 把每个 POI 挂到最近的 cell 下
      const cellMap = new Map<string, NarrativeCellEntity>()
      for (const cell of cells) {
        cellMap.set(cell.cellId, { ...cell, childPoiIds: [] })
      }

      const poiCellAssignment = new Map<string, string>() // poiId → cellId
      for (const poi of poiSamples) {
        const poiLon = Number(poi.longitude)
        const poiLat = Number(poi.latitude)
        if (!Number.isFinite(poiLon) || !Number.isFinite(poiLat)) continue
        let nearestCellId = ''
        let nearestDist = Infinity
        for (const cell of cells) {
          const dLon = (poiLon - cell.center.lon) * Math.cos(cell.center.lat * Math.PI / 180)
          const dLat = poiLat - cell.center.lat
          const dist = dLon * dLon + dLat * dLat
          if (dist < nearestDist) {
            nearestDist = dist
            nearestCellId = cell.cellId
          }
        }
        if (nearestCellId) {
          const cell = cellMap.get(nearestCellId)
          if (cell) {
            const poiId = `poi:${String(poi.id ?? poi.name)}`
            cell.childPoiIds.push(poiId)
            poiCellAssignment.set(poiId, nearestCellId)
          }
        }
      }

      // 每个 cell 生成一个候选节点
      for (const cell of cellMap.values()) {
        const childPois = poiSamples.filter((poi) => {
          const poiId = `poi:${String(poi.id ?? poi.name)}`
          return poiCellAssignment.get(poiId) === cell.cellId
        })

        const representativePoi = this.pickRepresentativePoi(childPois, cell)

        // 若代表 POI 已被 brand cluster 覆盖，跳过（品牌节点已承担区域代表）
        if (representativePoi) {
          const repId = String(representativePoi.id ?? representativePoi.name ?? '')
          if (repId && brandCoveredPoiIds.has(repId)) {
            continue
          }
          // 进一步：代表 POI 名字可抽出品牌词但品牌未成 cluster（单个 POI）
          // 这种情况下用 POI 原名即可，品牌聚合阶段不会产生重复
          const { brand } = extractBrandFromName(String(representativePoi.name || ''))
          if (brand && brandClusters.some((c) => c.brand === brand)) {
            continue
          }
        }

        const displayName = representativePoi
          ? normalizeName(representativePoi.name)
          : this.normalizeCellEntityName(cell.cellName)

        if (!displayName) continue

        const categoryMain = representativePoi?.categoryMain || (cell.dominantCategory || null)
        const categorySub = representativePoi?.categorySub || representativePoi?.category || null

        const role = representativePoi
          ? resolveNodeRoleFromPoi(representativePoi)
          : this.inferRoleFromCell(cell)

        const center = cell.center
        const childCount = cell.childPoiIds.length
        const densityBonus = Math.min(Math.log2(Math.max(childCount, 1) + 1) * 0.04, 0.16)
        const score = Number((resolveRoleWeight(role) + cell.searchScore * 0.15 + densityBonus).toFixed(3))

        if (role === 'local_life_anchor' && childCount < 3) continue
        if (role === 'district_anchor' && childCount < 3 && !cell.aoiType) continue

        const node = {
          id: `cell:${cell.cellId}`,
          name: displayName,
          role,
          roleLabel: resolveRoleLabel(role),
          source: 'representative_sample',
          center,
          score,
          categoryMain,
          categorySub,
          distanceM: null,
          tags: [role, cell.dominantCategory, ...cell.sceneTags].filter(Boolean),
          reasons: [resolveRoleLabel(role), cell.dominantCategory || '区域代表实体'].filter(Boolean),
          hotness: 'low' as const,
          cellId: cell.cellId,
          childPoiIds: cell.childPoiIds,
        } satisfies NarrativeNode
        nodes.push(node)
        const entityKey = this.buildNarrativeEntityKey(node.name)
        if (entityKey && !nodeByEntityKey.has(entityKey)) {
          nodeByEntityKey.set(entityKey, node)
        }
      }
    }

    // ============================================================
    // 阶段 3：AOI 锚点（AOI 本身即区域实体），跳过与品牌/cell 重复的
    // ============================================================
    const existingEntityKeys = new Set(
      nodes
        .map((node) => this.buildNarrativeEntityKey(node.name))
        .filter(Boolean),
    )
    const dedupedAoiContext = new Map<string, Record<string, unknown>>()
    for (const item of aoiContext) {
      const rawName = String(item.name || '').trim()
      const name = normalizeName(rawName)
      if (!name || /^(none|null|unknown|未命名|无名)$/iu.test(name)) continue
      const entityKey = this.buildNarrativeEntityKey(name)
      if (!entityKey) continue
      const existing = dedupedAoiContext.get(entityKey)
      if (!existing || this.resolveAoiWeight(item) > this.resolveAoiWeight(existing)) {
        dedupedAoiContext.set(entityKey, item)
      }
    }

    for (const item of dedupedAoiContext.values()) {
      const name = normalizeName(item.name)
      if (!name) continue
      const entityKey = this.buildNarrativeEntityKey(name)
      if (!entityKey) continue
      const supportingNode = brandNodeByEntityKey.get(entityKey) || nodeByEntityKey.get(entityKey)
      if (supportingNode) {
        this.mergeNarrativeNodeAoiSupport(supportingNode, item)
        existingEntityKeys.add(entityKey)
        continue
      }
      if (existingEntityKeys.has(entityKey)) continue

      const lon = Number(item.longitude)
      const lat = Number(item.latitude)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

      // 判定「自然地物」：水体、公园、湿地、林地、保护区等大面积 polygon
      // 这类 AOI 的 centroid 往往和路边 POI/cell 中心在 300m 内，但其 polygon
      // 覆盖几百米到几公里的面，不应被当作 "重复节点" 丢弃（如沙湖）。
      const fclass = String(item.fclass || '').trim().toLowerCase()
      const isScenicPolygon = (
        fclass === 'water' || fclass === 'wetland' || fclass === 'forest'
        || fclass === 'nature_reserve' || fclass === 'reservoir' || fclass === 'lake'
        || fclass === 'river' || fclass === 'park' || fclass === 'scenic'
        || fclass === 'tourism'
        || /^(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)/u.test(name)
        || /(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)$/u.test(name)
      )
      // 如果 AOI 中心离某个 cell 中心 <300m，跳过（避免重复），
      // 但自然地物保留独立节点（polygon 面积大，语义上是独立实体）
      const tooClose = !isScenicPolygon && cells.some((cell) => {
        const dLon = (lon - cell.center.lon) * Math.cos(cell.center.lat * Math.PI / 180)
        const dLat = lat - cell.center.lat
        return Math.sqrt(dLon * dLon + dLat * dLat) < 0.003
      })
      if (tooClose) continue

      const role = resolveNodeRoleFromAoi(item)
      const weight = this.resolveAoiWeight(item)
      const scaleBonus = Math.min(Math.log10(Math.max(weight, 1) + 1) / 10, 0.18)
      const boundary = parseBoundaryGeoJson(item.boundary_geojson, 'aoi_native')
      const node = {
        id: `aoi:${String(item.id ?? name)}`,
        name,
        role,
        roleLabel: resolveRoleLabel(role),
        source: 'aoi_context',
        center: { lon, lat },
        score: Number((resolveRoleWeight(role) + 0.24 + scaleBonus).toFixed(3)),
        categoryMain: null,
        categorySub: String(item.fclass || '').trim() || null,
        distanceM: null,
        tags: [role, String(item.fclass || '')].filter(Boolean),
        reasons: [resolveRoleLabel(role), 'AOI 代表锚点'].filter(Boolean),
        hotness: 'low' as const,
        boundary,
      } satisfies NarrativeNode
      nodes.push(node)
      existingEntityKeys.add(entityKey)
      nodeByEntityKey.set(entityKey, node)
    }

    return nodes
  }

  /**
   * 对缺少 boundary 的节点做定向 AOI 边界回查。
   *
   * 根因：areaAoiContextViewport.sql 的 LIMIT + tile_rank 过滤导致部分 AOI
   * （沙湖、湖北大学等）不在 aoiContext 结果中，其对应的 brand cluster / cell
   * 节点因此无 boundary。此方法批量查 aois 表补齐。
   *
   * 匹配策略：
   * 1. name 精确 / 前缀 / 包含匹配
   * 2. 空间邻近过滤：AOI 与所有缺 boundary 节点中心点的 MultiPoint 距离 <2km
   *    （原实现错用了 aois 表不存在的 longitude/latitude 列，SQL 一直在 PG
   *    报列不存在、被外层 catch 静默吞掉，等于该方法从未生效）
   * 3. 面积过滤：排除 <100m²（残片）与 >50km²（辐射过广）的异常 AOI
   */
  private async enrichMissingBoundaries(nodes: NarrativeNode[], context: SkillExecutionContext): Promise<void> {
    const missing = nodes.filter((n) => !n.boundary)
    if (missing.length === 0) return

    // 收集需要回查的节点名，用 entityKey 去重
    const namesByKey = new Map<string, { node: NarrativeNode, name: string }>()
    for (const node of missing) {
      const key = this.buildNarrativeEntityKey(node.name)
      if (key && !namesByKey.has(key)) {
        namesByKey.set(key, { node, name: node.name })
      }
    }
    if (namesByKey.size === 0) return

    // name 匹配条件：精确 / 前缀 / 包含
    const nameConditions: string[] = []
    for (const { name } of namesByKey.values()) {
      const escaped = String(name).replace(/'/gu, "''")
      nameConditions.push(`name = '${escaped}'`)
      nameConditions.push(`name LIKE '${escaped}%'`)
      nameConditions.push(`name LIKE '%${escaped}%'`)
    }

    // 空间过滤：用 missing node 的中心点集合构造 MultiPoint，
    // AOI geom 与 MultiPoint 距离 <2km 即视为候选（避免远距离同名实体误匹配）
    const centerPoints = [...namesByKey.values()]
      .filter(({ node }) => Number.isFinite(node.center.lon) && Number.isFinite(node.center.lat))
      .map(({ node }) => `ST_SetSRID(ST_MakePoint(${Number(node.center.lon)}, ${Number(node.center.lat)}), 4326)`)

    if (centerPoints.length === 0) return

    const multiPointExpr = centerPoints.length === 1
      ? centerPoints[0]
      : `ST_Collect(ARRAY[${centerPoints.join(', ')}])`

    const sql = `
      SELECT
        name,
        ST_X(ST_Centroid(geom)) AS longitude,
        ST_Y(ST_Centroid(geom)) AS latitude,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS boundary_geojson,
        CAST(ST_Area(geom::geography) AS bigint) AS area_m2
      FROM aois
      WHERE (${nameConditions.join(' OR ')})
        AND ST_GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
        AND ST_DWithin(geom::geography, (${multiPointExpr})::geography, 2000)
      ORDER BY area_m2 DESC
      LIMIT 200
    `

    let rows: Record<string, unknown>[] = []
    try {
      const postgis = this.requireSkill('postgis')
      const result = await this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', { sql }, context)
      rows = Array.isArray(result?.rows) ? result.rows : []
    } catch (error) {
      context.logger.warn('enrichMissingBoundaries aois query failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (rows.length === 0) return

    // 按 entityKey 索引查询结果，取面积最大且空间最近的
    const bestByEntityKey = new Map<string, { boundary: NarrativeNodeBoundary, area: number, dist: number }>()
    for (const row of rows) {
      const rowName = String(row.name || '').trim()
      const key = this.buildNarrativeEntityKey(rowName)
      if (!key) continue
      const area = Number(row.area_m2) || 0
      // 过滤面积过大（>50km²）或过小（<100m²）的异常 AOI
      if (area > 50_000_000 || area < 100) continue

      const aoiLon = Number(row.longitude)
      const aoiLat = Number(row.latitude)
      if (!Number.isFinite(aoiLon) || !Number.isFinite(aoiLat)) continue

      // 找到与该 AOI 最近的缺 boundary 节点
      let minDist = Infinity
      for (const node of missing) {
        if (!Number.isFinite(node.center.lon) || !Number.isFinite(node.center.lat)) continue
        const dLon = (aoiLon - node.center.lon) * Math.cos(aoiLat * Math.PI / 180)
        const dLat = aoiLat - node.center.lat
        const distM = Math.sqrt(dLon * dLon + dLat * dLat) * 111_320
        if (distM < minDist) minDist = distM
      }
      // 空间邻近过滤：AOI 中心距最近节点 >2km 则跳过
      if (minDist > 2000) continue

      const existing = bestByEntityKey.get(key)
      if (!existing || area > existing.area) {
        const boundary = parseBoundaryGeoJson(row.boundary_geojson, 'aoi_native')
        if (boundary) bestByEntityKey.set(key, { boundary, area, dist: minDist })
      }
    }

    for (const node of missing) {
      const key = this.buildNarrativeEntityKey(node.name)
      if (!key) continue
      const match = bestByEntityKey.get(key)
      if (match) {
        node.boundary = match.boundary
      }
    }
  }

  /**
   * 对仍缺 boundary 的节点做聚合边界生成。
   *
   * 策略：
   * 1. 若节点有 ≥3 个 memberPoints → 调用 narrativeAggregateBoundary SQL
   *    （DBSCAN → ConcaveHull → Buffer → Landuse 吸附）
   * 2. 若 memberPoints <3 或 SQL 失败 → JS 纯生成单点圆兜底（point_halo）
   */
  private async enrichAggregateBoundaries(
    nodes: NarrativeNode[],
    viewport: NarrativeViewport,
    context: SkillExecutionContext,
  ): Promise<void> {
    const missing = nodes.filter((n) => !n.boundary)
    if (missing.length === 0) return

    const postgis = this.requireSkill('postgis')

    // 按节点逐个生成聚合边界（每个节点的 memberPoints 不同）
    const settled = await Promise.allSettled(missing.map(async (node) => {
      const pts = node.memberPoints?.filter(
        (pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat),
      ) ?? []

      // 兜底：memberPoints <3 → 生成单点圆
      if (pts.length < 3) {
        return { nodeId: node.id, boundary: this.generatePointHalo(node) }
      }

      try {
        const sql = buildNarrativeAreaTemplateSql({
          templateName: 'narrative_aggregate_boundary',
          viewport,
          center: node.center,
          limit: 1,
          memberPoints: pts,
        })
        const result = await this.executeSkill<{ rows: Record<string, unknown>[] }>(
          postgis, 'execute_spatial_sql', { sql }, context,
        )
        const rows = Array.isArray(result?.rows) ? result.rows : []
        if (rows.length > 0 && rows[0].boundary_geojson) {
          const boundary = parseBoundaryGeoJson(rows[0].boundary_geojson, 'aggregate_morphology')
          if (boundary) {
            return { nodeId: node.id, boundary }
          }
        }
        // SQL 成功但无有效结果 → 兜底单点圆
        return { nodeId: node.id, boundary: this.generatePointHalo(node) }
      } catch (error) {
        context.logger.warn('enrichAggregateBoundaries SQL failed for node', {
          nodeId: node.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return { nodeId: node.id, boundary: this.generatePointHalo(node) }
      }
    }))

    for (const item of settled) {
      if (item.status !== 'fulfilled' || !item.value.boundary) continue
      const node = missing.find((n) => n.id === item.value.nodeId)
      if (node && !node.boundary) {
        node.boundary = item.value.boundary
      }
    }
  }

  /**
   * JS 纯生成单点圆兜底（point_halo）。
   * 以节点 center 为圆心，radiusM 为半径（默认 150m），生成 32 边正多边形 GeoJSON Polygon。
   */
  private generatePointHalo(
    node: NarrativeNode,
    radiusM: number = 150,
  ): NarrativeNodeBoundary {
    const segments = 32
    const lon = node.center.lon
    const lat = node.center.lat
    // 角度→米的换算系数
    const lonFactor = 111_320 * Math.cos(lat * Math.PI / 180)
    const latFactor = 110_540
    const dLon = radiusM / lonFactor
    const dLat = radiusM / latFactor

    const ring: number[][] = []
    for (let i = 0; i <= segments; i++) {
      const angle = (2 * Math.PI * i) / segments
      ring.push([
        lon + dLon * Math.cos(angle),
        lat + dLat * Math.sin(angle),
      ])
    }

    return {
      type: 'Polygon',
      coordinates: [ring],
      source: 'point_halo',
    }
  }

  private buildNarrativeEntityKey(name: string) {
    const cleaned = normalizeName(name)
      .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
      .replace(/\s+/gu, '')
      .trim()
    if (!cleaned) return ''
    const { brand } = extractBrandFromName(cleaned)
    const base = brand || cleaned.replace(/(东区|西区|南区|北区|主校区|新校区|老校区|校区|分校|教学点)$/u, '')
    return base.replace(/[\-—_·•]/gu, '').trim().toLowerCase()
  }

  private resolveAoiWeight(item: Record<string, unknown>) {
    const weight = Number(item.population || item.area_sqm || item.areaSqm || 1)
    return Number.isFinite(weight) ? weight : 1
  }

  private mergeNarrativeNodeAoiSupport(node: NarrativeNode, item: Record<string, unknown>) {
    const fclass = String(item.fclass || '').trim()
    node.tags = [...new Set([...node.tags, 'aoi_support', fclass].filter(Boolean))]
    node.reasons = [...new Set([...node.reasons, 'AOI 代表锚点'])]
    // 品牌/cell 节点本无 polygon，若 AOI 有原生边界则提拔为节点 boundary
    if (!node.boundary) {
      const aoiBoundary = parseBoundaryGeoJson(item.boundary_geojson, 'aoi_native')
      if (aoiBoundary) node.boundary = aoiBoundary
    }
  }

  /**
   * 把 brandPool（SQL row 格式）转成 EvidenceItem，并与 representativeSamples 合并去重。
   * 保证即使景点 / 小吃街在 anchor_priority 排序中被压住，也能进入品牌聚合层。
   */
  private mergePoisWithBrandPool(
    samples: EvidenceItem[],
    brandPoolRows: Record<string, unknown>[],
  ): EvidenceItem[] {
    const map = new Map<string, EvidenceItem>()
    for (const poi of samples) {
      const key = String(poi.id ?? poi.name ?? '')
      if (key) map.set(key, poi)
    }
    for (const row of brandPoolRows) {
      const key = String(row.id ?? row.name ?? '')
      if (!key || map.has(key)) continue
      const lon = Number(row.longitude)
      const lat = Number(row.latitude)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      map.set(key, {
        id: row.id as string | number | null | undefined ?? null,
        name: String(row.name ?? ''),
        categoryMain: typeof row.category_main === 'string' ? row.category_main : null,
        categorySub: typeof row.category_sub === 'string' ? row.category_sub : null,
        longitude: lon,
        latitude: lat,
        distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
      })
    }
    return [...map.values()]
  }

  /**
   * 把 brand cluster 转成独立的 NarrativeNode。
   * 节点名 = 品牌（如「湖北大学」「户部巷小吃街」），center = 成员质心。
   */
  private buildBrandClusterNode(cluster: BrandCluster): NarrativeNode {
    const role = resolveBrandRole(cluster.type)
    const categoryLabel = resolveBrandCategoryLabel(cluster.type)
    const densityBonus = Math.min(Math.log2(cluster.count + 1) * 0.05, 0.15)
    const reason = cluster.count >= 2
      ? `由 ${cluster.count} 个同品牌 POI 汇聚成的区域实体`
      : `${categoryLabel}代表节点`
    const memberPoints = cluster.members
      .map((m) => ({ lon: Number(m.longitude), lat: Number(m.latitude) }))
      .filter((pt) => Number.isFinite(pt.lon) && Number.isFinite(pt.lat))
    return {
      id: `brand:${cluster.type}:${cluster.brand}`,
      name: cluster.brand,
      role,
      roleLabel: resolveRoleLabel(role),
      source: 'brand_cluster',
      center: cluster.center,
      score: Number((resolveRoleWeight(role) + 0.28 + densityBonus).toFixed(3)),
      categoryMain: null,
      categorySub: categoryLabel,
      distanceM: null,
      tags: [role, `brand:${cluster.type}`, `cluster_count:${cluster.count}`],
      reasons: [resolveRoleLabel(role), reason],
      hotness: 'low',
      cellId: `brand:${cluster.type}:${cluster.brand}`,
      childPoiIds: cluster.members.map((m) => `poi:${String(m.id ?? m.name)}`),
      memberPoints,
    }
  }

  private pickRepresentativePoi(pois: EvidenceItem[], cell: NarrativeCellEntity): EvidenceItem | null {
    if (pois.length === 0) return null

    // 优先级排序：校园/景区/商业 > 行政/交通 > 餐饮/生活 > 其他
    const priority = (poi: EvidenceItem) => {
      const text = `${poi.name || ''} ${poi.categoryMain || ''} ${poi.categorySub || ''}`
      if (/(大学|学院)/u.test(text) && !/(小学|中学|幼儿园|附小|附中|实验学校|国际学校)/u.test(text)) return 0
      if (/(景区|景点|公园|风景区|旅游区|博物馆|纪念馆)/u.test(text)) return 1
      if (/(商圈|步行街|广场|购物中心|商业街|商场)/u.test(text)) return 2
      if (/(地铁站|公交站|交通枢纽)/u.test(text)) return 3
      if (/(医院|图书馆|体育|文化|社区|街道|政务)/u.test(text)) return 4
      if (/^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务)$/u.test(String(poi.name || '').trim())) return 98
      if (/(小学|中学|幼儿园|附小|附中|实验学校|国际学校)/u.test(text)) return 97
      // 排除噪音
      if (/(宿舍|便利店|快递|停车场|厕所|卫生间|门岗|出入口)/u.test(text)) return 99
      return 10
    }

    const sorted = [...pois].sort((a, b) => priority(a) - priority(b))
    const best = sorted[0] || null
    return best && priority(best) < 90 ? best : null
  }

  private normalizeCellEntityName(name: string) {
    const text = normalizeName(name)
    if (!text) return ''
    if (/^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务|交通设施服务|公共设施|公司企业|商务住宅|住宅区|教育培训|教育服务|科教文化服务|风景名胜|地名地址信息)$/u.test(text)) {
      return ''
    }
    if (/(宿舍|学生公寓|楼栋|教学楼|实验楼|食堂|便利店|驿站|快递站|停车场|门岗|出入口|入口|出口|东门|西门|南门|北门|厕所|卫生间)/u.test(text)) {
      return ''
    }
    if (/(小学|中学|幼儿园|附小|附中|实验学校|国际学校)/u.test(text)) {
      return ''
    }
    return text
  }

  private inferRoleFromCell(cell: NarrativeCellEntity): string {
    const text = `${cell.cellName} ${cell.dominantCategory} ${cell.aoiType} ${cell.sceneTags.join(' ')}`
    if (/(校园|高校|大学|学院|education|campus)/iu.test(text)) return 'campus_anchor'
    if (/(景观|景区|滨水|湖|公园|风景|scenic|park|water)/iu.test(text)) return 'scenic_landmark'
    if (/(商业|商圈|零售|购物|retail|mall|commercial)/iu.test(text)) return 'commercial_anchor'
    if (/(交通|地铁|公交|枢纽|station|transit)/iu.test(text)) return 'transit_connector'
    if (/(生活|社区|居住|餐饮|配套|residential|daily|food)/iu.test(text)) return 'local_life_anchor'
    return 'district_anchor'
  }

  private async enrichCandidatesWithEncoder(input: {
    candidates: NarrativeNode[]
    center: { lon: number, lat: number }
    rawQuery: string
    areaView: ReturnType<typeof buildAreaOverviewView>
    context: SkillExecutionContext
  }) {
    const encoder = this.options.registry.get('spatial_encoder')
    if (!encoder || input.candidates.length === 0) {
      return input.candidates
    }

    const annotationMap = new Map<string, Record<string, unknown>>()
    try {
      const annotation = await this.executeSkill<{ results: Record<string, unknown>[] }>(encoder, 'annotate_poi_cells', {
        anchor_lon: input.center.lon,
        anchor_lat: input.center.lat,
        user_query: input.rawQuery,
        task_type: 'viewport_tour',
        pois: input.candidates.map((node) => ({
          id: node.id,
          name: node.name,
          longitude: node.center.lon,
          latitude: node.center.lat,
          category_main: node.categoryMain || null,
          category_sub: node.categorySub || null,
          role: node.role,
        })),
      }, input.context)

      for (const row of Array.isArray(annotation.results) ? annotation.results : []) {
        const key = String(row.id || row.poi_id || row.name || '').trim()
        if (key) annotationMap.set(key, row)
      }
    } catch (error) {
      input.context.logger.warn('narrative annotate_poi_cells unavailable', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const profileMap = new Map<string, { summary: string | null, tags: Array<{ key: string, label: string, score: number, detail: string | null }> }>()
    const shortlist = input.candidates.slice(0, Math.min(input.candidates.length, 12))
    const profileSettled = await Promise.allSettled(shortlist.map(async (node) => {
      const result = await this.executeSkill<{ feature_summary?: string, feature_tags?: Array<{ key: string, label: string, score: number, detail: string | null }> }>(encoder, 'encode_poi_profile', {
        profile: buildPoiProfileInputFromEvidence({
          item: {
            id: node.id,
            name: node.name,
            categoryMain: node.categoryMain || null,
            categorySub: node.categorySub || null,
            longitude: node.center.lon,
            latitude: node.center.lat,
            distance_m: node.distanceM ?? null,
          },
          view: input.areaView,
        }),
      }, input.context)
      return {
        nodeId: node.id,
        summary: typeof result.feature_summary === 'string' ? result.feature_summary : null,
        tags: Array.isArray(result.feature_tags) ? result.feature_tags : [],
      }
    }))

    for (const item of profileSettled) {
      if (item.status !== 'fulfilled') continue
      profileMap.set(item.value.nodeId, {
        summary: item.value.summary,
        tags: item.value.tags,
      })
    }

    return input.candidates.map((node) => {
      const annotation = annotationMap.get(node.id) || annotationMap.get(node.name) || null
      const cellContext = annotation && typeof annotation.cell_context === 'object' ? annotation.cell_context as Record<string, unknown> : null
      const profile = profileMap.get(node.id) || null
      const sceneText = [
        String(cellContext?.dominant_category || ''),
        String(annotation?.dominant_category || ''),
        String(profile?.summary || ''),
        ...(profile?.tags || []).map((tag) => tag.label),
        node.categoryMain || '',
        node.categorySub || '',
      ].join(' ')
      const sceneBucket = this.inferSceneBucketFromText(sceneText)

      return {
        ...node,
        sceneBucket,
        encoderSummary: profile?.summary || node.encoderSummary || null,
        encoderTags: profile?.tags || node.encoderTags || [],
        // selectionReason 由 rankNarrativeNodes 中的 buildSelectionReason 统一生成，
        // 不再用 encoder summary 覆写，避免"日常配套支点"等泛化描述覆盖角色感知
      }
    })
  }

  private async enrichSelectedNodesWithWebFacts(
    nodes: NarrativeNode[],
    summary: NarrativeViewportSummary,
    context: SkillExecutionContext,
  ): Promise<NarrativeNode[]> {
    const searchSkill = this.options.registry.get('tavily_search') || this.options.registry.get('multi_search_engine')
    if (!searchSkill || nodes.length === 0) return nodes

    const action = searchSkill.name === 'tavily_search' ? 'search_web' : 'search_multi'
    const resultsPerNode = new Map<string, NarrativeNodeFactEnrichment>()

    // 对每个选中节点做逐点搜索，提取事实片段和标签
    const settled = await Promise.allSettled(nodes.map(async (node) => {
      const sceneTag = summary.sceneMix.slice(0, 2).join(' ')
      const query = `${node.name} ${node.categorySub || node.categoryMain || ''} ${sceneTag}`.trim()
      try {
        const result = await this.executeSkill<Record<string, unknown>>(searchSkill, action, {
          query,
          queries: [query],
          max_results: 5,
          search_depth: 'basic',
        }, context)

        const items = Array.isArray((result as any).results) ? (result as any).results
          : Array.isArray((result as any).merged) ? (result as any).merged
          : []

        const snippets: string[] = []
        const labels: string[] = []
        for (const item of items) {
          const snippet = String(item.snippet || item.title || '').trim()
          if (snippet && snippet.includes(node.name)) {
            snippets.push(snippet.slice(0, 120))
          }
          // 从搜索结果中提取事实标签
          const title = String(item.title || '')
          const text = `${title} ${snippet}`
          if (/(5A|AAAA|五A级|国家级|世界遗产|重点文物|历史名城|千年|百年)/u.test(text)) labels.push('国家级')
          if (/(4A|AAAA|四A级)/u.test(text)) labels.push('4A景区')
          if (/(3A|AAA|三A级)/u.test(text)) labels.push('3A景区')
          if (/(重点|示范|标杆|旗舰|旗舰级|头部)/u.test(text)) labels.push('重点标杆')
          if (/(老字号|百年老店|老街|古镇|历史街区)/u.test(text)) labels.push('历史底蕴')
          if (/(名校|985|211|双一流|重点大学|重点中学)/u.test(text)) labels.push('名校')
          if (/(网红|打卡|人气|热门|必去|必逛)/u.test(text)) labels.push('人气打卡')
        }

        return {
          nodeId: node.id,
          enrichment: {
            nodeId: node.id,
            snippets: snippets.slice(0, 3),
            labels: [...new Set(labels)].slice(0, 3),
            source: searchSkill.name === 'tavily_search' ? 'tavily' as const : 'multi_search' as const,
          } satisfies NarrativeNodeFactEnrichment,
        }
      } catch {
        return { nodeId: node.id, enrichment: null }
      }
    }))

    for (const item of settled) {
      if (item.status !== 'fulfilled' || !item.value.enrichment) continue
      resultsPerNode.set(item.value.nodeId, item.value.enrichment)
    }

    return nodes.map((node) => {
      const facts = resultsPerNode.get(node.id) || null
      return { ...node, webFacts: facts }
    })
  }

  private buildEncoderAnchorScoreMap(encoderPayload: {
    scopeData?: Record<string, unknown> | null
  }): Map<string, number> {
    const map = new Map<string, number>()
    if (!encoderPayload?.scopeData) return map

    const cells = Array.isArray(encoderPayload.scopeData.cells) ? encoderPayload.scopeData.cells : []
    for (const cell of cells) {
      const poiId = String(cell.poi_id || cell.nodeId || '')
      const score = Number(cell.score || cell.relevance || 0)
      if (poiId && Number.isFinite(score) && score > 0) {
        map.set(poiId, score)
      }
    }
    return map
  }

  private async collectEncoderSignals(input: {
    context: SkillExecutionContext
    rawQuery: string
    center: { lon: number, lat: number }
    diagonalM: number
    snapshot: RegionSnapshotInput
  }) {
    const encoder = this.options.registry.get('spatial_encoder')
    if (!encoder) {
      return {
        regionSummary: null,
        regionTags: [] as never[],
        sceneTags: [] as string[],
        dominantBuckets: [] as string[],
      }
    }

    const [scopeCells, regionEncoding] = await Promise.allSettled([
      encoder.execute('search_anchor_cells', {
        anchor_lon: input.center.lon,
        anchor_lat: input.center.lat,
        user_query: input.rawQuery,
        task_type: 'viewport_tour',
        top_k: 6,
        max_distance_m: Math.max(Math.round(input.diagonalM / 1.6), 1600),
      }, input.context),
      encoder.execute('encode_region_snapshot', {
        snapshot: input.snapshot,
      }, input.context),
    ])

    const scopeData = scopeCells.status === 'fulfilled' && scopeCells.value.ok ? scopeCells.value.data as Record<string, unknown> : null
    const regionData = regionEncoding.status === 'fulfilled' && regionEncoding.value.ok ? regionEncoding.value.data as Record<string, unknown> : null

    return {
      regionSummary: typeof regionData?.feature_summary === 'string' ? regionData.feature_summary : null,
      regionTags: Array.isArray(regionData?.feature_tags) ? regionData.feature_tags : [],
      sceneTags: Array.isArray(scopeData?.scene_tags) ? scopeData.scene_tags.map((item) => String(item)) : [],
      dominantBuckets: Array.isArray(scopeData?.dominant_buckets) ? scopeData.dominant_buckets.map((item) => String(item)) : [],
      scopeData,
    }
  }
}
