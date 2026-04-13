/**
 * Embedding-First 意图分类器
 *
 * 用原型质心 cosine 分类替代 LLM 调用来判断 queryType 和 needsWebSearch。
 * 1 次 embed 调用（~100ms）替代 LLM（3-9s），快 30-80 倍。
 *
 * 原理：
 * - 为每种 queryType 预定义 2-3 条原型文本
 * - embed 原型文本 → 质心向量（启动时计算）
 * - 查询时 embed rawQuery → 和各质心做 cosine → 最高分即为 queryType
 * - needsWebSearch：正例/反例原型 → sigmoid 映射
 */

import type { EmbedRerankBridge } from '../integration/jinaBridge.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'

// ── 类型 ──

export type QueryType = 'nearby_poi' | 'area_overview' | 'nearest_station' | 'compare_places' | 'unsupported'

export interface EmbeddingIntentResult {
  queryType: QueryType
  /** 分类置信度 0-1 */
  confidence: number
  /** 是否需要联网搜索 */
  needsWebSearch: boolean
  /** needsWebSearch 置信度 0-1 */
  webSearchConfidence: number
  /** 分类耗时 ms */
  latencyMs: number
  /** 是否使用了 embedding 分类（false = fallback） */
  usedEmbedding: boolean
}

// ── 原型文本 ──

const QUERY_TYPE_PROTOTYPES: Record<QueryType, string[]> = {
  nearby_poi: [
    '附近有什么好吃的餐厅',
    '这附近高分推荐的酒店',
    '光谷有什么咖啡店',
    '武汉大学周边的美食推荐',
    '江汉路附近有什么商场',
    '附近有什么好玩的地方',
    '这附近有健身房吗',
    '周边有什么超市',
    '高分推荐的酒店',
    '好吃的餐厅推荐',
    '口碑好的咖啡店',
    '附近有什么药店',
    '这附近有银行吗',
    '周边有什么医院',
    '附近有什么公园',
    '这附近有停车场吗',
  ],
  area_overview: [
    '光谷这个区域怎么样',
    '江汉路是什么样的一片区域',
    '介绍一下洪山区',
    '这个片区适合居住吗',
    '这片区域有什么特点',
    '这个区域生活方便吗',
  ],
  nearest_station: [
    '最近的地铁站在哪',
    '离我最近的地铁站',
    '附近有没有地铁站',
    '最近的公交站',
    '最近的火车站怎么走',
  ],
  compare_places: [
    '光谷和江汉路哪个更适合逛街',
    '这两个区域哪个好',
    'A和B哪个更方便',
    '比较一下这两个地方',
  ],
  unsupported: [
    '今天天气怎么样',
    '帮我写一首诗',
    '什么是量子力学',
    '你好',
  ],
}

const WEB_SEARCH_POSITIVE: string[] = [
  '高分推荐的酒店',
  '好吃的餐厅推荐',
  '口碑好的咖啡店',
  '评价最高的商场',
  '排名前十的美食',
  '最新开业的餐厅',
  '网红打卡地',
  '人均消费',
  '营业时间',
  '特色推荐',
  '必吃榜单',
  '人气最旺的',
]

const WEB_SEARCH_NEGATIVE: string[] = [
  '附近有什么餐厅',
  '这附近有酒店吗',
  '最近的地铁站',
  '光谷有什么咖啡店',
  '介绍一下这个区域',
  '周边有什么超市',
  '这个片区怎么样',
  '附近有没有健身房',
]

// ── 工具 ──

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

