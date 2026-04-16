import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

import type { ChatRuntime } from '../app.js'
import { buildAreaOverviewView } from '../evidence/views/AreaOverviewView.js'
import {
  buildRegionSnapshotFromEvidence,
  deriveRegionFeatureTags,
  summarizeRegionFeatures,
} from '../evidence/areaInsight/regionSnapshot.js'
import { createSkillExecutionContext } from '../skills/SkillContext.js'
import type { SkillDefinition, SkillExecutionContext, SkillExecutionResult } from '../skills/types.js'
import type {
  ChatRequestV4,
  DeterministicIntent,
  EvidenceItem,
  RegionSnapshotInput,
  ResolvedAnchor,
} from '../chat/types.js'
import { SSEWriter } from '../chat/SSEWriter.js'
import type { SkillRegistry } from '../skills/SkillRegistry.js'
import { createLogger } from '../utils/logger.js'
import {
  buildNarrativeAnswer,
  buildNarrativeCandidates,
  buildNarrativeSteps,
  buildNarrativeTransitions,
  buildNarrativeViewportSummary,
  rankNarrativeNodes,
} from './planner.js'
import {
  buildNarrativeAreaTemplateSql,
  buildViewportBoundary,
  buildViewportCenter,
  buildViewportDiagonalM,
} from './postgisTemplateBuilder.js'
import type { NarrativeSurface, NarrativeViewport } from './types.js'

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

export class NarrativeRuntime implements ChatRuntime {
  constructor(private readonly options: {
    registry: SkillRegistry
    version: string
  }) {}

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

    const candidates = buildNarrativeCandidates({
      representativeSamples: areaView.representativeSamples || [],
      aoiContext: areaEvidence.aoiContext,
    })
    const viewportSummary = buildNarrativeViewportSummary({
      featureTags: derivedFeatureTags,
      featureSummary: derivedFeatureSummary,
      encoderSummary: encoderPayload.regionSummary,
      encoderTags: encoderPayload.regionTags,
      encoderSceneTags: encoderPayload.sceneTags,
      encoderDominantBuckets: encoderPayload.dominantBuckets,
      candidates,
    })

    await writer.reasoning({
      content: viewportSummary.summarySentence,
    })

    await writer.stage('node_candidates')
    await writer.thinking({
      status: 'start',
      message: '正在挑选候选解说节点...',
    })

    const rankResult = rankNarrativeNodes(
      candidates,
      viewportSummary,
      buildViewportDiagonalM(viewport) >= 12000 ? 6 : 5,
    )
    const selectedNodes = rankResult.selectedNodes
    const transitions = buildNarrativeTransitions(selectedNodes)
    const narrativeSteps = buildNarrativeSteps({
      summary: viewportSummary,
      nodes: selectedNodes,
      transitions,
    })
    const answer = buildNarrativeAnswer({
      summary: viewportSummary,
      nodes: selectedNodes,
      transitions,
      narrativeMode: rankResult.narrativeMode,
    })

    await writer.pois(normalizePoiPreview(selectedNodes.map((node) => ({
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
      result_count: selectedNodes.length,
      candidate_count: candidates.length,
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
          candidates,
          selected_nodes: selectedNodes,
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
    const postgis = this.requireSkill('postgis')
    const [categoryHistogram, representativeSamples, hotspots, aoiContext, landuseContext] = await Promise.all([
      this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_category_histogram', viewport, center, limit: 8 }),
      }, context),
      this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_representative_sample', viewport, center, limit: 18 }),
      }, context),
      this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_h3_hotspots', viewport, center, limit: 5 }),
      }, context),
      this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_aoi_context', viewport, center, limit: 6 }),
      }, context),
      this.executeSkill<{ rows: Record<string, unknown>[] }>(postgis, 'execute_spatial_sql', {
        sql: buildNarrativeAreaTemplateSql({ templateName: 'area_landuse_context', viewport, center, limit: 6 }),
      }, context),
    ])

    return {
      categoryHistogram: Array.isArray(categoryHistogram.rows) ? categoryHistogram.rows : [],
      representativeSamples: Array.isArray(representativeSamples.rows) ? representativeSamples.rows : [],
      hotspots: Array.isArray(hotspots.rows) ? hotspots.rows : [],
      aoiContext: Array.isArray(aoiContext.rows) ? aoiContext.rows : [],
      landuseContext: Array.isArray(landuseContext.rows) ? landuseContext.rows : [],
    }
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
    }
  }
}
