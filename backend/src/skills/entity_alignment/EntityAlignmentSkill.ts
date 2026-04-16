/**
 * 实体对齐 Skill
 * 将联网搜索结果与本地 POI 数据库进行匹配对齐
 * 算法：名称相似度 + 空间邻近度 + 类别一致性
 * 输出：matched / unmatched_web / unmatched_local 三类结果 + 融合排序
 */

import type { SkillDefinition, SkillActionDefinition } from '../types.js'
import type { EmbedRerankBridge } from '../../integration/jinaBridge.js'
import { LocalFallbackBridge } from '../../integration/jinaBridge.js'

// ── 类型定义 ──

/** 联网搜索结果条目 */
export interface WebSearchItem {
  title: string
  url?: string
  snippet?: string
  /** 搜索引擎提取的评分（如有） */
  rating?: number
  /** 被多少个搜索引擎/来源提及 */
  mentionCount?: number
}

/** 本地 POI 条目 */
export interface LocalPoiItem {
  id?: string | number | null
  name: string
  category?: string | null
  categoryMain?: string | null
  categorySub?: string | null
  longitude?: number
  latitude?: number
  distance_m?: number | null
  score?: number | null
}

/** 匹配结果 */
export interface AlignmentMatch {
  webItem: WebSearchItem
  localPoi: LocalPoiItem
  /** 综合匹配置信度 0-1 */
  confidence: number
  /** 名称相似度得分 0-1 */
  nameScore: number
  /** 空间邻近度得分 0-1（无坐标时为 0） */
  spatialScore: number
  /** 类别一致性得分 0-1 */
  categoryScore: number
  /** 匹配类型说明 */
  matchType: 'exact' | 'fuzzy' | 'spatial' | 'combined' | 'snippet_fuzzy' | 'embedding_rerank'
}

/** 融合排序后的最终结果 */
export interface RankedResult {
  name: string
  /** 融合得分（非强制 top-k，自然截断） */
  fusionScore: number
  /** 验证状态 */
  verification: 'dual_verified' | 'local_only' | 'web_only'
  /** 原始本地 POI（如有） */
  localPoi?: LocalPoiItem
  /** 原始搜索结果（如有） */
  webItem?: WebSearchItem
  /** 匹配详情（如有） */
  alignment?: AlignmentMatch
  /** 距离（米） */
  distance_m?: number | null
  /** 类别 */
  category?: string | null
}

// ── 名称相似度算法 ──

/** 编辑距离（Levenshtein） */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/** 归一化编辑距离相似度 0-1 */
function editDistanceSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

/**
 * 清洗 POI 名称：去除括号后缀（如"老乡鸡(湖北大学店)"→"老乡鸡"）
 * 同时去除常见修饰词
 */
function cleanPoiName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')  // 去括号内容
    .replace(/[\s·\-—]+/g, '')           // 去分隔符
    .replace(/(店|馆|坊|堂|铺|楼|阁|苑|轩|居|家|屋)$/u, '') // 去通用后缀
    .trim()
}

/** 子串包含度：较短字符串是否是较长字符串的子串 */
function substringScore(a: string, b: string): number {
  const short = a.length <= b.length ? a : b
  const long = a.length > b.length ? a : b
  if (long.includes(short)) {
    return short.length / long.length
  }
  return 0
}

/**
 * 综合名称相似度：编辑距离 + 子串匹配 + 清洗后比较
 */
function computeNameSimilarity(webTitle: string, localName: string): number {
  const cleanWeb = cleanPoiName(webTitle)
  const cleanLocal = cleanPoiName(localName)

  // 完全匹配
  if (cleanWeb === cleanLocal) return 1.0

  // 清洗后编辑距离
  const editSim = editDistanceSimilarity(cleanWeb, cleanLocal)

  // 子串包含
  const subSim = substringScore(cleanWeb, cleanLocal)

  // 原始名称也检查一遍（防止清洗丢信息）
  const rawSubSim = substringScore(webTitle, localName)

  // 取最优
  return Math.max(editSim, subSim * 0.9, rawSubSim * 0.85)
}

// ── 空间邻近度算法 ──

/** 目的地型类别：用户愿意远距离前往，距离衰减应更宽松 */
const DESTINATION_CATEGORIES = new Set([
  '购物', '商场', '超市', '商业', '景区', '公园', '旅游', '景点',
  '教育', '学校', '大学', '医院', '医疗', '健身', '体育', '娱乐',
  '影院', 'KTV', '书店', '图书馆', '博物馆',
])

/**
 * 空间邻近度：距离衰减函数（类别感知）
 * 步行型（餐饮/便利店）：50m→1.0, 200m→0.8+, 500m+急剧衰减
 * 目的地型（商场/景区/教育）：50m→1.0, 1km→0.8+, 3km+才急剧衰减
 */
function computeSpatialProximity(distanceM: number | null | undefined, categoryMain?: string | null | undefined): number {
  if (distanceM == null || distanceM < 0) return 0
  if (distanceM <= 50) return 1.0

  // 判断是否为目的地型 POI
  const isDestination = categoryMain && DESTINATION_CATEGORIES.has(categoryMain)

  if (isDestination) {
    // 目的地型：宽松衰减，σ=2000m
    if (distanceM <= 1000) return 0.8 + 0.2 * (1 - (distanceM - 50) / 950)
    if (distanceM <= 3000) return 0.5 + 0.3 * (1 - (distanceM - 1000) / 2000)
    return 0.5 * Math.exp(-((distanceM - 3000) ** 2) / (2 * 2000 ** 2))
  }

  // 步行型：紧凑衰减，σ=300m
  if (distanceM <= 200) return 0.8 + 0.2 * (1 - (distanceM - 50) / 150)
  if (distanceM <= 500) return 0.5 + 0.3 * (1 - (distanceM - 200) / 300)
  return 0.5 * Math.exp(-((distanceM - 500) ** 2) / (2 * 300 ** 2))
}

