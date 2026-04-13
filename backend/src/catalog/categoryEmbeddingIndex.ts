/**
 * 品类 Embedding 索引。
 * 启动时从 PostGIS 加载所有 category_main / category_sub 值，
 * 预计算 embedding 向量，查询时用 cosine similarity 做语义匹配，
 * 替代硬编码的 STRUCTURED_CATEGORY_HINTS + buildCategoryFilters 映射表。
 *
 * 缓存机制：将预计算的 embedding 保存到 JSON 文件，避免每次启动都调用 API。
 */
import type { EmbedRerankBridge } from '../integration/jinaBridge.js'
import type { QueryResultLike } from '../integration/postgisPool.js'
import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── 类型 ──

export interface CategoryEntry {
  /** category_main 值（如"住宿服务"、"餐饮美食"） */
  main: string
  /** category_sub 值（如"宾馆酒店"、"咖啡"），可能等于 main */
  sub: string
  /** 用于 embedding 的文本表示 */
  label: string
  /** 预计算的 embedding 向量 */
  embedding: number[]
}

export interface CategoryMatchResult {
  /** 最佳匹配的 category_main */
  categoryMain: string
  /** 最佳匹配的 category_sub（可能等于 category_main） */
  categorySub: string
  /** cosine 相似度分数 */
  score: number
  /** 是否超过匹配阈值 */
  matched: boolean
  /** 查询文本的 embedding 向量（供下游复用，避免重复 embed） */
  queryVec?: number[]
}

// ── 常量 ──

/** cosine 相似度阈值：低于此值视为无匹配 */
const MATCH_THRESHOLD = 0.40

/** 缓存文件名 */
const CACHE_FILE = 'category-embedding-cache.json'

const MAIN_GENERIC_HINTS: Record<string, string[]> = {
  '住宿服务': ['酒店', '宾馆', '旅馆', '住宿', '民宿'],
  '餐饮美食': ['餐厅', '餐馆', '美食', '吃饭', '小吃', '饭店', '餐饮'],
  '购物服务': ['商场', '超市', '便利店', '购物', '商超'],
  '交通设施服务': ['地铁', '地铁站', '公交', '车站'],
  '体育休闲服务': ['健身', '健身房', '运动', '休闲'],
  '医疗保健服务': ['医院', '诊所', '药店', '医疗'],
  '教育文化服务': ['学校', '教育', '培训', '图书馆'],
  '风景名胜': ['景点', '景区', '公园', '旅游'],
}

const SUBCATEGORY_ALIAS_MAP: Record<string, string[]> = {
  '宾馆酒店': ['酒店', '宾馆', '旅馆', '住宿', '民宿'],
  '咖啡': ['咖啡', '咖啡店', '咖啡馆'],
  '奶茶店': ['奶茶', '茶饮', '奶茶店'],
  '茶座': ['茶座', '茶馆'],
  '茶艺馆': ['茶艺', '茶艺馆', '茶馆'],
  '火锅': ['火锅', '火锅店'],
  '烧烤': ['烧烤', '烧烤店'],
  '中餐厅': ['中餐', '中餐厅'],
  '快餐厅': ['快餐', '快餐厅'],
  '商场': ['商场', '购物中心'],
  '超市': ['超市', '商超'],
  '便利店': ['便利店'],
  '地铁站': ['地铁', '地铁站'],
  '医院': ['医院'],
  '药店': ['药店'],
  '健身房': ['健身', '健身房'],
  '学校': ['学校'],
  '图书馆': ['图书馆'],
  '公园': ['公园'],
}

/** 缓存文件路径（优先 data 目录，其次 backend/data） */
function getCachePath(): string {
  const dataDir = resolveResourceUrl(import.meta.url, ['../../data/memory/', '../data/memory/'])
  // 转换 file:// URL 为文件路径
  const dirPath = fileURLToPath(dataDir)
  return join(dirPath, CACHE_FILE)
}

// ── 缓存数据类型 ──

interface CacheData {
  /** 品类条目（包含预计算的 embedding） */
  entries: CategoryEntry[]
  /** 缓存时间戳 */
  timestamp: number
  /** 数据库品类数量（用于检测品类变化） */
  categoryCount: number
}

/** 加载 category 时的 SQL */
const CATEGORY_SQL = `
  SELECT DISTINCT
    COALESCE(NULLIF(TRIM(category_main), ''), '未分类') AS category_main,
    COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类')) AS category_sub
  FROM public.pois
  ORDER BY category_main, category_sub
`

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

