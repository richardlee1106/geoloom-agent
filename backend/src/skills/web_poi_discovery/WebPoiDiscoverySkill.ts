/**
 * Web POI Discovery Skill V2 — 新链路
 *
 * 链路: SceneProfile -> DB shortlist -> Tavily Search(1-2 query)
 *     -> Tavily Extract(top 4-6 URL, query+chunks_per_source)
 *     -> LLM mention extraction -> mention归一化
 *     -> shortlist匹配 -> 输出分桶
 *
 * 去掉了 crawl4ai + NER 依赖。
 * 全程保持 DB-first，不会把网页里脏实体直接带进地图。
 */

import type { SkillDefinition, SkillExecutionResult, SkillExecutionContext } from '../types.js'
import type { DependencyStatus } from '../../integration/dependencyStatus.js'
import type {
  SceneProfile,
  PoiDiscoveryResult,
  PipelineTimings,
  ExtractedChunkItem,
  WebMention,
  ShortlistPoi,
  MentionMatch,
  DiscoveryScopeInput,
} from './types.js'
import { inferQuerySceneProfile, buildSearchQueries, scoreSearchResult, scoreVenueCandidate } from './sceneProfile.js'
import { TavilyExtractClient } from './tavilyExtractClient.js'
import { MentionExtractor } from './mentionExtractor.js'
import { MentionNormalizer, type NormalizedMentionGroup } from './mentionNormalizer.js'
import { ShortlistMatcher, type DbQueryFn } from './shortlistMatcher.js'
import type { EmbedRerankBridge } from '../../integration/jinaBridge.js'
import { JinaBridge, LocalFallbackBridge } from '../../integration/jinaBridge.js'

interface SearchHit {
  url: string
  title: string
  snippet: string
}

interface WebPoiDiscoveryOptions {
  tavilyApiKey: string
  tavilyTimeoutMs?: number
  query: DbQueryFn
  /** LLM 配置（用于 mention 提取） */
  llmBaseUrl?: string
  llmApiKey?: string
  llmModel?: string
  /** Jina 配置（用于 shortlist 向量召回/rerank） */
  jinaApiKey?: string
  maxSearchRounds?: number
  maxResults?: number
}

const MAX_TAVILY_RESULTS = 6
const MAX_EXTRACT_URLS = 6
const MAX_SHORTLIST_SIZE = 200
const DB_ONLY_HEAD_MULTIPLIER = 6
const MAX_MENTION_CHUNKS = 4
const DYNAMIC_DOMAIN_BLOCK_THRESHOLD = 2

const STATIC_BLOCKED_EXTRACT_DOMAINS = [
  'zhihu.com',
  'douyin.com',
]

const STATIC_BLOCKED_EXTRACT_URL_PATTERNS = [
  /\/\/(?:www\.)?xiaohongshu\.com\/search(?:\/|\?|$)/iu,
  /\/\/(?:www\.)?zhihu\.com\/search(?:\/|\?|$)/iu,
  /\/\/(?:www\.)?douyin\.com\/search(?:\/|\?|$)/iu,
]

const DEFAULT_SITE_CONFIG = {
  global_domains: [
    'wuhan.gov.cn', 'visitwuhan.com', 'ctrip.com', 'you.ctrip.com',
    'mafengwo.cn', 'qyer.com', 'dianping.com', 'meituan.com',
    'qunar.com', 'tuniu.com', 'xiaohongshu.com', 'douyin.com',
    'zhihu.com', 'sohu.com', 'qq.com',
  ],
  scene_domains: {
    food: ['dianping.com', 'meituan.com', 'xiaohongshu.com', 'douyin.com', 'zhihu.com', 'sohu.com'],
    hotel: ['ctrip.com', 'you.ctrip.com', 'qunar.com', 'meituan.com', 'tuniu.com', 'zhihu.com'],
    scenic: ['visitwuhan.com', 'wuhan.gov.cn', 'you.ctrip.com', 'ctrip.com', 'mafengwo.cn', 'qyer.com', 'zhihu.com', 'sohu.com'],
    park: ['wuhan.gov.cn', 'visitwuhan.com', 'you.ctrip.com', 'ctrip.com', 'qq.com', 'zhihu.com', 'sohu.com'],
    metro_station: ['wuhan.gov.cn', 'qq.com', 'zhihu.com'],
  },
}

function normalizeHostname(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    const candidate = raw.includes('://') ? raw : `https://${raw}`
    return new URL(candidate).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '')
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function isBlockedDomain(hostname: string, blockedDomains: Iterable<string>): boolean {
  const host = normalizeHostname(hostname)
  if (!host) return false
  for (const blocked of blockedDomains) {
    const blockedHost = normalizeHostname(blocked)
    if (!blockedHost) continue
    if (host === blockedHost || host.endsWith(`.${blockedHost}`)) {
      return true
    }
  }
  return false
}

function isBlockedExtractUrl(url: string, blockedDomains: Iterable<string>, blockedUrls: Iterable<string> = []): boolean {
  if ([...blockedUrls].includes(url)) return true
  const hostname = extractHostname(url)
  if (isBlockedDomain(hostname, blockedDomains)) return true
  return STATIC_BLOCKED_EXTRACT_URL_PATTERNS.some((pattern) => pattern.test(url))
}

function collectHostnames(urls: string[]): string[] {
  const hosts = new Set<string>()
  for (const url of urls) {
    const host = extractHostname(url)
    if (host) hosts.add(host)
  }
  return [...hosts]
}

