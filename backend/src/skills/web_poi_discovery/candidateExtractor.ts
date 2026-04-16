/**
 * 候选提取 + 过滤 + 排序模块
 * 移植自 backend/scripts/test_full_pipeline.mjs
 */
import type { SceneProfile } from './types.js'

/** 候选地点（旧链路遗留类型，仅 candidateExtractor 内部使用） */
interface VenueCandidate {
  name: string
  label: string
  snippet: string
  count?: number
  score?: number
}
import { isNoiseEntity as isProfileNoiseEntity, scoreVenueCandidate } from './sceneProfile.js'

const ADMIN_REGION_NAMES = new Set([
  '武汉市', '武昌区', '江汉区', '江岸区', '硚口区', '洪山区', '汉阳区',
  '青山区', '东西湖区', '蔡甸区', '江夏区', '黄陂区', '新洲区', '经开区',
  '武汉', '湖北', '湖北省', '汉口', '武昌', '汉阳', '光谷',
  '上海', '北京', '深圳', '广州', '张家口', '成都', '重庆', '南京',
])

export const DISTRICT_ALIAS_MAP: Record<string, string[]> = {
  武昌区: ['武昌'],
  江汉区: ['江汉', '汉口'],
  江岸区: ['江岸', '汉口'],
  硚口区: ['硚口', '汉口'],
  汉阳区: ['汉阳'],
  洪山区: ['洪山', '光谷'],
  青山区: ['青山'],
  东西湖区: ['东西湖', '金银湖'],
  蔡甸区: ['蔡甸'],
  江夏区: ['江夏'],
  黄陂区: ['黄陂'],
  新洲区: ['新洲'],
}

const EXTRA_NOISE_PATTERNS = [
  /队太长/u,
  /价格太高/u,
  /品牌店$/u,
  /快时尚/u,
  /有限公司$/u,
  /社区服务$/u,
  /经营部$/u,
  /投递部$/u,
  /代理$/u,
  /充电$/u,
  /停车场$/u,
  /洗手间$/u,
  /卫生间$/u,
  /母婴室$/u,
  /快递$/u,
  /物流$/u,
  /仓储$/u,
]

const CANDIDATE_CHAR_NORMALIZATION = new Map([
  ['徳', '德'], ['鬥', '斗'], ['級', '级'], ['營', '营'],
  ['書', '书'], ['會', '会'], ['員', '员'], ['區', '区'],
  ['門', '门'], ['漢', '汉'], ['馬', '马'], ['樓', '楼'],
  ['廣', '广'], ['風', '风'], ['東', '东'], ['國', '国'],
])

const GENERIC_VENUE_DESCRIPTOR_PATTERN = /^(老字号|特色|热门|高分|人气|本地|传统|推荐|精选|宝藏|经典|必吃|适合散步的|适合游玩的|国家级的|休闲的|值得一去的|适合赏樱的)(?:景点|景区|公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场|餐厅|饭店|面馆|酒楼|食府|火锅店|牛排馆|小吃店|鸭脖店|酒店|宾馆|民宿|客栈|旅馆|公寓)$/u

const CANDIDATE_CONTEXT_PREFIX_PATTERNS = [
  /^(在|于|位于|坐落于|除了|还有|以及|其中|例如|比如|像|包括|包含)/u,
  /^(适合(?:独自)?(?:散步|徒步|骑行|游玩|赏樱)的|非常适合(?:散步|游玩)的)/u,
  /^(人气超旺的|国家级的|值得一去的|值得打卡的|休闲的|串联景区公园的|设计为|用于)/u,
  /^(这堪称[^的]{0,8}的|中午或晚上在一些特殊的)/u,
  /^(打造|精品|殿堂级|顶级|高端|特色|本地|传统|老牌|知名|著名|网红|宝藏|经典)/u,
]

const DESCRIPTIVE_PREFIX_PATTERN = /^(打造|精品|殿堂级|顶级|高端|特色|本地|传统|老牌|知名|著名|网红|宝藏|经典|人气|高分|热门|推荐|精选|必吃)/u

const CANDIDATE_CONNECTOR_SPLIT_PATTERN = /(?:、|，|,|；|;|\/|以及|还有|或者|位于|坐落于|例如|比如|包括|包含|其中|并且|同时|加上|搭配)/u

const NOISY_CONNECTIVE_PATTERN = /(以及|还有|或者|位于|坐落于|例如|比如|包括|包含|其中|并且|同时)/u

const FOOD_LOCATION_NOISE_PATTERN = /(软件园|产业园|科技园|工业园|园区|写字楼|办公楼|商务楼|大厦|校区|社区|小区|地铁站|车站|机场|火车站|高铁站)/u
const FOOD_ENTITY_HINT_PATTERN = /(餐厅|饭店|面馆|酒楼|食府|火锅|烧烤|小吃|甜品|奶茶|咖啡|茶饮|饮品|牛排|烤肉|汉堡|披萨|卤味|鸭脖|店|馆|厅|坊|轩|府|锅|面|粉|鱼|鸭|鸡|虾|茶|酒|饼|串|汤)/u

