import type { QueryResultLike } from '../integration/postgisPool.js'

export interface SpatialFetchRequest {
  categories?: unknown
  bounds?: unknown
  geometry?: unknown
  regions?: unknown
  limit?: unknown
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
      coordSys,
      _coordSys: coordSys,
    },
  }
}

export async function fetchSpatialFeaturesFromDatabase(
  input: SpatialFetchRequest,
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
): Promise<SpatialFeature[]> {
  const params: unknown[] = []
  const spatialClause = buildSpatialClause(params, input)
  if (!spatialClause) {
    return []
  }

  const categories = normalizeCategories(input.categories)
  const categoryClause = buildCategoryClause(params, categories)
  const limitIndex = params.push(resolveLimit(input.limit))

  const sql = `
    SELECT
      id,
      name,
      category_main,
      category_sub,
      brand_category,
      longitude,
      latitude
    FROM public.pois
    WHERE longitude IS NOT NULL
      AND latitude IS NOT NULL
      ${spatialClause}
      ${categoryClause}
    ORDER BY id ASC
    LIMIT $${limitIndex}
  `

  const result = await query(sql, params, 120000)
  return (result.rows as Record<string, unknown>[])
    .map((row) => toFeature(row))
    .filter((feature): feature is SpatialFeature => Boolean(feature))
}
