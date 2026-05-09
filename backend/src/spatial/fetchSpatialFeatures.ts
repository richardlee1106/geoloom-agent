import type { QueryResultLike } from '../integration/postgisPool.js'

export interface SpatialFetchRequest {
  categories?: unknown
  bounds?: unknown
  geometry?: unknown
  regions?: unknown
  limit?: unknown
  timeoutMs?: unknown
  semanticQueryVector?: unknown
  semanticWeight?: unknown
  semanticCandidateLimit?: unknown
}

export interface SpatialFeature {
  type: 'Feature'
  id?: string | number | null
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
  properties: Record<string, unknown>
}

interface SpatialFetchRegion {
  boundaryWKT: string
}

function normalizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )]
}

function normalizeBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null

  const minLon = Number(value[0])
  const minLat = Number(value[1])
  const maxLon = Number(value[2])
  const maxLat = Number(value[3])

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return null
  }

  return [
    Math.min(minLon, maxLon),
    Math.min(minLat, maxLat),
    Math.max(minLon, maxLon),
    Math.max(minLat, maxLat),
  ]
}

function normalizeWkt(value: unknown): string | null {
  const candidate = String(value || '').trim()
  if (!candidate) return null
  if (!/^(POLYGON|MULTIPOLYGON)\s*\([\d\s,().-]+\)$/i.test(candidate)) {
    return null
  }
  return candidate.replace(/\s+/g, ' ').trim()
}

function normalizeRegions(value: unknown): SpatialFetchRegion[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const boundaryWKT = normalizeWkt((item as Record<string, unknown>).boundaryWKT)
      if (!boundaryWKT) {
        return null
      }

      return { boundaryWKT }
    })
    .filter((item): item is SpatialFetchRegion => Boolean(item))
}

function resolveLimit(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 20000
  return Math.max(1, Math.min(Math.trunc(numeric), 500000))
}

function resolveTimeoutMs(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 120000
  return Math.max(200, Math.min(Math.trunc(numeric), 120000))
}

function resolveSemanticWeight(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0.42
  return Math.max(0, Math.min(numeric, 1))
}

function resolveSemanticCandidateLimit(resultLimit: number, value: unknown): number {
  const numeric = Number(value)
  const fallback = Math.max(resultLimit * 3, 2000)
  const selected = Number.isFinite(numeric) ? numeric : fallback
  return Math.max(resultLimit, Math.min(Math.trunc(selected), 80000))
}

function normalizeSemanticVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 512) return null
  const vector = value.map((item) => Number(item))
  return vector.every(Number.isFinite) ? vector : null
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((item) => Number(item.toFixed(8))).join(',')}]`
}

function buildCategoryClause(params: unknown[], categories: string[]) {
  if (categories.length === 0) return ''

  const paramIndex = params.push(categories)
  return `
    AND (
      COALESCE(NULLIF(TRIM(category_main), ''), '未分类') = ANY($${paramIndex}::text[])
      OR COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类')) = ANY($${paramIndex}::text[])
      OR COALESCE(NULLIF(TRIM(brand_category), ''), COALESCE(NULLIF(TRIM(category_sub), ''), COALESCE(NULLIF(TRIM(category_main), ''), '未分类'))) = ANY($${paramIndex}::text[])
    )
  `
}

function buildSpatialClause(params: unknown[], input: SpatialFetchRequest) {
  const regions = normalizeRegions(input.regions)
  if (regions.length > 0) {
    const clauses = regions.map((region) => {
      const paramIndex = params.push(region.boundaryWKT)
      return `ST_Intersects(geom, ST_GeomFromText($${paramIndex}, 4326))`
    })
    return `AND (${clauses.join(' OR ')})`
  }

  const geometryWkt = normalizeWkt(input.geometry)
  if (geometryWkt) {
    const paramIndex = params.push(geometryWkt)
    return `AND ST_Intersects(geom, ST_GeomFromText($${paramIndex}, 4326))`
  }

  const bounds = normalizeBounds(input.bounds)
  if (bounds) {
    const [minLon, minLat, maxLon, maxLat] = bounds
    const firstParamIndex = params.push(minLon, minLat, maxLon, maxLat) - 3
    return `
      AND geom && ST_MakeEnvelope($${firstParamIndex}, $${firstParamIndex + 1}, $${firstParamIndex + 2}, $${firstParamIndex + 3}, 4326)
      AND ST_Intersects(geom, ST_MakeEnvelope($${firstParamIndex}, $${firstParamIndex + 1}, $${firstParamIndex + 2}, $${firstParamIndex + 3}, 4326))
    `
  }

  return ''
}

function toFeature(row: Record<string, unknown>): SpatialFeature | null {
  const longitude = Number(row.longitude)
  const latitude = Number(row.latitude)
  const geomLongitude = Number(row.geom_longitude)
  const geomLatitude = Number(row.geom_latitude)
  const semanticDistance = Number(row.semantic_distance)
  const semanticScore = Number(row.semantic_score)
  const fusionScore = Number(row.fusion_score)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null
  }

  const name = String(row.name || '').trim() || '未命名地点'
  const categoryMain = String(row.category_main || '').trim() || '未分类'
  const categorySub = String(row.category_sub || '').trim() || categoryMain
  const brandCategory = String(row.brand_category || '').trim() || categorySub
  const coordSys = String(row.coord_sys || row.coordSys || 'gcj02').trim().toLowerCase() || 'gcj02'

  return {
    type: 'Feature',
    id: (row.id as string | number | null | undefined) ?? null,
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
    properties: {
      id: (row.id as string | number | null | undefined) ?? null,
      name,
      名称: name,
      type: brandCategory,
      category_main: categoryMain,
      category_sub: categorySub,
      brand_category: brandCategory,
      category_big: categoryMain,
      category_mid: categorySub,
      category_small: brandCategory,
      大类: categoryMain,
      中类: categorySub,
      小类: brandCategory,
      longitude,
      latitude,
      geom_longitude: Number.isFinite(geomLongitude) ? geomLongitude : null,
      geom_latitude: Number.isFinite(geomLatitude) ? geomLatitude : null,
      geomCoordSys: 'wgs84',
      coordSys,
      _coordSys: coordSys,
      semantic_distance: Number.isFinite(semanticDistance) ? semanticDistance : null,
      semantic_score: Number.isFinite(semanticScore) ? semanticScore : null,
      fusion_score: Number.isFinite(fusionScore) ? fusionScore : null,
    },
  }
}

export async function fetchSpatialFeaturesFromDatabase(
  input: SpatialFetchRequest,
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
): Promise<SpatialFeature[]> {
  const semanticVector = normalizeSemanticVector(input.semanticQueryVector)
  const semanticWeight = resolveSemanticWeight(input.semanticWeight)
  try {
    return await fetchSpatialFeaturesWithSemanticFallback(input, query, semanticVector, semanticWeight)
  } catch (error) {
    if (!semanticVector) throw error
    return fetchSpatialFeaturesWithSemanticFallback({ ...input, semanticQueryVector: undefined }, query, null, semanticWeight)
  }
}

async function fetchSpatialFeaturesWithSemanticFallback(
  input: SpatialFetchRequest,
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
  semanticVector: number[] | null,
  semanticWeight: number,
): Promise<SpatialFeature[]> {
  const params: unknown[] = []
  const spatialClause = buildSpatialClause(params, input)
  if (!spatialClause) {
    return []
  }

  const categories = normalizeCategories(input.categories)
  const categoryClause = buildCategoryClause(params, categories)
  const resultLimit = resolveLimit(input.limit)
  if (semanticVector) {
    const semanticParamIndex = params.push(vectorLiteral(semanticVector))
    const candidateLimitIndex = params.push(resolveSemanticCandidateLimit(resultLimit, input.semanticCandidateLimit))
    const limitIndex = params.push(resultLimit)
    const semanticDistanceExpression = `(embedding <=> $${semanticParamIndex}::vector(512))`
    const semanticScoreExpression = `GREATEST(0, 1 - (semantic_distance / 2.0))`
    const fusionScoreExpression = `(${semanticScoreExpression} * ${semanticWeight.toFixed(3)} + category_relevance * ${(1 - semanticWeight).toFixed(3)})`
    const sql = `
      WITH spatial_candidates AS (
        SELECT
          id,
          name,
          category_main,
          category_sub,
          brand_category,
          longitude,
          latitude,
          ST_X(geom) AS geom_longitude,
          ST_Y(geom) AS geom_latitude,
          embedding,
          CASE
            WHEN category_main IN ('餐饮服务', '购物服务', '风景名胜', '科教文化服务', '体育休闲服务', '生活服务') THEN 1.0
            ELSE 0.55
          END AS category_relevance
        FROM public.pois
        WHERE longitude IS NOT NULL
          AND latitude IS NOT NULL
          ${spatialClause}
          ${categoryClause}
        ORDER BY id ASC
        LIMIT $${candidateLimitIndex}
      ),
      semantic_scores AS (
        SELECT
          id,
          name,
          category_main,
          category_sub,
          brand_category,
          longitude,
          latitude,
          geom_longitude,
          geom_latitude,
          ${semanticDistanceExpression} AS semantic_distance,
          category_relevance
        FROM spatial_candidates
      )
      SELECT
        id,
        name,
        category_main,
        category_sub,
        brand_category,
        longitude,
        latitude,
        geom_longitude,
        geom_latitude,
        semantic_distance,
        ${semanticScoreExpression} AS semantic_score,
        ${fusionScoreExpression} AS fusion_score
      FROM semantic_scores
      ORDER BY
        CASE WHEN semantic_distance IS NULL THEN 1 ELSE 0 END ASC,
        fusion_score DESC NULLS LAST,
        semantic_distance ASC NULLS LAST,
        id ASC
      LIMIT $${limitIndex}
    `

    const result = await query(sql, params, resolveTimeoutMs(input.timeoutMs))
    return (result.rows as Record<string, unknown>[])
      .map((row) => toFeature(row))
      .filter((feature): feature is SpatialFeature => Boolean(feature))
  }

  const limitIndex = params.push(resultLimit)

  const sql = `
    SELECT
      id,
      name,
      category_main,
      category_sub,
      brand_category,
      longitude,
      latitude,
      ST_X(geom) AS geom_longitude,
      ST_Y(geom) AS geom_latitude,
      NULL::double precision AS semantic_distance,
      NULL::double precision AS semantic_score,
      NULL::double precision AS fusion_score
    FROM public.pois
    WHERE longitude IS NOT NULL
      AND latitude IS NOT NULL
      ${spatialClause}
      ${categoryClause}
    ORDER BY id ASC
    LIMIT $${limitIndex}
  `

  const result = await query(sql, params, resolveTimeoutMs(input.timeoutMs))
  return (result.rows as Record<string, unknown>[])
    .map((row) => toFeature(row))
    .filter((feature): feature is SpatialFeature => Boolean(feature))
}