function normalizeMatchText(text: string): string {
  return String(text || '').replace(/\s+/g, '').trim().toLowerCase()
}

function hasExplicitHint(query: string, hints: string[]): boolean {
  const normalizedQuery = normalizeMatchText(query)
  if (!normalizedQuery) return false
  return hints
    .map((hint) => normalizeMatchText(hint))
    .filter(Boolean)
    .some((hint) => normalizedQuery.includes(hint))
}

function shouldUseSpecificSub(main: string, sub: string, focusedQuery: string): boolean {
  if (!sub || sub === main) return false
  const subHints = [sub, ...(SUBCATEGORY_ALIAS_MAP[sub] || [])]
  if (hasExplicitHint(focusedQuery, subHints)) return true
  const mainHints = [main, ...(MAIN_GENERIC_HINTS[main] || [])]
  if (hasExplicitHint(focusedQuery, mainHints)) return false
  return false
}

/**
 * 为 category 构造语义丰富的 embedding 文本。
 * 将 "住宿服务" + "宾馆酒店" 组合为 "住宿服务 宾馆酒店 住宿 宾馆 酒店"，
 * 增加常见同义词以提升召回。
 */
function buildEmbeddingLabel(main: string, sub: string): string {
  // main 和 sub 相同时只保留一份
  const parts = [main]
  if (sub !== main) parts.push(sub)

  // 追加常见同义词提示（仅对高频品类）
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

  const synonyms = synonymMap[main]
  if (synonyms) {
    parts.push(...synonyms)
  }

  return parts.join(' ')
}

/**
 * 从自然语言查询中提取品类聚焦词。
 * "这附近高分推荐的酒店，最好靠近地铁站" → "酒店"
 * "好吃的餐厅推荐" → "餐厅"
 * "附近有咖啡店吗" → "咖啡店"
 * 思路：取主句 → 去修饰语 → 保留品类名词核心
 */
function extractCategoryFocus(rawQuery: string): string {
  // 按分隔符取第一个子句（品类目标通常在主句，约束条件在后面的子句）
  const mainClause = rawQuery.split(/[\uff0c,\u3001\uff1b;\u3002\uff01!\uff1f?]|\u6700\u597d|\u540c\u65f6|\u800c\u4e14|\u5e76\u4e14|\u53e6\u5916/u)[0]?.trim() || rawQuery

  // 去掉常见修饰性前缀和形容词
  const cleaned = mainClause
    .replace(/^(\u8fd9|\u90a3|\u6211|\u8bf7\u95ee|\u8bf7|\u5e2e\u6211|\u627e|\u67e5|\u641c|\u63a8\u8350|\u6709\u6ca1\u6709|\u6709\u54ea\u4e9b|\u54ea\u91cc\u6709|\u54ea\u5bb6|\u4ec0\u4e48|\u9644\u8fd1|\u5468\u8fb9|\u65c1\u8fb9|\u8fd9\u9644\u8fd1|\u90a3\u9644\u8fd1|\u5468\u56f4)\s*/gu, '')
    .replace(/(\u9ad8\u5206|\u597d\u8bc4|\u63a8\u8350|\u4eba\u6c14|\u7f51\u7ea2|\u53e3\u7891\u597d|\u6027\u4ef7\u6bd4\u9ad8|\u4fbf\u5b9c|\u8d35|\u597d\u5403|\u6700\u597d|\u6700\u4f73|\u8bc4\u5206\u9ad8|\u4e0d\u9519|\u6709\u540d|\u70ed\u95e8)\u7684?\s*/gu, '')
    .trim()

  return cleaned || mainClause || rawQuery
}

// ── 主类 ──

export class CategoryEmbeddingIndex {
  private entries: CategoryEntry[] = []
  private ready = false

  /** 加载状态 */
  get isReady(): boolean {
    return this.ready && this.entries.length > 0
  }

  /** 当前索引中的品类数量 */
  get size(): number {
    return this.entries.length
  }

