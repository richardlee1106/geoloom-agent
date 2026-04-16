import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { resolveResourceUrl } from '../utils/resolveResourceUrl.js'
import type { NarrativePoint, NarrativeViewport } from './types.js'

export type NarrativeAreaTemplateName =
  | 'area_category_histogram'
  | 'area_representative_sample'
  | 'area_h3_hotspots'
  | 'area_aoi_context'
  | 'area_landuse_context'

const TEMPLATE_ROOT = resolveResourceUrl(import.meta.url, [
  '../skills/postgis/templates/',
  '../../../src/skills/postgis/templates/',
])

const TEMPLATE_FILE_MAP: Record<NarrativeAreaTemplateName, string> = {
  area_category_histogram: 'areaCategoryHistogram.sql',
  area_representative_sample: 'areaRepresentativeSampleViewport.sql',
  area_h3_hotspots: 'areaH3Hotspots.sql',
  area_aoi_context: 'areaAoiContextViewport.sql',
  area_landuse_context: 'areaLanduseContext.sql',
}

const templateCache = new Map<NarrativeAreaTemplateName, string>()

function formatNumber(value: number, digits = 8) {
  if (!Number.isFinite(value)) return '0'
  const text = value.toFixed(digits)
  return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function clampLimit(limit: number, fallback: number) {
  const normalized = Number(limit)
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback
  }
  return Math.max(1, Math.min(Math.round(normalized), 200))
}

function buildViewportPolygonWkt(viewport: NarrativeViewport) {
  const ring = [
    [viewport.swLon, viewport.swLat],
    [viewport.neLon, viewport.swLat],
    [viewport.neLon, viewport.neLat],
    [viewport.swLon, viewport.neLat],
    [viewport.swLon, viewport.swLat],
  ]
  return `POLYGON((${ring.map(([lon, lat]) => `${formatNumber(lon)} ${formatNumber(lat)}`).join(', ')}))`
}

function loadTemplate(templateName: NarrativeAreaTemplateName) {
  const cached = templateCache.get(templateName)
  if (cached) {
    return cached
  }
  const fileUrl = new URL(TEMPLATE_FILE_MAP[templateName], TEMPLATE_ROOT)
  const raw = readFileSync(fileURLToPath(fileUrl), 'utf8')
  templateCache.set(templateName, raw)
  return raw
}

function replaceTokens(template: string, replacements: Record<string, string>) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, token) => replacements[token] ?? '')
}

export function buildViewportCenter(viewport: NarrativeViewport): NarrativePoint {
  return {
    lon: (viewport.swLon + viewport.neLon) / 2,
    lat: (viewport.swLat + viewport.neLat) / 2,
  }
}

export function buildViewportBoundary(viewport: NarrativeViewport) {
  return {
    type: 'Polygon' as const,
    coordinates: [[
      [viewport.swLon, viewport.swLat],
      [viewport.neLon, viewport.swLat],
      [viewport.neLon, viewport.neLat],
      [viewport.swLon, viewport.neLat],
      [viewport.swLon, viewport.swLat],
    ]],
  }
}

export function buildViewportDiagonalM(viewport: NarrativeViewport) {
  const lon1 = viewport.swLon * Math.PI / 180
  const lat1 = viewport.swLat * Math.PI / 180
  const lon2 = viewport.neLon * Math.PI / 180
  const lat2 = viewport.neLat * Math.PI / 180
  const dLon = lon2 - lon1
  const dLat = lat2 - lat1
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return 6371000 * c
}

export function buildNarrativeAreaTemplateSql(input: {
  templateName: NarrativeAreaTemplateName
  viewport: NarrativeViewport
  center?: NarrativePoint
  limit?: number
}) {
  const template = loadTemplate(input.templateName)
  const viewport = input.viewport
  const center = input.center || buildViewportCenter(viewport)
  const polygonWkt = buildViewportPolygonWkt(viewport)
  const areaGeometry = `ST_GeomFromText('${polygonWkt}', 4326)`
  const areaFilter = `ST_Intersects(geom, ${areaGeometry})`
  const areaJoinFilter = `ST_Intersects(p.geom, ${areaGeometry})`
  const pointGeography = `ST_SetSRID(ST_MakePoint(${formatNumber(center.lon)}, ${formatNumber(center.lat)}), 4326)::geography`
  const widthDeg = Math.max(viewport.neLon - viewport.swLon, 0.0001)
  const heightDeg = Math.max(viewport.neLat - viewport.swLat, 0.0001)
  const tileCols = 4
  const tileRows = 4
  const tileWidth = Math.max(widthDeg / tileCols, 0.00005)
  const tileHeight = Math.max(heightDeg / tileRows, 0.00005)
  const cellSizeDeg = Math.max(Math.max(widthDeg, heightDeg) / 5, 0.00012)
  const limit = clampLimit(input.limit ?? 12, 12)

  return replaceTokens(template, {
    AREA_FILTER: areaFilter,
    AREA_GEOMETRY: areaGeometry,
    AREA_JOIN_FILTER: areaJoinFilter,
    CATEGORY_FILTER: '',
    CATEGORY_JOIN_FILTER: '',
    POINT_GEOGRAPHY: pointGeography,
    CELL_SIZE_DEG: formatNumber(cellSizeDeg, 10),
    LIMIT: String(limit),
    VIEWPORT_MIN_LON: formatNumber(viewport.swLon),
    VIEWPORT_MIN_LAT: formatNumber(viewport.swLat),
    VIEWPORT_TILE_WIDTH: formatNumber(tileWidth, 10),
    VIEWPORT_TILE_HEIGHT: formatNumber(tileHeight, 10),
    VIEWPORT_TILE_COLS: String(tileCols),
    VIEWPORT_TILE_ROWS: String(tileRows),
  })
}
