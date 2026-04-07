import { loadRuntimeEnv } from './config/loadRuntimeEnv.js'

loadRuntimeEnv()

import { SessionManager } from './agent/SessionManager.js'
import { createApp } from './app.js'
import { GeoLoomAgent } from './agent/GeoLoomAgent.js'
import { RemoteFirstFaissIndex } from './integration/faissIndex.js'
import { RemoteFirstOSMBridge } from './integration/osmBridge.js'
import { PostgisPool } from './integration/postgisPool.js'
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
import { loadCategoryTreeFromDatabase } from './catalog/categoryCatalog.js'
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
          : '0'
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
          SELECT id, name, category_main, category_sub, longitude AS lon, latitude AS lat
          FROM pois
          WHERE (${exactClauses}) OR (${fuzzyClauses})
          ORDER BY CASE
            WHEN ${exactClauses} THEN 0
            WHEN ${prefixClauses} THEN 1
            ELSE 2
          END ASC,
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

const chat = new GeoLoomAgent({
  registry,
  version,
  memory,
  sessionManager,
})

const app = createApp({
  registry,
  version,
  checkDatabaseHealth: async () => pool.healthcheck(),
  getCategoryTree: async () => loadCategoryTreeFromDatabase((sql, params, timeoutMs) => pool.query(sql, params, timeoutMs)),
  chat,
})

const shutdown = async () => {
  await app.close()
  await pool.close()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

app.listen({ port, host }).catch(async (error) => {
  console.error(error)
  await shutdown()
  process.exit(1)
})
