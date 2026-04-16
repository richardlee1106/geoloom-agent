import {
  buildRegionSnapshotTokens,
  deriveRegionFeatureTags,
  summarizeRegionFeatures,
  vectorizeRegionSnapshotTokens,
} from '../evidence/areaInsight/regionSnapshot.js'
import {
  buildPoiProfileTokens,
  derivePoiFeatureTags,
  summarizePoiProfile,
  vectorizePoiProfileTokens,
} from '../evidence/areaInsight/poiProfile.js'
import type { PoiFeatureTag, PoiProfileInput, RegionFeatureTag, RegionSnapshotInput } from '../chat/types.js'
import { createDependencyStatus, type DependencyStatus } from './dependencyStatus.js'
import { requestJson } from './httpClient.js'

export interface EncodedTextResult {
  vector: number[]
  tokens: string[]
  dimension: number
}

export interface EncodedRegionResult extends EncodedTextResult {
  summary: string
  feature_tags: RegionFeatureTag[]
}

export interface EncodedPoiProfileResult extends EncodedTextResult {
  summary: string
  feature_tags: PoiFeatureTag[]
}

export interface DependencyStatusQueryOptions {
  probe?: boolean
}

export interface TownCellContextResult {
  context: Record<string, unknown>
  models_used: string[]
}

export interface TownCellSearchResult {
  anchor_cell_context: Record<string, unknown>
  cells: Array<Record<string, unknown>>
  model_route?: string | null
  models_used: string[]
  search_radius_m?: number | null
  per_cell_radius_m?: number | null
  support_bucket_distribution?: Array<Record<string, unknown>>
  dominant_buckets?: string[]
  scene_tags?: string[]
  cell_mix?: Array<Record<string, unknown>>
  macro_uncertainty?: Record<string, unknown>
}

export interface TownPoiCellBatchResult {
  anchor_cell_context: Record<string, unknown>
  results: Array<Record<string, unknown>>
  model_route?: string | null
  models_used: string[]
}

export interface PythonBridge {
  encodeText(text: string): Promise<EncodedTextResult>
  encodeRegionSnapshot(snapshot: RegionSnapshotInput): Promise<EncodedRegionResult>
  encodePoiProfile(profile: PoiProfileInput): Promise<EncodedPoiProfileResult>
  getCellContext(lon: number, lat: number): Promise<TownCellContextResult>
  searchNearbyCells(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    topK?: number
    maxDistanceM?: number | null
  }): Promise<TownCellSearchResult>
  batchPoiCellContext(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    pois: Array<Record<string, unknown>>
  }): Promise<TownPoiCellBatchResult>
  getStatus(options?: DependencyStatusQueryOptions): Promise<DependencyStatus>
}

function tokenize(text: string) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

const VOCABULARY = [
  '高校',
  '学生',
  '咖啡',
  '地铁',
  '交通',
  '商圈',
  '活跃',
  '夜间',
  '片区',
  '餐饮',
  '购物',
  '办公',
  '社区',
]

export class LocalPythonBridge implements PythonBridge {
  async encodeText(text: string): Promise<EncodedTextResult> {
    const tokens = tokenize(text)
    const vector = VOCABULARY.map((term) => tokens.some((token) => token.includes(term) || term.includes(token)) ? 1 : 0)
    return {
      vector,
      tokens,
      dimension: vector.length,
    }
  }

  async encodeRegionSnapshot(snapshot: RegionSnapshotInput): Promise<EncodedRegionResult> {
    const featureTags = deriveRegionFeatureTags(snapshot)
    const tokens = buildRegionSnapshotTokens(snapshot, featureTags)
    const vector = vectorizeRegionSnapshotTokens(tokens)

    return {
      vector,
      tokens,
      dimension: vector.length,
      summary: summarizeRegionFeatures(snapshot, featureTags),
      feature_tags: featureTags,
    }
  }

  async encodePoiProfile(profile: PoiProfileInput): Promise<EncodedPoiProfileResult> {
    const featureTags = derivePoiFeatureTags(profile)
    const tokens = buildPoiProfileTokens(featureTags)
    const vector = vectorizePoiProfileTokens(tokens)

    return {
      vector,
      tokens,
      dimension: vector.length,
      summary: summarizePoiProfile(profile, featureTags),
      feature_tags: featureTags,
    }
  }

  async getCellContext(lon: number, lat: number): Promise<TownCellContextResult> {
    return {
      context: {
        lon,
        lat,
        distance_m: 0,
      },
      models_used: ['local_fallback'],
    }
  }