const PROFILE_MENTION_RULES: Record<SceneProfile['key'], {
  include: RegExp
  exclude: RegExp
  baseThreshold: number
  strongThreshold?: number
}> = {
  food: {
    include: /(餐厅|饭店|餐馆|酒楼|食府|小吃|火锅|烧烤|面馆|粉面|甜品|奶茶|茶饮|饮品|咖啡|coffee|cafe|café|restaurant|bistro|bbq|hotpot|dessert|tea)/iu,
    exclude: /(大学|学院|政府|官网|网站|教程|攻略|榜单|公园|江滩|绿道|博物馆|纪念馆|酒店|宾馆|民宿|住宿|写字楼|园区|校区|车站|机场)/u,
    baseThreshold: 2,
    strongThreshold: 4,
  },
  hotel: {
    include: /(酒店|宾馆|民宿|旅馆|客栈|公寓|饭店|度假村|hotel|inn|hostel|resort|suite|apartment)/iu,
    exclude: /(大学|学院|政府|官网|网站|教程|攻略|榜单|公园|景区|景点|博物馆|纪念馆|餐厅|咖啡|奶茶)/u,
    baseThreshold: 3,
  },
  scenic: {
    include: /(景区|景点|博物馆|纪念馆|故居|古迹|遗址|塔|楼|寺|庙|步行街|江滩|公园|museum|temple|tower|park|lake|street|memorial)/iu,
    exclude: /(酒店|宾馆|民宿|住宿|书店|大学|学院|校区|写字楼|办公楼|餐厅|咖啡|奶茶)/u,
    baseThreshold: 3,
  },
  park: {
    include: /(公园|江滩|绿道|湿地|植物园|森林公园|步道|花园|湖|山|park|garden|wetland|greenway|trail|lake)/iu,
    exclude: /(酒店|宾馆|民宿|住宿|书店|大学|学院|校区|餐厅|咖啡|奶茶|博物馆|纪念馆)/u,
    baseThreshold: 3,
  },
  metro_station: {
    include: /(地铁站|站口|出口|换乘|轨道交通|metro|subway|station)/iu,
    exclude: /(酒店|景区|景点|餐厅|咖啡|公园|博物馆)/u,
    baseThreshold: 3,
  },
}

function buildProfileContextTokens(profile: SceneProfile): string[] {
  return [...new Set([
    ...profile.dbCategorySubs,
    ...profile.searchTokens,
  ])]
    .map((token) => String(token || '').trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !/推荐|攻略|打卡|口碑|必吃|附近|散步/u.test(token))
}

function scoreProfileContextText(text: string, profile: SceneProfile): number {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return 0

  const rule = PROFILE_MENTION_RULES[profile.key]
  let score = 0
  for (const token of buildProfileContextTokens(profile)) {
    if (normalized.includes(token.toLowerCase())) {
      score += token.length >= 3 ? 2 : 1
    }
  }
  if (rule.include.test(normalized)) score += 3
  if (rule.exclude.test(normalized)) score -= 3
  return score
}

function resolveMentionThreshold(profile: SceneProfile): number {
  const rule = PROFILE_MENTION_RULES[profile.key]
  if (!rule) return 2
  if (profile.dbCategorySubs.length > 0 && typeof rule.strongThreshold === 'number') {
    return rule.strongThreshold
  }
  return rule.baseThreshold
}

function scoreMentionGroupByProfile(group: NormalizedMentionGroup, profile: SceneProfile): number {
  let bestScore = scoreVenueCandidate(group.canonicalName, '', profile)
  for (const mention of group.rawMentions) {
    const rawNameScore = Math.max(scoreVenueCandidate(mention.mention, '', profile), 0)
    const nameAndHintScore = scoreProfileContextText(`${mention.mention} ${mention.categoryHint}`, profile)
    const pageTitleScore = Math.min(scoreProfileContextText(mention.pageTitle, profile), 2)
    bestScore = Math.max(bestScore, rawNameScore + nameAndHintScore + pageTitleScore)
  }
  return bestScore
}

function filterMentionGroupsByProfile(groups: NormalizedMentionGroup[], profile: SceneProfile): {
  groups: NormalizedMentionGroup[]
  threshold: number
  fallbackApplied: boolean
  scorePreview: string
} {
  const threshold = resolveMentionThreshold(profile)
  const scoredGroups = groups
    .map((group) => ({
      group,
      score: scoreMentionGroupByProfile(group, profile),
    }))
    .sort((left, right) => right.score - left.score || right.group.maxConfidence - left.group.maxConfidence || right.group.count - left.group.count)

  let kept = scoredGroups.filter((item) => item.score >= threshold)
  let fallbackApplied = false

  if (kept.length === 0 && scoredGroups.length > 0) {
    const relaxedThreshold = Math.max(threshold - 2, 1)
    kept = scoredGroups.filter((item) => item.score >= relaxedThreshold).slice(0, 2)
    fallbackApplied = kept.length > 0
  }

  if (kept.length === 0 && scoredGroups[0]?.score > 0) {
    kept = scoredGroups.slice(0, 1)
    fallbackApplied = true
  }

  return {
    groups: kept.map((item) => item.group),
    threshold,
    fallbackApplied,
    scorePreview: scoredGroups.slice(0, 6).map((item) => `${item.group.canonicalName}:${item.score}`).join(', '),
  }
}

