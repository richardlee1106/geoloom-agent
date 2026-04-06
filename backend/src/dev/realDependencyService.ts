import { loadRuntimeEnv } from '../config/loadRuntimeEnv.js'

loadRuntimeEnv()

import Fastify from 'fastify'
import cors from '@fastify/cors'

import { PostgisPool } from '../integration/postgisPool.js'

const host = process.env.DEPENDENCY_SERVICE_HOST || '127.0.0.1'
const port = Number(process.env.DEPENDENCY_SERVICE_PORT || '3410')
const encoderBaseUrl = String(
  process.env.GEOLOOM_ENCODER_BASE_URL
  || process.env.SPATIAL_ENCODER_BASE_URL
  || 'http://127.0.0.1:8100',
).replace(/\/+$/u, '')
const osrmBaseUrl = String(
  process.env.OSRM_BASE_URL || 'https://router.project-osrm.org',
).replace(/\/+$/u, '')

const CITY_CENTER = {
  lon: 114.305,
  lat: 30.593,
}

const CATEGORY_KEYWORDS: Array<{
  label: string
  probes: string[]
}> = [
  { label: '咖啡', probes: ['咖啡', 'cafe', 'coffee'] },
  { label: '地铁站', probes: ['地铁', '地铁站', '站口', '出口', 'metro', 'subway'] },
  { label: '餐饮美食', probes: ['餐饮', '餐厅', '小吃', '美食', '轻食', '火锅', '烧烤'] },
  { label: '购物服务', probes: ['商场', '超市', '购物', 'mall', '便利店'] },
  { label: '学校', probes: ['大学', '学院', '学校', '校区', '高校'] },
  { label: '公园广场', probes: ['公园', '绿地', '广场', '步道'] },
]

const NOISE_PATTERNS = [
  /适合开什么店/gu,
  /帮我(?:找|拉取|看看)?/gu,
  /有哪些/gu,
  /有什么/gu,
  /最近的/gu,
  /附近的/gu,
  /附近/gu,
  /周边/gu,
  /周围/gu,
  /相似的/gu,
  /相似片区/gu,
  /最像/gu,
  /像/gu,
  /比较/gu,
  /和/gu,
  /三个/gu,
  /推荐/gu,
]

type AnchorCandidate = {
  id: string | number
  name: string
  lon: number
  lat: number
}

type SemanticPoiCandidate = {
  id: string
  name: string
  category: string
  score: number
  tags?: string[]
}

type SimilarRegionCandidate = {
  id: string
  name: string
  summary: string
  score: number
  tags?: string[]
}

const pool = new PostgisPool({
  queryTimeoutMs: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || '5000'),
})

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function extractCategoryKeyword(text: string) {
  const normalized = normalizeText(text).toLowerCase()
  for (const item of CATEGORY_KEYWORDS) {
    if (item.probes.some((probe) => normalized.includes(probe.toLowerCase()))) {
      return item.label
    }
  }
  return ''
}

