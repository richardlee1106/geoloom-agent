/**
 * POI Embedding 缓存 + 语义重排序
 *
 * 策略：PostGIS 返回 POI 行后，按需计算 embedding 并缓存到数据库。
 * 查询时 embed 用户 query → 和 POI embedding 做 cosine → 语义重排序。
 *
 * 优势：
 * - 不需要全量预计算（Jina 免费版限流太严）
 * - 只对被查询到的 POI（通常 10-50 条）计算 embedding
 * - 缓存到 pois.embedding 列，后续查询直接命中
 * - 逐步积累覆盖率
 */

import type { EmbedRerankBridge } from '../integration/jinaBridge.js'
import type { QueryResultLike } from '../integration/postgisPool.js'

export interface PoiEmbeddingCacheOptions {
  bridge: EmbedRerankBridge
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>
}

/** POI 行（从 PostGIS 返回的原始行） */
export interface PoiRow {
  id: number | string
  name: string
  category_main?: string
  category_sub?: string
  location_hint?: string
  [key: string]: unknown
}

/** 语义重排序结果 */
export interface SemanticRankResult {
  /** 重排序后的行（附加了 semanticScore） */
  rows: PoiRow[]
  /** 是否使用了语义排序（false = fallback 到原始距离排序） */
  usedSemanticRank: boolean
  /** 新缓存了多少条 POI embedding */
  newlyCached: number
  /** 总耗时 ms */
  latencyMs: number
}

// ── 工具函数 ──

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

/**
 * 为 POI 构造 embedding 文本（和预计算脚本保持一致）
 */
function buildPoiEmbeddingText(name: string, categoryMain?: string, categorySub?: string, locationHint?: string): string {
  const parts = [name || '']
  if (categoryMain) parts.push(categoryMain)
  if (categorySub && categorySub !== categoryMain) parts.push(categorySub)

  const synonymMap: Record<string, string[]> = {
    '住宿服务': ['酒店', '宾馆', '旅馆', '住宿', '旅店', '民宿'],
    '餐饮美食': ['餐厅', '餐馆', '美食', '吃饭', '小吃', '餐饮'],
    '购物服务': ['商场', '超市', '购物', '便利店', '商超'],
    '交通设施服务': ['地铁', '公交', '车站', '交通'],
    '体育休闲服务': ['健身', '运动', '体育馆', '休闲'],
    '医疗保健服务': ['医院', '诊所', '药店', '医疗'],
    '教育文化服务': ['学校', '培训', '教育', '图书馆'],
    '风景名胜': ['景点', '景区', '公园', '旅游'],
    '商务住宅': ['写字楼', '公寓', '商务', '住宅'],
    '生活服务': ['洗衣', '维修', '家政', '生活'],
  }
  const synonyms = synonymMap[categoryMain || '']
  if (synonyms) parts.push(...synonyms)
  if (locationHint) parts.push(locationHint)

  return parts.filter(Boolean).join(' ')
}

// ── 主类 ──

export class PoiEmbeddingCache {
  private readonly bridge: EmbedRerankBridge
  private readonly query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>

  constructor(options: PoiEmbeddingCacheOptions) {
    this.bridge = options.bridge
    this.query = options.query
  }