/** sigmoid 映射 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

// ── 主类 ──

export class EmbeddingIntentClassifier {
  private readonly bridge: EmbedRerankBridge
  private ready = false

  /** 各 queryType 的质心向量 */
  private centroids = new Map<QueryType, number[]>()

  /** needsWebSearch 正例质心 */
  private webSearchPositiveCentroid: number[] | null = null
  /** needsWebSearch 反例质心 */
  private webSearchNegativeCentroid: number[] | null = null

  constructor(bridge: EmbedRerankBridge) {
    this.bridge = bridge
  }

  get isReady(): boolean {
    return this.ready
  }

  /**
   * 启动时预计算原型质心（带文件缓存）
   */
  async build(): Promise<void> {
    // 缓存文件路径（和 CategoryEmbeddingIndex 同目录）
    const dataDir = resolveResourceUrl(import.meta.url, ['../../data/memory/', '../data/memory/'])
    const cachePath = join(fileURLToPath(dataDir), 'intent-centroids.json')

    // 尝试从缓存加载
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
      if (cached.version === 2 && cached.centroids && cached.webPos && cached.webNeg) {
        for (const [type, vec] of Object.entries(cached.centroids) as [QueryType, number[]][]) {
          this.centroids.set(type, vec)
        }
        this.webSearchPositiveCentroid = cached.webPos
        this.webSearchNegativeCentroid = cached.webNeg
        this.ready = true
        console.log(`[EmbeddingIntentClassifier] 从缓存加载质心 (${this.centroids.size} 类)`)
        return
      }
    } catch { /* 缓存不存在或格式错误，重新计算 */ }

    // 重新计算
    const allTexts: string[] = []
    const typeMap: Array<{ type: QueryType; startIdx: number; count: number }> = []
    let idx = 0

    for (const [type, prototypes] of Object.entries(QUERY_TYPE_PROTOTYPES) as [QueryType, string[]][]) {
      typeMap.push({ type, startIdx: idx, count: prototypes.length })
      allTexts.push(...prototypes)
      idx += prototypes.length
    }

    // web search 原型
    const webPosStart = idx
    allTexts.push(...WEB_SEARCH_POSITIVE)
    const webPosCount = WEB_SEARCH_POSITIVE.length
    idx += webPosCount

    const webNegStart = idx
    allTexts.push(...WEB_SEARCH_NEGATIVE)
    const webNegCount = WEB_SEARCH_NEGATIVE.length

    // 一次性 embed 所有原型
    const result = await this.bridge.embed(allTexts)

    // 计算各 queryType 质心
    for (const { type, startIdx, count } of typeMap) {
      const vecs = result.embeddings.slice(startIdx, startIdx + count)
      const centroid = this.computeCentroid(vecs)
      this.centroids.set(type, centroid)
    }

    // 计算 web search 正例/反例质心
    this.webSearchPositiveCentroid = this.computeCentroid(
      result.embeddings.slice(webPosStart, webPosStart + webPosCount),
    )
    this.webSearchNegativeCentroid = this.computeCentroid(
      result.embeddings.slice(webNegStart, webNegStart + webNegCount),
    )

    // 写入缓存
    try {
      const cacheData = {
        version: 2,
        centroids: Object.fromEntries(this.centroids) as Record<string, number[]>,
        webPos: this.webSearchPositiveCentroid,
        webNeg: this.webSearchNegativeCentroid,
      }
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileSync(cachePath, JSON.stringify(cacheData))
    } catch (e) {
      console.warn(`[EmbeddingIntentClassifier] 缓存写入失败: ${e instanceof Error ? e.message : String(e)}`)
    }

    this.ready = true
    console.log(`[EmbeddingIntentClassifier] 原型质心预计算完成 (${allTexts.length} 条原型)`)
  }

  private computeCentroid(vecs: number[][]): number[] {
    if (vecs.length === 0) return []
    const dim = vecs[0].length
    const centroid = new Float64Array(dim)
    for (const vec of vecs) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += vec[i]
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= vecs.length
    }
    // L2 归一化
    let norm = 0
    for (let i = 0; i < dim; i++) norm += centroid[i] ** 2
    norm = Math.sqrt(norm)
    if (norm > 0) {
      for (let i = 0; i < dim; i++) centroid[i] /= norm
    }
    return Array.from(centroid)
  }

  /**
   * 分类 rawQuery → queryType + needsWebSearch
   * 如果传入预计算的 queryVec，省掉 1 次 embed 调用
   */
  async classify(rawQuery: string, queryVec?: number[]): Promise<EmbeddingIntentResult> {
    const start = Date.now()

    if (!this.ready) {
      return {
        queryType: 'nearby_poi',
        confidence: 0,
        needsWebSearch: false,
        webSearchConfidence: 0,
        latencyMs: Date.now() - start,
        usedEmbedding: false,
      }
    }

    try {
      // 使用预计算的 queryVec 或实时 embed
      let vec = queryVec
      if (!vec) {
        const embResult = await this.bridge.embed([rawQuery])
        vec = embResult.embeddings[0]
      }
      if (!vec || vec.length === 0) {

        return {
          queryType: 'nearby_poi',
          confidence: 0,
          needsWebSearch: false,
          webSearchConfidence: 0,
          latencyMs: Date.now() - start,
          usedEmbedding: false,
        }
      }

      // queryType 分类：和各质心做 cosine
      let bestType: QueryType = 'nearby_poi'
      let bestScore = -1
      for (const [type, centroid] of this.centroids) {
        const sim = cosineSimilarity(vec, centroid)
        if (sim > bestScore) {
          bestScore = sim
          bestType = type
        }
      }

      // needsWebSearch：正例/反例质心 → sigmoid
      let webSearchConfidence = 0
      let needsWebSearch = false
      if (this.webSearchPositiveCentroid && this.webSearchNegativeCentroid) {
        const posSim = cosineSimilarity(vec, this.webSearchPositiveCentroid)
        const negSim = cosineSimilarity(vec, this.webSearchNegativeCentroid)
        // 正例比反例高多少 → sigmoid 映射到 0-1
        const diff = (posSim - negSim) * 20  // 放大差异，cosine 差 0.05→sigmoid 0.73，差 0.15→0.97
        webSearchConfidence = Math.round(sigmoid(diff) * 1000) / 1000
        needsWebSearch = webSearchConfidence >= 0.5
      }

      return {
        queryType: bestType,
        confidence: Math.round(bestScore * 1000) / 1000,
        needsWebSearch,
        webSearchConfidence,
        latencyMs: Date.now() - start,
        usedEmbedding: true,
      }
    } catch {
      return {
        queryType: 'nearby_poi',
        confidence: 0,
        needsWebSearch: false,
        webSearchConfidence: 0,
        latencyMs: Date.now() - start,
        usedEmbedding: false,
      }
    }
  }
}