function scoreShortlistPoiByProfile(poi: ShortlistPoi, profile: SceneProfile): number {
  let score = scoreVenueCandidate(poi.name, '', profile)
  const name = String(poi.name || '').trim()
  const categoryMain = String(poi.categoryMain || '').trim()
  const categorySub = String(poi.categorySub || '').trim()

  const genericNamePatterns: Partial<Record<SceneProfile['key'], RegExp>> = {
    food: /^(餐厅|饭店|餐馆|饭馆|酒楼|食府|小吃|面馆|面店|火锅|烧烤|甜品|奶茶|咖啡|茶饮|饮品|小馆)$/u,
    hotel: /^(酒店|宾馆|民宿|旅馆|客栈|公寓)$/u,
    scenic: /^(景点|景区|公园|博物馆|纪念馆|步行街)$/u,
    park: /^(公园|江滩|绿道|步道|花园|湿地)$/u,
    metro_station: /^(地铁站|站口|出口|换乘)$/u,
  }
  const shortAmbiguousPatterns: Partial<Record<SceneProfile['key'], RegExp>> = {
    food: /^[一-鿿A-Za-z]{1,2}(记|家|馆|店|茶)$/u,
    hotel: /^[一-鿿A-Za-z]{1,2}(居|宿|店|馆)$/u,
  }

  if (genericNamePatterns[profile.key]?.test(name)) {
    score -= 20
  }
  if (shortAmbiguousPatterns[profile.key]?.test(name)) {
    score -= 8
  }
  if (name.length <= 2) {
    score -= 6
  }

  if (categoryMain && profile.dbCategoryMains.includes(categoryMain)) {
    score += 6
  } else if (categoryMain) {
    score -= 4
  }

  if (profile.dbCategorySubs.length > 0) {
    if (categorySub && profile.dbCategorySubs.includes(categorySub)) {
      score += 8
    } else if (profile.dbCategorySubs.some((sub) => poi.name.includes(sub))) {
      score += 5
    } else if (categorySub) {
      score -= 3
    }
  }

  if (profile.key === 'food' && categorySub === '其他') {
    score -= 4
  }

  return score
}

function rankShortlistByProfile(shortlist: ShortlistPoi[], profile: SceneProfile): {
  ranked: ShortlistPoi[]
  dbOnlyPool: ShortlistPoi[]
  preview: string
} {
  const scored = shortlist
    .map((poi) => ({
      poi,
      score: scoreShortlistPoiByProfile(poi, profile),
    }))
    .sort((left, right) => right.score - left.score || right.poi.poiScore - left.poi.poiScore || left.poi.name.length - right.poi.name.length)

  const minimumDbOnlyScore = profile.dbCategorySubs.length > 0 ? 4 : 2
  const relaxedPool = scored.filter((item) => item.score >= minimumDbOnlyScore)
  const dbOnlyPool = (relaxedPool.length >= 8 ? relaxedPool : scored)
    .map((item) => item.poi)

  return {
    ranked: scored.map((item) => item.poi),
    dbOnlyPool,
    preview: scored.slice(0, 12).map((item) => `${item.poi.name}:${item.score}`).join(', '),
  }
}

function resolveAllowedDomains(profile: SceneProfile, blockedDomains: Iterable<string> = []): string[] {
  const global = DEFAULT_SITE_CONFIG.global_domains
  const scene = DEFAULT_SITE_CONFIG.scene_domains[profile.key] || []
  const profileDomains = profile.preferredDomains || []
  return [...new Set([...global, ...scene, ...profileDomains])]
    .filter((domain) => !isBlockedDomain(domain, blockedDomains))
    .slice(0, 40)
}

