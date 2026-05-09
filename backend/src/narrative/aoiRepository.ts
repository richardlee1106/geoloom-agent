import type { QueryResultLike } from '../integration/postgisPool.js'
import type { NarrativeBoundaryGeometry, ViewportBBox } from './contract.js'
import { polygonFromBounds } from './geometry.js'
import type { AoiCandidateRow } from './regionCandidate.js'

function parseBoundaryGeoJson(value: unknown): NarrativeBoundaryGeometry | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value) as { type?: unknown; coordinates?: unknown }
    if (parsed.type !== 'Polygon' || !Array.isArray(parsed.coordinates)) return null
    const rings = parsed.coordinates
      .map((ring) => {
        if (!Array.isArray(ring)) return null
        const points = ring
          .map((point) => {
            if (!Array.isArray(point) || point.length < 2) return null
            const lon = Number(point[0])
            const lat = Number(point[1])
            return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] as [number, number] : null
          })
          .filter((point): point is [number, number] => Boolean(point))
        return points.length >= 4 ? points : null
      })
      .filter((ring): ring is [number, number][] => Boolean(ring))
    if (rings.length === 0) return null
    return { type: 'Polygon', coordinates: rings }
  } catch {
    return null
  }
}

export async function fetchNarrativeAoiCandidates(
  viewport: ViewportBBox,
  query: (sql: string, params?: unknown[], timeoutMs?: number) => Promise<QueryResultLike>,
  limit = 200,
  timeoutMs = 1000,
): Promise<AoiCandidateRow[]> {
  const sql = `
    WITH viewport AS (
      SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom
    ),
    candidates AS (
      SELECT
        a.id::text AS id,
        COALESCE(NULLIF(TRIM(a.name), ''), '未命名区域') AS name,
        a.fclass,
        a.area_sqm,
        ST_Intersection(a.geom, viewport.geom) AS clipped_geom
      FROM public.aois a, viewport
      WHERE a.geom && viewport.geom
        AND ST_Intersects(a.geom, viewport.geom)
        AND a.name IS NOT NULL
    )
    SELECT
      id,
      name,
      fclass,
      area_sqm,
      ST_XMin(ST_Envelope(clipped_geom)) AS west,
      ST_YMin(ST_Envelope(clipped_geom)) AS south,
      ST_XMax(ST_Envelope(clipped_geom)) AS east,
      ST_YMax(ST_Envelope(clipped_geom)) AS north,
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(clipped_geom, 0.00003)) AS boundary_geojson
    FROM candidates
    WHERE NOT ST_IsEmpty(clipped_geom)
    ORDER BY
      CASE
        WHEN COALESCE(name, '') ~ '(公园|江滩|湿地|湖|景区|大学|学院|校区|商业街|步行街|购物中心|商场|广场|医院)' THEN 0
        WHEN COALESCE(fclass, '') IN ('park', 'garden', 'recreation_ground', 'nature_reserve', 'university', 'college', 'school', 'commercial', 'retail', 'hospital') THEN 1
        ELSE 2
      END,
      COALESCE(area_sqm, 0) DESC
    LIMIT $5
  `
  const result = await query(sql, [viewport.west, viewport.south, viewport.east, viewport.north, limit], timeoutMs)
  return result.rows
    .map((row): AoiCandidateRow | null => {
      const west = Number(row.west)
      const south = Number(row.south)
      const east = Number(row.east)
      const north = Number(row.north)
      if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) return null
      return {
        id: String(row.id),
        name: String(row.name || '未命名区域'),
        fclass: row.fclass == null ? null : String(row.fclass),
        areaSqm: Number.isFinite(Number(row.area_sqm)) ? Number(row.area_sqm) : null,
        boundary: parseBoundaryGeoJson(row.boundary_geojson) ?? polygonFromBounds({ west, south, east, north }),
      }
    })
    .filter((item): item is AoiCandidateRow => Boolean(item))
}