// ── 类别一致性算法 ──

/** 类别同义词/上下位映射 */
const CATEGORY_ALIASES: Record<string, string[]> = {
  '餐饮': ['中餐', '中国菜', '西餐', '日料', '韩餐', '小吃', '快餐', '小吃快餐', '火锅', '烧烤', '面馆', '粥店', '饮品', '咖啡', '奶茶', '甜品', '蛋糕甜品店', '面包甜点'],
  '中餐': ['中国菜', '川菜', '湘菜', '粤菜', '鲁菜', '东北菜', '西北菜', '本帮菜', '鄂菜'],
  '快餐': ['小吃快餐', '小吃', '快餐', '便当', '轻食'],
  '咖啡': ['咖啡厅', '咖啡馆', '咖啡店'],
  '甜品': ['蛋糕甜品店', '甜品店', '蛋糕店', '面包甜点'],
}

/**
 * 计算类别一致性
 * 完全匹配 → 1.0
 * 同义词/上下位关系 → 0.7
 * 同属大类（餐饮） → 0.5
 * 无关 → 0.0
 */
function computeCategoryConsistency(
  webSnippet: string | undefined,
  localCategory: string | null | undefined,
  localCategoryMain: string | null | undefined,
): number {
  if (!localCategory && !localCategoryMain) return 0.3 // 无类别信息时给中性分
  if (!webSnippet) return 0.3

  const localCats = [localCategory, localCategoryMain].filter(Boolean) as string[]
  const snippetLower = webSnippet.toLowerCase()

  // 直接包含检查
  for (const cat of localCats) {
    if (snippetLower.includes(cat.toLowerCase())) return 1.0
  }

  // 同义词检查
  for (const cat of localCats) {
    for (const [_group, aliases] of Object.entries(CATEGORY_ALIASES)) {
      if (aliases.some(a => a === cat || cat.includes(a))) {
        // 本地类别属于某个大类，检查搜索结果是否也属于该大类
        if (aliases.some(a => snippetLower.includes(a.toLowerCase()))) {
          return 0.7
        }
      }
    }
  }

  // 宽泛大类检查：是否都是餐饮类
  const allFoodAliases = CATEGORY_ALIASES['餐饮'] || []
  const localIsFood = localCats.some(c =>
    allFoodAliases.some(a => c.includes(a) || a.includes(c)) || c.includes('餐') || c.includes('食')
  )
  const webIsFood = allFoodAliases.some(a => snippetLower.includes(a.toLowerCase())) ||
    /餐|食|吃|菜|饭|面|粥|汤|烤|炒|煎|蒸|炖/u.test(snippetLower)
  if (localIsFood && webIsFood) return 0.5

  return 0.0
}

// ── POI 名称提取器 ──

/**
 * 从搜索结果的 title + snippet 中提取具体 POI 名称
 * 搜索结果通常是推荐文章（如"湖北大学附近必吃的5家餐馆"），
 * 需要从正文中拆解出具体餐馆名参与匹配
 */

/** 常见餐馆/店铺名后缀（用于识别提取出的名称是否像 POI 名） */
const POI_NAME_SUFFIXES = /店|馆|坊|堂|铺|楼|阁|苑|轩|居|屋|厅|餐厅|咖啡|茶|面|饭|粥|饼|煲|锅|烤|串|饮|吧|房|厨|味|食|斋|记|局|舍|阁|院|铺子|小馆|大排档|快餐|小吃$/u

/** 非餐馆名模式（过滤掉明显不是 POI 名的提取结果） */
const NON_POI_PATTERNS = /^(推荐|附近|周边|好吃|必吃|美食|攻略|排名|评分|高分|十佳|盘点|合集|大全|指南|打卡|探店|测评|比较|选择|哪家|什么|怎么|如何|哪里|几个|多少|排名|前十|top|best)/iu

/**
 * 从单条搜索结果中提取 POI 名称
 * 策略优先级：
 * 1. 引号/书名号内的名称
 * 2. 列表模式（1.XX 2.YY 或 ·XX -YY）
 * 3. 顿号/空格分隔的短名称
 * 4. 标题中与本地 POI 名相似的子串
 */
