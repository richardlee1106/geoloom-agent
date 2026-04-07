import { ref, type Ref } from 'vue'
import Feature from 'ol/Feature'
import Polygon from 'ol/geom/Polygon'
import { Vector as VectorLayer } from 'ol/layer'
import { fromLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import { isEmpty as isEmptyExtent } from 'ol/extent'

import {
  buildAiBoundaryMeta,
  buildBoundaryPopupLines as buildBoundaryPopupLinesFromMeta,
  type AiBoundaryMeta
} from '../../utils/aiBoundaryMeta'
import {
  normalizeAiEvidencePayload,
  resolveFuzzyLayerBundle,
  resolveRegionBoundary,
  type FuzzyLayerBundle
} from '../../utils/aiEvidencePayload'

type PlainObject = Record<string, unknown>
type CoordinatePair = [number, number]

interface LegendBuckets {
  high: number
  medium: number
  low: number
}

interface BoundaryLegendState {
  visible: boolean
  model: string | null
  avg: number | null
  min: number | null
  max: number | null
  buckets: LegendBuckets
  anchorModel: string | null
  semanticAnchorCoverage: number | null
  dominantNicheType: string | null
  avgWaterPenalty: number | null
}

interface SimpleViewLike {
  getResolution?: () => number | undefined
  fit?: (extent: unknown, options: PlainObject) => void
}

interface SimpleMapLike {
  getView?: () => SimpleViewLike | undefined
}

interface UseEvidenceLayerArgs {
  mapRef: Ref<SimpleMapLike | null>
  locateLayerSource: VectorSource
  hidePopup?: (() => void) | null
  vectorLayerRuntimeOptions?: PlainObject
  toMapLonLat?: ((lon: number, lat: number) => [number, number]) | null
}

interface BestBoundaryMatch {
  label: string
  kind: string
  confidence: number
  score: number
  meta: unknown
}

interface AddBoundaryOptions {
  confidence?: unknown
  label?: unknown
  meta?: unknown
  onFeatureAdded?: ((confidence: number | null) => void) | null
}

const AI_BOUNDARY_KIND_PRIORITY = Object.freeze({
  fuzzyCore: 4.0,
  fuzzyTransition: 3.0,
  fuzzyOuter: 2.0,
  vernacular: 1.6,
  hotspot: 1.4,
  queryBoundary: 1.2,
  generic: 1.0
} satisfies Record<string, number>)

type AiBoundaryKind = keyof typeof AI_BOUNDARY_KIND_PRIORITY

const AI_POLYGON_STYLE_PRESETS: Record<AiBoundaryKind, {
  color: [number, number, number]
  fillAlpha: number
  strokeAlpha: number
  width: number
}> = {
  queryBoundary: { color: [59, 130, 246], fillAlpha: 0.08, strokeAlpha: 0.95, width: 3.0 },
  hotspot: { color: [249, 115, 22], fillAlpha: 0.12, strokeAlpha: 0.92, width: 2.0 },
  vernacular: { color: [244, 114, 182], fillAlpha: 0.10, strokeAlpha: 0.82, width: 2.0 },
  fuzzyOuter: { color: [56, 189, 248], fillAlpha: 0.08, strokeAlpha: 0.58, width: 1.6 },
  fuzzyTransition: { color: [168, 85, 247], fillAlpha: 0.10, strokeAlpha: 0.75, width: 2.0 },
  fuzzyCore: { color: [16, 185, 129], fillAlpha: 0.15, strokeAlpha: 0.90, width: 2.4 },
  generic: { color: [148, 163, 184], fillAlpha: 0.06, strokeAlpha: 0.75, width: 1.8 }
}

const AI_BOUNDARY_FULL_GEOMETRY_KEY = '__aiBoundaryGeometryFull'
const AI_BOUNDARY_SIMPLIFY_CACHE_KEY = '__aiBoundarySimplifyCache'
const AI_BOUNDARY_VERTEX_COUNT_KEY = '__aiBoundaryVertexCount'

function asPlainObject(value: unknown): PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PlainObject)
    : {}
}

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAiBoundaryKind(value: string): value is AiBoundaryKind {
  return value in AI_BOUNDARY_KIND_PRIORITY
}

