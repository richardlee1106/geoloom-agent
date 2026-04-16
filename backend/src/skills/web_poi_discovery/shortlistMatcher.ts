/**
 * ShortlistMatcher — DB-first shortlist 匹配
 *
 * 策略：
 * 1. 按scope+category从本地DB召回权威候选 shortlist
 * 2. mention 先走 lexical gate (精确/前缀/ILIKE)
 * 3. 未命中走 vector recall (embedding 余弦相似度)
 * 4. 最后用 reranker 做消歧
 *
 * 全程只在 shortlist 内匹配，不做全库开放式召回。
 */

import type { SceneProfile, ShortlistPoi, MentionMatch, DiscoveryScopeInput } from './types.js'
import type { NormalizedMentionGroup } from './mentionNormalizer.js'
import type { EmbedRerankBridge } from '../../integration/jinaBridge.js'
import { LocalFallbackBridge } from '../../integration/jinaBridge.js'
import { isAcceptableDbRow } from './sceneProfile.js'

export interface DbQueryFn {
  (sql: string, params?: unknown[], timeoutMs?: number): Promise<{
    rows: Record<string, unknown>[]
    rowCount: number
  }>
}

export interface ShortlistMatcherOptions {
  query: DbQueryFn
  bridge: EmbedRerankBridge
}

/** Lexical gate 匹配阈值 */
const EXACT_THRESHOLD = 1.0
const PREFIX_THRESHOLD = 0.85
const CONTAINS_THRESHOLD = 0.7
/** ILIKE 粗对齐阈值 */
const ILIKE_THRESHOLD = 0.6
/** Vector recall 阈值 */
const VECTOR_THRESHOLD = 0.55
/** Rerank 阈值 */
const RERANK_THRESHOLD = 0.4

/** shortlist 最大召回数 */
const MAX_SHORTLIST_SIZE = 200

export class ShortlistMatcher {
  private readonly dbQuery: DbQueryFn
  private readonly bridge: EmbedRerankBridge

  constructor(options: ShortlistMatcherOptions) {
    this.dbQuery = options.query
    this.bridge = options.bridge
  }