function extractPoiNamesFromSingleResult(item: WebSearchItem): string[] {
  const names: string[] = []
  const text = [item.title, item.snippet].filter(Boolean).join(' ')

  // 策略 1：引号/书名号内的名称
  const quotedPattern = /[《「『""]([^《》「」『』"""]{2,20})[》」』""]|["""]([^""""]{2,20})["""]|「([^」]{2,20})」/gu
  let match: RegExpExecArray | null
  while ((match = quotedPattern.exec(text)) !== null) {
    const name = (match[1] || match[2] || match[3]).trim()
    if (name.length >= 2 && !NON_POI_PATTERNS.test(name)) {
      names.push(name)
    }
  }

  // 策略 2：列表模式
  // "1.老乡鸡 2.海底捞" 或 "①XX ②YY" 或 "一、XX 二、YY"
  const listPatterns = [
    /(?:\d+[\.、）)]\s*|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩)\s*([^\d①②③④⑤⑥⑦⑧⑨⑩\.、）)\n]{2,20})/gu,
    /[一二三四五六七八九十]+[、]\s*([^\d①②③④⑤⑥⑦⑧⑨⑩\.、）)\n]{2,20})/gu,
  ]
  for (const pattern of listPatterns) {
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1].trim()
      // 列表项可能以顿号/空格分隔多个名称
      const parts = raw.split(/[、，,\s]+/).filter(p => p.length >= 2 && p.length <= 20)
      for (const part of parts) {
        if (!NON_POI_PATTERNS.test(part) && looksLikePoiName(part)) {
          names.push(part)
        }
      }
    }
  }

  // 策略 3：连字符/破折号分隔的名称（"老乡鸡 - 武大店"）
  const dashPattern = /(?:^|[、，,\s])([^\-—–…]{2,15})(?:\s*[-—–…]\s*(?:.*店|.*分?店|.*分校|.*分店|.*校区|.*路店|.*广场店))?/gu
  while ((match = dashPattern.exec(text)) !== null) {
    const name = match[1].trim()
    if (name.length >= 2 && name.length <= 15 && !NON_POI_PATTERNS.test(name) && looksLikePoiName(name)) {
      names.push(name)
    }
  }

  // 策略 4：标题本身就是餐馆名（短标题、含后缀词）
  const cleanTitle = item.title.replace(/[！!？?。.，,：:；;…]+$/g, '').trim()
  if (cleanTitle.length >= 2 && cleanTitle.length <= 20 && looksLikePoiName(cleanTitle)) {
    names.push(cleanTitle)
  }

  return [...new Set(names)]
}

/**
 * 判断一个字符串是否"看起来像" POI 名称
 * 启发式：含餐馆/店铺后缀，或 2-8 字纯中文名且不含常见文章词
 */