export function createWebPoiDiscoverySkill(options: WebPoiDiscoveryOptions): SkillDefinition {
  const tavilyApiKey = options.tavilyApiKey
  const tavilyTimeoutMs = options.tavilyTimeoutMs || 12000
  const maxSearchRounds = options.maxSearchRounds || 2
  const maxResults = options.maxResults || 10

  const extractClient = new TavilyExtractClient({
    apiKey: tavilyApiKey,
    timeoutMs: tavilyTimeoutMs,
  })

  const mentionLlmBaseUrl = options.llmBaseUrl || process.env.LLM_BASE_URL || ''
  const mentionLlmModel = options.llmModel || process.env.LLM_MODEL || ''
  console.log(`[WebPoiDiscovery] mention提取模型: ${mentionLlmModel || '(未配置)'} @ ${mentionLlmBaseUrl || '(未配置)'}`)

  const mentionExtractor = new MentionExtractor({
    baseUrl: mentionLlmBaseUrl,
    apiKey: options.llmApiKey || process.env.LLM_API_KEY || '',
    model: mentionLlmModel,
    timeoutMs: 4000,
  })

  const normalizer = new MentionNormalizer()

  const jinaBridge: EmbedRerankBridge = options.jinaApiKey || process.env.JINA_API_KEY
    ? new JinaBridge({ apiKey: options.jinaApiKey || process.env.JINA_API_KEY })
    : new LocalFallbackBridge()

  const shortlistMatcher = new ShortlistMatcher({
    query: options.query,
    bridge: jinaBridge,
  })

  return {
    name: 'web_poi_discovery',
    description: '联网搜索→Tavily Extract→LLM mention提取→shortlist匹配，发现真实POI',
    capabilities: ['search_web', 'extract_content', 'mention_extraction', 'shortlist_match'],
    actions: {
      discover_pois: {
        name: 'discover_pois',
        description: '根据自然语言查询，通过联网搜索发现并匹配数据库中的真实POI',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '自然语言查询' },
            districts: { type: 'array', items: { type: 'string' }, description: '目标区域行政区' },
            scope_district_ids: { type: 'array', items: { type: 'number' } },
            scope_wkt: { type: 'string' },
            anchor_lon: { type: 'number' },
            anchor_lat: { type: 'number' },
            radius_m: { type: 'number' },
            scope_context: { type: 'object' },
            max_results: { type: 'number', description: '最大返回数量' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            verifiedDbPois: { type: 'array', description: 'DB已验证POI' },
            shortlist: { type: 'array', description: '按场景重排后的shortlist预览' },
            dbOnlyPois: { type: 'array', description: '仅DB侧POI' },
            webUnresolvedMentions: { type: 'array', description: 'web未匹配mention' },
            topVenues: { type: 'array', description: '最终POI列表' },
            dbMatchCount: { type: 'number', description: 'DB命中数量' },
            searchRounds: { type: 'number' },
          },
        },
      },
    },

    async getStatus() {
      return {
        tavily: {
          name: 'tavily',
          ready: !!tavilyApiKey,
          degraded: !tavilyApiKey,
          mode: 'remote' as const,
        },
        llm: {
          name: 'llm',
          ready: !!(options.llmBaseUrl || process.env.LLM_BASE_URL),
          degraded: !(options.llmBaseUrl || process.env.LLM_BASE_URL),
          mode: 'remote' as const,
        },
        jina: await jinaBridge.getStatus(),
      } satisfies Record<string, DependencyStatus>
    },

    async execute(
      action: string,
      payload: Record<string, unknown>,
      context: SkillExecutionContext,
    ): Promise<SkillExecutionResult<PoiDiscoveryResult>> {
      if (action !== 'discover_pois') {
        return {
          ok: false,
          error: { code: 'UNKNOWN_ACTION', message: `未知 action: ${action}` },
          meta: { action, latencyMs: 0, traceId: context.traceId, audited: false },
        }
      }

      const startMs = Date.now()
      const query = String(payload.query || '').trim()
      const scope = readDiscoveryScope(payload)
      const effectiveMaxResults = Number(payload.max_results) || maxResults

      if (!query) {
        return {
          ok: false,
          error: { code: 'MISSING_QUERY', message: 'query 不能为空' },
          meta: { action, latencyMs: Date.now() - startMs, traceId: context.traceId, audited: false },
        }
      }

      context.logger.info(`[WebPoiDiscovery] 开始V2: query="${query}", scope=${JSON.stringify({
        districts: scope.districts || [],
        districtIds: scope.districtIds || [],
        hasAreaWkt: Boolean(scope.areaWkt),
        anchorLon: scope.anchorLon ?? null,
        anchorLat: scope.anchorLat ?? null,
        radiusM: scope.radiusM ?? null,
      })}`)

      try {
        const result = await runPipeline(query, scope, effectiveMaxResults, {
          tavilyApiKey,
          tavilyTimeoutMs,
          maxSearchRounds,
          extractClient,
          mentionExtractor,
          normalizer,
          shortlistMatcher,
          logger: context.logger as PipelineContext['logger'],
        })

        const totalMs = Date.now() - startMs
        result.timings.total = totalMs

        context.logger.info(
          `[WebPoiDiscovery] V2完成: verified=${result.verifiedDbPois.length}, dbOnly=${result.dbOnlyPois.length}, unresolved=${result.webUnresolvedMentions.length}, 耗时=${totalMs}ms`,
        )

        return {
          ok: true,
          data: result,
          meta: { action, latencyMs: totalMs, traceId: context.traceId, audited: true },
        }
      } catch (err) {
        const totalMs = Date.now() - startMs
        context.logger.error(`[WebPoiDiscovery] V2失败: ${err instanceof Error ? err.message : String(err)}`)
        return {
          ok: false,
          error: { code: 'PIPELINE_ERROR', message: String(err instanceof Error ? err.message : err) },
          meta: { action, latencyMs: totalMs, traceId: context.traceId, audited: false },
        }
      }
    },
  }
}

// ── pipeline 内部实现 ──

interface PipelineContext {
  tavilyApiKey: string
  tavilyTimeoutMs: number
  maxSearchRounds: number
  extractClient: TavilyExtractClient
  mentionExtractor: MentionExtractor
  normalizer: MentionNormalizer
  shortlistMatcher: ShortlistMatcher
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
}