  /**
   * 对 PostGIS 返回的 POI 行做语义重排序。
   *
   * 流程：
   * 1. embed 用户 query（聚焦后的品类查询词）
   * 2. 检查哪些 POI 已有 embedding（从数据库读取）
   * 3. 对没有 embedding 的 POI 按需计算并写回数据库
   * 4. 所有 POI embedding 和 query embedding 做 cosine
   * 5. 融合距离分数 + 语义分数 → 重排序
   */
  async semanticRank(
    poiRows: PoiRow[],
    queryText: string,
    options?: {
      /** 语义权重（0-1，默认 0.5） */
      semanticWeight?: number
      /** 距离权重（0-1，默认 0.5） */
      distanceWeight?: number
      /** 最大距离（米），用于归一化距离分数 */
      maxDistanceM?: number
      /** 预计算的 query embedding（复用品类匹配阶段的向量，避免重复 API 调用） */
      queryVec?: number[]
    },
  ): Promise<SemanticRankResult> {
    const start = Date.now()
    const semanticWeight = options?.semanticWeight ?? 0.5
    const distanceWeight = options?.distanceWeight ?? 0.5
    const maxDist = options?.maxDistanceM ?? 3000

    if (poiRows.length === 0) {
      return { rows: [], usedSemanticRank: false, newlyCached: 0, latencyMs: Date.now() - start }
    }

    try {
      // 1. 使用预计算的 queryVec 或实时 embed
      let queryVec = options?.queryVec
      if (!queryVec) {
        const queryEmbed = await this.bridge.embed([queryText])
        queryVec = queryEmbed.embeddings[0]
      }
      if (!queryVec || queryVec.length === 0) {
        return { rows: poiRows, usedSemanticRank: false, newlyCached: 0, latencyMs: Date.now() - start }
      }

      // 2. 批量读取已有 embedding
      const poiIds = poiRows.map(r => r.id)
      const existingResult = await this.query(
        'SELECT id, embedding::text AS emb_text FROM pois WHERE id::text = ANY($1::text[]) AND embedding IS NOT NULL',
        [poiIds],
      )
      const existingMap = new Map<string, number[]>()
      for (const row of existingResult.rows) {
        try {
          existingMap.set(String(row.id), JSON.parse(row.emb_text as string))
        } catch { /* skip invalid */ }
      }

      // 3. 找出缺少 embedding 的 POI，按需计算
      const missingPois = poiRows.filter(r => !existingMap.has(String(r.id)))
      let newlyCached = 0

      if (missingPois.length > 0) {
        const texts = missingPois.map(r =>
          buildPoiEmbeddingText(r.name, r.category_main, r.category_sub, r.location_hint),
        )
        const embedResult = await this.bridge.embed(texts)

        // 写回数据库
        const ids: (number | string)[] = []
        const vecs: string[] = []
        for (let i = 0; i < missingPois.length; i++) {
          const vec = embedResult.embeddings[i]
          if (vec && vec.length > 0) {
            existingMap.set(String(missingPois[i].id), vec)
            ids.push(missingPois[i].id)
            vecs.push(JSON.stringify(vec))
          }
        }

        if (ids.length > 0) {
          try {
            await this.query(
              `UPDATE pois p
               SET embedding = v.vec::vector(512)
               FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS vec) v
               WHERE p.id::text = v.id`,
              [ids, vecs],
            )
            newlyCached = ids.length
          } catch (e) {
            // 写入失败不影响排序，只是下次还需要重新计算
            console.warn(`[PoiEmbeddingCache] 缓存写入失败: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }

      // 4. 计算 cosine 相似度 + 融合排序
      const scored = poiRows.map(row => {
        const poiVec = existingMap.get(String(row.id))
        const semanticScore = poiVec ? cosineSimilarity(queryVec, poiVec) : 0
        const distanceM = Number(row.distance_m) || maxDist
        const distanceScore = Math.max(0, 1 - distanceM / maxDist)  // 距离越近分数越高
        const fusionScore = semanticWeight * semanticScore + distanceWeight * distanceScore
        return { row, semanticScore, distanceScore, fusionScore }
      })

      scored.sort((a, b) => b.fusionScore - a.fusionScore)

      const rankedRows = scored.map(s => ({
        ...s.row,
        semanticScore: Math.round(s.semanticScore * 1000) / 1000,
        fusionScore: Math.round(s.fusionScore * 1000) / 1000,
      }))

      return {
        rows: rankedRows,
        usedSemanticRank: true,
        newlyCached,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      console.warn(`[PoiEmbeddingCache] 语义排序失败，fallback 到距离排序: ${err instanceof Error ? err.message : String(err)}`)
      return { rows: poiRows, usedSemanticRank: false, newlyCached: 0, latencyMs: Date.now() - start }
    }
  }
}