function looksLikePoiName(text: string): boolean {
  // 含 POI 后缀词 → 很可能是
  if (POI_NAME_SUFFIXES.test(text)) return true

  // 纯中文 2-8 字 → 可能是品牌名
  if (/^[\u4e00-\u9fff]{2,8}$/.test(text)) return true

  // 含英文+中文混合（如"luckin coffee"）→ 可能是
  if (/^[a-zA-Z\s\u4e00-\u9fff]{2,20}$/.test(text) && /[a-zA-Z]/.test(text) && /[\u4e00-\u9fff]/.test(text)) return true

  // 纯英文品牌名 2-15 字符
  if (/^[a-zA-Z\s&']{2,15}$/.test(text) && text.length >= 3) return true

  return false
}

/**
 * 将搜索结果展开为"提取出的 POI 名称"列表
 * 对齐时使用展开后的列表而非原始 title
 */
function expandWebResults(webResults: WebSearchItem[]): WebSearchItem[] {
  const expanded: WebSearchItem[] = []

  for (const item of webResults) {
    const extractedNames = extractPoiNamesFromSingleResult(item)

    if (extractedNames.length > 0) {
      // 每个提取出的名称生成一个独立的 web item
      for (const name of extractedNames) {
        expanded.push({
          title: name,
          url: item.url,
          snippet: item.snippet,
          mentionCount: item.mentionCount,
        })
      }
    } else {
      // 无法提取名称，保留原始 item
      expanded.push(item)
    }
  }

  return expanded
}

function dedupeLocalPois(localPois: LocalPoiItem[]): LocalPoiItem[] {
  const seen = new Set<string>()
  const deduped: LocalPoiItem[] = []

  for (const poi of localPois) {
    const key = poi.id != null
      ? `id:${String(poi.id)}`
      : `name:${cleanPoiName(poi.name || '')}:${String(poi.categoryMain || poi.category || '')}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(poi)
  }

  return deduped
}

function resolveCategoryMainHint(categoryKey?: string | null, categoryMain?: string | null) {
  if (categoryMain) return categoryMain
  if (categoryKey === 'food' || categoryKey === 'coffee') return '餐饮美食'
  if (categoryKey === 'hotel') return '住宿服务'
  if (categoryKey === 'metro_station') return '交通设施服务'
  return null
}

async function recallLocalPoisFromWebResults(
  webResults: WebSearchItem[],
  input: {
    query: NonNullable<CreateEntityAlignmentSkillOptions['query']>
    categoryKey?: string | null
    categoryMain?: string | null
    categorySub?: string | null
  },
): Promise<LocalPoiItem[]> {
  const candidateNames = [...new Set(
    webResults
      .flatMap((item) => extractPoiNamesFromSingleResult(item))
      .map((name) => String(name || '').trim())
      .filter((name) => name.length >= 2 && name.length <= 24),
  )].slice(0, 24)

  if (candidateNames.length === 0) {
    return []
  }

  const categoryMainHint = resolveCategoryMainHint(input.categoryKey, input.categoryMain)
  const concurrency = Math.min(4, candidateNames.length)
  let cursor = 0
  const recalled: LocalPoiItem[] = []

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < candidateNames.length) {
      const currentIndex = cursor++
      const candidateName = candidateNames[currentIndex]
      if (!candidateName) break

      let sql = `
        SELECT id, name, category_main, category_sub, longitude, latitude
        FROM pois
        WHERE (name = $1 OR name ILIKE $2 OR name ILIKE $3)
      `
      const params: unknown[] = [candidateName, `${candidateName}%`, `%${candidateName}%`]

      if (categoryMainHint) {
        sql += ` AND category_main = $4`
        params.push(categoryMainHint)
      }

      if (input.categorySub) {
        sql += categoryMainHint ? ` AND category_sub = $5` : ` AND category_sub = $4`
        params.push(input.categorySub)
      }

      sql += `
        ORDER BY
          CASE
            WHEN name = $1 THEN 0
            WHEN name ILIKE $2 THEN 1
            ELSE 2
          END,
          LENGTH(name)
        LIMIT 8
      `

      try {
        const result = await input.query(sql, params, 2000)
        for (const row of result.rows || []) {
          recalled.push({
            id: typeof row.id === 'string' || typeof row.id === 'number' ? row.id : null,
            name: String(row.name || ''),
            category: String(row.category_sub || row.category_main || ''),
            categoryMain: row.category_main ? String(row.category_main) : null,
            categorySub: row.category_sub ? String(row.category_sub) : null,
            longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
            latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
            distance_m: null,
          })
        }
      } catch {
        continue
      }
    }
  })

  await Promise.all(workers)
  return dedupeLocalPois(recalled)
}

// ── 核心对齐算法 ──

/** 匹配置信度阈值（降低以提升召回率） */
const MATCH_THRESHOLD = 0.35

/**
 * 执行实体对齐
 */
function alignEntities(
  webResults: WebSearchItem[],
  localPois: LocalPoiItem[],
): {
  matched: AlignmentMatch[]
  unmatchedWeb: WebSearchItem[]
  unmatchedLocal: LocalPoiItem[]
} {
  // 先展开搜索结果：从 title/snippet 中提取具体 POI 名称
  const expandedWeb = expandWebResults(webResults)

  const matched: AlignmentMatch[] = []
  const usedLocalIndices = new Set<number>()
  const usedWebIndices = new Set<number>()

  // ── 正向匹配：web → local ──
  const scoreMatrix: Array<{
    webIdx: number
    localIdx: number
    nameScore: number
    spatialScore: number
    categoryScore: number
    confidence: number
    matchType: AlignmentMatch['matchType']
  }> = []

  for (let wi = 0; wi < expandedWeb.length; wi++) {
    for (let li = 0; li < localPois.length; li++) {
      const web = expandedWeb[wi]
      const local = localPois[li]

      const nameScore = computeNameSimilarity(web.title, local.name)
      const spatialScore = computeSpatialProximity(local.distance_m, local.categoryMain)
      const categoryScore = computeCategoryConsistency(
        web.snippet || web.title,
        local.category || local.categorySub,
        local.categoryMain,
      )

      const confidence = nameScore * 0.5 + spatialScore * 0.3 + categoryScore * 0.2

      let matchType: AlignmentMatch['matchType'] = 'combined'
      if (nameScore >= 0.9) matchType = 'exact'
      else if (nameScore >= 0.6) matchType = 'fuzzy'
      else if (spatialScore >= 0.8 && nameScore >= 0.4) matchType = 'spatial'

      if (confidence >= MATCH_THRESHOLD) {
        scoreMatrix.push({ webIdx: wi, localIdx: li, nameScore, spatialScore, categoryScore, confidence, matchType })
      }
    }
  }

  // ── 反向匹配：local → web（本地 POI 名在搜索结果 title/snippet 中被提及）──
  for (let li = 0; li < localPois.length; li++) {
    if (usedLocalIndices.has(li)) continue
    const local = localPois[li]
    const cleanLocalName = cleanPoiName(local.name)
    // POI 核心品牌名（清洗后前4字），用于 title 交叉验证
    const localCoreWord = cleanLocalName.slice(0, Math.min(cleanLocalName.length, 4))

    for (let wi = 0; wi < expandedWeb.length; wi++) {
      if (usedWebIndices.has(wi)) continue
      const web = expandedWeb[wi]
      const webTitle = web.title || ''
      const cleanWebTitle = cleanPoiName(webTitle)
      const webText = [webTitle, web.snippet].filter(Boolean).join(' ')
      const cleanWebText = cleanPoiName(webText)

      // ── title 匹配（高置信度）：POI 名在 web title 中出现 ──
      // 清洗后 POI 名在 title 中
      if (cleanLocalName.length >= 2 && cleanWebTitle.includes(cleanLocalName)) {
        const nameScore = 0.85 // title 子串匹配
        const spatialScore = computeSpatialProximity(local.distance_m, local.categoryMain)
        const categoryScore = computeCategoryConsistency(
          web.snippet || webTitle,
          local.category || local.categorySub,
          local.categoryMain,
        )
        const confidence = nameScore * 0.5 + spatialScore * 0.3 + categoryScore * 0.2

        if (confidence >= MATCH_THRESHOLD) {
          scoreMatrix.push({
            webIdx: wi, localIdx: li,
            nameScore, spatialScore, categoryScore, confidence,
            matchType: 'fuzzy',
          })
        }
      }

      // 原始 POI 名在 title 中精确出现
      if (local.name.length >= 2 && webTitle.includes(local.name)) {
        const nameScore = 0.95 // 原名在 title 精确出现
        const spatialScore = computeSpatialProximity(local.distance_m, local.categoryMain)
        const categoryScore = computeCategoryConsistency(
          web.snippet || webTitle,
          local.category || local.categorySub,
          local.categoryMain,
        )
        const confidence = nameScore * 0.5 + spatialScore * 0.3 + categoryScore * 0.2

        if (confidence >= MATCH_THRESHOLD) {
          scoreMatrix.push({
            webIdx: wi, localIdx: li,
            nameScore, spatialScore, categoryScore, confidence,
            matchType: 'fuzzy',
          })
        }
      }

      // ── snippet 匹配（低置信度）：POI 名仅在 snippet 中出现 ──
      // 需要额外交叉验证：POI 核心词在 title 中也有出现
      // 防止"喜茶江汉路店" snippet 中提到"奈雪的茶"导致误匹配
      const inTitle = cleanLocalName.length >= 2 && cleanWebTitle.includes(cleanLocalName)
      const inSnippet = cleanLocalName.length >= 2 && cleanWebText.includes(cleanLocalName) && !inTitle
      if (inSnippet) {
        // 交叉验证：POI 核心词是否在 title 中出现
        const hasTitleCrossRef = localCoreWord.length >= 2 && (
          cleanWebTitle.includes(localCoreWord) || webTitle.includes(cleanLocalName)
        )
        const nameScore = hasTitleCrossRef ? 0.70 : 0.50 // 有交叉验证给中等分，否则低分
        const spatialScore = computeSpatialProximity(local.distance_m, local.categoryMain)
        const categoryScore = computeCategoryConsistency(
          web.snippet || webTitle,
          local.category || local.categorySub,
          local.categoryMain,
        )
        const confidence = nameScore * 0.5 + spatialScore * 0.3 + categoryScore * 0.2

        if (confidence >= MATCH_THRESHOLD) {
          scoreMatrix.push({
            webIdx: wi, localIdx: li,
            nameScore, spatialScore, categoryScore, confidence,
            matchType: 'snippet_fuzzy', // 区别于 title 的 fuzzy
          })
        }
      }
    }
  }

  // 按置信度降序排列，贪心匹配（每个 web/local 只匹配一次）
  scoreMatrix.sort((a, b) => b.confidence - a.confidence)

  for (const entry of scoreMatrix) {
    if (usedWebIndices.has(entry.webIdx) || usedLocalIndices.has(entry.localIdx)) continue

    matched.push({
      webItem: expandedWeb[entry.webIdx],
      localPoi: localPois[entry.localIdx],
      confidence: entry.confidence,
      nameScore: entry.nameScore,
      spatialScore: entry.spatialScore,
      categoryScore: entry.categoryScore,
      matchType: entry.matchType,
    })
    usedWebIndices.add(entry.webIdx)
    usedLocalIndices.add(entry.localIdx)
  }

  const unmatchedWeb = expandedWeb.filter((_, i) => !usedWebIndices.has(i))
  const unmatchedLocal = localPois.filter((_, i) => !usedLocalIndices.has(i))

  return { matched, unmatchedWeb, unmatchedLocal }
}

// ── 融合排序算法 ──

/** 权重配置 */
const FUSION_WEIGHTS = {
  webMention: 0.15,    // 联网搜索被提及权重
  localRating: 0.15,   // 数据库自身评分权重
  distance: 0.20,      // 距离衰减权重
  categoryRelevance: 0.15, // 类别匹配度
  matchConfidence: 0.35,   // 实体对齐置信度（权重提升，弱匹配自然排后）
}

/** dual_verified 融合分数最低门槛（低于此值的匹配降级） */
const DUAL_VERIFIED_FUSION_FLOOR = 0.40

/**
 * 根据匹配类型确定融合截断阈值
 * exact/fuzzy（确定性名称匹配）要求更高，combined/embedding_rerank（弱匹配）允许更低
 */
function getFusionFloor(matchType: string): number {
  if (matchType === 'exact' || matchType === 'fuzzy') return 0.45
  // snippet_fuzzy / combined / embedding_rerank / spatial 等弱匹配类型
  return 0.35
}

/**
 * 融合排序：不强制 top-k，按信号自然截断
 */
function fusionRank(
  matched: AlignmentMatch[],
  unmatchedWeb: WebSearchItem[],
  unmatchedLocal: LocalPoiItem[],
  maxResults: number,
): RankedResult[] {
  const results: RankedResult[] = []

  // 双端验证的结果
  for (const m of matched) {
    const webMentionScore = Math.min((m.webItem.mentionCount || 1) / 3, 1)
    const localRatingScore = m.localPoi.score != null ? Math.min(m.localPoi.score / 5, 1) : 0.5
    const distanceScore = computeSpatialProximity(m.localPoi.distance_m, m.localPoi.categoryMain)
    const categoryScore = m.categoryScore
    const matchScore = m.confidence

    const fusionScore =
      webMentionScore * FUSION_WEIGHTS.webMention +
      localRatingScore * FUSION_WEIGHTS.localRating +
      distanceScore * FUSION_WEIGHTS.distance +
      categoryScore * FUSION_WEIGHTS.categoryRelevance +
      matchScore * FUSION_WEIGHTS.matchConfidence

    results.push({
      name: m.localPoi.name,
      fusionScore,
      verification: 'dual_verified',
      localPoi: m.localPoi,
      webItem: m.webItem,
      alignment: m,
      distance_m: m.localPoi.distance_m,
      category: m.localPoi.category || m.localPoi.categoryMain,
    })
  }

  // 仅数据库有的结果（无网评佐证）
  for (const local of unmatchedLocal) {
    const localRatingScore = local.score != null ? Math.min(local.score / 5, 1) : 0.5
    const distanceScore = computeSpatialProximity(local.distance_m, local.categoryMain)

    const fusionScore =
      localRatingScore * (FUSION_WEIGHTS.localRating + FUSION_WEIGHTS.webMention * 0.3) +
      distanceScore * FUSION_WEIGHTS.distance +
      0.3 * FUSION_WEIGHTS.categoryRelevance +
      0.0 * FUSION_WEIGHTS.matchConfidence

    results.push({
      name: local.name,
      fusionScore,
      verification: 'local_only',
      localPoi: local,
      distance_m: local.distance_m,
      category: local.category || local.categoryMain,
    })
  }

  // 仅网上提及的结果（数据库未收录）
  for (const web of unmatchedWeb) {
    const webMentionScore = Math.min((web.mentionCount || 1) / 3, 1)
    const ratingScore = web.rating != null ? Math.min(web.rating / 5, 1) : 0.3

    const fusionScore =
      webMentionScore * FUSION_WEIGHTS.webMention +
      ratingScore * FUSION_WEIGHTS.localRating * 0.5 +
      0.0 * FUSION_WEIGHTS.distance +
      0.3 * FUSION_WEIGHTS.categoryRelevance +
      0.0 * FUSION_WEIGHTS.matchConfidence

    results.push({
      name: web.title,
      fusionScore,
      verification: 'web_only',
      webItem: web,
    })
  }

  // ── 质量截断：fusionScore 过低的 dual_verified 降级 ──
  for (const r of results) {
    const floor = r.alignment ? getFusionFloor(r.alignment.matchType) : DUAL_VERIFIED_FUSION_FLOOR
    if (r.verification === 'dual_verified' && r.fusionScore < floor) {
      // 弱匹配降级：有 local 的变 local_only，否则变 web_only
      if (r.localPoi) {
        r.verification = 'local_only'
        delete r.webItem
        delete r.alignment
      } else if (r.webItem) {
        r.verification = 'web_only'
        delete r.localPoi
        delete r.alignment
      }
    }
  }

  // 按融合得分降序排列
  results.sort((a, b) => b.fusionScore - a.fusionScore)

  // 自然截断：不强制 top-k，但限制最大数量
  return results.slice(0, maxResults)
}

// ── Embedding 召回 + Reranker 精排 ──

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] ** 2
    normB += b[i] ** 2
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

/**
 * 构造 POI 描述文本，注入结构化信号增强 embedding 表示
 * 格式："{名称} {类别} 距离{N}m"
 */
function buildPoiDescription(poi: LocalPoiItem): string {
  const parts = [poi.name]
  if (poi.categoryMain) parts.push(poi.categoryMain)
  else if (poi.category) parts.push(poi.category)
  if (poi.distance_m != null && poi.distance_m >= 0) parts.push(`距离${Math.round(poi.distance_m)}m`)
  return parts.join(' ')
}

/**
 * 构造搜索结果描述文本
 * 格式："{标题} {snippet前200字}"
 */
function buildWebDescription(item: WebSearchItem): string {
  const parts = [item.title]
  if (item.snippet) parts.push(item.snippet.slice(0, 200))
  return parts.join(' ')
}

/** Embedding 召回候选对 */
interface RecallCandidate {
  webIdx: number
  localIdx: number
  cosineSim: number
}

/**
 * 阶段2：Embedding 召回
 * 对 Stage1 未匹配的 local/web 对，用 embedding 向量做 brute-force cosine 召回
 * 优先从数据库读取已缓存的 POI embedding，减少 API 调用
 * 返回 top-k 候选对（按 cosine 降序）
 */
async function embeddingRecall(
  bridge: EmbedRerankBridge,
  unmatchedWeb: WebSearchItem[],
  unmatchedLocal: LocalPoiItem[],
  topKPerLocal = 3,
  cosineThreshold = 0.45,
  dbQuery?: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>,
): Promise<RecallCandidate[]> {
  if (unmatchedWeb.length === 0 || unmatchedLocal.length === 0) return []

  // 批量生成 web embedding（每次都要重新计算）
  const webTexts = unmatchedWeb.map(buildWebDescription)
  const webEmb = await bridge.embed(webTexts)

  // 尝试从数据库读取已缓存的 POI embedding
  let localEmbeddings: number[][] | null = null
  if (dbQuery) {
    try {
      const poiIds = unmatchedLocal.map(p => p.id).filter(Boolean)
      if (poiIds.length > 0) {
        const result = await dbQuery(
          'SELECT id, embedding::text AS emb_text FROM pois WHERE id = ANY($1) AND embedding IS NOT NULL',
          [poiIds],
        )
        const embMap = new Map<string, number[]>()
        for (const row of result.rows) {
          try { embMap.set(String(row.id), JSON.parse(row.emb_text as string)) } catch { /* skip */ }
        }
        // 按顺序组装，缺失的标记为 null
        localEmbeddings = unmatchedLocal.map(p => {
          const id = p.id != null ? String(p.id) : ''
          return embMap.get(id) || null as unknown as number[]
        })
        // 检查是否全部命中
        const allCached = localEmbeddings.every(v => v && v.length > 0)
        if (!allCached) {
          // 对缺失的 POI 实时 embed
          const missingIndices = localEmbeddings.map((v, i) => (!v || v.length === 0) ? i : -1).filter(i => i >= 0)
          if (missingIndices.length > 0) {
            const missingTexts = missingIndices.map(i => buildPoiDescription(unmatchedLocal[i]))
            const missingEmb = await bridge.embed(missingTexts)
            for (let j = 0; j < missingIndices.length; j++) {
              localEmbeddings[missingIndices[j]] = missingEmb.embeddings[j]
            }
          }
        }
      }
    } catch {
      // 数据库读取失败，fallback 到全量 embed
      localEmbeddings = null
    }
  }

  // fallback：全量 embed
  if (!localEmbeddings) {
    const localTexts = unmatchedLocal.map(buildPoiDescription)
    const localEmb = await bridge.embed(localTexts)
    localEmbeddings = localEmb.embeddings
  }

  if (webEmb.count === 0 || !localEmbeddings || localEmbeddings.length === 0) return []

  // brute-force cosine：每个 local 找 top-k 最相似的 web
  const candidates: RecallCandidate[] = []
  for (let li = 0; li < localEmbeddings.length; li++) {
    const localVec = localEmbeddings[li]
    if (!localVec || localVec.length === 0) continue
    const scored: Array<{ webIdx: number; sim: number }> = []

    for (let wi = 0; wi < webEmb.count; wi++) {
      const sim = cosineSimilarity(localVec, webEmb.embeddings[wi])
      if (sim >= cosineThreshold) {
        scored.push({ webIdx: wi, sim })
      }
    }

    // 取 top-k
    scored.sort((a, b) => b.sim - a.sim)
    for (const s of scored.slice(0, topKPerLocal)) {
      candidates.push({ webIdx: s.webIdx, localIdx: li, cosineSim: round3(s.sim) })
    }
  }

  // 全局按 cosine 降序，限制最大候选数（CPU 模式下 reranker 是瓶颈）
  candidates.sort((a, b) => b.cosineSim - a.cosineSim)
  return candidates.slice(0, 30)
}

/**
 * 阶段3：Reranker 精排
 * 对 Embedding 召回的候选对，用 cross-encoder reranker 做精排
 * 返回超过阈值的匹配对
 */
async function rerankerRefine(
  bridge: EmbedRerankBridge,
  candidates: RecallCandidate[],
  unmatchedWeb: WebSearchItem[],
  unmatchedLocal: LocalPoiItem[],
  rerankThreshold = 0.5,
): Promise<Array<{ webIdx: number; localIdx: number; rerankScore: number }>> {
  if (candidates.length === 0) return []

  // 构造 reranker 输入
  const pairs = candidates.map(c => ({
    query: buildPoiDescription(unmatchedLocal[c.localIdx]),
    document: buildWebDescription(unmatchedWeb[c.webIdx]),
  }))

  const result = await bridge.rerank(pairs)

  // 过滤低分对
  return result.scores
    .filter(s => s.score >= rerankThreshold && s.index >= 0 && s.index < candidates.length)
    .map(s => ({
      webIdx: candidates[s.index].webIdx,
      localIdx: candidates[s.index].localIdx,
      rerankScore: round3(s.score),
    }))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ── Skill 定义 ──

const entityAlignmentActions: Record<string, SkillActionDefinition> = {
  align_and_rank: {
    name: 'align_and_rank',
    description: '将联网搜索结果与本地 POI 进行实体对齐，然后融合排序',
    inputSchema: {
      type: 'object',
      required: ['web_results', 'local_pois'],
      properties: {
        web_results: {
          type: 'array',
          description: '联网搜索结果列表',
        },
        local_pois: {
          type: 'array',
          description: '本地 POI 数据库结果列表',
        },
        max_results: {
          type: 'number',
          description: '最大返回结果数（默认 30）',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        ranked_results: { type: 'array' },
        alignment_summary: { type: 'object' },
      },
    },
  },
}

export interface CreateEntityAlignmentSkillOptions {
  bridge?: EmbedRerankBridge
  /** 数据库查询函数（用于读取已缓存的 POI embedding） */
  query?: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
  /** Embedding 召回时每个 local 的 top-k 候选数（默认 3） */
  recallTopK?: number
  /** Embedding cosine 阈值（默认 0.55） */
  recallCosineThreshold?: number
  /** Reranker 通过阈值（默认 0.5） */
  rerankThreshold?: number
}

export function createEntityAlignmentSkill(options: CreateEntityAlignmentSkillOptions = {}): SkillDefinition {
  const bridge = options.bridge || new LocalFallbackBridge()
  const dbQuery = options.query
  const recallTopK = options.recallTopK ?? 5
  const recallCosineThreshold = options.recallCosineThreshold ?? 0.35
  const rerankThreshold = options.rerankThreshold ?? 0.25

  return {
    name: 'entity_alignment',
    description: '联网搜索结果与本地 POI 实体对齐 + 融合排序（Embedding+Reranker）',
    capabilities: ['entity_alignment', 'fusion_ranking'],
    actions: entityAlignmentActions,
    async execute(action, payload, _context) {
      if (action !== 'align_and_rank') {
        return {
          ok: false,
          error: { code: 'unknown_action', message: `Unknown action "${action}"` },
          meta: { action, audited: false },
        }
      }

      const input = payload as {
        web_results: WebSearchItem[]
        local_pois: LocalPoiItem[]
        max_results?: number
        category_key?: string | null
        category_main?: string | null
        category_sub?: string | null
        search_driven_local_recall?: boolean
        disable_distance_bias?: boolean
      }

      const webResults = Array.isArray(input.web_results) ? input.web_results : []
      const originalLocalPois = Array.isArray(input.local_pois) ? input.local_pois : []
      const maxResults = input.max_results || 30
      const searchDrivenLocalRecall = input.search_driven_local_recall === true
      const disableDistanceBias = input.disable_distance_bias === true
      const recalledLocalPois = searchDrivenLocalRecall && dbQuery
        ? await recallLocalPoisFromWebResults(webResults, {
            query: dbQuery,
            categoryKey: input.category_key,
            categoryMain: input.category_main,
            categorySub: input.category_sub,
          })
        : []
      const localPois = dedupeLocalPois([
        ...originalLocalPois,
        ...recalledLocalPois,
      ]).map((poi) => ({
        ...poi,
        distance_m: disableDistanceBias ? null : poi.distance_m,
      }))

      // ── 阶段 1：确定性实体对齐 ──
      const deterministicStart = Date.now()
      const { matched, unmatchedWeb, unmatchedLocal } = alignEntities(webResults, localPois)
      const deterministicMs = Date.now() - deterministicStart

      // ── 阶段 2：Embedding 召回 ──
      const embedStart = Date.now()
      let embedMs = 0
      let embedCandidateCount = 0
      let rerankMs = 0
      let rerankMatchedCount = 0

      try {
        const recallCandidates = await embeddingRecall(
          bridge,
          unmatchedWeb,
          unmatchedLocal,
          recallTopK,
          recallCosineThreshold,
          dbQuery,
        )
        embedMs = Date.now() - embedStart
        embedCandidateCount = recallCandidates.length

        // ── 阶段 3：Reranker 精排 ──
        const rerankStart = Date.now()

        const rerankMatches = await rerankerRefine(
          bridge,
          recallCandidates,
          unmatchedWeb,
          unmatchedLocal,
          rerankThreshold,
        )
        rerankMs = Date.now() - rerankStart

        // 将 Reranker 匹配结果合并到 matched 列表
        const usedRecallWebIndices = new Set<number>()
        const usedRecallLocalIndices = new Set<number>()

        for (const rm of rerankMatches) {
          if (usedRecallWebIndices.has(rm.webIdx) || usedRecallLocalIndices.has(rm.localIdx)) continue

          const webItem = unmatchedWeb[rm.webIdx]
          const localPoi = unmatchedLocal[rm.localIdx]

          if (matched.some(m => m.localPoi === localPoi || m.webItem === webItem)) continue

          // 名称交叉验证：embedding_rerank 匹配必须有名称信号支撑
          // 防止"喜茶"匹配到"奈雪的茶"（语义相关但非同一实体）
          const cleanLocal = cleanPoiName(localPoi.name)
          const webTitle = webItem.title || ''
          // 验证1：POI 核心品牌名在 web title 中出现
          const localCoreWord = cleanLocal.slice(0, Math.min(cleanLocal.length, 4))
          const hasTitleCrossRef = localCoreWord.length >= 2 && (
            cleanPoiName(webTitle).includes(localCoreWord) || webTitle.includes(cleanLocal)
          )
          // 验证2：清洗后名称编辑距离 ≥ 0.5（展开后的 web title 必须与 POI 名足够相似）
          const nameSimAfterClean = computeNameSimilarity(webTitle, localPoi.name)
          const isNameSimilarEnough = nameSimAfterClean >= 0.5
          // 两个验证都不通过且 rerank 分数不够高，跳过
          // rerankScore ≥ 0.7 视为强语义信号，即使名称不匹配也可信
          if (!hasTitleCrossRef && !isNameSimilarEnough && rm.rerankScore < 0.7) {
            continue
          }

          usedRecallWebIndices.add(rm.webIdx)
          usedRecallLocalIndices.add(rm.localIdx)
          rerankMatchedCount++

          matched.push({
            webItem,
            localPoi,
            confidence: rm.rerankScore,
            nameScore: rm.rerankScore,
            spatialScore: computeSpatialProximity(localPoi.distance_m, localPoi.categoryMain),
            categoryScore: 0.7,
            matchType: 'fuzzy',
          })
        }
      } catch {
        // Embedding/Reranker 阶段失败，不影响确定性阶段结果
        embedMs = Date.now() - embedStart
      }

      // 重新计算 unmatchedLocal（排除新匹配的）
      const finalUnmatchedLocal = localPois.filter((_, i) =>
        !matched.some(m => m.localPoi === localPois[i])
      )

      // 重新计算 unmatchedWeb（排除 Reranker 新匹配的，防止重复计入 web_only）
      const finalUnmatchedWeb = unmatchedWeb.filter(
        w => !matched.some(m => m.webItem === w)
      )

      // 融合排序
      const rankedResults = fusionRank(matched, finalUnmatchedWeb, finalUnmatchedLocal, maxResults)

      // 统计摘要
      const dualVerified = rankedResults.filter(r => r.verification === 'dual_verified').length
      const localOnly = rankedResults.filter(r => r.verification === 'local_only').length
      const webOnly = rankedResults.filter(r => r.verification === 'web_only').length

      return {
        ok: true,
        data: {
          ranked_results: rankedResults,
          alignment_summary: {
            total_web_results: webResults.length,
            total_local_pois: localPois.length,
            search_recalled_local_pois: recalledLocalPois.length,
            matched_count: matched.length,
            unmatched_web_count: unmatchedWeb.length,
            unmatched_local_count: finalUnmatchedLocal.length,
            dual_verified: dualVerified,
            local_only: localOnly,
            web_only: webOnly,
            avg_match_confidence: matched.length > 0
              ? +(matched.reduce((sum, m) => sum + m.confidence, 0) / matched.length).toFixed(3)
              : 0,
            // 各阶段耗时
            deterministic_ms: deterministicMs,
            embed_recall_ms: embedMs,
            rerank_ms: rerankMs,
            embed_candidate_count: embedCandidateCount,
            rerank_matched_count: rerankMatchedCount,
          },
        },
        meta: {
          action: 'align_and_rank',
          audited: true,
        },
      }
    },
  }
}

// 导出用于单元测试
export {
  computeNameSimilarity,
  computeSpatialProximity,
  computeCategoryConsistency,
  alignEntities,
  fusionRank,
  cleanPoiName,
  extractPoiNamesFromSingleResult,
  expandWebResults,
  looksLikePoiName,
  // Embedding + Reranker 阶段
  cosineSimilarity,
  buildPoiDescription,
  buildWebDescription,
  embeddingRecall,
  rerankerRefine,
}
