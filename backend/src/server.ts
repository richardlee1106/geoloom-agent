import { loadRuntimeEnv } from './config/loadRuntimeEnv.js'

loadRuntimeEnv()

import { SessionManager } from './agent/SessionManager.js'
import { createApp } from './app.js'
import { GeoLoomAgent } from './agent/GeoLoomAgent.js'
import { RemoteFirstFaissIndex } from './integration/faissIndex.js'
import { RemoteFirstOSMBridge } from './integration/osmBridge.js'
import { PostgisPool } from './integration/postgisPool.js'
import { JinaBridge } from './integration/jinaBridge.js'
import { RemoteFirstPythonBridge } from './integration/pythonBridge.js'
import { LongTermMemory } from './memory/LongTermMemory.js'
import { MemoryManager } from './memory/MemoryManager.js'
import { ProfileManager } from './memory/ProfileManager.js'
import { createRedisShortTermStoreFromEnv } from './memory/RedisShortTermStore.js'
import { ShortTermMemory } from './memory/ShortTermMemory.js'
import { SQLSandbox } from './sandbox/SQLSandbox.js'
import { SkillRegistry } from './skills/SkillRegistry.js'
import { createPostgisCatalog } from './skills/postgis/sqlSecurity.js'
import { createPostgisSkill } from './skills/postgis/PostGISSkill.js'
import { createSpatialEncoderSkill } from './skills/spatial_encoder/SpatialEncoderSkill.js'
import { createSpatialVectorSkill } from './skills/spatial_vector/SpatialVectorSkill.js'
import { createRouteDistanceSkill } from './skills/route_distance/RouteDistanceSkill.js'
import { createSemanticSelectorSkill } from './skills/semantic_selector/SemanticSelectorSkill.js'
import { createMultiSearchEngineSkill } from './skills/multi_search_engine/MultiSearchEngineSkill.js'
import { createTavilySearchSkill } from './skills/tavily_search/TavilySearchSkill.js'
import { createEntityAlignmentSkill } from './skills/entity_alignment/EntityAlignmentSkill.js'
import { createWebPoiDiscoverySkill } from './skills/web_poi_discovery/index.js'
import { loadCategoryTreeFromDatabase } from './catalog/categoryCatalog.js'
import { CategoryEmbeddingIndex } from './catalog/categoryEmbeddingIndex.js'
import { PoiEmbeddingCache } from './catalog/poiEmbeddingCache.js'
import { EmbeddingIntentClassifier } from './catalog/embeddingIntentClassifier.js'
import { fetchSpatialFeaturesFromDatabase } from './spatial/fetchSpatialFeatures.js'
import { resolveResourceUrl } from './utils/resolveResourceUrl.js'

const port = Number(process.env.PORT || '3210')
const host = process.env.HOST || '127.0.0.1'
const version = '0.1.0'

function inferSearchPlaceKind(placeName = '') {
  if (/(大学|学院|学校|校区|中学|小学|幼儿园|附中|高中|初中)/.test(placeName)) return 'education'
  if (/(地铁站|地铁口|火车站|高铁站|站)/.test(placeName)) return 'transport'
  if (/(公园|景区|广场)/.test(placeName)) return 'scenic'
  return 'generic'
}

const catalog = createPostgisCatalog()
const pool = new PostgisPool({
  queryTimeoutMs: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || '5000'),
})
const sandbox = new SQLSandbox({
  catalog,
  maxRows: Number(process.env.SQL_MAX_ROWS || '200'),
  statementTimeoutMs: Number(process.env.SQL_STATEMENT_TIMEOUT_MS || '3000'),
})
const registry = new SkillRegistry()
const shortTerm = new ShortTermMemory({
  ttlMs: Number(process.env.SHORT_TERM_MEMORY_TTL_MS || `${24 * 60 * 60 * 1000}`),
  store: createRedisShortTermStoreFromEnv(),
})
const memory = new MemoryManager({
  shortTerm,
  longTerm: new LongTermMemory({
    dataDir: resolveResourceUrl(import.meta.url, ['../data/memory/', '../../data/memory/']),
  }),
  profiles: new ProfileManager({
    profileDir: resolveResourceUrl(import.meta.url, ['../profiles/', '../../profiles/']),
  }),
})
const sessionManager = new SessionManager({
  memory: shortTerm,
})
const spatialEncoderBridge = new RemoteFirstPythonBridge()
const spatialVectorIndex = new RemoteFirstFaissIndex()
const routeBridge = new RemoteFirstOSMBridge()