  async searchNearbyCells(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    topK?: number
    maxDistanceM?: number | null
  }): Promise<TownCellSearchResult> {
    return {
      anchor_cell_context: {
        lon: input.anchorLon,
        lat: input.anchorLat,
        distance_m: 0,
      },
      cells: [],
      model_route: 'local_fallback',
      models_used: ['local_fallback'],
      search_radius_m: input.maxDistanceM ?? null,
      per_cell_radius_m: null,
      support_bucket_distribution: [],
      dominant_buckets: [],
      scene_tags: [],
      cell_mix: [],
      macro_uncertainty: {},
    }
  }

  async batchPoiCellContext(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    pois: Array<Record<string, unknown>>
  }): Promise<TownPoiCellBatchResult> {
    return {
      anchor_cell_context: {
        lon: input.anchorLon,
        lat: input.anchorLat,
        distance_m: 0,
      },
      results: input.pois.map((poi) => ({
        ...poi,
        cell_context: null,
      })),
      model_route: 'local_fallback',
      models_used: ['local_fallback'],
    }
  }

  async getStatus(): Promise<DependencyStatus> {
    return createDependencyStatus({
      name: 'spatial_encoder',
      ready: true,
      mode: 'local',
      degraded: true,
      reason: 'remote_unconfigured',
    })
  }
}

export interface RemoteFirstPythonBridgeOptions {
  baseUrl?: string
  encodePath?: string
  regionEncodePath?: string
  poiEncodePath?: string
  cellContextPath?: string
  cellSearchPath?: string
  batchCellContextPath?: string
  healthPath?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  fallback?: PythonBridge
}

export class RemoteFirstPythonBridge implements PythonBridge {
  private readonly baseUrl: string

  private readonly encodePath: string

  private readonly regionEncodePath: string

  private readonly poiEncodePath: string

  private readonly cellContextPath: string

  private readonly cellSearchPath: string

  private readonly batchCellContextPath: string

  private readonly healthPath: string

  private readonly timeoutMs: number

  private readonly fallback: PythonBridge

  private lastStatus: DependencyStatus

