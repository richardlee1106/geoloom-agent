import { createDependencyStatus, type DependencyStatus } from './dependencyStatus.js'
import { requestJson } from './httpClient.js'

export interface SemanticPoiCandidate {
  id: string
  name: string
  category: string
  score: number
  tags?: string[]
}

export interface SimilarRegionCandidate {
  id: string
  name: string
  summary: string
  score: number
  tags?: string[]
}

export interface FaissIndex {
  searchSemanticPOIs(text: string, topK?: number): Promise<SemanticPoiCandidate[]>
  searchSimilarRegions(text: string, topK?: number): Promise<SimilarRegionCandidate[]>
  getStatus(): Promise<DependencyStatus>
}

const REGION_CATALOG = [
  {
    id: 'region_wuda',
    name: '街道口-武大商圈',
    summary: '高校密集、咖啡和夜间活跃度较高',
    tags: ['高校', '学生', '咖啡', '活跃', '夜间'],
  },
  {
    id: 'region_huazhong',
    name: '光谷青年社区',
    summary: '年轻人消费活跃，咖啡与轻餐饮集中',
    tags: ['学生', '年轻', '咖啡', '交通'],
  },
  {
    id: 'region_warehouse',
    name: '远郊物流仓储片区',
    summary: '以仓储和办公为主，生活配套较弱',
    tags: ['仓储', '办公'],
  },
]

const POI_CATALOG = [
  {
    id: 'poi_semantic_001',
    name: '校园咖啡实验室',
    category: '咖啡',
    scoreBase: 0.88,
    tags: ['学生', '咖啡', '高校'],
  },
  {
    id: 'poi_semantic_002',
    name: '地铁口轻食咖啡',
    category: '咖啡',
    scoreBase: 0.81,
    tags: ['交通', '咖啡'],
  },
  {
    id: 'poi_semantic_003',
    name: '社区便利咖啡馆',
    category: '咖啡',
    scoreBase: 0.74,
    tags: ['社区', '咖啡'],
  },
]

function overlapScore(text: string, tags: string[]) {
  const query = String(text || '')
  const hits = tags.filter((tag) => query.includes(tag)).length
  return hits / Math.max(tags.length, 1)
}

export class LocalFaissIndex implements FaissIndex {
  async searchSemanticPOIs(text: string, topK = 5): Promise<SemanticPoiCandidate[]> {
    return POI_CATALOG
      .map((item) => ({
        ...item,
        score: Number((item.scoreBase + overlapScore(text, item.tags) * 0.12).toFixed(3)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async searchSimilarRegions(text: string, topK = 5): Promise<SimilarRegionCandidate[]> {
    return REGION_CATALOG
      .map((item) => ({
        ...item,
        score: Number((0.55 + overlapScore(text, item.tags) * 0.45).toFixed(3)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async getStatus(): Promise<DependencyStatus> {
    return createDependencyStatus({
      name: 'spatial_vector',
      ready: true,
      mode: 'local',
      degraded: true,
      reason: 'remote_unconfigured',
    })
  }
}

export interface RemoteFirstFaissIndexOptions {
  baseUrl?: string
  semanticPoiPath?: string
  similarRegionPath?: string
  healthPath?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  fallback?: FaissIndex
}

export class RemoteFirstFaissIndex implements FaissIndex {
  private readonly baseUrl: string

  private readonly semanticPoiPath: string

  private readonly similarRegionPath: string

  private readonly healthPath: string

  private readonly timeoutMs: number

  private readonly fallback: FaissIndex

  private lastStatus: DependencyStatus

  constructor(private readonly options: RemoteFirstFaissIndexOptions = {}) {
    this.baseUrl = String(
      this.options.baseUrl || process.env.SPATIAL_VECTOR_BASE_URL || '',
    ).trim()
    this.semanticPoiPath = String(
      this.options.semanticPoiPath || process.env.SPATIAL_VECTOR_POI_PATH || '/search/semantic-pois',
    ).trim()
    this.similarRegionPath = String(
      this.options.similarRegionPath || process.env.SPATIAL_VECTOR_REGION_PATH || '/search/similar-regions',
    ).trim()
    this.healthPath = String(
      this.options.healthPath || process.env.SPATIAL_VECTOR_HEALTH_PATH || '/health',
    ).trim()
    this.timeoutMs = Number(
      this.options.timeoutMs || process.env.SPATIAL_VECTOR_TIMEOUT_MS || '3000',
    )
    this.fallback = options.fallback || new LocalFaissIndex()
    this.lastStatus = this.baseUrl
      ? createDependencyStatus({
        name: 'spatial_vector',
        ready: false,
        mode: 'remote',
        degraded: true,
        reason: 'awaiting_probe',
        target: this.baseUrl,
      })
      : createDependencyStatus({
        name: 'spatial_vector',
        ready: true,
        mode: 'local',
        degraded: true,
        reason: 'remote_unconfigured',
      })
  }

  async searchSemanticPOIs(text: string, topK = 5): Promise<SemanticPoiCandidate[]> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.searchSemanticPOIs(text, topK)
    }

    try {
      const response = await requestJson<{ candidates: SemanticPoiCandidate[] }>({
        baseUrl: this.baseUrl,
        path: this.semanticPoiPath,
        method: 'POST',
        body: { text, top_k: topK },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = createDependencyStatus({
        name: 'spatial_vector',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
      return response.candidates || []
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'spatial_vector',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return this.fallback.searchSemanticPOIs(text, topK)
    }
  }

  async searchSimilarRegions(text: string, topK = 5): Promise<SimilarRegionCandidate[]> {
    if (!this.baseUrl) {
      this.lastStatus = await this.fallback.getStatus()
      return this.fallback.searchSimilarRegions(text, topK)
    }

    try {
      const response = await requestJson<{ regions: SimilarRegionCandidate[] }>({
        baseUrl: this.baseUrl,
        path: this.similarRegionPath,
        method: 'POST',
        body: { text, top_k: topK },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.options.fetchImpl,
      })
      this.lastStatus = createDependencyStatus({
        name: 'spatial_vector',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
      return response.regions || []
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'spatial_vector',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'remote_request_failed',
        target: this.baseUrl,
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return this.fallback.searchSimilarRegions(text, topK)
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
        name: 'spatial_vector',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.baseUrl,
      })
    } catch (error) {
      this.lastStatus = createDependencyStatus({
        name: 'spatial_vector',
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