function parseBoundaryPayload(boundary: unknown): unknown {
  if (typeof boundary !== 'string') return boundary
  const raw = boundary.trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toCoordinatePair(coord: unknown): CoordinatePair | null {
  if (Array.isArray(coord) && coord.length >= 2) {
    const lon = Number(coord[0])
    const lat = Number(coord[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat]
  }

  if (isPlainObject(coord)) {
    const lon = Number(coord.lon ?? coord.lng ?? coord.longitude ?? coord.x)
    const lat = Number(coord.lat ?? coord.latitude ?? coord.y)
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat]
  }

  return null
}

function extractBoundaryRings(boundary: unknown): unknown[] {
  const payload = parseBoundaryPayload(boundary)
  if (!payload) return []

  if (Array.isArray(payload)) {
    if (payload.length === 0) return []
    if (toCoordinatePair(payload[0])) return [payload]
    const first = payload[0]
    if (Array.isArray(first) && toCoordinatePair(first[0])) return [first]
    return payload.flatMap((item) => extractBoundaryRings(item))
  }

  if (!isPlainObject(payload)) return []
  if (payload.type === 'Feature') return extractBoundaryRings(payload.geometry)
  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features.flatMap((feature) => extractBoundaryRings(feature))
  }
  if (payload.type === 'Polygon') return extractBoundaryRings(payload.coordinates)
  if (payload.type === 'MultiPolygon' && Array.isArray(payload.coordinates)) {
    return payload.coordinates.flatMap((polygon) => extractBoundaryRings(polygon))
  }
  if (Array.isArray(payload.coordinates)) return extractBoundaryRings(payload.coordinates)
  if (Array.isArray(payload.boundary)) return extractBoundaryRings(payload.boundary)
  if (Array.isArray(payload.boundary_ring)) return extractBoundaryRings(payload.boundary_ring)
  if (isPlainObject(payload.geometry)) return extractBoundaryRings(payload.geometry)
  return []
}

function normalizeClosedRing(ringCandidate: unknown): CoordinatePair[] {
  const ring = (Array.isArray(ringCandidate) ? ringCandidate : [])
    .map((coord) => toCoordinatePair(coord))
    .filter((coord): coord is CoordinatePair => Boolean(coord))

  if (ring.length < 3) return []

  const [firstLon, firstLat] = ring[0]
  const [lastLon, lastLat] = ring[ring.length - 1]
  if (firstLon !== lastLon || firstLat !== lastLat) ring.push([firstLon, firstLat])
  return ring
}