async function runPipeline(
  query: string,
  scope: DiscoveryScopeInput,
  maxResults: number,
  ctx: PipelineContext,
): Promise<PoiDiscoveryResult> {
  const timings: PipelineTimings = {
    profile: 0,
    shortlist: 0,
    search: 0,
    extract: 0,
    mentionExtraction: 0,
    normalization: 0,
    matching: 0,
    total: 0,
  }
  const blockedDomains = new Set<string>(STATIC_BLOCKED_EXTRACT_DOMAINS.map((domain) => normalizeHostname(domain)))
  const blockedUrls = new Set<string>()
  const extractStats = {
    attemptedUrls: 0,
    succeededUrls: 0,
    failedUrls: 0,
    successRate: 0,
    blockedUrls: 0,
    blockedDomains: blockedDomains.size,
  }

  // ── Stage 1: 场景画像 ──
  const profileStart = Date.now()
  const profile = inferQuerySceneProfile(query)
  // 兜底修正
  const correctedProfile = applyProfileCorrection(query, profile)
  timings.profile = Date.now() - profileStart
  ctx.logger.info(`[Pipeline] 场景画像: key=${correctedProfile.key}, label=${correctedProfile.label}`)

  // ── Stage 2: 本地 DB 召回 authoritative shortlist ──
  const shortlistStart = Date.now()
  const rawShortlist = await ctx.shortlistMatcher.recallShortlist(
    correctedProfile,
    scope,
    MAX_SHORTLIST_SIZE,
  )
  const rankedShortlistResult = rankShortlistByProfile(rawShortlist, correctedProfile)
  const shortlist = rankedShortlistResult.ranked
  timings.shortlist = Date.now() - shortlistStart
  ctx.logger.info(`[Pipeline] DB shortlist: ${shortlist.length} 个候选`)
  if (shortlist.length > 0) {
    ctx.logger.info(`[Pipeline] shortlist场景重排: key=${correctedProfile.key}, top=[${rankedShortlistResult.preview}]`)
  }

  // ── Stage 3-7: 搜索轮次 ──
  let searchRound = 0
  let effectiveQuery = query
  const allMentionGroups: NormalizedMentionGroup[] = []
  let verifiedDbPois: MentionMatch[] = []
  let webUnresolvedMentions: WebMention[] = []

  while (searchRound < ctx.maxSearchRounds) {
    searchRound++
    ctx.logger.info(`[Pipeline] 搜索轮次 ${searchRound}, query="${effectiveQuery}"`)

    // Stage 3: Tavily Search（最多 1-2 条 query）
    const searchStart = Date.now()
    const searchResults = await runTavilySearch(effectiveQuery, correctedProfile, ctx, scope.districts || [], blockedDomains, blockedUrls)
    timings.search += Date.now() - searchStart

    ctx.logger.info(`[Pipeline] Tavily返回 ${searchResults.length} 条结果`)

    if (searchResults.length === 0) {
      ctx.logger.warn(`[Pipeline] 搜索无结果，尝试下一轮`)
      if (searchRound >= ctx.maxSearchRounds) break
      effectiveQuery = `武汉 ${query} ${correctedProfile.searchTokens.slice(0, 2).join(' ')}`
      continue
    }

    // Stage 4: Tavily Extract（top 4-6 URL, 带 query + chunks_per_source）
    const extractStart = Date.now()
    const topUrls = searchResults
      .filter((r) => !isBlockedExtractUrl(r.url, blockedDomains, blockedUrls))
      .slice(0, MAX_EXTRACT_URLS)
      .map((r) => ({
        url: r.url,
        title: r.title,
      }))
    const extractResult = await ctx.extractClient.extract(
      topUrls,
      effectiveQuery,
      1, // chunks_per_source
    )
    timings.extract += Date.now() - extractStart

    const succeededUrlCount = new Set(extractResult.chunks.map((item) => item.url)).size
    const failedUrlCount = new Set(extractResult.failedUrls).size
    const roundExtractSuccessRate = topUrls.length > 0
      ? succeededUrlCount / topUrls.length
      : 0
    extractStats.attemptedUrls += topUrls.length
    extractStats.succeededUrls += succeededUrlCount
    extractStats.failedUrls += failedUrlCount
    extractStats.successRate = extractStats.attemptedUrls > 0
      ? Number((extractStats.succeededUrls / extractStats.attemptedUrls).toFixed(3))
      : 0

    ctx.logger.info(
      `[Pipeline] Tavily Extract: ${extractResult.chunks.length} chunks, attempted=${topUrls.length}, succeeded=${succeededUrlCount}, failed=${failedUrlCount}, success=${Math.round((succeededUrlCount / Math.max(topUrls.length, 1)) * 100)}%`,
    )
    if (extractResult.failedUrls.length > 0) {
      ctx.logger.info(`[Pipeline] Extract失败URL: ${extractResult.failedUrls.slice(0, 6).join(', ')}`)
      for (const failedUrl of extractResult.failedUrls) {
        blockedUrls.add(failedUrl)
      }
      const failedHosts = collectHostnames(extractResult.failedUrls)
      const succeededHosts = new Set(collectHostnames(extractResult.chunks.map((item) => item.url)))
      const failedHostCount = new Map<string, number>()
      for (const host of failedHosts) {
        failedHostCount.set(host, (failedHostCount.get(host) || 0) + 1)
      }
      const newBlockedDomains = [...failedHostCount.entries()]
        .filter(([host, count]) => count >= DYNAMIC_DOMAIN_BLOCK_THRESHOLD && !succeededHosts.has(host) && !blockedDomains.has(host))
        .map(([host]) => host)
      if (newBlockedDomains.length > 0) {
        for (const host of newBlockedDomains) blockedDomains.add(host)
        ctx.logger.info(`[Pipeline] 新增Extract失败域名黑名单: ${newBlockedDomains.join(', ')}`)
      }
    }
    extractStats.blockedUrls = blockedUrls.size
    extractStats.blockedDomains = blockedDomains.size

    // 对 extract 失败的 URL，用搜索 snippet 作为后备
    const failedUrlSet = new Set(extractResult.failedUrls)
    const snippetChunks: ExtractedChunkItem[] = searchResults
      .filter((r) => failedUrlSet.has(r.url))
      .map((r) => ({
        url: r.url,
        title: r.title,
        text: `${r.title}\n${r.snippet}`.slice(0, 2000),
      }))
      .filter((c) => c.text.length > 40)

    // 如果 extract 全部失败，把搜索 title 直接作为 mention 候选注入
    let titleMentions: WebMention[] = []
    if (extractResult.chunks.length === 0 && searchResults.length > 0) {
      // 噪声标题模式：文章标题而非店名
      const titleNoisePattern = /知乎|抖音|小红书|百度|微博|头条|哔哩哔哩|bilibili|推荐|攻略|排行榜|榜单|附近|有哪些|十大|盘点|汇总|大全/iu
      titleMentions = searchResults
        .filter(r => r.title && r.title.length >= 2 && r.title.length <= 15)
        .filter(r => !titleNoisePattern.test(r.title))
        .map(r => ({
          mention: r.title.replace(/[|–—··•\-—].*$/u, '').trim(),
          evidenceSpan: r.snippet || '',
          url: r.url,
          pageTitle: r.title,
          areaHint: '',
          categoryHint: '',
          confidence: 0.6,
          isGeneric: false,
        }))
        .filter(m => m.mention.length >= 2)
      ctx.logger.info(`[Pipeline] extract全失败，注入 ${titleMentions.length} 个 title mention`)
    }

    const rankedChunks = [...extractResult.chunks, ...snippetChunks]
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, MAX_MENTION_CHUNKS)
    if (snippetChunks.length > 0) {
      ctx.logger.info(`[Pipeline] snippet后备: +${snippetChunks.length} chunks`)
    }
    ctx.logger.info(`[Pipeline] mention输入chunk: ${rankedChunks.length} 个`)

    if (rankedChunks.length === 0) {
      ctx.logger.warn(`[Pipeline] 无有效 chunk，尝试下一轮`)
      if (searchRound >= ctx.maxSearchRounds) break
      effectiveQuery = `武汉 ${query} ${correctedProfile.searchTokens.slice(0, 2).join(' ')}`
      continue
    }

    // Stage 5: LLM mention 提取（并发）
    const mentionStart = Date.now()
    const categoryHint = correctedProfile.label || ''
    const mentionResult = await ctx.mentionExtractor.extractMentions(rankedChunks, query, 6, categoryHint)
    timings.mentionExtraction += Date.now() - mentionStart

    // 合并 title mention（extract 全失败时的后备）
    const allRawMentions = [...mentionResult.mentions, ...titleMentions]
    ctx.logger.info(
      `[Pipeline] LLM mention提取: ${mentionResult.mentions.length} 个, title后备: ${titleMentions.length}, 耗时=${mentionResult.latencyMs}ms`,
    )

    // Stage 6: mention 归一化
    const normStart = Date.now()
    const mentionGroups = ctx.normalizer.normalize(allRawMentions, correctedProfile)
    const filteredMentionGroupResult = filterMentionGroupsByProfile(mentionGroups, correctedProfile)
    const filteredMentionGroups = filteredMentionGroupResult.groups
    const currentRoundMentionCount = filteredMentionGroups.length
    timings.normalization += Date.now() - normStart

    ctx.logger.info(`[Pipeline] mention归一化: ${mentionGroups.length} 个组`)
    if (filteredMentionGroups.length !== mentionGroups.length || filteredMentionGroupResult.fallbackApplied) {
      ctx.logger.info(`[Pipeline] mention品类过滤: key=${correctedProfile.key}, threshold=${filteredMentionGroupResult.threshold}, ${mentionGroups.length} -> ${filteredMentionGroups.length}${filteredMentionGroupResult.fallbackApplied ? ', fallback=on' : ''}, scores=[${filteredMentionGroupResult.scorePreview}]`)
    }

    // 去重：合并多轮结果
    const existingNames = new Set(allMentionGroups.map((g) => g.canonicalName))
    for (const group of filteredMentionGroups) {
      if (!existingNames.has(group.canonicalName)) {
        allMentionGroups.push(group)
        existingNames.add(group.canonicalName)
      }
    }

    // Stage 7: shortlist 匹配
    const matchStart = Date.now()
    // 诊断：打印 mention 名 vs shortlist 名
    const mentionNames = allMentionGroups.map(g => `${g.canonicalName}[raw=${g.rawMentions.map(r=>r.mention).join('/')}]`).join(', ')
    const shortlistNames = shortlist.slice(0, 15).map(p => p.name).join(', ')
    ctx.logger.info(`[Pipeline] 诊断: mention名=[${mentionNames}]`)
    ctx.logger.info(`[Pipeline] 诊断: shortlist前15=[${shortlistNames}]`)
    const matchResults = await ctx.shortlistMatcher.match(allMentionGroups, shortlist, correctedProfile, scope)
    timings.matching += Date.now() - matchStart

    // 分桶
    verifiedDbPois = matchResults.filter((r) => r.poi !== null)
    webUnresolvedMentions = matchResults
      .filter((r) => r.poi === null)
      .map((r) => ({
        mention: r.mention,
        evidenceSpan: r.evidenceSpan,
        pageTitle: '',
        url: r.url,
        areaHint: '',
        categoryHint: '',
        confidence: r.confidence,
        isGeneric: false,
      }))

    ctx.logger.info(
      `[Pipeline] 匹配结果: verified=${verifiedDbPois.length}, unresolved=${webUnresolvedMentions.length}`,
    )

    // 首轮未验证到任何 DB 命中就停：第二轮扩搜几乎不可能把 unresolved 变成 verified
    if (searchRound === 1 && verifiedDbPois.length === 0) {
      const shouldContinueForRecall = currentRoundMentionCount > 0 && roundExtractSuccessRate >= 0.5
      if (!shouldContinueForRecall) {
        ctx.logger.info(`[Pipeline] 首轮 verified=0，停止继续扩搜（unresolved=${webUnresolvedMentions.length}）`)
        break
      }
      ctx.logger.info(`[Pipeline] 首轮 verified=0，但extract成功率较高且存在有效mention，继续下一轮召回`)
    }

    // 检查是否需要继续搜索
    if (verifiedDbPois.length >= Math.min(maxResults, 3) || searchRound >= ctx.maxSearchRounds) {
      break
    }

    // 构造下一轮查询：加入已发现的 mention 名和品类 token
    const discoveredNames = allMentionGroups.slice(0, 3).map((g) => g.canonicalName)
    const newTokens = correctedProfile.searchTokens.filter((t) => !effectiveQuery.includes(t)).slice(0, 2)
    effectiveQuery = [query, ...newTokens, ...discoveredNames.slice(0, 2)].join(' ')
  }

  // DB-only POIs：shortlist 中未被 web mention 命中的，按 pois 表自有评分取头部
  const verifiedPoiNames = new Set(verifiedDbPois.map((r) => r.poi?.name).filter(Boolean))
  const shortlistHead = rankedShortlistResult.dbOnlyPool.slice(0, Math.min(rankedShortlistResult.dbOnlyPool.length, Math.max(maxResults * DB_ONLY_HEAD_MULTIPLIER, 24)))
  const dbOnlyPois = shortlistHead
    .filter((poi) => !verifiedPoiNames.has(poi.name))
    .slice(0, maxResults)
  const topVenues = [
    ...verifiedDbPois.slice(0, maxResults).flatMap((item) => item.poi ? [{
      poiId: item.poi.id,
      poiName: item.poi.name,
      poiCategory: item.poi.categorySub || item.poi.categoryMain || null,
      poiScore: item.poi.poiScore,
      nerName: item.mention,
      matchType: item.matchType,
      confidence: Math.max(Number(item.confidence) || 0, Number(item.matchScore) || 0),
      source: 'verified' as const,
    }] : []),
    ...dbOnlyPois.map((poi) => ({
      poiId: poi.id,
      poiName: poi.name,
      poiCategory: poi.categorySub || poi.categoryMain || null,
      poiScore: poi.poiScore,
      nerName: null,
      matchType: 'db_only',
      confidence: poi.poiScore,
      source: 'db_only' as const,
    })),
  ].slice(0, maxResults)

  return {
    verifiedDbPois: verifiedDbPois.slice(0, maxResults),
    shortlist: shortlist.slice(0, 30),
    dbOnlyPois,
    webUnresolvedMentions: webUnresolvedMentions.slice(0, 10),
    topVenues,
    dbMatchCount: verifiedDbPois.length,
    profile: correctedProfile,
    timings,
    extractStats,
    searchRounds: searchRound,
  }
}

