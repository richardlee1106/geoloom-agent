import { createContextBindingManager } from '../../utils/contextBinding.js'

const DEEP_SPATIAL_KEYWORDS = [
  '模糊',
  '边界',
  '片区',
  '聚类',
  '热力',
  '对比',
  '空间结构',
  '可达性',
  '生态位',
  'fuzzy',
  'vernacular',
  'cluster',
  'region',
  'comparison'
]

const VISUAL_SNAPSHOT_KEYWORDS = [
  '看图',
  '截图',
  '视觉',
  '形态',
  '地图',
  'v l m'.replace(/\s+/g, ''),
  'ocr'
]

const GCJ_A = 6378245.0
const GCJ_EE = 0.00669342162296594323

function outOfChina(lon, lat) {
  return (lon < 72.004 || lon > 137.8347) || (lat < 0.8293 || lat > 55.8271)
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}

function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return [lon, lat]

  const dLat = transformLat(lon - 105.0, lat - 35.0)
  const dLon = transformLon(lon - 105.0, lat - 35.0)
  const radLat = lat / 180.0 * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - GCJ_EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const mgLat = lat + (dLat * 180.0) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI)
  const mgLon = lon + (dLon * 180.0) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI)
  return [mgLon, mgLat]
}

function normalizeSelectedCategories(rawSelectedCategories) {
  if (!Array.isArray(rawSelectedCategories) || rawSelectedCategories.length === 0) {
    return []
  }

  const flattened = []
  for (const item of rawSelectedCategories) {
    if (Array.isArray(item) && item.length > 0) {
      const leaf = item[item.length - 1]
      if (typeof leaf === 'string' && leaf.trim()) {
        flattened.push(leaf.trim())
      }
      continue
    }

    if (typeof item === 'string' && item.trim()) {
      flattened.push(item.trim())
    }
  }

  return [...new Set(flattened)]
}

function inferAnalysisScale(zoom) {
  if (!zoom) return 'district'
  if (zoom >= 16) return 'street'
  if (zoom >= 14) return 'block'
  if (zoom >= 12) return 'district'
  return 'city'
}

