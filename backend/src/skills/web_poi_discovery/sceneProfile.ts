/**
 * 场景画像模块
 * 移植自 backend/scripts/lib/query_scene_profile.mjs
 */
import type { SceneProfile } from './types.js'

const CATEGORY_DEFINITIONS = [
  {
    key: 'food' as const,
    label: '美食',
    aliases: ['美食', '餐饮', '餐厅', '餐馆', '吃饭', '小吃', '宵夜', '夜宵', '早餐', '外卖', '咖啡', '奶茶', '火锅', '烧烤', '面馆', '甜品', '茶馆', '酒楼', '食府', '饮品'],
    searchTokens: ['餐厅', '小吃', '推荐', '必吃', '咖啡', '奶茶'],
    dbCategoryMains: ['餐饮服务', '餐饮美食'],
    dbCategorySubs: [],  // 由查询动态推断
    includeKeywords: ['餐厅', '饭店', '馆', '店', '酒楼', '食府', '小吃', '火锅', '烧烤', '面馆', '甜品', '奶茶'],
    excludeKeywords: ['学校', '学院', '大学', '政府', '官网', '网站', '个人中心', '创作者中心', '游戏中心', '微博', '酒店', '宾馆', '民宿', '住宿', '探店'],
    preferredDomains: ['dianping.com', 'meituan.com', 'xiaohongshu.com', 'douyin.com', 'zhihu.com', 'sohu.com'],
  },
  {
    key: 'hotel' as const,
    label: '酒店',
    aliases: ['酒店', '宾馆', '民宿', '住宿', '旅馆', '客栈', '住店'],
    searchTokens: ['酒店', '住宿', '推荐', '口碑'],
    dbCategoryMains: ['住宿服务'],
    dbCategorySubs: [],
    includeKeywords: ['酒店', '宾馆', '民宿', '客栈', '旅馆', '度假村', '公寓'],
    excludeKeywords: ['学校', '学院', '大学', '政府', '官网', '网站', '个人中心', '创作者中心', '游戏中心'],
    preferredDomains: ['ctrip.com', 'qunar.com', 'meituan.com', 'tuniu.com', 'zhihu.com', 'booking.com'],
  },
  {
    key: 'scenic' as const,
    label: '景点',
    aliases: ['景点', '景区', '景观', '旅游景点', '名胜', '打卡地', '参观', '游览', '游玩', '好玩'],
    searchTokens: ['景点', '攻略', '推荐', '打卡'],
    dbCategoryMains: ['风景名胜', '科教文化服务'],
    dbCategorySubs: [],
    includeKeywords: ['景区', '景点', '博物馆', '纪念馆', '故居', '古迹', '塔', '楼', '寺', '庙', '步行街', '江滩', '公园'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站', '教程', '书店', '酒店', '住宿'],
    preferredDomains: ['you.ctrip.com', 'ctrip.com', 'mafengwo.cn', 'qyer.com', 'dianping.com', 'zhihu.com', 'sohu.com'],
  },
  {
    key: 'park' as const,
    label: '公园',
    aliases: ['公园', '绿道', '江滩', '湿地', '植物园', '森林公园', '步道', '绿地', '广场', '运动', '散步'],
    searchTokens: ['公园', '绿道', '散步', '推荐'],
    dbCategoryMains: ['风景名胜', '体育休闲服务'],
    dbCategorySubs: [],
    includeKeywords: ['公园', '江滩', '绿道', '湿地', '植物园', '森林公园', '步道', '花园', '湖'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站', '教程', '面包', '甜点', '书店', '酒店', '住宿'],
    preferredDomains: ['wuhan.gov.cn', 'dianping.com', 'you.ctrip.com', 'ctrip.com', 'sohu.com', 'qq.com', 'zhihu.com'],
  },
  {
    key: 'metro_station' as const,
    label: '地铁站',
    aliases: ['地铁站', '地铁', '站口', '出口', '换乘', '轨道交通'],
    searchTokens: ['地铁站', '站口', '换乘'],
    dbCategoryMains: ['交通设施服务'],
    dbCategorySubs: [],
    includeKeywords: ['地铁站', '站口', '出口', '换乘'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站'],
    preferredDomains: ['wuhan.gov.cn', 'qq.com', 'zhihu.com'],
  },
]

/** 子品类推断映射：查询关键词 → DB category_sub 值 */
const SUB_CATEGORY_MAP: Record<string, string[]> = {
  '咖啡': ['咖啡'],
  '咖啡馆': ['咖啡'],
  '咖啡店': ['咖啡'],
  '奶茶': ['蛋糕甜品店'],
  '甜品': ['蛋糕甜品店'],
  '蛋糕': ['蛋糕甜品店'],
  '火锅': ['火锅'],
  '烧烤': ['烧烤'],
  '面馆': ['面馆'],
  '小吃': ['小吃快餐'],
  '快餐': ['小吃快餐'],
  '中餐': ['中国菜'],
  '西餐': ['外国菜'],
  '日料': ['外国菜'],
  '日式': ['外国菜'],
  '韩餐': ['外国菜'],
  '韩国料理': ['外国菜'],
}

function inferCategorySubs(query: string, categoryKey?: string): string[] {
  if (categoryKey !== 'food') return []
  const subs: string[] = []
  for (const [keyword, dbSubs] of Object.entries(SUB_CATEGORY_MAP)) {
    if (query.includes(keyword)) {
      subs.push(...dbSubs)
    }
  }
  return [...new Set(subs)]
}

const SCENE_DEFINITIONS = [
  {
    key: 'tourism',
    aliases: ['旅游', '旅行', '出游', '游玩', '攻略', '打卡', '好去处', '值得去', '值得一去'],
    primaryCategoryKey: 'scenic',
    secondaryCategoryKeys: ['park'],
    searchTokens: ['攻略', '打卡', '推荐'],
  },
  {
    key: 'cherry_blossom',
    aliases: ['樱花', '赏樱', '看樱花', '樱花季', '花海'],
    primaryCategoryKey: 'park',
    secondaryCategoryKeys: ['scenic'],
    searchTokens: ['赏樱', '樱花', '春游'],
  },
  {
    key: 'walking',
    aliases: ['散步', '遛弯', '漫步', '溜达', '吸氧', '放空', '徒步', '运动', '休闲'],
    primaryCategoryKey: 'park',
    secondaryCategoryKeys: ['scenic'],
    searchTokens: ['散步', '步道', '绿道'],
  },
]

const GENERIC_NOISE_PATTERNS = [
  /^个人中心$/u,
  /^创作者中心$/u,
  /^游戏中心$/u,
  /^首页$/u,
  /^登录$/u,
  /^注册$/u,
  /^会员中心$/u,
  /^湖北省政府网$/u,
  /探店/u,
  /微博探店/u,
  /攻略$/u,
  /榜单$/u,
  /排行榜$/u,
  /教程$/u,
  /官网$/u,
  /网站$/u,
  /客户端$/u,
  /小程序$/u,
  /下载App/u,
  /创作者/u,
]

const PLATFORM_NOISE_PATTERNS = [
  /创作者/u,
]

const FOOD_BRAND_LIKE_SUFFIX = /(记|家|铺|馆|店|楼|坊|轩|府|村|肆|堂|居)$/u
const SCENIC_SUFFIX = /(楼|塔|寺|庙|馆|园|湖|山|街|滩|桥|故居|古迹|遗址)$/u

function unique(values: string[] = []): string[] {
  return [...new Set(values.filter(Boolean))]
}

function normalize(text: unknown): string {
  return String(text || '').trim().toLowerCase()
}

function compactSearchQuery(query: string, profile: SceneProfile): string {
  const normalized = String(query || '')
    .replace(/[？?！!。,.，、]/g, ' ')
    .replace(/有哪些|有什么|有啥|哪里|哪儿|这块|帮我|请问|一下|一下子|适合|推荐的/u, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return ''

  return unique([
    ...normalized.split(/\s+/),
    ...(profile.searchTokens || []),
  ]).join(' ')
}

interface DefinitionMatch {
  definition: typeof CATEGORY_DEFINITIONS[0]
  hits: string[]
  score: number
}

function matchDefinitions(
  definitions: typeof CATEGORY_DEFINITIONS,
  probes: string[],
): DefinitionMatch[] {
  return definitions
    .map((definition) => {
      const hits = definition.aliases.filter((alias) =>
        probes.some((probe) => probe.includes(alias.toLowerCase())),
      )
      return {
        definition,
        hits,
        score: hits.reduce((sum, alias) => sum + alias.length, 0),
      }
    })
    .filter((item) => item.hits.length > 0)
    .sort((left, right) => right.score - left.score || right.hits.length - left.hits.length)
}

export function inferQuerySceneProfile(query: string): SceneProfile {
  const normalizedQuery = normalize(query)
  const probes = [normalizedQuery]
  const matchedCategories = matchDefinitions(CATEGORY_DEFINITIONS, probes)
  const matchedScenes = SCENE_DEFINITIONS
    .map((def) => {
      const hits = def.aliases.filter((a) => probes.some((p) => p.includes(a)))
      return {
        definition: def,
        hits,
        score: hits.reduce((s, a) => s + a.length, 0),
      }
    })
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => b.score - a.score || b.hits.length - a.hits.length)

  const primaryCategory = matchedCategories[0]?.definition
    || (matchedScenes[0]
      ? CATEGORY_DEFINITIONS.find((d) => d.key === matchedScenes[0].definition.primaryCategoryKey)
      : null)
    || CATEGORY_DEFINITIONS.find((d) => d.key === 'scenic')

  const resolvedCategoryKeys = unique([
    primaryCategory?.key,
    ...matchedCategories.map((x) => x.definition.key),
    ...matchedScenes.flatMap((x) => [
      x.definition.primaryCategoryKey,
      ...(x.definition.secondaryCategoryKeys || []),
    ]),
  ].filter(Boolean) as string[])

  const preferredDomains = unique([
    ...(primaryCategory?.preferredDomains || []),
    ...(resolvedCategoryKeys.flatMap((k) =>
      CATEGORY_DEFINITIONS.find((d) => d.key === k)?.preferredDomains || [])),
  ])

  const includeKeywords = unique([
    ...(primaryCategory?.includeKeywords || []),
    ...(resolvedCategoryKeys.flatMap((k) =>
      CATEGORY_DEFINITIONS.find((d) => d.key === k)?.includeKeywords || [])),
  ])

  const excludeKeywords = unique([
    ...(primaryCategory?.excludeKeywords || []),
    ...(resolvedCategoryKeys.flatMap((k) =>
      CATEGORY_DEFINITIONS.find((d) => d.key === k)?.excludeKeywords || [])),
  ])

  const searchTokens = unique([
    ...(primaryCategory?.searchTokens || []),
    ...matchedScenes.flatMap((x) => x.definition.searchTokens || []),
  ])

  const dbCategoryMains = unique(resolvedCategoryKeys.flatMap((k) =>
    CATEGORY_DEFINITIONS.find((d) => d.key === k)?.dbCategoryMains || []))

  // 根据查询中的子品类词推断 dbCategorySubs
  const dbCategorySubs = inferCategorySubs(query, primaryCategory?.key)

  return {
    key: primaryCategory?.key || 'scenic',
    label: primaryCategory?.label || '景点',
    matchedScenes: matchedScenes.map((x) => x.definition.key),
    resolvedCategoryKeys,
    preferredDomains,
    includeKeywords,
    excludeKeywords,
    searchTokens,
    dbCategoryMains,
    dbCategorySubs,
  }
}

export function buildSearchQueries(query: string, profile: SceneProfile, city = '武汉'): string[] {
  // 去除泛化词，保留核心品类词
  const cleanedQuery = String(query || '')
    .replace(/[？?！!。,.，、]/g, ' ')
    .replace(/有哪些|有什么|有啥|哪里|哪儿|这块|帮我|请问|一下|一下子|适合|推荐|附近的/u, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 主查询：城市 + 清洗后的query
  const geoQuery = cleanedQuery ? `${city} ${cleanedQuery}`.trim() : `${city} ${query}`.trim()

  // 扩展查询：城市 + 清洗后query + 品类token（最多2个）
  const additions = profile.searchTokens
    .filter((t) => t && !cleanedQuery.includes(t))
    .slice(0, 2)
  const expanded = additions.length > 0
    ? `${city} ${cleanedQuery} ${additions.join(' ')}`.trim()
    : ''

  return unique([geoQuery, expanded]).filter(Boolean)
}

interface SearchResultItem {
  url?: string
  title?: string
  snippet?: string
  content?: string
}

export function scoreSearchResult(result: SearchResultItem, profile: SceneProfile): number {
  const url = String(result.url || '')
  let hostname = ''
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    hostname = ''
  }

  const title = String(result.title || '')
  const snippet = String(result.snippet || result.content || '')
  const haystack = `${title} ${snippet}`.toLowerCase()

  let score = 0
  const preferredIndex = profile.preferredDomains.findIndex((d) => hostname.includes(d))
  if (preferredIndex >= 0) {
    score += Math.max(30 - preferredIndex * 2, 10)
  }

  for (const token of profile.searchTokens) {
    if (title.includes(token)) score += 8
    if (snippet.includes(token)) score += 3
  }

  for (const keyword of profile.includeKeywords) {
    if (title.includes(keyword)) score += 4
    if (snippet.includes(keyword)) score += 1
  }

  if (/为什么|英文名|游戏下载|论坛|小说|电影|电视剧/u.test(title)) {
    score -= 25
  }

  if (/个人中心|创作者中心|游戏中心|登录|注册|微博/u.test(haystack)) {
    score -= 25
  }

  if (/\/search\/|[?&](q|query|keyword|wd)=/u.test(url)) {
    score -= 28
  }

  if (/douyin\.com\/search|xiaohongshu\.com\/search|zhihu\.com\/search/u.test(url)) {
    score -= 32
  }

  return score
}

export function isNoiseEntity(name: string): boolean {
  const normalized = String(name || '').trim()
  if (!normalized || normalized.length < 2) return true
  if (normalized.length > 20) return true
  if (GENERIC_NOISE_PATTERNS.some((p) => p.test(normalized))) return true
  if (/[0-9]{4,}/.test(normalized)) return true
  if (/(个人|创作者|游戏|服务|登录|注册|下载|关注|攻略|推荐|榜单|排行|官网|网站)/u.test(normalized)) return true
  return false
}

export function scoreVenueCandidate(name: string, label: string, profile: SceneProfile): number {
  const n = String(name || '').trim()
  if (isNoiseEntity(n)) return -100

  let score = 0

  for (const k of profile.excludeKeywords) {
    if (n.includes(k)) score -= 12
  }
  for (const k of profile.includeKeywords) {
    if (n.includes(k)) score += 5
  }

  if (label === 'SHOP' || label === 'FAC' || label === 'regex' || label === 'ADJ+NOUN') {
    score += 3
  }
  if ((label === 'GPE' || label === 'LOC') && !SCENIC_SUFFIX.test(n) && !n.includes('公园')) {
    score -= 5
  }

  if (profile.key === 'food') {
    if (/(学院|大学|政府|中心|网站|论坛|小路|大道|中路)/u.test(n)) score -= 15
    if (/(酒店|宾馆|民宿|住宿|探店)/u.test(n)) score -= 18
    if (/(酒楼|食府)/u.test(n) && !/(咖啡|奶茶|茶饮|饮品|火锅|烧烤)/u.test(n)) score -= 20
    if (/(软件园|产业园|科技园|工业园|园区|写字楼|办公楼|商务楼|大厦|校区|社区|小区|地铁站|车站|机场|火车站|高铁站)/u.test(n) && !/(餐厅|饭店|面馆|酒楼|食府|火锅|烧烤|小吃|甜品|奶茶|咖啡|茶饮|饮品|牛排|烤肉|汉堡|披萨|卤味|鸭脖|店|馆|厅|坊|轩|府|锅|面|粉|鱼|鸭|鸡|虾|茶|酒|饼|串|汤)/u.test(n)) score -= 22
    if (/这个时候/u.test(n)) score -= 18
    if (/^各.+店$/u.test(n)) score -= 18
    if (/^[一-鿿]{2,8}(路|街|城|巷|里|广场|中心)(分店|总店|店)$/u.test(n)) score -= 16
    if (/^[一-鿿]{2,5}(路|街|大道|巷|里)(店|总店)$/u.test(n)) score -= 14
    if (FOOD_BRAND_LIKE_SUFFIX.test(n)) score += 4
    if (/总店$/u.test(n) && !/[锅馆店楼面粉鱼鸭鸡虾饼串汤脖烧麦]/u.test(n)) score -= 8
    if (!/[店馆厅楼坊轩府锅面粉鱼鸭鸡虾茶酒饼串汤]/u.test(n) && !FOOD_BRAND_LIKE_SUFFIX.test(n)) {
      score -= 8
    }
  }

  if (profile.key === 'hotel') {
    if (/(学院|大学|政府|中心|网站)/u.test(n)) score -= 12
    if (/(酒店|宾馆|民宿|旅馆|客栈|公寓)/u.test(n)) score += 6
    if (!/(酒店|宾馆|民宿|旅馆|客栈|公寓)/u.test(n)) score -= 6
  }

  if (profile.key === 'park') {
    if (/(书店|酒店|住宿)/u.test(n)) score -= 16
    if (/(公园|江滩|绿道|湿地|植物园|森林公园|步道|花园|湖)/u.test(n)) score += 8
    if (!/(公园|江滩|绿道|湿地|植物园|森林公园|步道|花园|湖|山|滩)/u.test(n)) score -= 5
  }

  if (profile.key === 'scenic') {
    if (/(书店|酒店|住宿)/u.test(n)) score -= 16
    if (/(景区|景点|博物馆|纪念馆|故居|古迹|塔|楼|寺|庙|步行街|江滩|公园)/u.test(n)) score += 7
    if (SCENIC_SUFFIX.test(n)) score += 4
  }

  if (profile.matchedScenes.includes('walking') && /(公园|江滩|绿道|步道|湖|湿地)/u.test(n)) {
    score += 5
  }
  if (profile.matchedScenes.includes('cherry_blossom') && /(樱花|植物园|大学|公园)/u.test(n)) {
    score += 4
  }

  return score
}

export function isAcceptableDbRow(candidateName: string, rowName: string, profile: SceneProfile): boolean {
  const c = String(candidateName || '').trim()
  const t = String(rowName || '').trim()
  if (!c || !t) return false
  if (t === c) return true
  if (t.startsWith(c)) return true

  if (profile.key === 'food' || profile.key === 'hotel') {
    return t.startsWith(c)
  }

  return false
}