function readDiscoveryScope(payload: Record<string, unknown>): DiscoveryScopeInput {
  const scopeContext = payload.scope_context && typeof payload.scope_context === 'object'
    ? payload.scope_context as Record<string, unknown>
    : null
  const payloadRadius = Number(payload.radius_m)
  const contextRadius = Number(scopeContext?.search_radius_m)
  const effectiveRadius = Number.isFinite(payloadRadius) && payloadRadius > 0
    ? (Number.isFinite(contextRadius) && contextRadius > 0 ? Math.max(payloadRadius, contextRadius) : payloadRadius)
    : (Number.isFinite(contextRadius) && contextRadius > 0 ? contextRadius : null)

  return {
    districts: Array.isArray(payload.districts)
      ? payload.districts.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    districtIds: Array.isArray(payload.scope_district_ids)
      ? payload.scope_district_ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
      : [],
    areaWkt: String(payload.scope_wkt || '').trim() || null,
    anchorLon: Number.isFinite(Number(payload.anchor_lon)) ? Number(payload.anchor_lon) : null,
    anchorLat: Number.isFinite(Number(payload.anchor_lat)) ? Number(payload.anchor_lat) : null,
    radiusM: effectiveRadius,
    scopeContext,
  }
}

// ── 场景画像兜底修正 ──