  /**
   * 从本地 DB 召回权威 shortlist
   *
   * @param profile 场景画像
   * @param districts 目标区域
   * @param maxCount 最大数量
   */
  async recallShortlist(
    profile: SceneProfile,
    scope: DiscoveryScopeInput = {},
    maxCount = MAX_SHORTLIST_SIZE,
  ): Promise<ShortlistPoi[]> {
    const params: unknown[] = []
    const conditions: string[] = []
    const districts = Array.isArray(scope.districts) ? scope.districts : []
    const districtIds = Array.isArray(scope.districtIds)
      ? scope.districtIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
      : []
    const areaWkt = String(scope.areaWkt || '').trim()
    const anchorLon = Number(scope.anchorLon)
    const anchorLat = Number(scope.anchorLat)
    const radiusM = Number(scope.radiusM)

    // 品类过滤（必选）
    if (profile.dbCategoryMains.length > 0) {
      params.push(profile.dbCategoryMains)
      conditions.push(`category_main = ANY($${params.length}::text[])`)
    }

    // 子品类过滤（可选，精确缩小范围）
    // 逻辑：category_sub 匹配 OR 名字含品类关键词（弥补 DB 品类标注不准）
    if (profile.dbCategorySubs && profile.dbCategorySubs.length > 0) {
      params.push(profile.dbCategorySubs)
      const subMatch = `category_sub = ANY($${params.length}::text[])`
      // 名字含品类关键词的也纳入（如"柚子咖啡"被标为外国菜但名字含咖啡）
      const nameLikeParts = profile.dbCategorySubs
        .map((sub, i) => {
          params.push(`%${sub}%`)
          return `name ILIKE $${params.length}`
        })
        .join(' OR ')
      conditions.push(`(${subMatch} OR ${nameLikeParts})`)
    }

    // 名字排除模式：猫咖/狗咖不是咖啡店
    const nameExcludePatterns: string[] = []
    if (profile.dbCategorySubs?.includes('咖啡')) {
      nameExcludePatterns.push('猫咖', '狗咖')
    }
    if (nameExcludePatterns.length > 0) {
      const excludeParts = nameExcludePatterns.map(p => {
        params.push(`%${p}%`)
        return `name NOT ILIKE $${params.length}`
      })
      conditions.push(excludeParts.join(' AND '))
    }

    if (areaWkt) {
      params.push(areaWkt)
      conditions.push(`ST_Intersects(pois.geom, ST_GeomFromText($${params.length}::text, 4326))`)
    } else if (districtIds.length > 0) {
      params.push(districtIds)
      conditions.push(`EXISTS (
        SELECT 1
        FROM districts d
        WHERE d.id = ANY($${params.length}::int[])
          AND ST_Intersects(pois.geom, d.geom)
      )`)
    } else if (Number.isFinite(anchorLon) && Number.isFinite(anchorLat) && Number.isFinite(radiusM) && radiusM > 0) {
      params.push(anchorLon)
      const lonIndex = params.length
      params.push(anchorLat)
      const latIndex = params.length
      params.push(radiusM)
      conditions.push(`ST_DWithin(
        pois.geom::geography,
        ST_SetSRID(ST_MakePoint($${lonIndex}, $${latIndex}), 4326)::geography,
        $${params.length}
      )`)
    } else if (districts.length > 0) {
      const districtPatterns = districts.map((d) => `%${d.replace(/区$/, '')}%`)
      params.push(districtPatterns)
      conditions.push(`city ILIKE ANY($${params.length}::text[])`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // ORDER BY: 先按名称长度升序（短名 = 主店），再按 id 降序（新数据优先）
    params.push(maxCount)
    const sql = `
      SELECT id, name, category_main, category_sub, city, longitude, latitude,
             0 AS poi_score
      FROM pois
      ${whereClause}
      ORDER BY LENGTH(name) ASC, id DESC
      LIMIT $${params.length}
    `

    try {
      const result = await this.dbQuery(sql, params, 5000)
      return (result.rows || []).map((row) => ({
        id: row.id as number | string,
        name: String(row.name || ''),
        categoryMain: row.category_main as string | null,
        categorySub: row.category_sub as string | null,
        city: row.city as string | null,
        longitude: Number(row.longitude) || 0,
        latitude: Number(row.latitude) || 0,
        poiScore: Number(row.poi_score) || 0,
      }))
    } catch (err) {
      console.warn(`[ShortlistMatcher] shortlist 召回失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  /**
   * 将归一化后的 mention 组匹配到 shortlist
   *
   * @param mentionGroups 归一化后的 mention 组
   * @param shortlist 本地权威候选
   * @param profile 场景画像
   */
  async match(
    mentionGroups: NormalizedMentionGroup[],
    shortlist: ShortlistPoi[],
    profile: SceneProfile,
    scope?: DiscoveryScopeInput,
  ): Promise<MentionMatch[]> {
    const results: MentionMatch[] = []

    // 构建 shortlist 名称索引
    const nameIndex = new Map<string, ShortlistPoi>()
    for (const poi of shortlist) {
      nameIndex.set(poi.name, poi)
    }

    // 需要走 vector recall 的 mention
    const unmatchedGroups: Array<{ group: NormalizedMentionGroup; candidates: ShortlistPoi[] }> = []

    // Step 1: Lexical gate
    for (const group of mentionGroups) {
      const mentionName = group.canonicalName

      // 精确匹配
      const exactMatch = nameIndex.get(mentionName)
      if (exactMatch) {
        results.push(this.buildMatch(group, exactMatch, 'exact', EXACT_THRESHOLD))
        continue
      }

      // 前缀/包含匹配
      const lexicalMatches = this.lexicalSearch(mentionName, shortlist, profile)
      if (lexicalMatches.length > 0) {
        const best = lexicalMatches[0]
        results.push(this.buildMatch(group, best.poi, best.matchType, best.score))
        continue
      }

      // 原始名称也尝试匹配（归一化前可能有更完整的名称）
      let rawNameMatched = false
      for (const raw of group.rawMentions) {
        const rawName = raw.mention.trim()
        if (rawName === mentionName) continue
        const rawExact = nameIndex.get(rawName)
        if (rawExact) {
          results.push(this.buildMatch(group, rawExact, 'exact', EXACT_THRESHOLD))
          rawNameMatched = true
          break
        }
        const rawLexical = this.lexicalSearch(rawName, shortlist, profile)
        if (rawLexical.length > 0) {
          const best = rawLexical[0]
          results.push(this.buildMatch(group, best.poi, best.matchType, best.score))
          rawNameMatched = true
          break
        }
      }
      if (rawNameMatched) continue

      // 收集待做 vector recall 的
      unmatchedGroups.push({ group, candidates: shortlist })
    }

    // Step 1.5: ILIKE 粗对齐（对 lexical 未命中的，用 mention 核心词查 DB）
    if (unmatchedGroups.length > 0) {
      await this.ilikeRecall(unmatchedGroups, results, profile, scope)
    }

    // 重新收集仍未命中的
    const stillUnmatched = unmatchedGroups.filter(g =>
      !results.some(r => r.mention === g.group.canonicalName && r.poi !== null)
    )

    // Step 2: Vector recall（仅对 ILIKE 也未命中的）
    // 如果所有未命中 mention 的 count 都 <=1（噪声），跳过 vector recall
    const hasHighValueUnmatched = stillUnmatched.some(g => g.group.count > 1)
    if (stillUnmatched.length > 0 && this.bridge && hasHighValueUnmatched) {
      await this.vectorRecallAndRerank(stillUnmatched, results)
    }

    // 未匹配的 mention 标记为 web_only
    const matchedMentionNames = new Set(results.map((r) => r.mention))
    for (const group of mentionGroups) {
      if (!matchedMentionNames.has(group.canonicalName)) {
        results.push({
          mention: group.canonicalName,
          evidenceSpan: group.evidenceSpans[0] || '',
          url: [...group.urls][0] || '',
          confidence: group.maxConfidence,
          matchType: 'web_only',
          poi: null,
          matchScore: 0,
          mentionCount: group.count,
        })
      }
    }

    return results
  }

  private lexicalSearch(
    mentionName: string,
    shortlist: ShortlistPoi[],
    profile: SceneProfile,
  ): Array<{ poi: ShortlistPoi; matchType: MentionMatch['matchType']; score: number }> {
    const matches: Array<{ poi: ShortlistPoi; matchType: MentionMatch['matchType']; score: number }> = []

    for (const poi of shortlist) {
      const poiName = poi.name
      if (poiName === mentionName) {
        matches.push({ poi, matchType: 'exact', score: EXACT_THRESHOLD })
        continue
      }

      // 前缀匹配
      if (poiName.startsWith(mentionName) || mentionName.startsWith(poiName)) {
        const acceptable = isAcceptableDbRow(mentionName, poiName, profile)
        if (acceptable) {
          matches.push({ poi, matchType: 'prefix', score: PREFIX_THRESHOLD })
        }
        continue
      }

      // 包含匹配
      if (poiName.includes(mentionName) || mentionName.includes(poiName)) {
        const acceptable = isAcceptableDbRow(mentionName, poiName, profile)
        if (acceptable) {
          matches.push({ poi, matchType: 'contains', score: CONTAINS_THRESHOLD })
        }
      }
    }

    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, 3)
  }

  /**
   * ILIKE 粗对齐：对 lexical gate 未命中的 mention，用核心词直接查 DB
   * 例：mention="库迪咖啡" → DB ILIKE '%库迪%' 命中 "Cotti库迪咖啡(XX店)"
   */
  private async ilikeRecall(
    unmatchedGroups: Array<{ group: NormalizedMentionGroup; candidates: ShortlistPoi[] }>,
    results: MentionMatch[],
    profile: SceneProfile,
    scope?: DiscoveryScopeInput,
  ): Promise<void> {
    // 对每个未命中 mention，提取核心词做 ILIKE 查询
    for (const { group } of unmatchedGroups) {
      const mentionName = group.canonicalName
      // 提取核心词：去掉常见后缀，取 2-6 字的核心部分
      const coreWords = this.extractCoreWords(mentionName)
      if (coreWords.length === 0) continue

      try {
        // 构建 ILIKE 查询：name ILIKE '%核心词1%' OR name ILIKE '%核心词2%'
        const nameConds: string[] = []
        const params: unknown[] = []
        for (const word of coreWords) {
          params.push(`%${word}%`)
          nameConds.push(`name ILIKE $${params.length}`)
        }
        const catCond = profile.dbCategoryMains.length > 0
          ? `AND category_main = ANY($${params.length + 1}::text[])`
          : ''
        if (profile.dbCategoryMains.length > 0) {
          params.push(profile.dbCategoryMains)
        }
        // 空间约束
        let spatialCond = ''
        const anchorLon = Number(scope?.anchorLon)
        const anchorLat = Number(scope?.anchorLat)
        const radiusM = Number(scope?.radiusM)
        if (Number.isFinite(anchorLon) && Number.isFinite(anchorLat) && Number.isFinite(radiusM) && radiusM > 0) {
          params.push(anchorLon, anchorLat, radiusM * 2) // 扩大 2 倍范围
          spatialCond = `AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`
        }
        params.push(5) // 最多返回 5 条
        const sql = `SELECT id, name, category_main, category_sub, city, longitude, latitude, 0 AS poi_score
                     FROM pois WHERE (${nameConds.join(' OR ')}) ${catCond} ${spatialCond}
                     ORDER BY LENGTH(name) ASC LIMIT $${params.length}`

        const result = await this.dbQuery(sql, params, 3000)
        if (result.rows && result.rows.length > 0) {
          // 精对齐验证：ILIKE 命中后检查 mention 和 DB 名的语义相关性
          // 避免地名误匹配（如"楚河汉街"→"老汉口楚河汉街店"）
          const row = result.rows[0]
          const dbName = String(row.name || '')
          if (!this.isPlausibleMatch(mentionName, dbName)) {
            continue
          }
          const poi: ShortlistPoi = {
            id: row.id as number | string,
            name: String(row.name || ''),
            categoryMain: row.category_main as string | null,
            categorySub: row.category_sub as string | null,
            city: row.city as string | null,
            longitude: Number(row.longitude) || 0,
            latitude: Number(row.latitude) || 0,
            poiScore: 0,
          }
          results.push(this.buildMatch(group, poi, 'ilike', ILIKE_THRESHOLD))
        }
      } catch {
        // ILIKE 查询失败不影响主流程
      }
    }
  }

  /** 从 mention 名中提取核心搜索词 */
  private extractCoreWords(name: string): string[] {
    const words: string[] = []
    // 1. 整个名字（2-10字）
    if (name.length >= 2 && name.length <= 10) {
      words.push(name)
    }
    // 2. 去掉品类后缀后的核心名
    const suffixes = ['咖啡馆', '咖啡店', '咖啡厅', '咖啡', '奶茶店', '甜品店', '火锅店', '烧烤店', '餐厅', '饭店', '酒店', '宾馆']
    for (const suf of suffixes) {
      if (name.endsWith(suf) && name.length > suf.length + 1) {
        const core = name.slice(0, -suf.length)
        if (core.length >= 2) words.push(core)
      }
    }
    // 3. 英文名部分（如 "luckin" from "luckin coffee"）
    const engMatch = name.match(/^([a-zA-Z]{3,})/i)
    if (engMatch) words.push(engMatch[1])
    return [...new Set(words)]
  }

  /** ILIKE 精对齐：验证 mention 和 DB 名是否语义上指同一实体 */
  private isPlausibleMatch(mentionName: string, dbName: string): boolean {
    // 1. 精确匹配 → 必然合理
    if (mentionName === dbName) return true

    // 2. mention 是 DB 名的子串时，检查占比
    //    "楚河汉街"(4字) in "老汉口楚河汉街店"(8字) → 占比 50% → 偏低，可能是地名
    //    "库迪咖啡"(4字) in "Cotti库迪咖啡(光谷店)"(11字) → 占比 36% 但含品牌核心
    const shorter = mentionName.length < dbName.length ? mentionName : dbName
    const longer = mentionName.length < dbName.length ? dbName : mentionName
    const ratio = shorter.length / longer.length

    // 3. 如果 mention 包含品类关键词（咖啡/火锅/餐厅等），更可能是店名而非地名
    const categoryKeywords = ['咖啡', '奶茶', '火锅', '烧烤', '餐厅', '饭店', '酒店', '宾馆', '甜品', '蛋糕', '茶饮', '小吃']
    const mentionHasCategory = categoryKeywords.some(k => mentionName.includes(k))
    const dbHasCategory = categoryKeywords.some(k => dbName.includes(k))

    // 4. 如果两者都有品类词 → 高概率是同一类店
    if (mentionHasCategory && dbHasCategory) return true

    // 5. 如果 mention 有品类词但 DB 没有 → 可能是品牌名匹配（如"库迪咖啡"→"Cotti库迪"）
    if (mentionHasCategory && ratio >= 0.3) return true

    // 6. 如果都没品类词 → 要求更高的占比（避免地名误匹配）
    if (ratio >= 0.6) return true

    // 7. 前缀匹配加分：mention 是 DB 名的前缀 → 更可能是简称
    if (longer.startsWith(shorter) && ratio >= 0.4) return true

    return false
  }

  private async vectorRecallAndRerank(
    unmatchedGroups: Array<{ group: NormalizedMentionGroup; candidates: ShortlistPoi[] }>,
    results: MentionMatch[],
  ): Promise<void> {
    try {
      // 只取前 5 个最有价值的未匹配 mention 做向量匹配（控制成本）
      const topUnmatched = unmatchedGroups.slice(0, 5)
      if (topUnmatched.length === 0) return

      // shortlist 候选取所有组的并集（所有组的 candidates 相同，即完整 shortlist）
      // 只 embed 一次 shortlist，避免每组重复 embed
      const sharedCandidates = topUnmatched[0].candidates.slice(0, 20)

      // Embed mentions（前段）+ shortlist POI 名称（后段）
      const mentionNames = topUnmatched.map((g) => g.group.canonicalName)
      const poiNames = sharedCandidates.map((p) => p.name)
      const allTexts = [...mentionNames, ...poiNames]

      const embedResult = await this.bridge.embed(allTexts)
      if (!embedResult.embeddings || embedResult.embeddings.length !== allTexts.length) return

      const mentionEmbeds = embedResult.embeddings.slice(0, mentionNames.length)
      const poiEmbeds = embedResult.embeddings.slice(mentionNames.length)

      // 为每个 mention 在 shortlist 中找向量最相似的 POI
      const vectorCandidates: Array<{
        groupIdx: number
        poi: ShortlistPoi
        score: number
      }> = []

      for (let gi = 0; gi < topUnmatched.length; gi++) {
        const mentionEmb = mentionEmbeds[gi]
        for (let ci = 0; ci < sharedCandidates.length; ci++) {
          const poiEmb = poiEmbeds[ci]
          if (!poiEmb) continue
          const sim = cosineSimilarity(mentionEmb, poiEmb)
          if (sim >= VECTOR_THRESHOLD) {
            vectorCandidates.push({
              groupIdx: gi,
              poi: sharedCandidates[ci],
              score: sim,
            })
          }
        }
      }

      // 对向量匹配候选做 rerank 精排
      if (vectorCandidates.length > 0) {
        const rerankPairs = vectorCandidates.map((c) => ({
          query: topUnmatched[c.groupIdx].group.canonicalName,
          document: c.poi.name,
        }))

        const rerankResult = await this.bridge.rerank(rerankPairs)

        // 取 rerank 结果
        const rerankScores = new Map<number, number>()
        for (const item of rerankResult.scores) {
          rerankScores.set(item.index, item.score)
        }

        // 每个 mention 只取最佳 rerank 结果
        const bestPerMention = new Map<number, { poi: ShortlistPoi; score: number }>()
        for (let i = 0; i < vectorCandidates.length; i++) {
          const candidate = vectorCandidates[i]
          const rerankScore = rerankScores.get(i) || 0
          if (rerankScore < RERANK_THRESHOLD) continue

          const existing = bestPerMention.get(candidate.groupIdx)
          if (!existing || rerankScore > existing.score) {
            bestPerMention.set(candidate.groupIdx, {
              poi: candidate.poi,
              score: rerankScore,
            })
          }
        }

        for (const [groupIdx, match] of bestPerMention) {
          const group = topUnmatched[groupIdx].group
          results.push(this.buildMatch(group, match.poi, 'rerank', match.score))
        }
      }
    } catch (err) {
      console.warn(`[ShortlistMatcher] vector recall 失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private buildMatch(
    group: NormalizedMentionGroup,
    poi: ShortlistPoi,
    matchType: MentionMatch['matchType'],
    matchScore: number,
  ): MentionMatch {
    return {
      mention: group.canonicalName,
      evidenceSpan: group.evidenceSpans[0] || '',
      url: [...group.urls][0] || '',
      confidence: group.maxConfidence,
      matchType,
      poi,
      matchScore,
      mentionCount: group.count,
    }
  }
}

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] ** 2
    normB += b[i] ** 2
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}