export function useSpatialRequestBuilder({
  poiCoordSys = (import.meta.env.VITE_POI_COORD_SYS || 'gcj02').toLowerCase(),
  contextBindingSeed = ''
} = {}) {
  const shouldProjectToBackend = poiCoordSys === 'wgs84'
  const contextBindingManager = createContextBindingManager({
    seed: contextBindingSeed || `view_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  })

  function gcj02ToWgs84(lon, lat) {
    if (outOfChina(lon, lat)) return [lon, lat]
    const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat)
    return [lon * 2 - gcjLon, lat * 2 - gcjLat]
  }

  function toBackendLonLat(lon, lat) {
    const numericLon = Number(lon)
    const numericLat = Number(lat)
    if (!Number.isFinite(numericLon) || !Number.isFinite(numericLat)) {
      return [lon, lat]
    }
    if (!shouldProjectToBackend) {
      return [numericLon, numericLat]
    }
    return gcj02ToWgs84(numericLon, numericLat)
  }

  function convertCoordinateArrayToBackend(coords) {
    if (!Array.isArray(coords)) return coords
    if (coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
      const [lon, lat] = toBackendLonLat(coords[0], coords[1])
      const rest = coords.length > 2 ? coords.slice(2) : []
      return [lon, lat, ...rest]
    }
    return coords.map((item) => convertCoordinateArrayToBackend(item))
  }

  function normalizeBoundaryForBackend(boundary) {
    if (!Array.isArray(boundary)) return boundary
    return boundary
      .map((point) => {
        if (Array.isArray(point) && point.length >= 2) {
          const [lon, lat] = toBackendLonLat(point[0], point[1])
          return [lon, lat]
        }
        if (point && typeof point === 'object') {
          const [lon, lat] = toBackendLonLat(point.lon ?? point.lng ?? point.longitude, point.lat ?? point.latitude)
          return { ...point, lon, lat }
        }
        return null
      })
      .filter(Boolean)
  }

  function normalizeCenterForBackend(center) {
    if (!center) return center
    if (Array.isArray(center) && center.length >= 2) {
      const [lon, lat] = toBackendLonLat(center[0], center[1])
      return [lon, lat]
    }
    if (center && typeof center === 'object') {
      const [lon, lat] = toBackendLonLat(center.lon ?? center.lng ?? center.longitude, center.lat ?? center.latitude)
      return { ...center, lon, lat }
    }
    return center
  }

  function normalizeViewportForBackend(viewport) {
    if (!Array.isArray(viewport) || viewport.length < 4) return viewport
    const [swLon, swLat] = toBackendLonLat(viewport[0], viewport[1])
    const [neLon, neLat] = toBackendLonLat(viewport[2], viewport[3])
    return [
      Math.min(swLon, neLon),
      Math.min(swLat, neLat),
      Math.max(swLon, neLon),
      Math.max(swLat, neLat)
    ]
  }

  function normalizeBoundaryWKTForBackend(boundaryWKT) {
    if (!shouldProjectToBackend) return boundaryWKT
    if (typeof boundaryWKT !== 'string' || !boundaryWKT.trim()) return boundaryWKT
    if (!/POLYGON\s*\(\(/i.test(boundaryWKT)) return boundaryWKT

    const match = boundaryWKT.match(/POLYGON\s*\(\(\s*(.+?)\s*\)\)/i)
    if (!match || !match[1]) return boundaryWKT

    const convertedPairs = match[1]
      .split(',')
      .map((pair) => pair.trim().split(/\s+/))
      .filter((pair) => pair.length >= 2)
      .map(([lon, lat]) => toBackendLonLat(lon, lat))
      .map(([lon, lat]) => `${lon} ${lat}`)

    if (convertedPairs.length < 3) return boundaryWKT
    return `POLYGON((${convertedPairs.join(', ')}))`
  }

  function normalizeRegionGeometryForBackend(geometry) {
    if (!geometry || typeof geometry !== 'object') return geometry
    if (!Array.isArray(geometry.coordinates)) return geometry
    return {
      ...geometry,
      coordinates: convertCoordinateArrayToBackend(geometry.coordinates)
    }
  }

  function normalizeRegionsForBackend(regions = []) {
    if (!Array.isArray(regions)) return []
    return regions.map((region) => ({
      id: region.id,
      name: region.name,
      type: region.type,
      geometry: normalizeRegionGeometryForBackend(region.geometry),
      boundaryWKT: normalizeBoundaryWKTForBackend(region.boundaryWKT),
      center: normalizeCenterForBackend(region.center),
      poiCount: region.pois?.length || 0,
      stats: region.stats
    }))
  }

  function hasCustomSelection(spatialContext, regions) {
    const hasPolygon = Array.isArray(spatialContext?.boundary) && spatialContext.boundary.length >= 3
    const hasCircle = Boolean(spatialContext?.center) && String(spatialContext?.mode || '').toLowerCase() === 'circle'
    const hasRegion = Array.isArray(regions) && regions.length > 0
    return hasPolygon || hasCircle || hasRegion
  }

  function shouldRunDeepSpatialMode(queryText, spatialContext, regions, poiCount) {
    const normalized = String(queryText || '').toLowerCase()
    if (!normalized) return false
    if ((regions?.length || 0) >= 2) return true
    if (DEEP_SPATIAL_KEYWORDS.some((kw) => normalized.includes(kw))) return true
    if (String(spatialContext?.mode || '').toLowerCase() === 'polygon' && Number(poiCount) >= 180) return true
    return false
  }

  function shouldCaptureSnapshot(queryText, deepSpatialMode) {
    if (!deepSpatialMode) return false
    const normalized = String(queryText || '').toLowerCase()
    return VISUAL_SNAPSHOT_KEYWORDS.some((kw) => normalized.includes(kw)) || normalized.length >= 28
  }

  function buildDslMetaSkeleton({
    enabled = false,
    requestId = '',
    spatialContext = {},
    drawMode = 'none',
    regions = [],
    mapStateVersion = null
  } = {}) {
    const contextBinding = contextBindingManager.next({
      viewport: Array.isArray(spatialContext?.viewport) ? spatialContext.viewport : [],
      drawMode: drawMode || spatialContext?.mode || 'none',
      regions,
      mapStateVersion,
      sourceOverride: requestId ? 'frontend_injected' : 'frontend_generated'
    })

    if (!enabled) {
      return {
        context_binding: contextBinding
      }
    }

    return {
      context_binding: contextBinding,
      revision: {
        mode: 'rebuild',
        base_trace_id: null,
        patch_ops: []
      },
      streaming_hints: {
        allow_prefetch: false,
        prefetch_on_fields: []
      }
    }
  }

  function buildSpatialContext({
    boundaryPolygon,
    drawMode,
    circleCenter,
    circleRadius,
    mapBounds,
    mapZoom,
    regions = [],
    poiFeatures = []
  }) {
    return {
      boundary: normalizeBoundaryForBackend(boundaryPolygon),
      mode: drawMode,
      center: normalizeCenterForBackend(circleCenter),
      radius: circleRadius,
      viewport: normalizeViewportForBackend(mapBounds),
      mapZoom,
      analysisScale: inferAnalysisScale(mapZoom),
      interactionHints: {
        hasDrawnRegion: regions.length > 0,
        regionCount: regions.length || 0,
        isComparing: (regions.length || 0) >= 2,
        poiCount: poiFeatures.length || 0
      }
    }
  }

  return {
    normalizeSelectedCategories,
    hasCustomSelection,
    shouldRunDeepSpatialMode,
    shouldCaptureSnapshot,
    buildDslMetaSkeleton,
    normalizeBoundaryForBackend,
    normalizeCenterForBackend,
    normalizeViewportForBackend,
    normalizeBoundaryWKTForBackend,
    normalizeRegionGeometryForBackend,
    normalizeRegionsForBackend,
    buildSpatialContext
  }
}
