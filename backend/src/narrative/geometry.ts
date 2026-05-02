import type { NarrativeBoundaryGeometry, NarrativePoi, ViewportBBox } from './contract.js'

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function viewportToBounds(viewport: ViewportBBox): Bounds {
  return {
    west: viewport.west,
    south: viewport.south,
    east: viewport.east,
    north: viewport.north,
  }
}

export function polygonFromBounds(bounds: Bounds): NarrativeBoundaryGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south],
    ]],
  }
}

export function boundsFromBoundary(boundary: NarrativeBoundaryGeometry): Bounds {
  const ring = boundary.coordinates[0] || []
  const lons = ring.map((point) => point[0]).filter(Number.isFinite)
  const lats = ring.map((point) => point[1]).filter(Number.isFinite)
  if (lons.length === 0 || lats.length === 0) {
    return { west: 0, south: 0, east: 0, north: 0 }
  }
  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  }
}

export function clipBoundsToViewport(bounds: Bounds, viewport: ViewportBBox): Bounds | null {
  const clipped = {
    west: Math.max(bounds.west, viewport.west),
    south: Math.max(bounds.south, viewport.south),
    east: Math.min(bounds.east, viewport.east),
    north: Math.min(bounds.north, viewport.north),
  }
  if (clipped.west >= clipped.east || clipped.south >= clipped.north) return null
  return clipped
}

export function areaKm2FromBounds(bounds: Bounds): number {
  const midLat = ((bounds.south + bounds.north) / 2) * Math.PI / 180
  const widthM = Math.abs(bounds.east - bounds.west) * 111_320 * Math.cos(midLat)
  const heightM = Math.abs(bounds.north - bounds.south) * 110_540
  return Math.max(0, (widthM * heightM) / 1_000_000)
}

export function viewportAreaKm2(viewport: ViewportBBox): number {
  return Math.max(0.0001, areaKm2FromBounds(viewportToBounds(viewport)))
}

export function boundaryAreaKm2(boundary: NarrativeBoundaryGeometry): number {
  return areaKm2FromBounds(boundsFromBoundary(boundary))
}

export function pointInBounds(lon: number, lat: number, bounds: Bounds): boolean {
  return lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north
}

export function pointInBoundaryBounds(poi: NarrativePoi, boundary: NarrativeBoundaryGeometry): boolean {
  return pointInBounds(poi.lon, poi.lat, boundsFromBoundary(boundary))
}

export function boundaryFromPoints(pois: NarrativePoi[], viewport: ViewportBBox): NarrativeBoundaryGeometry {
  const visible = pois.filter((poi) => poi.tier !== 'excluded')
  if (visible.length === 0) return polygonFromBounds(viewportToBounds(viewport))
  const lons = visible.map((poi) => poi.lon)
  const lats = visible.map((poi) => poi.lat)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const lonPad = Math.max((east - west) * 0.08, 0.001)
  const latPad = Math.max((north - south) * 0.08, 0.001)
  const clipped = clipBoundsToViewport({ west: west - lonPad, south: south - latPad, east: east + lonPad, north: north + latPad }, viewport)
  return polygonFromBounds(clipped || viewportToBounds(viewport))
}

export function centerFromBoundary(boundary: NarrativeBoundaryGeometry): [number, number] {
  const bounds = boundsFromBoundary(boundary)
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
}

export function centerFromPois(pois: NarrativePoi[], viewport: ViewportBBox): [number, number] {
  const visible = pois.filter((poi) => poi.tier !== 'excluded')
  if (visible.length === 0) return viewport.center
  const lon = visible.reduce((sum, poi) => sum + poi.lon, 0) / visible.length
  const lat = visible.reduce((sum, poi) => sum + poi.lat, 0) / visible.length
  return [lon, lat]
}

export function semanticDiversity(pois: NarrativePoi[]): number {
  const counts = new Map<string, number>()
  for (const poi of pois) {
    const key = poi.category_main || '未分类'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (pois.length === 0) return 0
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / pois.length
    entropy -= p * Math.log2(p)
  }
  return Number(entropy.toFixed(3))
}