  /**
   * 从缓存文件加载预计算的 embedding。
   * 如果缓存不存在或品类数量不匹配，返回 null。
   */
  private async loadFromCache(expectedCount: number): Promise<CategoryEntry[] | null> {
    const cachePath = getCachePath()

    if (!existsSync(cachePath)) {
      console.log('[CategoryEmbeddingIndex] 缓存文件不存在，需要重新计算')
      return null
    }

    try {
      const content = await readFile(cachePath, 'utf-8')
      const cache: CacheData = JSON.parse(content)

      // 验证品类数量是否匹配
      if (cache.categoryCount !== expectedCount) {
        console.log(`[CategoryEmbeddingIndex] 品类数量变化（缓存=${cache.categoryCount}, 当前=${expectedCount}），需要重新计算`)
        return null
      }

      console.log(`[CategoryEmbeddingIndex] 从缓存加载 ${cache.entries.length} 个品类（缓存时间：${new Date(cache.timestamp).toLocaleString()}）`)
      return cache.entries
    } catch (err) {
      console.warn(`[CategoryEmbeddingIndex] 缓存加载失败: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /**
   * 将预计算的 embedding 保存到缓存文件。
   */
  private async saveToCache(categoryCount: number): Promise<void> {
    const cachePath = getCachePath()
    const cacheDir = dirname(cachePath)

    try {
      // 确保目录存在
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true })
      }

      const cacheData: CacheData = {
        entries: this.entries,
        timestamp: Date.now(),
        categoryCount,
      }
      await writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8')
      console.log(`[CategoryEmbeddingIndex] 缓存已保存到 ${cachePath}`)
    } catch (err) {
      console.warn(`[CategoryEmbeddingIndex] 缓存保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 从数据库加载品类并预计算 embedding。
   * 应在服务启动时调用一次。
   * 优先从缓存加载，缓存失效时才调用 API 重新计算。
   */
  async build(
    query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
    bridge: EmbedRerankBridge,
  ): Promise<void> {
    try {
      console.log('[CategoryEmbeddingIndex] 正在从数据库加载品类...')
      const result = await query(CATEGORY_SQL)
      const rows = result.rows as Array<{ category_main: string; category_sub: string }>

      if (rows.length === 0) {
        console.warn('[CategoryEmbeddingIndex] 数据库无品类数据，索引为空')
        this.ready = false
        return
      }

      // 去重：同一 (main, sub) 只保留一条
      const seen = new Set<string>()
      const uniqueRows = rows.filter(r => {
        const key = `${r.category_main}||${r.category_sub}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const categoryCount = uniqueRows.length
      console.log(`[CategoryEmbeddingIndex] 加载 ${categoryCount} 个品类`)

      // 尝试从缓存加载
      const cachedEntries = await this.loadFromCache(categoryCount)
      if (cachedEntries) {
        this.entries = cachedEntries
        this.ready = true
        return
      }

      // 缓存失效，调用 API 重新计算
      console.log(`[CategoryEmbeddingIndex] 缓存失效，正在调用 API 计算 embedding...`)

      // 构造 embedding 文本
      const labels = uniqueRows.map(r => buildEmbeddingLabel(r.category_main, r.category_sub))

      // 批量 embed（Jina 单次最多 2048 条，这里通常 <100 条）
      const embedResult = await bridge.embed(labels)

      if (!embedResult.embeddings || embedResult.embeddings.length !== uniqueRows.length) {
        console.error('[CategoryEmbeddingIndex] Embedding 返回长度不匹配，构建失败')
        this.ready = false
        return
      }

      let skipCount = 0
      this.entries = uniqueRows.map((r, i) => {
        const vec = embedResult.embeddings[i]
        if (!vec || vec.length === 0) {
          console.warn(`[CategoryEmbeddingIndex] 品类 ${r.category_main}/${r.category_sub} 的 embedding 为空，跳过`)
          skipCount++
          return null
        }
        return {
          main: r.category_main,
          sub: r.category_sub,
          label: labels[i],
          embedding: vec,
        }
      }).filter((e): e is CategoryEntry => e !== null)

      if (this.entries.length === 0) {
        console.error('[CategoryEmbeddingIndex] 所有品类 embedding 均为空，索引构建失败')
        this.ready = false
        return
      }

      this.ready = true
      if (skipCount > 0) {
        console.warn(`[CategoryEmbeddingIndex] 索引构建完成（跳过 ${skipCount} 个空 embedding）：${this.entries.length} 个品类`)
      } else {
        console.log(`[CategoryEmbeddingIndex] 索引构建完成：${this.entries.length} 个品类`)
      }

      // 保存缓存
      await this.saveToCache(categoryCount)
    } catch (err) {
      console.error(`[CategoryEmbeddingIndex] 索引构建失败: ${err instanceof Error ? err.message : String(err)}`)
      this.ready = false
    }
  }

  /**
   * 用自然语言查询匹配最佳品类。
   * 返回 cosine similarity 最高的 category_main + category_sub。
   */
  async resolve(
    rawQuery: string,
    bridge: EmbedRerankBridge,
  ): Promise<CategoryMatchResult> {
    if (!this.ready || this.entries.length === 0) {
      return { categoryMain: '', categorySub: '', score: 0, matched: false }
    }

    // 提取品类聚焦词，避免被约束条件干扰（如"靠近地铁站"误导品类匹配）
    const focusedQuery = extractCategoryFocus(rawQuery)
    console.log(`[CategoryEmbeddingIndex] rawQuery="${rawQuery}" -> focused="${focusedQuery}"`)

    // embed 聚焦后的查询
    let queryVec: number[] | undefined
    try {
      const queryEmbed = await bridge.embed([focusedQuery])
      queryVec = queryEmbed.embeddings[0]
    } catch (err) {
      console.warn(`[CategoryEmbeddingIndex] Embedding 查询失败: ${err instanceof Error ? err.message : String(err)}`)
      return { categoryMain: '', categorySub: '', score: 0, matched: false }
    }

    if (!queryVec || queryVec.length === 0) {
      return { categoryMain: '', categorySub: '', score: 0, matched: false }
    }

    const mainScores = new Map<string, number>()
    for (const entry of this.entries) {
      const score = cosineSimilarity(queryVec, entry.embedding)
      const previous = mainScores.get(entry.main) ?? -1
      if (score > previous) {
        mainScores.set(entry.main, score)
      }
    }

    let bestMain = this.entries[0]?.main || ''
    let bestMainScore = -1
    for (const [main, score] of mainScores.entries()) {
      if (score > bestMainScore) {
        bestMainScore = score
        bestMain = main
      }
    }

    const entriesUnderMain = this.entries.filter((entry) => entry.main === bestMain)
    let bestScore = -1
    let bestEntry: CategoryEntry = entriesUnderMain[0] || this.entries[0]

    for (const entry of entriesUnderMain) {
      const score = cosineSimilarity(queryVec, entry.embedding)
      if (score > bestScore) {
        bestScore = score
        bestEntry = entry
      }
    }

    const resolvedSub = shouldUseSpecificSub(bestEntry.main, bestEntry.sub, focusedQuery)
      ? bestEntry.sub
      : bestEntry.main

    if (bestEntry.sub !== resolvedSub) {
      console.log(`[CategoryEmbeddingIndex] 子品类回退：focused="${focusedQuery}" main=${bestEntry.main} sub=${bestEntry.sub}`)
    }

    return {
      categoryMain: bestEntry.main,
      categorySub: resolvedSub,
      score: Math.round(bestScore * 1000) / 1000,
      matched: bestScore >= MATCH_THRESHOLD,
      queryVec,
    }
  }

  /**
   * 同步版本：用预计算的 query embedding 做匹配（避免额外 embed 调用）。
   * 适用于已经拿到 query embedding 的场景。
   */
  resolveWithEmbedding(queryEmbedding: number[]): CategoryMatchResult {
    if (!this.ready || this.entries.length === 0 || !queryEmbedding || queryEmbedding.length === 0) {
      return { categoryMain: '', categorySub: '', score: 0, matched: false }
    }

    let bestScore = -1
    let bestEntry: CategoryEntry = this.entries[0]

    for (const entry of this.entries) {
      const score = cosineSimilarity(queryEmbedding, entry.embedding)
      if (score > bestScore) {
        bestScore = score
        bestEntry = entry
      }
    }

    return {
      categoryMain: bestEntry.main,
      categorySub: bestEntry.sub,
      score: Math.round(bestScore * 1000) / 1000,
      matched: bestScore >= MATCH_THRESHOLD,
    }
  }

  /**
   * 根据 categoryKey（旧逻辑兼容）查找对应的 category_main。
   * 仅在过渡期使用，后续删除。
   */
  resolveByCategoryKey(categoryKey: string): { categoryMain: string; categorySub: string } | null {
    // 旧 key → category_main 映射（过渡期兼容）
    const legacyMap: Record<string, { categoryMain: string; categorySub: string }> = {
      metro_station: { categoryMain: '交通设施服务', categorySub: '地铁站' },
      coffee: { categoryMain: '餐饮美食', categorySub: '咖啡' },
      food: { categoryMain: '餐饮美食', categorySub: '餐饮美食' },
      hotel: { categoryMain: '住宿服务', categorySub: '住宿服务' },
      supermarket: { categoryMain: '购物服务', categorySub: '购物服务' },
    }
    return legacyMap[categoryKey] || null
  }
}
