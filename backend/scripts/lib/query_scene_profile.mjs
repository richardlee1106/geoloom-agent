const CATEGORY_DEFINITIONS = [
  {
    key: 'food',
    label: '美食',
    aliases: ['美食', '餐饮', '餐厅', '餐馆', '吃饭', '小吃', '宵夜', '夜宵', '早餐'],
    searchTokens: ['餐厅', '小吃', '推荐', '必吃'],
    dbCategoryMains: ['餐饮服务', '餐饮美食'],
    includeKeywords: ['餐厅', '饭店', '馆', '店', '酒楼', '食府', '小吃', '火锅', '烧烤', '面馆', '甜品', '奶茶'],
    excludeKeywords: ['学校', '学院', '大学', '政府', '官网', '网站', '个人中心', '创作者中心', '游戏中心', '微博', '酒店', '宾馆', '民宿', '住宿', '探店'],
    preferredDomains: ['dianping.com', 'meituan.com', 'xiaohongshu.com', 'douyin.com', 'zhihu.com', 'sohu.com'],
  },
  {
    key: 'hotel',
    label: '酒店',
    aliases: ['酒店', '宾馆', '民宿', '住宿', '旅馆', '客栈'],
    searchTokens: ['酒店', '住宿', '推荐', '口碑'],
    dbCategoryMains: ['住宿服务'],
    includeKeywords: ['酒店', '宾馆', '民宿', '客栈', '旅馆', '度假村', '公寓'],
    excludeKeywords: ['学校', '学院', '大学', '政府', '官网', '网站', '个人中心', '创作者中心'],
    preferredDomains: ['ctrip.com', 'qunar.com', 'meituan.com', 'tuniu.com', 'zhihu.com'],
  },
  {
    key: 'scenic',
    label: '景点',
    aliases: ['景点', '景区', '景观', '旅游景点', '名胜', '打卡地'],
    searchTokens: ['景点', '攻略', '推荐', '打卡'],
    dbCategoryMains: ['风景名胜', '科教文化服务'],
    includeKeywords: ['景区', '景点', '博物馆', '纪念馆', '故居', '古迹', '塔', '楼', '寺', '庙', '步行街', '江滩', '公园'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站', '教程', '书店', '酒店', '住宿'],
    preferredDomains: ['you.ctrip.com', 'ctrip.com', 'mafengwo.cn', 'qyer.com', 'visitwuhan.com', 'wuhan.gov.cn', 'zhihu.com', 'sohu.com'],
  },
  {
    key: 'park',
    label: '公园',
    aliases: ['公园', '绿道', '江滩', '湿地', '植物园', '森林公园', '步道', '绿地'],
    searchTokens: ['公园', '绿道', '散步', '推荐'],
    dbCategoryMains: ['风景名胜', '体育休闲服务'],
    includeKeywords: ['公园', '江滩', '绿道', '湿地', '植物园', '森林公园', '步道', '花园', '湖'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站', '教程', '面包', '甜点', '书店', '酒店', '住宿'],
    preferredDomains: ['wuhan.gov.cn', 'visitwuhan.com', 'you.ctrip.com', 'ctrip.com', 'sohu.com', 'qq.com', 'zhihu.com'],
  },
  {
    key: 'metro_station',
    label: '地铁站',
    aliases: ['地铁站', '地铁', '站口', '出口', '换乘'],
    searchTokens: ['地铁站', '站口', '换乘'],
    dbCategoryMains: ['交通设施服务'],
    includeKeywords: ['地铁站', '站口', '出口', '换乘'],
    excludeKeywords: ['个人中心', '创作者中心', '游戏中心', '官网', '网站'],
    preferredDomains: ['wuhan.gov.cn', 'qq.com', 'zhihu.com'],
  },
]

const SCENE_DEFINITIONS = [
  {
    key: 'tourism',
    aliases: ['旅游', '旅行', '出游', '游玩', '攻略', '打卡', '好去处', '值得去'],
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
    aliases: ['散步', '遛弯', '漫步', '溜达', '吸氧', '放空'],
    primaryCategoryKey: 'park',
    secondaryCategoryKeys: ['scenic'],
    searchTokens: ['散步', '步道', '绿道'],
  },
]

const GENERIC_NOISE_PATTERNS = [
  /^个人中心$/,
  /^创作者中心$/,
  /^游戏中心$/,
  /^首页$/,
  /^登录$/,
  /^注册$/,
  /^湖北省政府网$/,
  /^会员中心$/,
  /探店/u,
  /微博探店/,
  /攻略$/,
  /榜单$/,
  /排行榜$/,
  /教程$/,
  /官网$/,
  /网站$/,
  /客户端$/,
  /小程序$/,
  /下载App/u,
  /创作者/u,
]

const FOOD_BRAND_LIKE_SUFFIX = /(记|家|铺|馆|店|楼|坊|轩|园|府|村|肆|堂|居)$/u
const SCENIC_SUFFIX = /(楼|塔|寺|庙|馆|园|湖|山|街|滩|桥|故居|古迹|遗址)$/u

function unique(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function normalize(text) {
  return String(text || '').trim().toLowerCase()
}

function compactSearchQuery(query, profile) {
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

function matchDefinitions(definitions, probes) {
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

export function inferQuerySceneProfile(query) {
  const normalizedQuery = normalize(query)
  const probes = [normalizedQuery]
  const matchedCategories = matchDefinitions(CATEGORY_DEFINITIONS, probes)
  const matchedScenes = matchDefinitions(SCENE_DEFINITIONS, probes)
  const primaryCategory = matchedCategories[0]?.definition
    || (matchedScenes[0]
      ? CATEGORY_DEFINITIONS.find((definition) => definition.key === matchedScenes[0].definition.primaryCategoryKey)
      : null)
    || CATEGORY_DEFINITIONS.find((definition) => definition.key === 'scenic')

  const resolvedCategoryKeys = unique([
    primaryCategory?.key,
    ...matchedCategories.map((item) => item.definition.key),
    ...matchedScenes.flatMap((item) => [
      item.definition.primaryCategoryKey,
      ...(item.definition.secondaryCategoryKeys || []),
    ]),
  ])

  const preferredDomains = unique([
    ...(primaryCategory?.preferredDomains || []),
    ...resolvedCategoryKeys.flatMap((key) =>
      CATEGORY_DEFINITIONS.find((definition) => definition.key === key)?.preferredDomains || []),
  ])

  const includeKeywords = unique([
    ...(primaryCategory?.includeKeywords || []),
    ...resolvedCategoryKeys.flatMap((key) =>
      CATEGORY_DEFINITIONS.find((definition) => definition.key === key)?.includeKeywords || []),
  ])

  const excludeKeywords = unique([
    ...(primaryCategory?.excludeKeywords || []),
    ...resolvedCategoryKeys.flatMap((key) =>
      CATEGORY_DEFINITIONS.find((definition) => definition.key === key)?.excludeKeywords || []),
  ])

  const searchTokens = unique([
    ...(primaryCategory?.searchTokens || []),
    ...matchedScenes.flatMap((item) => item.definition.searchTokens || []),
  ])

  const dbCategoryMains = unique(resolvedCategoryKeys.flatMap((key) =>
    CATEGORY_DEFINITIONS.find((definition) => definition.key === key)?.dbCategoryMains || []))

  return {
    key: primaryCategory?.key || 'scenic',
    label: primaryCategory?.label || '景点',
    matchedScenes: matchedScenes.map((item) => item.definition.key),
    resolvedCategoryKeys,
    preferredDomains,
    includeKeywords,
    excludeKeywords,
    searchTokens,
    dbCategoryMains,
  }
}

export function buildSearchQueries(query, profile) {
  const additions = profile.searchTokens
    .filter((token) => token && !String(query || '').includes(token))
    .slice(0, 3)

  const expanded = additions.length > 0
    ? `${query} ${additions.join(' ')}`
    : String(query || '')

  const compact = compactSearchQuery(query, profile)

  return unique([String(query || '').trim(), expanded.trim(), compact.trim()]).filter(Boolean)
}

export function scoreSearchResult(result, profile) {
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
  const preferredIndex = profile.preferredDomains.findIndex((domain) => hostname.includes(domain))
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

export function isNoiseEntity(name) {
  const normalizedName = String(name || '').trim()
  if (!normalizedName || normalizedName.length < 2) return true
  if (normalizedName.length > 20) return true
  if (GENERIC_NOISE_PATTERNS.some((pattern) => pattern.test(normalizedName))) return true
  if (/[0-9]{4,}/.test(normalizedName)) return true
  if (/(个人|创作者|游戏|服务|登录|注册|下载|关注|攻略|推荐|榜单|排行|官网|网站)/u.test(normalizedName)) return true
  return false
}

export function scoreVenueCandidate(name, label, profile) {
  const normalizedName = String(name || '').trim()
  if (isNoiseEntity(normalizedName)) return -100

  let score = 0

  for (const keyword of profile.excludeKeywords) {
    if (normalizedName.includes(keyword)) score -= 12
  }

  for (const keyword of profile.includeKeywords) {
    if (normalizedName.includes(keyword)) score += 5
  }

  if (label === 'SHOP' || label === 'FAC' || label === 'regex' || label === 'ADJ+NOUN') {
    score += 3
  }

  if ((label === 'GPE' || label === 'LOC') && !SCENIC_SUFFIX.test(normalizedName) && !normalizedName.includes('公园')) {
    score -= 5
  }

  if (profile.key === 'food') {
    if (/(学院|大学|政府|中心|网站|论坛|小路|大道|中路)/u.test(normalizedName)) score -= 15
    if (/(酒店|宾馆|民宿|住宿|探店)/u.test(normalizedName)) score -= 18
    if (/这个时候/u.test(normalizedName)) score -= 18
    if (/^各.+店$/u.test(normalizedName)) score -= 18
    if (/^[\u4e00-\u9fff]{2,8}(路|街|城|巷|里|广场|中心)(分店|总店|店)$/u.test(normalizedName)) score -= 16
    if (/^[\u4e00-\u9fff]{2,5}(路|街|大道|巷|里)(店|总店)$/u.test(normalizedName)) score -= 14
    if (FOOD_BRAND_LIKE_SUFFIX.test(normalizedName)) score += 4
    if (/总店$/u.test(normalizedName) && !/[锅馆店楼面粉鱼鸭鸡虾饼串汤脖烧麦]/u.test(normalizedName)) score -= 8
    if (!/[店馆厅楼坊轩府锅面粉鱼鸭鸡虾茶酒饼串汤]/u.test(normalizedName) && !FOOD_BRAND_LIKE_SUFFIX.test(normalizedName)) {
      score -= 8
    }
  }

  if (profile.key === 'hotel') {
    if (/(学院|大学|政府|中心|网站)/u.test(normalizedName)) score -= 12
    if (/(酒店|宾馆|民宿|旅馆|客栈|公寓)/u.test(normalizedName)) score += 6
    if (!( /(酒店|宾馆|民宿|旅馆|客栈|公寓)/u.test(normalizedName) )) score -= 6
  }

  if (profile.key === 'park') {
    if (/(书店|酒店|住宿)/u.test(normalizedName)) score -= 16
    if (/(公园|江滩|绿道|湿地|植物园|森林公园|步道|花园|湖)/u.test(normalizedName)) score += 8
    if (!/(公园|江滩|绿道|湿地|植物园|森林公园|步道|花园|湖|山|滩)/u.test(normalizedName)) score -= 5
  }

  if (profile.key === 'scenic') {
    if (/(书店|酒店|住宿)/u.test(normalizedName)) score -= 16
    if (/(景区|景点|博物馆|纪念馆|故居|古迹|塔|楼|寺|庙|步行街|江滩|公园)/u.test(normalizedName)) score += 7
    if (SCENIC_SUFFIX.test(normalizedName)) score += 4
  }

  if (profile.matchedScenes.includes('walking') && /(公园|江滩|绿道|步道|湖|湿地)/u.test(normalizedName)) {
    score += 5
  }

  if (profile.matchedScenes.includes('cherry_blossom') && /(樱花|植物园|大学|公园)/u.test(normalizedName)) {
    score += 4
  }

  return score
}

export function isAcceptableDbRow(candidateName, rowName, profile) {
  const candidate = String(candidateName || '').trim()
  const target = String(rowName || '').trim()
  if (!candidate || !target) return false
  if (target === candidate) return true
  if (target.startsWith(candidate)) return true

  if (profile.key === 'food' || profile.key === 'hotel') {
    return target.startsWith(candidate)
  }

  return false
}