  constructor(private readonly options: RemoteFirstPythonBridgeOptions = {}) {
    this.baseUrl = String(
      this.options.baseUrl || process.env.SPATIAL_ENCODER_BASE_URL || '',
    ).trim()
    this.encodePath = String(
      this.options.encodePath || process.env.SPATIAL_ENCODER_ENCODE_PATH || '/encode-text',
    ).trim()
    this.regionEncodePath = String(
      this.options.regionEncodePath || process.env.SPATIAL_ENCODER_REGION_ENCODE_PATH || '/encode-region-snapshot',
    ).trim()
    this.poiEncodePath = String(
      this.options.poiEncodePath || process.env.SPATIAL_ENCODER_POI_ENCODE_PATH || '/encode-poi-profile',
    ).trim()
    this.cellContextPath = String(
      this.options.cellContextPath || process.env.SPATIAL_ENCODER_CELL_CONTEXT_PATH || '/cell/context',
    ).trim()
    this.cellSearchPath = String(
      this.options.cellSearchPath || process.env.SPATIAL_ENCODER_CELL_SEARCH_PATH || '/cell/search',
    ).trim()
    this.batchCellContextPath = String(
      this.options.batchCellContextPath || process.env.SPATIAL_ENCODER_BATCH_CELL_CONTEXT_PATH || '/cell/context/batch',
    ).trim()
    this.healthPath = String(
      this.options.healthPath || process.env.SPATIAL_ENCODER_HEALTH_PATH || '/health',
    ).trim()
    this.timeoutMs = Number(
      this.options.timeoutMs || process.env.SPATIAL_ENCODER_TIMEOUT_MS || '3000',
    )
    this.fallback = options.fallback || new LocalPythonBridge()
    this.lastStatus = this.baseUrl
      ? createDependencyStatus({
        name: 'spatial_encoder',
        ready: false,
        mode: 'remote',
        degraded: true,
        reason: 'awaiting_probe',
        target: this.baseUrl,
      })
      : createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'local',
        degraded: true,
        reason: 'remote_unconfigured',
      })
  }

  private buildSuccessStatus() {
    return createDependencyStatus({
      name: 'spatial_encoder',
      ready: true,
      mode: 'remote',
      degraded: false,
      target: this.baseUrl,
    })
  }

  private buildFailureStatus(error: unknown, path: string) {
    const message = error instanceof Error ? error.message : String(error)
    const isUnsupportedEndpoint = /remote_request_failed:404\b/u.test(message)

    return createDependencyStatus({
      name: 'spatial_encoder',
      ready: true,
      mode: 'fallback',
      degraded: true,
      reason: isUnsupportedEndpoint ? 'remote_endpoint_unavailable' : 'remote_request_failed',
      target: this.baseUrl,
      details: {
        message,
        path,
      },
    })
  }

  async encodeText(text: string): Promise<EncodedTextResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.encodeText(text)
    }

    try {
      const response = await requestJson<EncodedTextResult>({
        baseUrl: this.baseUrl,
        path: this.encodePath,
        method: 'POST',
        body: { text },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return response
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.encodePath)
      return this.fallback.encodeText(text)
    }
  }

  async encodeRegionSnapshot(snapshot: RegionSnapshotInput): Promise<EncodedRegionResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.encodeRegionSnapshot(snapshot)
    }

    try {
      const response = await requestJson<EncodedRegionResult & { featureTags?: RegionFeatureTag[] }>({
        baseUrl: this.baseUrl,
        path: this.regionEncodePath,
        method: 'POST',
        body: { snapshot },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return {
        ...response,
        feature_tags: Array.isArray(response.feature_tags)
          ? response.feature_tags
          : Array.isArray(response.featureTags)
            ? response.featureTags
            : [],
        summary: String(response.summary || '').trim(),
      }
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.regionEncodePath)
      return this.fallback.encodeRegionSnapshot(snapshot)
    }
  }

  async encodePoiProfile(profile: PoiProfileInput): Promise<EncodedPoiProfileResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.encodePoiProfile(profile)
    }

    try {
      const response = await requestJson<EncodedPoiProfileResult & { featureTags?: PoiFeatureTag[] }>({
        baseUrl: this.baseUrl,
        path: this.poiEncodePath,
        method: 'POST',
        body: { profile },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return {
        ...response,
        feature_tags: Array.isArray(response.feature_tags)
          ? response.feature_tags
          : Array.isArray(response.featureTags)
            ? response.featureTags
            : [],
        summary: String(response.summary || '').trim(),
      }
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.poiEncodePath)
      return this.fallback.encodePoiProfile(profile)
    }
  }

  async getCellContext(lon: number, lat: number): Promise<TownCellContextResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.getCellContext(lon, lat)
    }

    try {
      const response = await requestJson<TownCellContextResult>({
        baseUrl: this.baseUrl,
        path: this.cellContextPath,
        method: 'POST',
        body: { lon, lat },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return {
        context: response.context || {},
        models_used: Array.isArray(response.models_used) ? response.models_used : [],
      }
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.cellContextPath)
      return this.fallback.getCellContext(lon, lat)
    }
  }

  async searchNearbyCells(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    topK?: number
    maxDistanceM?: number | null
  }): Promise<TownCellSearchResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.searchNearbyCells(input)
    }

    try {
      const response = await requestJson<TownCellSearchResult>({
        baseUrl: this.baseUrl,
        path: this.cellSearchPath,
        method: 'POST',
        body: {
          anchor_lon: input.anchorLon,
          anchor_lat: input.anchorLat,
          user_query: input.userQuery || '',
          task_type: input.taskType || undefined,
          top_k: input.topK || 5,
          max_distance_m: input.maxDistanceM ?? undefined,
        },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return {
        anchor_cell_context: response.anchor_cell_context || {},
        cells: Array.isArray(response.cells) ? response.cells : [],
        model_route: response.model_route || null,
        models_used: Array.isArray(response.models_used) ? response.models_used : [],
        search_radius_m: Number.isFinite(Number(response.search_radius_m))
          ? Number(response.search_radius_m)
          : null,
        per_cell_radius_m: Number.isFinite(Number(response.per_cell_radius_m))
          ? Number(response.per_cell_radius_m)
          : null,
        support_bucket_distribution: Array.isArray(response.support_bucket_distribution)
          ? response.support_bucket_distribution
          : [],
        dominant_buckets: Array.isArray(response.dominant_buckets)
          ? response.dominant_buckets.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        scene_tags: Array.isArray(response.scene_tags)
          ? response.scene_tags.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        cell_mix: Array.isArray(response.cell_mix) ? response.cell_mix : [],
        macro_uncertainty: response.macro_uncertainty && typeof response.macro_uncertainty === 'object'
          ? response.macro_uncertainty
          : {},
      }
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.cellSearchPath)
      return this.fallback.searchNearbyCells(input)
    }
  }

  async batchPoiCellContext(input: {
    anchorLon: number
    anchorLat: number
    userQuery?: string
    taskType?: string | null
    pois: Array<Record<string, unknown>>
  }): Promise<TownPoiCellBatchResult> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.batchPoiCellContext(input)
    }

    try {
      const response = await requestJson<TownPoiCellBatchResult>({
        baseUrl: this.baseUrl,
        path: this.batchCellContextPath,
        method: 'POST',
        body: {
          anchor_lon: input.anchorLon,
          anchor_lat: input.anchorLat,
          user_query: input.userQuery || '',
          task_type: input.taskType || undefined,
          pois: input.pois,
        },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
      return {
        anchor_cell_context: response.anchor_cell_context || {},
        results: Array.isArray(response.results) ? response.results : [],
        model_route: response.model_route || null,
        models_used: Array.isArray(response.models_used) ? response.models_used : [],
      }
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.batchCellContextPath)
      return this.fallback.batchPoiCellContext(input)
    }
  }

  async getStatus(options: DependencyStatusQueryOptions = {}): Promise<DependencyStatus> {
    if (options.probe === false || !this.baseUrl) {
      return this.lastStatus
    }

    try {
      await requestJson({
        baseUrl: this.baseUrl,
        path: this.healthPath,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = this.buildSuccessStatus()
    } catch (error) {
      this.lastStatus = this.buildFailureStatus(error, this.healthPath)
    }

    return this.lastStatus
  }
}