function applyProfileCorrection(query: string, profile: SceneProfile): SceneProfile {
  const q = query.toLowerCase()
  const foodSearchTokens = q.includes('咖啡')
    ? ['咖啡馆', '咖啡店', '咖啡', '奶茶']
    : (q.includes('奶茶') || q.includes('茶饮') || q.includes('饮品'))
      ? ['奶茶店', '茶饮店', '饮品店', '奶茶']
      : ['餐厅', '小吃', '火锅', '面馆']

  const inlineCategoryMap: Record<string, { key: SceneProfile['key']; label: string; tokens: string[]; dbCats: string[] }> = {
    food: { key: 'food', label: '美食', tokens: foodSearchTokens, dbCats: ['餐饮服务', '餐饮美食'] },
    hotel: { key: 'hotel', label: '酒店', tokens: ['酒店', '住宿', '推荐', '口碑'], dbCats: ['住宿服务'] },
    scenic: { key: 'scenic', label: '景点', tokens: ['景点', '攻略', '推荐', '打卡'], dbCats: ['风景名胜', '科教文化服务'] },
    park: { key: 'park', label: '公园', tokens: ['公园', '绿道', '散步', '推荐'], dbCats: ['风景名胜', '体育休闲服务'] },
  }

  const foodAliases = ['美食', '餐饮', '餐厅', '餐馆', '吃饭', '小吃', '宵夜', '夜宵', '早餐', '外卖', '咖啡', '奶茶', '火锅', '烧烤', '面馆', '甜品', '茶馆', '酒楼', '食府', '饮品']
  const hotelAliases = ['酒店', '宾馆', '民宿', '住宿', '旅馆', '客栈', '住店']
  const scenicAliases = ['景点', '景区', '景观', '旅游景点', '名胜', '打卡地', '参观', '游览', '游玩', '好玩']
  const parkAliases = ['公园', '绿道', '江滩', '湿地', '植物园', '森林公园', '步道', '绿地', '广场', '运动', '散步']

  if (profile.key !== 'food' && foodAliases.some((a) => q.includes(a))) {
    return { ...profile, key: inlineCategoryMap.food.key, label: inlineCategoryMap.food.label, searchTokens: inlineCategoryMap.food.tokens, dbCategoryMains: inlineCategoryMap.food.dbCats }
  }
  if (profile.key !== 'hotel' && hotelAliases.some((a) => q.includes(a))) {
    return { ...profile, key: inlineCategoryMap.hotel.key, label: inlineCategoryMap.hotel.label, searchTokens: inlineCategoryMap.hotel.tokens, dbCategoryMains: inlineCategoryMap.hotel.dbCats }
  }
  if (profile.key !== 'park' && parkAliases.some((a) => q.includes(a))) {
    return { ...profile, key: inlineCategoryMap.park.key, label: inlineCategoryMap.park.label, searchTokens: inlineCategoryMap.park.tokens, dbCategoryMains: inlineCategoryMap.park.dbCats }
  }
  if (profile.key !== 'scenic' && scenicAliases.some((a) => q.includes(a))) {
    return { ...profile, key: inlineCategoryMap.scenic.key, label: inlineCategoryMap.scenic.label, searchTokens: inlineCategoryMap.scenic.tokens, dbCategoryMains: inlineCategoryMap.scenic.dbCats }
  }

  return profile
}