export function normalizeCandidateName(name: string): string {
  let normalized = String(name || '').trim()
  for (const [source, target] of CANDIDATE_CHAR_NORMALIZATION.entries()) {
    normalized = normalized.split(source).join(target)
  }
  return normalized.replace(/\s+/g, '')
}

export function isNoiseEntity(name: string): boolean {
  const n = normalizeCandidateName(name)
  if (!n || n.length < 2) return true
  if (ADMIN_REGION_NAMES.has(n)) return true
  if (EXTRA_NOISE_PATTERNS.some((p) => p.test(n))) return true
  if (/\d{3,}/.test(n)) return true
  if (GENERIC_VENUE_DESCRIPTOR_PATTERN.test(n)) return true
  if (NOISY_CONNECTIVE_PATTERN.test(n) && n.length > 10) return true
  return isProfileNoiseEntity(n)
}

function stripCandidateContext(text: string): string {
  let normalized = String(text || '').trim()
  let previous = ''

  while (normalized && normalized !== previous) {
    previous = normalized
    for (const pattern of CANDIDATE_CONTEXT_PREFIX_PATTERNS) {
      normalized = normalized.replace(pattern, '').trim()
    }
    normalized = normalized
      .replace(/^[、，,；;和与及或或者]+/u, '')
      .replace(/(?:之一|一带|附近|周边|路线|线路)$/u, '')
      .trim()
  }

  return normalized
}

function escapeRegex(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAtomicVenueSuffixes(profile: SceneProfile): string[] {
  if (profile.key === 'food') return ['咖啡馆', '咖啡店', '茶饮店', '饮品店', '牛排馆', '火锅店', '小吃店', '甜品店', '奶茶店', '鸭脖店', '咖啡', '餐厅', '饭店', '面馆', '酒楼', '食府']
  if (profile.key === 'scenic') return ['湿地公园', '森林公园', '植物园', '博物馆', '纪念馆', '步行街', '景区', '景点', '故居', '古迹', '江滩', '公园', '寺', '庙', '塔', '楼']
  if (profile.key === 'park') return ['湿地公园', '森林公园', '植物园', '公园', '绿道', '江滩', '步道', '广场']
  if (profile.key === 'hotel') return ['度假村', '酒店', '宾馆', '民宿', '客栈', '旅馆', '公寓']
  if (profile.key === 'metro_station') return ['换乘站', '地铁站', '站口', '车站']
  return []
}

function buildAtomicVenuePattern(profile: SceneProfile): RegExp | null {
  const suffixes = getAtomicVenueSuffixes(profile)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)

  if (!suffixes.length) return null
  return new RegExp(`([\\u4e00-\\u9fffA-Za-z]{2,24}(?:${suffixes.join('|')}))`, 'gu')
}

function isGenericVenuePhrase(name: string, profile: SceneProfile | null = null): boolean {
  const n = normalizeCandidateName(name)
  if (!n) return true
  if (GENERIC_VENUE_DESCRIPTOR_PATTERN.test(n)) return true
  if (/(?:的|是|对|以及|还有|或者|位于|坐落于|包括|包含|例如|比如|其中|行业|评选|颁奖|授牌)/u.test(n)) return true
  if (/^(?:景点|景区|公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场|餐厅|饭店|面馆|酒楼|食府|火锅店|牛排馆|小吃店|鸭脖店|酒店|宾馆|民宿|客栈|旅馆|公寓)$/u.test(n)) return true

  if (profile) {
    const suffix = getAtomicVenueSuffixes(profile).find((s) => n.endsWith(s))
    if (suffix) {
      const core = n.slice(0, -suffix.length)
      if (!core || core.length < 2) return true
      if (/^(?:家|户|个)[\u4e00-\u9fff]{0,3}$/u.test(core)) return true
      if (/^(?:武汉|汉口|武昌|江城|老街区)(?:高端|热门|人气|名点|优秀|推荐|旅行|美食|小吃|地道)$/u.test(core)) return true
      if (/(?:高端|热门|人气|优秀|名点|旅行|老街区)$/u.test(core) && /^(?:武汉|汉口|武昌|江城)/u.test(core)) return true
    }
  }

  return false
}

function splitRegexCandidate(name: string, profile: SceneProfile): string[] {
  const normalized = stripCandidateContext(normalizeCandidateName(name))
  const pieces = new Set<string>()
  const atomicPattern = buildAtomicVenuePattern(profile)

  const pushPiece = (value: string) => {
    const cleaned = stripCandidateContext(normalizeCandidateName(value))
    if (!cleaned) return
    if (!isGenericVenuePhrase(cleaned, profile)) {
      pieces.add(cleaned)
    }
    if (atomicPattern) {
      for (const match of cleaned.matchAll(atomicPattern)) {
        const atomic = stripCandidateContext(normalizeCandidateName(match[1] || ''))
        if (!atomic || isGenericVenuePhrase(atomic, profile)) continue
        pieces.add(atomic)
      }
    }
  }

  pushPiece(normalized)
  for (const segment of normalized.split(CANDIDATE_CONNECTOR_SPLIT_PATTERN)) {
    pushPiece(segment)
  }

  return [...pieces].filter(Boolean)
}