registry.register(
  createPostgisSkill({
    catalog,
    sandbox,
    query: (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
    searchCandidates: async (placeName, variants) => {
      const searchTerms = [...new Set([placeName, ...variants])].filter(Boolean)
      if (searchTerms.length === 0) return []
      const placeKind = inferSearchPlaceKind(placeName)
      const categoryPriority = placeKind === 'education'
        ? `CASE
            WHEN category_sub IN ('学校', '高等院校', '中学', '小学', '幼儿园') THEN 0
            WHEN name LIKE '%校区%' THEN 1
            ELSE 2
          END`
        : placeKind === 'transport'
          ? `CASE
              WHEN category_sub IN ('地铁站', '公交车站', '火车站', '高铁站') THEN 0
              ELSE 1
            END`
          : '0::int'
      const candidateLimit = placeKind === 'education' ? 160 : 80

      const exactClauses = searchTerms.map((_, index) => `name = $${index + 1}`).join(' OR ')
      const fuzzyOffset = searchTerms.length
      const fuzzyClauses = searchTerms.map((_, index) => `name ILIKE $${fuzzyOffset + index + 1}`).join(' OR ')
      const prefixOffset = searchTerms.length * 2
      const prefixClauses = searchTerms.map((_, index) => `name ILIKE $${prefixOffset + index + 1}`).join(' OR ')
      const params = [
        ...searchTerms,
        ...searchTerms.map((term) => `%${term}%`),
        ...searchTerms.map((term) => `${term}%`),
      ]
      const result = await pool.query(
        `
          SELECT id, name, category_main, category_sub, longitude AS lon, latitude AS lat,
            CASE WHEN ${exactClauses} THEN 0 WHEN ${prefixClauses} THEN 1 ELSE 2 END AS match_rank
          FROM pois
          WHERE (${exactClauses}) OR (${fuzzyClauses})
          ORDER BY match_rank ASC,
          ${categoryPriority} ASC,
          LENGTH(name) ASC
          LIMIT ${candidateLimit}
        `,
        params,
      )
      return result.rows as Array<{
        id: string | number
        name: string
        lon?: number
        lat?: number
        category_main?: string
        category_sub?: string
        category_big?: string
        category_mid?: string
        category_small?: string
      }>
    },
    healthcheck: () => pool.healthcheck(),
  }),
)
registry.register(createSpatialEncoderSkill({ bridge: spatialEncoderBridge }))
registry.register(createSpatialVectorSkill({ index: spatialVectorIndex }))
registry.register(createRouteDistanceSkill({ bridge: routeBridge }))
registry.register(createSemanticSelectorSkill({ bridge: spatialEncoderBridge }))
registry.register(createMultiSearchEngineSkill({
  timeoutMs: Number(process.env.MULTI_SEARCH_TIMEOUT_MS || '10000'),
  maxEngines: Number(process.env.MULTI_SEARCH_MAX_ENGINES || '3'),
}))
if (process.env.TAVILY_API_KEY) {
  registry.register(createTavilySearchSkill({
    apiKey: process.env.TAVILY_API_KEY,
    timeoutMs: Number(process.env.TAVILY_TIMEOUT_MS || '15000'),
  }))
}
const jinaBridge = new JinaBridge()
registry.register(createEntityAlignmentSkill({
  bridge: jinaBridge,
  query: (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
}))

// Web POI Discovery Skill V2：Tavily Search + Extract + LLM mention提取 + shortlist匹配
// mention 提取用专属小模型（MENTION_LLM_*），降级到主 LLM（LLM_*）
if (process.env.TAVILY_API_KEY) {
  registry.register(createWebPoiDiscoverySkill({
    tavilyApiKey: process.env.TAVILY_API_KEY,
    llmBaseUrl: process.env.MENTION_LLM_BASE_URL || process.env.LLM_BASE_URL,
    llmApiKey: process.env.MENTION_LLM_API_KEY || process.env.LLM_API_KEY,
    llmModel: process.env.MENTION_LLM_MODEL || process.env.LLM_MODEL,
    query: (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
  }))
} else {
  console.warn('[WebPoiDiscovery] TAVILY_API_KEY 未设置，跳过注册')
}

// 品类 Embedding 索引：启动时从 PostGIS 加载品类并预计算 embedding
const categoryIndex = new CategoryEmbeddingIndex()
categoryIndex.build(
  (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
  jinaBridge,
).catch((err) => {
  console.warn(`[CategoryEmbeddingIndex] 索引构建失败: ${err instanceof Error ? err.message : String(err)}`)
})

// 启动时验证 pgvector 扩展 + POI embedding 覆盖率
;(async () => {
  try {
    // 检查 pgvector 扩展
    const extResult = await pool.query("SELECT extname FROM pg_extension WHERE extname = 'vector'")
    if (extResult.rows.length === 0) {
      console.warn('[Embedding] pgvector 扩展未安装，POI 语义排序不可用')
      return
    }
    // 检查 embedding 列
    const colResult = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pois' AND column_name = 'embedding'")
    if (colResult.rows.length === 0) {
      console.warn('[Embedding] pois.embedding 列不存在，POI 语义排序不可用')
      return
    }
    // 统计覆盖率
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM pois')
    const embResult = await pool.query('SELECT COUNT(*) as has_emb FROM pois WHERE embedding IS NOT NULL')
    const total = Number(totalResult.rows[0].total)
    const hasEmb = Number(embResult.rows[0].has_emb)
    const pct = total > 0 ? (hasEmb / total * 100).toFixed(1) : '0.0'
    console.log(`[Embedding] pgvector ✓ | POI embedding 覆盖率: ${hasEmb}/${total} (${pct}%)`)
    if (hasEmb === 0) {
      console.log('[Embedding] 提示：首次查询时会按需计算 POI embedding 并缓存，无需全量预计算')
    }
  } catch (err) {
    console.warn(`[Embedding] 验证失败: ${err instanceof Error ? err.message : String(err)}`)
  }
})()

// POI Embedding 缓存 + 语义重排序
const poiEmbeddingCache = new PoiEmbeddingCache({
  bridge: jinaBridge,
  query: (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
})

// Embedding-First 意图分类器：替代 LLM 意图识别
const intentClassifier = new EmbeddingIntentClassifier(jinaBridge)
intentClassifier.build().catch((err) => {
  console.warn(`[EmbeddingIntentClassifier] 构建失败: ${err instanceof Error ? err.message : String(err)}`)
})

const chat = new GeoLoomAgent({
  registry,
  version,
  memory,
  sessionManager,
  categoryIndex,
  bridge: jinaBridge,
  poiEmbeddingCache,
  intentClassifier,
})

const app = createApp({
  registry,
  version,
  checkDatabaseHealth: async () => pool.healthcheck(),
  getCategoryTree: async () => loadCategoryTreeFromDatabase((sql, params, timeoutMs) => pool.query(sql, params, timeoutMs)),
  fetchSpatialFeatures: async (input) => fetchSpatialFeaturesFromDatabase(
    input,
    (sql, params, timeoutMs) => pool.query(sql, params, timeoutMs),
  ),
  chat,
})

const shutdown = async () => {
  await app.close()
  await pool.close()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

app.listen({ port, host }).then(() => {
  console.log(`[Server] listening at http://${host}:${port}`)
}).catch(async (error) => {
  console.error(error)
  await shutdown()
  process.exit(1)
})