// ── Tavily Search ──

async function runTavilySearch(
  query: string,
  profile: SceneProfile,
  ctx: PipelineContext,
  _districts: string[] = [],
  blockedDomains: Iterable<string> = [],
  blockedUrls: Iterable<string> = [],
): Promise<SearchHit[]> {
  if (!ctx.tavilyApiKey) {
    ctx.logger.warn(`[Tavily] 无API key，跳过搜索`)
    return []
  }

  const allowedDomains = resolveAllowedDomains(profile, blockedDomains)
  const queries = buildSearchQueries(query, profile).slice(0, 1) // 只发主查询，控制延迟

  // 并发发出所有 query，不再串行等待
  const fetchOne = async (q: string): Promise<SearchHit[]> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ctx.tavilyTimeoutMs)
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: ctx.tavilyApiKey,
          query: q,
          search_depth: 'basic',
          max_results: MAX_TAVILY_RESULTS,
          include_answer: false,
          include_raw_content: false,
          include_domains: allowedDomains,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        ctx.logger.warn(`[Tavily] HTTP ${res.status} for query="${q}"`)
        return []
      }

      const data = await res.json() as { results?: Array<{ title?: string; content?: string; url?: string }> }
      const hits: SearchHit[] = []
      const filteredUrls: string[] = []
      for (const item of data.results || []) {
        const url = String(item.url || '')
        if (!url) continue
        if (isBlockedExtractUrl(url, blockedDomains, blockedUrls)) {
          filteredUrls.push(url)
          continue
        }
        const title = String(item.title || '')
        const snippet = String(item.content || '')
        const hasChinese = /[\u4e00-\u9fff]/u.test(`${title} ${snippet}`)
        if (!hasChinese) continue
        hits.push({ url, title, snippet })
      }
      if (filteredUrls.length > 0) {
        const blockedHosts = collectHostnames(filteredUrls)
        ctx.logger.info(`[Tavily] 已过滤 ${filteredUrls.length} 条黑名单结果${blockedHosts.length > 0 ? ` domains=[${blockedHosts.join(', ')}]` : ''}`)
      }
      return hits
    } catch (err) {
      clearTimeout(timer)
      ctx.logger.warn(`[Tavily] 查询失败(${q}): ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  // 所有 query 并发，结果按 URL 去重后评分排序
  const allHitsPerQuery = await Promise.all(queries.map(fetchOne))
  const seen = new Map<string, SearchHit>()
  for (const hits of allHitsPerQuery) {
    for (const hit of hits) {
      if (!seen.has(hit.url)) seen.set(hit.url, hit)
    }
  }

  const results = [...seen.values()]
  results.sort((a, b) => scoreSearchResult(b, profile) - scoreSearchResult(a, profile))
  return results.slice(0, MAX_TAVILY_RESULTS)
}
