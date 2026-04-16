/**
 * DB 模糊名匹配模块
 * 对 pois 表做全表 name 模糊匹配
 */
import type { SceneProfile } from './types.js'

/**
 * 旧链路遗留类型，仅 dbMatcher 内部使用。
 * 新链路请使用 MentionMatch（见 types.ts）。
 */
interface PoiMatch {
  nerName: string
  nerLabel: string
  nerCount: number
  candidateScore: number
  poiName: string | null
  poiCategory: string | null
  poiCity: string | null
  poiLon: number | null
  poiLat: number | null
  matchType: 'exact' | 'prefix' | 'contains' | 'web_only'
}
import { isAcceptableDbRow } from './sceneProfile.js'

const FOOD_FALLBACK_HINT = /(咖啡|咖啡馆|咖啡店|奶茶|奶茶店|茶饮|茶饮店|饮品|饮品店|星巴克|瑞幸|库迪|喜茶|奈雪|古茗|茶百道|沪上阿姨|霸王茶姬|蜜雪冰城|一点点|manner|mstand|m stand|seesaw)/iu
const HOTEL_FALLBACK_HINT = /(酒店|宾馆|民宿|客栈|旅馆|公寓|度假村|希尔顿|欢朋|皇冠假日|洲际|全季|汉庭|如家|维也纳|亚朵|桔子|锦江|holiday inn|hilton|hampton|crowne plaza|intercontinental)/iu

export interface DbQueryFn {
  (sql: string, params?: unknown[], timeoutMs?: number): Promise<{
    rows: Record<string, unknown>[]
    rowCount: number
  }>
}

function shouldFallbackWithoutCategory(candidateName: string, profile: SceneProfile): boolean {
  const name = String(candidateName || '').trim()
  if (!name) return false
  if (profile.key === 'food') return FOOD_FALLBACK_HINT.test(name)
  if (profile.key === 'hotel') return HOTEL_FALLBACK_HINT.test(name)
  return true
}

export class DbMatcher {
  private query: DbQueryFn

  constructor(query: DbQueryFn) {
    this.query = query
  }

  async matchCandidate(
    candidateName: string,
    profile: SceneProfile,
  ): Promise<Array<{
    name: string
    category_main: string
    category_sub: string
    city: string
    longitude: number
    latitude: number
  }>> {
    const withCategory = await this.doQuery(candidateName, profile.dbCategoryMains)
    if (withCategory.length > 0) return withCategory

    if (!shouldFallbackWithoutCategory(candidateName, profile)) {
      return []
    }

    return this.doQuery(candidateName, [])
  }

  private async doQuery(
    candidateName: string,
    categoryMains: string[],
  ): Promise<Array<{
    name: string
    category_main: string
    category_sub: string
    city: string
    longitude: number
    latitude: number
  }>> {
    const prefix = `${candidateName}%`
    const contains = `%${candidateName}%`

    let sql = `
      SELECT name, category_main, category_sub, city, longitude, latitude
      FROM pois
      WHERE (name = $1 OR name ILIKE $2 OR name ILIKE $3)
    `
    const params: unknown[] = [candidateName, prefix, contains]

    if (categoryMains.length > 0) {
      sql += ` AND category_main = ANY($4::text[])`
      params.push(categoryMains)
    }

    sql += `
      ORDER BY
        CASE
          WHEN name = $1 THEN 0
          WHEN name ILIKE $2 THEN 1
          ELSE 2
        END,
        LENGTH(name)
      LIMIT 18
    `

    try {
      const result = await this.query(sql, params, 3000)
      return (result.rows || []) as Array<{
        name: string
        category_main: string
        category_sub: string
        city: string
        longitude: number
        latitude: number
      }>
    } catch (err) {
      console.warn(`[DbMatcher] 查询失败(${candidateName}): ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  async batchMatch(
    candidates: Array<{ name: string; label: string; count?: number; score: number }>,
    profile: SceneProfile,
    maxResults = 10,
  ): Promise<PoiMatch[]> {
    const results: PoiMatch[] = []
    const candidateQueue = candidates.slice(0, Math.max(maxResults * 2, 12))
    const concurrency = Math.min(4, candidateQueue.length)
    let cursor = 0

    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < candidateQueue.length) {
        const currentIndex = cursor++
        const candidate = candidateQueue[currentIndex]
        if (!candidate) break

        const rows = await this.matchCandidate(candidate.name, profile)
        if (rows.length === 0) {
          results.push({
            nerName: candidate.name,
            nerLabel: candidate.label,
            nerCount: candidate.count ?? 1,
            candidateScore: candidate.score ?? 0,
            poiName: null,
            poiCategory: null,
            poiCity: null,
            poiLon: null,
            poiLat: null,
            matchType: 'web_only',
          })
          continue
        }

        for (const row of rows) {
          const acceptable = isAcceptableDbRow(candidate.name, row.name, profile)
          let matchType: PoiMatch['matchType'] = 'contains'
          if (row.name === candidate.name) matchType = 'exact'
          else if (row.name.startsWith(candidate.name)) matchType = 'prefix'

          if (matchType === 'contains' && !acceptable) continue

          results.push({
            nerName: candidate.name,
            nerLabel: candidate.label,
            nerCount: candidate.count ?? 1,
            candidateScore: candidate.score ?? 0,
            poiName: row.name,
            poiCategory: `${row.category_main}/${row.category_sub}`,
            poiCity: row.city,
            poiLon: row.longitude,
            poiLat: row.latitude,
            matchType,
          })
        }
      }
    })

    await Promise.all(workers)

    // 排序：DB命中的优先 → matchType → candidateScore → nerCount
    return results.sort((a, b) => {
      const aHasDb = a.poiName ? 1 : 0
      const bHasDb = b.poiName ? 1 : 0
      if (aHasDb !== bHasDb) return bHasDb - aHasDb

      const matchOrder = { exact: 0, prefix: 1, contains: 2, web_only: 3 }
      const aMatch = matchOrder[a.matchType]
      const bMatch = matchOrder[b.matchType]
      if (aMatch !== bMatch) return aMatch - bMatch

      if (b.candidateScore !== a.candidateScore) return b.candidateScore - a.candidateScore
      return b.nerCount - a.nerCount
    })
  }
}