function toFiniteBoundaryConfidence(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

function confidenceBucket(score: unknown): keyof LegendBuckets | 'unknown' {
  const value = toFiniteBoundaryConfidence(score)
  if (value === null) return 'unknown'
  if (value >= 0.7) return 'high'
  if (value >= 0.4) return 'medium'
  return 'low'
}

function createAiPolygonStyle(kind = 'generic', confidence: unknown = null): Style {
  const normalizedKind: AiBoundaryKind = isAiBoundaryKind(kind) ? kind : 'generic'
  const preset = AI_POLYGON_STYLE_PRESETS[normalizedKind]
  const score = toFiniteBoundaryConfidence(confidence)
  const confidenceFactor = score === null ? 1 : (0.45 + score * 0.55)
  const fillAlpha = Math.max(0.02, Math.min(0.98, preset.fillAlpha * confidenceFactor))
  const strokeAlpha = Math.max(0.08, Math.min(0.98, preset.strokeAlpha * (score === null ? 1 : (0.35 + score * 0.65))))
  const strokeWidth = Math.max(1, preset.width * (score === null ? 1 : (0.75 + score * 0.5)))
  const [r, g, b] = preset.color

  let lineDash: number[] | undefined
  if (score !== null && score < 0.4) lineDash = [8, 8]
  else if (score !== null && score < 0.7) lineDash = [6, 5]

  return new Style({
    fill: new Fill({ color: `rgba(${r}, ${g}, ${b}, ${fillAlpha.toFixed(3)})` }),
    stroke: new Stroke({
      color: `rgba(${r}, ${g}, ${b}, ${strokeAlpha.toFixed(3)})`,
      width: Number(strokeWidth.toFixed(2)),
      lineDash,
      lineJoin: 'round',
      lineCap: 'round'
    })
  })
}

function estimateBoundaryTolerance(resolution: unknown, vertexCount = 0): number {
  const safeResolution = Number.isFinite(Number(resolution)) ? Math.max(0.5, Number(resolution)) : 1
  let complexityFactor = 1.2
  if (vertexCount >= 1200) complexityFactor = 2.4
  else if (vertexCount >= 700) complexityFactor = 2.0
  else if (vertexCount >= 300) complexityFactor = 1.6
  return Number((safeResolution * complexityFactor).toFixed(2))
}

function createEmptyLegendState(): BoundaryLegendState {
  return {
    visible: false,
    model: null,
    avg: null,
    min: null,
    max: null,
    buckets: { high: 0, medium: 0, low: 0 },
    anchorModel: null,
    semanticAnchorCoverage: null,
    dominantNicheType: null,
    avgWaterPenalty: null
  }
}

export function useEvidenceLayer({
  mapRef,
  locateLayerSource,
  hidePopup,
  vectorLayerRuntimeOptions,
  toMapLonLat
}: UseEvidenceLayerArgs) {
  const aiEvidenceLayerSource = new VectorSource()
  const safeRenderBuffer = Math.max(256, Number(vectorLayerRuntimeOptions?.renderBuffer) || 0)
  const aiEvidenceLayer = new VectorLayer({
    ...(vectorLayerRuntimeOptions || {}),
    renderBuffer: safeRenderBuffer,
    source: aiEvidenceLayerSource,
    zIndex: 260
  })

  const aiBoundaryLegend = ref<BoundaryLegendState>(createEmptyLegendState())
  let boundaryInteractionMode = false

  const ringToOlCoordinates = (ringCandidate: unknown): number[][] => {
    const ring = normalizeClosedRing(ringCandidate)
    if (ring.length < 4) return []
    return ring.map(([lon, lat]) => {
      const [mapLon, mapLat] = typeof toMapLonLat === 'function' ? toMapLonLat(lon, lat) : [lon, lat]
      return fromLonLat([mapLon, mapLat])
    })
  }

  const formatLegendPercent = (value: unknown): string => {
    const score = toFiniteBoundaryConfidence(value)
    return score === null ? '--' : `${Math.round(score * 100)}%`
  }

  const resetAiBoundaryLegend = (): void => {
    aiBoundaryLegend.value = createEmptyLegendState()
  }

  const updateAiBoundaryLegend = ({
    stats = null,
    confidenceValues = [],
    renderedCount = 0
  }: {
    stats?: unknown
    confidenceValues?: Array<number | null>
    renderedCount?: number
  } = {}): void => {
    if (renderedCount <= 0) return resetAiBoundaryLegend()

    const cleanValues = confidenceValues
      .map((value) => toFiniteBoundaryConfidence(value))
      .filter((value): value is number => value !== null)

    const normalizedStats = asPlainObject(stats)
    const statAvg = toFiniteBoundaryConfidence(normalizedStats.avg_boundary_confidence)
    const statMin = toFiniteBoundaryConfidence(normalizedStats.min_boundary_confidence)
    const statMax = toFiniteBoundaryConfidence(normalizedStats.max_boundary_confidence)
    const avg = statAvg !== null ? statAvg : (cleanValues.length ? cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length : null)
    const min = statMin !== null ? statMin : (cleanValues.length ? Math.min(...cleanValues) : null)
    const max = statMax !== null ? statMax : (cleanValues.length ? Math.max(...cleanValues) : null)
    const buckets: LegendBuckets = { high: 0, medium: 0, low: 0 }

    cleanValues.forEach((value) => {
      const bucket = confidenceBucket(value)
      if (bucket !== 'unknown') buckets[bucket] += 1
    })

    aiBoundaryLegend.value = {
      visible: true,
      model: String(normalizedStats.boundary_confidence_model || 'composite_v5'),
      avg,
      min,
      max,
      buckets,
      anchorModel: normalizedStats.semantic_anchor_model ? String(normalizedStats.semantic_anchor_model) : null,
      semanticAnchorCoverage: toFiniteBoundaryConfidence(normalizedStats.semantic_anchor_coverage),
      dominantNicheType: normalizedStats.dominant_niche_type ? String(normalizedStats.dominant_niche_type) : null,
      avgWaterPenalty: toFiniteBoundaryConfidence(normalizedStats.avg_water_penalty)
    }
  }

  const addAiBoundaryFeature = (boundary: unknown, kind = 'generic', options: AddBoundaryOptions = {}): number => {
    const rings = extractBoundaryRings(boundary)
    if (!rings.length) return 0

    const confidence = toFiniteBoundaryConfidence(options.confidence)
    const onFeatureAdded = typeof options.onFeatureAdded === 'function' ? options.onFeatureAdded : null
    const label = typeof options.label === 'string' ? options.label.trim() : ''
    const meta = isPlainObject(options.meta) ? options.meta : null

    let addedCount = 0
    rings.forEach((ringCandidate) => {
      const olCoords = ringToOlCoordinates(ringCandidate)
      if (olCoords.length < 4) return

      const fullGeometry = new Polygon([olCoords])
      const feature = new Feature({ geometry: fullGeometry })
      if (label) feature.set('__aiBoundaryLabel', label)
      feature.set('__aiBoundaryKind', kind)
      feature.set('__aiBoundaryConfidence', confidence)
      feature.set(AI_BOUNDARY_FULL_GEOMETRY_KEY, fullGeometry)
      feature.set(AI_BOUNDARY_VERTEX_COUNT_KEY, olCoords.length)
      if (meta) feature.set('__aiBoundaryMeta', meta)
      feature.setStyle(createAiPolygonStyle(kind, confidence))
      aiEvidenceLayerSource.addFeature(feature)
      addedCount += 1
      onFeatureAdded?.(confidence)
    })

    return addedCount
  }

  const resolveSimplifiedGeometry = (feature: Feature, tolerance: number) => {
    const fullGeometry = feature.get(AI_BOUNDARY_FULL_GEOMETRY_KEY)
    if (!fullGeometry || tolerance <= 0) return fullGeometry || feature.getGeometry()

    let cache = feature.get(AI_BOUNDARY_SIMPLIFY_CACHE_KEY)
    if (!(cache instanceof Map)) {
      cache = new Map<string, unknown>()
      feature.set(AI_BOUNDARY_SIMPLIFY_CACHE_KEY, cache)
    }

    const cacheKey = Number(tolerance).toFixed(2)
    if (cache.has(cacheKey)) return cache.get(cacheKey)

    let simplified = fullGeometry.simplify(tolerance)
    if (!simplified || simplified.getType?.() !== 'Polygon') simplified = fullGeometry
    const firstRing = simplified.getCoordinates?.()?.[0]
    if (!Array.isArray(firstRing) || firstRing.length < 4) simplified = fullGeometry
    cache.set(cacheKey, simplified)
    return simplified
  }

  const applyBoundaryLod = (interactive = false): void => {
    const map = mapRef.value
    if (!map) return

    const resolution = map.getView?.()?.getResolution?.() ?? 1
    let changed = false
    aiEvidenceLayerSource.forEachFeature((feature) => {
      const fullGeometry = feature.get(AI_BOUNDARY_FULL_GEOMETRY_KEY)
      if (!fullGeometry) return
      let targetGeometry = fullGeometry
      if (interactive) {
        const vertexCount = Number(feature.get(AI_BOUNDARY_VERTEX_COUNT_KEY)) || 0
        const tolerance = estimateBoundaryTolerance(resolution, vertexCount)
        targetGeometry = resolveSimplifiedGeometry(feature, tolerance) || fullGeometry
      }
      if (feature.getGeometry() !== targetGeometry) {
        feature.setGeometry(targetGeometry)
        changed = true
      }
    })
    if (changed) aiEvidenceLayerSource.changed()
  }

  const setBoundaryInteractionMode = (isInteracting: unknown): void => {
    const nextMode = Boolean(isInteracting)
    if (nextMode === boundaryInteractionMode) return
    boundaryInteractionMode = nextMode
    applyBoundaryLod(boundaryInteractionMode)
  }

  const fitToAiEvidenceIfNeeded = (shouldFit = false): void => {
    const map = mapRef.value
    if (!shouldFit || !map) return
    const extent = aiEvidenceLayerSource.getExtent()
    if (!extent || isEmptyExtent(extent)) return
    map.getView?.()?.fit?.(extent, { padding: [60, 60, 60, 60], duration: 600, maxZoom: 16 })
  }

  const clearAiEvidenceBoundaries = (): void => {
    aiEvidenceLayerSource.clear()
    resetAiBoundaryLegend()
    if (typeof hidePopup === 'function') hidePopup()
  }

  const showAnalysisBoundary = (boundary: unknown, options: PlainObject = {}): void => {
    const { fitView = true, clear = true, clearLocate = true, label = '片区边界' } = options as {
      fitView?: boolean
      clear?: boolean
      clearLocate?: boolean
      label?: string
    }
    if (clear) clearAiEvidenceBoundaries()
    if (clearLocate) locateLayerSource.clear()
    addAiBoundaryFeature(boundary, 'queryBoundary', { label })
    applyBoundaryLod(boundaryInteractionMode)
    aiBoundaryLegend.value.visible = false
    fitToAiEvidenceIfNeeded(fitView)
  }

  const showAiSpatialEvidence = (payload: unknown = {}, options: { fitView?: boolean; clear?: boolean; clearLocate?: boolean } = {}): void => {
    const inputPayload = isPlainObject(payload) ? payload : {}
    const { fitView = false, clear = true, clearLocate = true } = options
    if (clear) clearAiEvidenceBoundaries()
    if (clearLocate) locateLayerSource.clear()

    const normalized = normalizeAiEvidencePayload(inputPayload)
    const clusters = normalized.clusters
    const vernacularRegions = normalized.vernacularRegions.filter(isPlainObject)
    const fuzzyRegions = normalized.fuzzyRegions.filter(isPlainObject)
    const boundary = normalized.boundary
    const stats = normalized.stats
    const confidenceValues: Array<number | null> = []
    const collectConfidence = (value: number | null): void => {
      const score = toFiniteBoundaryConfidence(value)
      if (score !== null) confidenceValues.push(score)
    }

    let renderedCount = 0
    const hotspotList = Array.isArray(clusters?.hotspots) ? clusters.hotspots.filter(isPlainObject) : []

    hotspotList.slice(0, 8).forEach((hotspot) => {
      const layers = asPlainObject(hotspot.layers)
      const transition = asPlainObject(layers.transition)
      const outer = asPlainObject(layers.outer)
      const dominantCategories = Array.isArray(hotspot.dominantCategories) ? hotspot.dominantCategories : []
      const dominantCategoriesSnake = Array.isArray(hotspot.dominant_categories) ? hotspot.dominant_categories : []
      const hotspotBoundary = hotspot.boundary_geojson || transition.geojson || hotspot.boundary || transition.boundary || outer.boundary || hotspot.boundary_ring
      const hotspotLabel = String(
        hotspot.name ||
        asPlainObject(dominantCategories[0]).category ||
        asPlainObject(dominantCategoriesSnake[0]).category ||
        '高活力片区'
      )
      renderedCount += addAiBoundaryFeature(hotspotBoundary, 'hotspot', {
        confidence: hotspot.boundary_confidence,
        label: hotspotLabel,
        meta: buildAiBoundaryMeta(hotspot),
        onFeatureAdded: collectConfidence
      })
    })

    vernacularRegions.slice(0, 8).forEach((region) => {
      const regionBoundary = resolveRegionBoundary(region)
      const regionLabel = String(region.name || region.dominant_category || region.theme || '生态片区')
      renderedCount += addAiBoundaryFeature(regionBoundary, 'vernacular', {
        confidence: region.boundary_confidence,
        label: regionLabel,
        meta: buildAiBoundaryMeta(region),
        onFeatureAdded: collectConfidence
      })
    })

    fuzzyRegions.slice(0, 10).forEach((region) => {
      const baseLabel = String(region.name || region.theme || '片区')
      const layers = resolveFuzzyLayerBundle(region) as FuzzyLayerBundle
      const regionLayers = asPlainObject(region.layers)
      const outerLayer = asPlainObject(regionLayers.outer)
      const transitionLayer = asPlainObject(regionLayers.transition)
      const coreLayer = asPlainObject(regionLayers.core)
      const hasDistinctLayers = Boolean(region.layers)
        && (outerLayer.boundary !== transitionLayer.boundary || transitionLayer.boundary !== coreLayer.boundary)

      if (hasDistinctLayers) {
        renderedCount += addAiBoundaryFeature(layers.outer.boundary, 'fuzzyOuter', {
          confidence: layers.outer.confidence,
          label: `${baseLabel}（外层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'outer' }),
          onFeatureAdded: collectConfidence
        })
        renderedCount += addAiBoundaryFeature(layers.transition.boundary, 'fuzzyTransition', {
          confidence: layers.transition.confidence,
          label: `${baseLabel}（过渡层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'transition' }),
          onFeatureAdded: collectConfidence
        })
        renderedCount += addAiBoundaryFeature(layers.core.boundary, 'fuzzyCore', {
          confidence: layers.core.confidence,
          label: `${baseLabel}（核心层）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'core' }),
          onFeatureAdded: collectConfidence
        })
      } else {
        const singleBoundary = layers.core.boundary || layers.transition.boundary || layers.outer.boundary
        renderedCount += addAiBoundaryFeature(singleBoundary, 'fuzzyCore', {
          confidence: layers.core.confidence,
          label: `${baseLabel}（核心区）`,
          meta: buildAiBoundaryMeta(region, { fuzzyLayer: 'core' }),
          onFeatureAdded: collectConfidence
        })
      }
    })

    if (renderedCount === 0 && boundary) {
      renderedCount += addAiBoundaryFeature(boundary, 'queryBoundary', {
        label: inputPayload.boundary_label || inputPayload.boundaryLabel || '边界'
      })
    }

    applyBoundaryLod(boundaryInteractionMode)
    updateAiBoundaryLegend({ stats, confidenceValues, renderedCount })
    fitToAiEvidenceIfNeeded(fitView)
  }

  const findAiBoundaryAtCoordinate = (coordinate: unknown): BestBoundaryMatch | null => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null
    let bestMatch: BestBoundaryMatch | null = null

    aiEvidenceLayerSource.forEachFeature((feature) => {
      const geometry = feature?.getGeometry?.()
      if (!geometry || typeof geometry.intersectsCoordinate !== 'function') return
      if (!geometry.intersectsCoordinate(coordinate)) return

      const labelRaw = feature.get('__aiBoundaryLabel')
      const label = typeof labelRaw === 'string' ? labelRaw.trim() : ''
      if (!label) return

      const kind = String(feature.get('__aiBoundaryKind') || 'generic')
      const priority = isAiBoundaryKind(kind)
        ? AI_BOUNDARY_KIND_PRIORITY[kind]
        : AI_BOUNDARY_KIND_PRIORITY.generic
      const confidence = toFiniteBoundaryConfidence(feature.get('__aiBoundaryConfidence')) ?? 0
      const score = priority + confidence
      const meta = feature.get('__aiBoundaryMeta') || null

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { label, kind, confidence, score, meta }
      }
    })

    return bestMatch
  }

  const buildBoundaryPopupLines = (meta: AiBoundaryMeta | unknown): string[] => {
    return buildBoundaryPopupLinesFromMeta(meta)
  }

  return {
    aiEvidenceLayer,
    aiEvidenceLayerSource,
    aiBoundaryLegend,
    formatLegendPercent,
    clearAiEvidenceBoundaries,
    showAnalysisBoundary,
    showAiSpatialEvidence,
    setBoundaryInteractionMode,
    findAiBoundaryAtCoordinate,
    buildBoundaryPopupLines
  }
}
