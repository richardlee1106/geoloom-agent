/**
 * Embedding + Reranker 推理网关
 * Embedding: OpenAI-compatible API (text-embedding-3-small, 512-dim)
 * Reranker:  远程 rerank API，不可用时降级到本地 Jaccard
 * API 不可用时自动降级到 LocalFallbackBridge（bigram Jaccard）
 */

import { createDependencyStatus, type DependencyStatus } from './dependencyStatus.js'

// ── 类型定义 ──

export interface EmbedResult {
  embeddings: number[][]
  dim: number
  count: number
  latency_ms?: number
}

export interface RerankScoreItem {
  index: number
  score: number
}

export interface RerankResult {
  scores: RerankScoreItem[]
  latency_ms?: number
}

/** Embedding + Reranker 统一接口 */
export interface EmbedRerankBridge {
  /** 批量文本 embedding */
  embed(texts: string[]): Promise<EmbedResult>
  /** pairwise reranker 打分 */
  rerank(pairs: Array<{ query: string; document: string }>): Promise<RerankResult>
  /** 健康检查 */
  getStatus(): Promise<DependencyStatus>
}

// ── 本地回退实现（无模型依赖，Jaccard 相似度） ──

/** 字符级 n-gram 集合 */
function charNgrams(text: string, n: number): Set<string> {
  const grams = new Set<string>()
  const t = text.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i <= t.length - n; i++) {
    grams.add(t.slice(i, i + n))
  }
  return grams
}

/** Jaccard 相似度 */
function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const item of a) {
    if (b.has(item)) inter++
  }
  return inter / (a.size + b.size - inter)
}

/** 本地简易 embedding（512 维对齐模型输出） */
function localEmbed(text: string): number[] {
  const DIM = 512
  const vec = new Float32Array(DIM)
  const g = text.replace(/\s+/g, '').toLowerCase()
  for (let i = 0; i < g.length - 1; i++) {
    const bigram = g.slice(i, i + 2)
    let h = 0
    for (let j = 0; j < bigram.length; j++) {
      h = ((h << 5) - h + bigram.charCodeAt(j)) | 0
    }
    const bucket = Math.abs(h) % DIM
    vec[bucket] += 1
  }
  // L2 归一化
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += vec[i] ** 2
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm
  }
  return Array.from(vec)
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export class LocalFallbackBridge implements EmbedRerankBridge {
  async embed(texts: string[]): Promise<EmbedResult> {
    return {
      embeddings: texts.map(localEmbed),
      dim: 512,
      count: texts.length,
    }
  }

  async rerank(pairs: Array<{ query: string; document: string }>): Promise<RerankResult> {
    // 本地回退：用 bigram Jaccard 相似度模拟 rerank
    // Jaccard ×2 对齐远程 Reranker 的 0-1 分数域
    const scores = pairs.map((pair, index) => {
      const qGrams = charNgrams(pair.query, 2)
      const dGrams = charNgrams(pair.document, 2)
      const sim = Math.min(jaccardSim(qGrams, dGrams) * 2.0, 1.0)
      return { index, score: round3(sim) }
    })
    scores.sort((a, b) => b.score - a.score)
    return { scores }
  }

  async getStatus(): Promise<DependencyStatus> {
    return createDependencyStatus({
      name: 'embed_api',
      ready: true,
      mode: 'fallback',
      degraded: true,
      reason: 'api_key_missing',
    })
  }
}

// ── 在线 Embedding API 实现 ──

export interface EmbedBridgeOptions {
  /** API 密钥 */
  apiKey?: string
  /** Embedding API 基础 URL */
  embedBaseUrl?: string
  /** Reranker API 基础 URL */
  rerankBaseUrl?: string
  /** Embedding 模型名 */
  embeddingModel?: string
  /** Reranker 模型名 */
  rerankerModel?: string
  /** 降级回退 */
  fallback?: EmbedRerankBridge
}

export class EmbedBridge implements EmbedRerankBridge {
  private readonly apiKey: string
  private readonly embedBaseUrl: string
  private readonly rerankBaseUrl: string
  private readonly embeddingModel: string
  private readonly rerankerModel: string
  private readonly fallback: EmbedRerankBridge
  private lastStatus: DependencyStatus

