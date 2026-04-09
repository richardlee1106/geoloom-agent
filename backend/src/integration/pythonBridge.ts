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

export interface PythonBridge {
  encodeText(text: string): Promise<EncodedTextResult>
  encodeRegionSnapshot(snapshot: RegionSnapshotInput): Promise<EncodedRegionResult>
  encodePoiProfile(profile: PoiProfileInput): Promise<EncodedPoiProfileResult>
  getStatus(): Promise<DependencyStatus>
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
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
      return response
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
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
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
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
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
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
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
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
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return this.fallback.encodePoiProfile(profile)
    }
  }

  async getStatus(): Promise<DependencyStatus> {
    if (!this.baseUrl) {
      return this.lastStatus
    }

    try {
      await requestJson({
        baseUrl: this.baseUrl,
        path: this.healthPath,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'spatial_encoder',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }

    return this.lastStatus
  }
}