function buildRegexPatterns(profile: SceneProfile): RegExp[] {
  if (profile.key === 'food') return [/([\u4e00-\u9fffA-Za-z]{2,18}(?:餐厅|饭店|面馆|酒楼|食府|火锅店|烧麦馆|牛排馆|小吃店|甜品店|奶茶店|茶饮店|饮品店|咖啡馆|咖啡店|咖啡|鸭脖店))/gu]
  if (profile.key === 'scenic') return [/([\u4e00-\u9fffA-Za-z]{2,18}(?:景区|景点|公园|博物馆|纪念馆|故居|古迹|寺|庙|塔|楼|步行街|江滩))/gu]
  if (profile.key === 'park') return [/([\u4e00-\u9fffA-Za-z]{2,20}(?:公园|绿道|江滩|湿地公园|植物园|森林公园|步道|广场))/gu]
  if (profile.key === 'hotel') return [/([\u4e00-\u9fffA-Za-z]{2,18}(?:酒店|宾馆|民宿|客栈|旅馆|公寓))/gu]
  return []
}

export function extractRegexCandidates(
  contents: Array<{ content: string }>,
  profile: SceneProfile,
): VenueCandidate[] {
  const patterns = buildRegexPatterns(profile)
  if (!patterns.length) return []

  const candidates: VenueCandidate[] = []
  for (const item of contents) {
    const text = String(item?.content || '')
    if (!text) continue

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const splitCandidates = splitRegexCandidate(match[1] || '', profile)
        for (const name of splitCandidates) {
          if (!name || isNoiseEntity(name)) continue
          if (DESCRIPTIVE_PREFIX_PATTERN.test(name)) continue
          candidates.push({ name, label: 'regex', snippet: name })
        }
      }
    }
  }

  return candidates
}

export function enrichContentsWithSearchMetadata(
  searchResults: Array<{ url?: string; title?: string; snippet?: string }>,
  contents: Array<{ url: string; title: string; content: string }>,
): Array<{ url: string; title: string; content: string }> {
  const resultByUrl = new Map(
    searchResults.filter((r) => r.url).map((r) => [r.url, r]),
  )

  return contents.map((item) => {
    const searchMeta = resultByUrl.get(item.url) || searchResults.find((c) => c.title === item.title)
    if (!searchMeta) return item

    const enrichedContent = [
      searchMeta.title,
      searchMeta.snippet,
      item.content,
    ].filter(Boolean).join('\n')

    return {
      ...item,
      title: searchMeta.title || item.title,
      content: enrichedContent,
    }
  })
}

export function rankVenueCandidates(
  rawVenues: VenueCandidate[],
  profile: SceneProfile,
  minimumScore = 1,
): VenueCandidate[] {
  const venueMap = new Map<string, VenueCandidate & { count: number; score: number }>()

  for (const venue of rawVenues) {
    const name = normalizeCandidateName(venue?.name || '')
    const label = String(venue?.label || '').trim()

    if (!name || isNoiseEntity(name)) continue
    if (isGenericVenuePhrase(name, profile)) continue
    if (profile.key === 'food' && /(科技馆|博物馆|纪念馆|公园|江滩|绿道|步行街|体育馆|体育场)/u.test(name)) continue
    if (profile.key === 'food' && FOOD_LOCATION_NOISE_PATTERN.test(name) && !FOOD_ENTITY_HINT_PATTERN.test(name)) continue
    if (profile.key === 'food' && label === 'SHOP' && /(店|总店)$/u.test(name) && !/[锅馆面饭粉包烧麦酒楼餐厅食府火锅小吃鸭脖鱼虾鸡]/u.test(name)) continue

    const score = scoreVenueCandidate(name, label, profile)
    if (score < minimumScore) continue

    const existing = venueMap.get(name)
    if (!existing) {
      venueMap.set(name, {
        name, label, count: 1, score,
        snippet: String(venue?.snippet || '').trim(),
      })
      continue
    }

    existing.count += 1
    existing.score = Math.max(existing.score, score) + 1
  }

  return [...venueMap.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.count !== a.count) return b.count - a.count
    return b.name.length - a.name.length
  })
}

export function mentionsOutOfScopeArea(name: string, districts: string[]): boolean {
  if (!districts || !districts.length) return false

  const normalized = normalizeCandidateName(name)
  for (const district of districts) {
    const aliases = DISTRICT_ALIAS_MAP[district] || [district.replace(/区$/, '')]
    for (const alias of aliases) {
      if (normalized.includes(alias)) return false
    }
  }

  // 检查是否包含任何已知区域名（但不在目标districts中的）
  for (const [district, aliases] of Object.entries(DISTRICT_ALIAS_MAP)) {
    if (districts.includes(district)) continue
    for (const alias of aliases) {
      if (normalized.includes(alias) && alias.length >= 2) return true
    }
  }

  return false
}