function extractAnchorHints(text: string) {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const hints = new Set<string>()
  const nearbyMatch = normalized.match(/(.+?)(?:附近|周边|周围|旁边)/u)
  if (nearbyMatch?.[1]) {
    hints.add(nearbyMatch[1].trim())
  }

  const similarMatch = normalized.match(/(?:最像|像|相似(?:的)?)(.+?)(?:的|片区|区域|地块|商圈|$)/u)
  if (similarMatch?.[1]) {
    hints.add(similarMatch[1].trim())
  }

  const compareMatch = normalized.match(/比较(.+?)和(.+?)(?:附近|周边|$)/u)
  if (compareMatch?.[1]) {
    hints.add(compareMatch[1].trim())
  }

  let stripped = normalized
  for (const pattern of NOISE_PATTERNS) {
    stripped = stripped.replace(pattern, ' ')
  }
  for (const item of CATEGORY_KEYWORDS) {
    for (const probe of item.probes) {
      stripped = stripped.replaceAll(probe, ' ')
    }
  }

  stripped
    .split(/[，。,.?？、\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .forEach((part) => hints.add(part))

  return [...hints].filter(Boolean)
}

function parseVectorText(raw: unknown) {
  const text = normalizeText(raw)
  if (!text) return []

  const normalized = text
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .trim()

  return normalized
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }

  if (leftNorm <= 1e-12 || rightNorm <= 1e-12) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function distanceScore(distanceM: number) {
  if (!Number.isFinite(distanceM)) return 0
  return Math.max(0, 1 - Math.min(distanceM, 4000) / 4000)
}

function lexicalBoost(text: string, candidate: { name?: string, category_main?: string, category_sub?: string }) {
  const normalized = normalizeText(text).toLowerCase()
  const haystacks = [
    normalizeText(candidate.name).toLowerCase(),
    normalizeText(candidate.category_main).toLowerCase(),
    normalizeText(candidate.category_sub).toLowerCase(),
  ].filter(Boolean)

  let boost = 0
  for (const item of CATEGORY_KEYWORDS) {
    if (!item.probes.some((probe) => normalized.includes(probe.toLowerCase()))) continue
    if (item.probes.some((probe) => haystacks.some((haystack) => haystack.includes(probe.toLowerCase())))) {
      boost += 0.18
    }
  }
  return Math.min(boost, 0.36)
}

async function resolveAnchor(text: string) {
  const hints = extractAnchorHints(text)

  for (const hint of hints) {
    const fuzzy = `%${hint}%`
    const result = await pool.query(
      `
        SELECT id, name, longitude AS lon, latitude AS lat
        FROM pois
        WHERE name = $1 OR name ILIKE $2
        ORDER BY
          CASE
            WHEN name = $1 THEN 0
            WHEN name ILIKE $3 THEN 1
            ELSE 2
          END ASC,
          LENGTH(name) ASC
        LIMIT 1
      `,
      [hint, fuzzy, `${hint}%`],
      4000,
    )

    if (result.rows[0]) {
      const row = result.rows[0]
      return {
        id: row.id as string | number,
        name: String(row.name || hint),
        lon: Number(row.lon),
        lat: Number(row.lat),
      } satisfies AnchorCandidate
    }
  }

  return {
    id: 'city_center',
    name: '武汉中心城区',
    lon: CITY_CENTER.lon,
    lat: CITY_CENTER.lat,
  } satisfies AnchorCandidate
}

async function fetchEncoderJson(pathname: string, body?: Record<string, unknown>) {
  const response = await fetch(`${encoderBaseUrl}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    throw new Error(`encoder_request_failed:${response.status}`)
  }

  return response.json()
}

async function getAnchorEmbedding(anchor: AnchorCandidate) {
  const payload = await fetchEncoderJson('/encode', {
    lon: anchor.lon,
    lat: anchor.lat,
    poi_id: anchor.id === 'city_center' ? undefined : anchor.id,
  }) as { embedding?: number[] }

  return Array.isArray(payload.embedding)
    ? payload.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : []
}

async function searchSemanticPois(text: string, topK = 5): Promise<SemanticPoiCandidate[]> {
  const anchor = await resolveAnchor(text)
  const categoryKeyword = extractCategoryKeyword(text)
  const queryVector = await getAnchorEmbedding(anchor)

  if (!queryVector.length) {
    throw new Error('anchor_embedding_unavailable')
  }

  const params: unknown[] = [anchor.lon, anchor.lat, categoryKeyword ? 2800 : 3600]
  let categorySql = ''
  if (categoryKeyword) {
    params.push(`%${categoryKeyword}%`)
    categorySql = `
      AND (
        category_main ILIKE $4
        OR category_sub ILIKE $4
        OR name ILIKE $4
      )
    `
  }

  const result = await pool.query(
    `
      SELECT
        id,
        name,
        category_main,
        category_sub,
        longitude AS lon,
        latitude AS lat,
        spatial_embedding::text AS embedding_text,
        ST_DistanceSphere(
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        ) AS distance_m
      FROM pois
      WHERE spatial_embedding IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
        ${categorySql}
      ORDER BY distance_m ASC
      LIMIT 80
    `,
    params,
    5000,
  )

  return result.rows
    .map((row) => {
      const candidateVector = parseVectorText(row.embedding_text)
      const vectorScore = cosineSimilarity(queryVector, candidateVector)
      const lexical = lexicalBoost(text, row)
      const nearScore = distanceScore(Number(row.distance_m))
      const score = Number((vectorScore * 0.62 + nearScore * 0.23 + lexical * 0.15).toFixed(3))
      return {
        id: String(row.id),
        name: String(row.name || '未命名地点'),
        category: String(row.category_sub || row.category_main || '未分类'),
        score,
        tags: [
          normalizeText(row.category_main),
          normalizeText(row.category_sub),
          anchor.name,
        ].filter(Boolean),
      }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(topK, 10)))
}

async function searchSimilarRegions(text: string, topK = 5): Promise<SimilarRegionCandidate[]> {
  const anchor = await resolveAnchor(text)
  const payload = await fetchEncoderJson('/cell/search', {
    anchor_lon: anchor.lon,
    anchor_lat: anchor.lat,
    user_query: text,
    task_type: /像|相似|similar|片区/u.test(text) ? 'region_comparison' : 'area_overview',
    top_k: Math.max(1, Math.min(topK, 8)),
  }) as {
    cells?: Array<Record<string, unknown>>
    scene_tags?: string[]
    dominant_buckets?: string[]
  }

  return (payload.cells || []).map((cell) => ({
    id: String(cell.cell_id || `${cell.lon}_${cell.lat}`),
    name: String(cell.region_name || cell.dominant_category || '相似片区'),
    summary: [
      normalizeText(cell.dominant_category),
      normalizeText(cell.aoi_type),
      ...(Array.isArray(cell.scene_tags) ? cell.scene_tags.map((item) => normalizeText(item)) : []),
    ].filter(Boolean).join(' / ') || '双模型 town/cell 编码检索结果',
    score: Number(Number(cell.search_score || cell.similarity || 0).toFixed(3)),
    tags: [
      normalizeText(cell.region_name),
      normalizeText(cell.dominant_category),
      ...(Array.isArray(payload.scene_tags) ? payload.scene_tags.map((item) => normalizeText(item)) : []),
      ...(Array.isArray(payload.dominant_buckets) ? payload.dominant_buckets.map((item) => normalizeText(item)) : []),
    ].filter(Boolean),
  }))
}

async function probeOsrm() {
  const response = await fetch(
    `${osrmBaseUrl}/route/v1/walking/114.364339,30.536334;114.365339,30.537334?overview=false`,
  )
  return response.ok
}

async function checkDatabaseReady() {
  try {
    return await pool.healthcheck()
  } catch {
    return false
  }
}

async function checkEncoderReady() {
  try {
    const encoderHealth = await fetchEncoderJson('/health') as { encoder_loaded?: boolean, status?: string }
    return encoderHealth.encoder_loaded === true || encoderHealth.status === 'ok'
  } catch {
    return false
  }
}

async function checkRoutingReady() {
  try {
    return await probeOsrm()
  } catch {
    return false
  }
}

const app = Fastify({
  logger: false,
})

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
})

app.get('/health', async () => {
  const [databaseReady, encoderReady, routingReady] = await Promise.all([
    checkDatabaseReady(),
    checkEncoderReady(),
    checkRoutingReady(),
  ])

  return {
    status: databaseReady && encoderReady && routingReady ? 'ok' : 'degraded',
    database_ready: databaseReady,
    encoder_ready: encoderReady,
    routing_ready: routingReady,
    encoder_base_url: encoderBaseUrl,
    osrm_base_url: osrmBaseUrl,
  }
})

app.get('/health/vector', async () => {
  const [databaseReady, encoderReady] = await Promise.all([
    checkDatabaseReady(),
    checkEncoderReady(),
  ])

  return {
    status: databaseReady && encoderReady ? 'ok' : 'degraded',
    database_ready: databaseReady,
    encoder_ready: encoderReady,
    encoder_base_url: encoderBaseUrl,
  }
})

app.get('/health/routing', async () => {
  const routingReady = await checkRoutingReady()

  return {
    status: routingReady ? 'ok' : 'degraded',
    routing_ready: routingReady,
    osrm_base_url: osrmBaseUrl,
  }
})

app.post('/search/semantic-pois', async (request) => {
  const body = (request.body || {}) as { text?: string, top_k?: number }
  const candidates = await searchSemanticPois(String(body.text || ''), Number(body.top_k || 5))
  return { candidates }
})

app.post('/search/similar-regions', async (request) => {
  const body = (request.body || {}) as { text?: string, top_k?: number }
  const regions = await searchSimilarRegions(String(body.text || ''), Number(body.top_k || 5))
  return { regions }
})

app.post('/route', async (request) => {
  const body = (request.body || {}) as {
    origin?: [number, number]
    destination?: [number, number]
    mode?: string
  }

  const origin = Array.isArray(body.origin) ? body.origin : []
  const destination = Array.isArray(body.destination) ? body.destination : []
  if (origin.length < 2 || destination.length < 2) {
    throw new Error('invalid_route_payload')
  }

  const profile = String(body.mode || 'walking').toLowerCase() === 'driving'
    ? 'driving'
    : String(body.mode || 'walking').toLowerCase() === 'cycling'
      ? 'cycling'
      : 'foot'

  const response = await fetch(
    `${osrmBaseUrl}/route/v1/${profile}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=false`,
  )
  if (!response.ok) {
    throw new Error(`route_upstream_failed:${response.status}`)
  }

  const payload = await response.json() as {
    routes?: Array<{ distance?: number, duration?: number }>
  }
  const route = payload.routes?.[0]
  if (!route) {
    throw new Error('route_missing')
  }

  return {
    distance_m: Number(route.distance || 0),
    duration_min: Math.max(1, Math.round(Number(route.duration || 0) / 60)),
    degraded: false,
    degraded_reason: null,
  }
})

const shutdown = async () => {
  await app.close()
  await pool.close()
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

app.listen({ host, port }).catch(async (error) => {
  console.error(error)
  await shutdown()
  process.exit(1)
})
