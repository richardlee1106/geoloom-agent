import type { BrandType } from './brandAggregation.js'
import type { NarrativeNode, NarrativePoint, NarrativeViewport } from './types.js'

/**
 * 诊断端点请求：给定 viewport，返回视口内原始召回数据与编排中间产物。
 * 不经 SSE、不生成解说词、不做 encoder POI profile，仅用于数据质量诊断。
 */
export interface NarrativeProbeRequest {
  viewport: NarrativeViewport
  rawQuery?: string
  includeEncoder?: boolean
  topRaw?: number
}

export interface ProbePoiRow {
  id: string | number | null
  name: string
  category_main: string | null
  category_sub: string | null
  longitude: number
  latitude: number
  distance_m: number | null
  anchor_priority?: number | null
  tile_x?: number | null
  tile_y?: number | null
  brand_bucket?: string | null
}

export interface ProbeAoiRow {
  id: string | number | null
  name: string
  fclass: string | null
  code: string | null
  population: number | null
  area_sqm: number | null
  longitude: number
  latitude: number
  anchor_priority?: number | null
  boundary_geojson?: string | null
}

export interface ProbeBrandClusterView {
  brand: string
  type: BrandType
  count: number
  eligible: boolean
  center: NarrativePoint
  members: Array<{
    id: string | number | null
    name: string
    longitude: number
    latitude: number
  }>
}

export interface NarrativeProbeResult {
  version: string
  viewport: NarrativeViewport
  center: NarrativePoint
  diagonalM: number
  raw: {
    categoryHistogram: Array<Record<string, unknown>>
    representativeSamples: ProbePoiRow[]
    brandPool: ProbePoiRow[]
    aoiContext: ProbeAoiRow[]
    landuseContext: Array<Record<string, unknown>>
    hotspots: Array<Record<string, unknown>>
  }
  brandAggregation: {
    allClusters: ProbeBrandClusterView[]
    eligibleClusters: ProbeBrandClusterView[]
    ineligibleClusters: ProbeBrandClusterView[]
    coveredPoiIds: string[]
  }
  candidates: {
    total: number
    bySource: Record<string, number>
    byRole: Record<string, number>
    items: NarrativeNode[]
  }
  ranked: {
    limit: number
    mode: string
    selected: NarrativeNode[]
    droppedIds: string[]
  }
  encoder?: {
    available: boolean
    regionSummary: string | null
    regionTags: Array<{ label: string, score?: number | null }>
    sceneTags: string[]
    dominantBuckets: string[]
    cells: Array<Record<string, unknown>>
  } | null
  diagnostics: {
    notes: string[]
  }
}