  constructor(options: EmbedBridgeOptions = {}) {
    this.apiKey = String(
      options.apiKey
      || process.env.EMBED_API_KEY
      || '',
    )
    this.embedBaseUrl = String(
      options.embedBaseUrl
      || process.env.EMBED_BASE_URL
      || 'https://www.hohy6.com/v1',
    )
    this.rerankBaseUrl = String(
      options.rerankBaseUrl
      || process.env.RERANK_URL
      || 'https://api.jina.ai/v1',
    )
    this.embeddingModel = String(
      options.embeddingModel
      || process.env.EMBEDDING_MODEL
      || 'text-embedding-3-small',
    )
    this.rerankerModel = String(
      options.rerankerModel
      || process.env.RERANKER_MODEL
      || 'jina-reranker-v3',
    )
    this.fallback = options.fallback || new LocalFallbackBridge()
    this.lastStatus = createDependencyStatus({
      name: 'embed_api',
      ready: false,
      mode: 'remote',
      degraded: true,
      reason: 'awaiting_health_check',
      target: this.embedBaseUrl,
    })
    console.log(`[EmbedBridge] Embedding: ${this.embedBaseUrl}/embeddings (${this.embeddingModel})`)
    console.log(`[EmbedBridge] Reranker:  ${this.rerankBaseUrl}/rerank (${this.rerankerModel})`)
    console.log(`[EmbedBridge] API Key:   ${this.apiKey ? '已配置' : '⚠️ 未配置，将降级到本地回退'}`)
  }

  /** 健康探测：用 embed 单条文本测试 API 可达性 */
  private async checkHealth(): Promise<boolean> {
    if (!this.apiKey) return false
    try {
      const res = await fetch(`${this.embedBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: ['health_check'],
          dimensions: 512,
        }),
        signal: AbortSignal.timeout(10000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const start = Date.now()
    try {
      if (!this.apiKey) throw new Error('EMBED_API_KEY 未配置')

      const res = await fetch(`${this.embedBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: texts,
          dimensions: 512,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`embed API ${res.status}: ${err.slice(0, 300)}`)
      }
      const data = await res.json() as {
        data: Array<{ embedding: number[]; index: number }>
        model: string
      }
      // 按 index 排序确保顺序正确
      const sorted = data.data.sort((a, b) => a.index - b.index)
      const embeddings = sorted.map(d => d.embedding)
      const dim = embeddings[0]?.length ?? 0

      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.embedBaseUrl,
      })

      return {
        embeddings,
        dim,
        count: texts.length,
        latency_ms: Date.now() - start,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[EmbedBridge] embed 失败: ${msg}，降级到本地回退`)
      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'api_unavailable',
        target: this.embedBaseUrl,
        details: { message: msg },
      })
      return this.fallback.embed(texts)
    }
  }

  async rerank(pairs: Array<{ query: string; document: string }>): Promise<RerankResult> {
    const start = Date.now()
    try {
      if (!this.apiKey) throw new Error('EMBED_API_KEY 未配置')

      // rerank API：按 query 分组调用
      const queryGroups = new Map<string, Array<{ document: string; originalIndex: number }>>()
      for (let i = 0; i < pairs.length; i++) {
        const { query, document } = pairs[i]
        if (!queryGroups.has(query)) {
          queryGroups.set(query, [])
        }
        queryGroups.get(query)!.push({ document, originalIndex: i })
      }

      const scores: RerankScoreItem[] = []

      for (const [query, items] of queryGroups) {
        const documents = items.map(item => item.document)

        const res = await fetch(`${this.rerankBaseUrl}/rerank`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.rerankerModel,
            query,
            documents,
            top_n: documents.length,
          }),
          signal: AbortSignal.timeout(30000),
        })

        if (!res.ok) {
          const err = await res.text()
          throw new Error(`rerank API ${res.status}: ${err.slice(0, 300)}`)
        }

        const data = await res.json() as {
          results: Array<{ index: number; relevance_score: number }>
        }

        // API 返回的 index 是 documents 数组的 0-based 索引
        for (const r of data.results) {
          if (r.index >= 0 && r.index < items.length) {
            scores.push({
              index: items[r.index].originalIndex,
              score: round3(Math.min(Math.max(r.relevance_score, 0), 1)),
            })
          }
        }
      }

      scores.sort((a, b) => b.score - a.score)

      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.rerankBaseUrl,
      })

      return {
        scores,
        latency_ms: Date.now() - start,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[EmbedBridge] rerank 失败: ${msg}，降级到本地回退`)
      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: 'api_unavailable',
        target: this.rerankBaseUrl,
        details: { message: msg },
      })
      return this.fallback.rerank(pairs)
    }
  }

  async getStatus(): Promise<DependencyStatus> {
    const healthy = await this.checkHealth()
    if (healthy) {
      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'remote',
        degraded: false,
        target: this.embedBaseUrl,
      })
    } else {
      this.lastStatus = createDependencyStatus({
        name: 'embed_api',
        ready: true,
        mode: 'fallback',
        degraded: true,
        reason: this.apiKey ? 'api_unavailable' : 'api_key_missing',
        target: this.embedBaseUrl,
      })
    }
    return this.lastStatus
  }
}
