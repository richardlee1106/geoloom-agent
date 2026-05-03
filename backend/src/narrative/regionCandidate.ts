import { classifyNarrativeEntity } from './entityClassifier.js'
import { discoverAbstractRegionCandidates } from './abstractRegionDiscovery.js'
import type {
  NarrativeBoundaryGeometry,
  NarrativePoi,
  NarrativeRegion,
  SceneProfile,
  ViewportBBox,
} from './contract.js'
import { transformPolygonCoordsToGcj02, wgs84ToGcj02 } from './gcj02.js'
import {
  boundaryAreaKm2,
  boundaryFromPoints,
  centerFromBoundary,
  centerFromPois,
  clamp,
  clipBoundsToViewport,
  pointInBounds,
  polygonFromBounds,
  semanticDiversity,
  viewportAreaKm2,
  type Bounds,
} from './geometry.js'

export interface AoiCandidateRow {
  id: string
  name: string
  fclass?: string | null
  areaSqm?: number | null
  boundary: NarrativeBoundaryGeometry
}

export interface RegionCandidate extends NarrativeRegion {
  score: number
  source: 'aoi' | 'abstract_region' | 'viewport_fallback'
  coverage: number
  diversity: number
  effectivePoiCount: number
}

const REGION_COLORS = ['#ef4444', '#f97316', '#eab308', '#14b8a6', '#a855f7', '#0ea5e9']
const AOI_CAMPUS_RE = /(大学|学院|校区|校园|university|college|campus)/iu
const AOI_SCENIC_RE = /(公园|景区|景点|风景区|名胜|古迹|旅游区|湿地|湖|山|江滩)/u
const CAMPUS_EVIDENCE_RE = /(学院|研究院|研究所|图书馆|博物馆|纪念馆|文化馆|艺术馆|美术馆|科技馆|展览馆|文化中心|体育馆|体育场|操场|运动场|教学楼|实验室|行政楼|校史馆|礼堂|\d+号楼|\d+栋)/u
const CAMPUS_LIFE_RE = /(宿舍|公寓|食堂)/u
const ACCESSORY_RE = /(停车场|出入口|入口|出口|门岗|门卫|收费亭|收费站|公厕|厕所|卫生间|地铁站|地铁口|站口|公交站|公交车站)/u
const SCENIC_EVIDENCE_RE = /(江滩|公园|湖|湿地|绿道|步道|栈道|观景|广场|码头|渡口|堤|滩|桥|亭|台|游客中心)/u
const COMMERCIAL_AOI_RE = /(商业街|步行街|购物中心|购物广场|商业广场|商场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|mall|plaza)/iu
const COMMERCIAL_EVIDENCE_RE = /(餐饮|美食|小吃|咖啡|茶|饮品|酒吧|购物|商店|商铺|商场|广场|商业|影院|影城|娱乐|休闲|服饰|珠宝|书店|超市|便利店|汉街|楚河)/u
const HARD_EXCLUDED_POI_RE = /(党校|干部学院|行政学院|社会主义学院|医院|医学院|医学部|医疗|卫生院|诊所|门诊|卫生服务中心|hospital|medical|clinic|healthcare)/iu

export function buildRegionCandidates(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  aois: AoiCandidateRow[]
  scene: SceneProfile
}): RegionCandidate[] {
  const candidates = [
    ...buildAoiRegionCandidates(input),
    ...buildAbstractRegionCandidates(input),
  ]
    .filter(isCandidateVisibleEnough)
    .sort(compareCandidates)

  return mergeOverlappingCandidates(suppressCompetingPrimaryAbstractRegions(candidates, input.viewport)).slice(0, 24)
}

function compareCandidates(left: RegionCandidate, right: RegionCandidate): number {
  return candidateRank(right) - candidateRank(left) || right.score - left.score
}

function candidateRank(candidate: RegionCandidate): number {
  const roleBoost = candidate.role === 'primary_region' ? 0.35 : candidate.role === 'support_region' || candidate.role === 'landmark_anchor' ? 0.2 : 0
  const sourceBoost = candidate.source === 'aoi' ? 0.15 : candidate.source === 'abstract_region' ? 0.08 : 0
  return candidate.score + roleBoost + sourceBoost
}

function isCandidateVisibleEnough(candidate: RegionCandidate): boolean {
  if (candidate.source === 'abstract_region') return candidate.effectivePoiCount >= (isKnownAbstractStreet(candidate.display_name) ? 2 : 3)
  if (candidate.source === 'aoi') return candidate.effectivePoiCount >= 1
  return candidate.effectivePoiCount >= 1 || candidate.pois.length >= 2 || candidate.coverage >= 0.006
}

function suppressCompetingPrimaryAbstractRegions(candidates: RegionCandidate[], viewport: ViewportBBox): RegionCandidate[] {
  if (!shouldSuppressCompetingPrimaryAbstractRegions(viewport)) return candidates
  const primaryAbstractRegions = candidates.filter((candidate) => candidate.source === 'abstract_region' && candidate.role === 'primary_region')
  if (primaryAbstractRegions.length <= 1) return candidates
  const [centerLon, centerLat] = wgs84ToGcj02(viewport.center[0], viewport.center[1])
  const dominant = [...primaryAbstractRegions].sort((left, right) =>
    distanceToPoint(left, centerLon, centerLat) - distanceToPoint(right, centerLon, centerLat)
    || candidateRank(right) - candidateRank(left)
  )[0]
  return candidates.filter((candidate) => candidate.source !== 'abstract_region' || candidate.role !== 'primary_region' || candidate.id === dominant.id)
}

function shouldSuppressCompetingPrimaryAbstractRegions(viewport: ViewportBBox): boolean {
  return (viewport.east - viewport.west) <= 0.1 && (viewport.north - viewport.south) <= 0.1
}

function distanceToPoint(candidate: RegionCandidate, lon: number, lat: number): number {
  const [candidateLon, candidateLat] = centerFromBoundary(candidate.boundary)
  const dx = candidateLon - lon
  const dy = candidateLat - lat
  return dx * dx + dy * dy
}

export function buildFallbackRegion(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  scene: SceneProfile
}): RegionCandidate {
  const renderablePois = input.pois.filter((poi) => poi.tier !== 'excluded')
  const evidencePois = renderablePois.filter(isCandidateEvidencePoi)
  const spatialPois = evidencePois.length > 0 ? evidencePois : renderablePois
  const boundary = boundaryFromPoints(spatialPois, input.viewport)
  const [lon, lat] = centerFromPois(spatialPois, input.viewport)
  const diversity = semanticDiversity(spatialPois)
  return materializeCandidate({
    id: 'viewport-overview',
    displayName: `${sceneLabel(input.scene)}概览`,
    role: 'scene_evidence',
    boundary,
    coreAnchor: { id: 'viewport-center', lon, lat },
    pois: renderablePois,
    scene: input.scene,
    source: 'viewport_fallback',
    score: 0.25,
    coverage: 1,
    diversity,
  })
}

function buildAoiRegionCandidates(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  aois: AoiCandidateRow[]
  scene: SceneProfile
}): RegionCandidate[] {
  const viewportArea = viewportAreaKm2(input.viewport)
  const out: RegionCandidate[] = []
  for (const aoi of input.aois) {
    const clippedBounds = clipBoundsToViewport(boundsFromBoundary(aoi.boundary), input.viewport)
    if (!clippedBounds) continue
    const boundary = clipBoundaryGeometryToViewport(aoi.boundary, input.viewport)
    const areaKm2 = boundaryAreaKm2(boundary)
    if (areaKm2 < 0.0005) continue

    const classification = classifyNarrativeEntity({
      name: aoi.name,
      fclass: aoi.fclass,
      areaSqm: aoi.areaSqm,
      isAoiEntity: true,
    })
    if (!classification.mainChainEligible && !classification.representative) continue

    const pois = input.pois
      .filter((poi) => pointInBoundaryGeometry(poi, boundary))
      .map((poi) => retierPoiWithinAoi(poi, aoi))
      .filter((poi): poi is NarrativePoi => poi !== null && poi.tier !== 'excluded')
    const evidencePois = pois.filter(isCandidateEvidencePoi)
    const coverage = Math.min(1, areaKm2 / viewportArea)
    const diversity = semanticDiversity(evidencePois)
    const densityScore = Math.min(1, evidencePois.length / Math.max(areaKm2 * 150, 1))
    const diversityScore = Math.min(1, diversity / 1.5)
    const anchorScore = classification.role === 'primary_region' ? 1 : 0.7
    const score = 0.3 * coverage + 0.2 * densityScore + 0.2 * diversityScore + 0.2 * anchorScore + 0.1
    const [lon, lat] = centerFromBoundary(boundary)
    out.push(materializeCandidate({
      id: `aoi-${aoi.id}`,
      displayName: aoi.name,
      role: classification.role,
      boundary,
      coreAnchor: { id: String(aoi.id), lon, lat },
      pois,
      scene: input.scene,
      source: 'aoi',
      score,
      coverage,
      diversity,
    }))
  }
  return out
}

function clipBoundaryGeometryToViewport(boundary: NarrativeBoundaryGeometry, viewport: ViewportBBox): NarrativeBoundaryGeometry {
  const coordinates = boundary.coordinates
    .map((ring) => ring
      .map(([lon, lat]) => [
        clamp(lon, viewport.west, viewport.east),
        clamp(lat, viewport.south, viewport.north),
      ] as [number, number])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)))
    .filter((ring) => ring.length >= 4)
  return coordinates.length > 0 ? { type: 'Polygon', coordinates } : polygonFromBounds(viewport)
}

function isCandidateEvidencePoi(poi: NarrativePoi): boolean {
  return poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium'
}

function retierPoiWithinAoi(poi: NarrativePoi, aoi: AoiCandidateRow): NarrativePoi | null {
  const aoiText = `${aoi.name} ${aoi.fclass || ''}`
  const poiText = `${poi.display_name} ${poi.category_main || ''}`
  if (HARD_EXCLUDED_POI_RE.test(poiText)) return null
  if (poi.tier === 'excluded') return null
  if (AOI_CAMPUS_RE.test(aoiText)) {
    if (ACCESSORY_RE.test(poiText)) return { ...poi, tier: 'weak', role: 'background_ecology' }
    if (CAMPUS_EVIDENCE_RE.test(poiText) || CAMPUS_LIFE_RE.test(poiText)) return { ...poi, tier: 'medium', role: 'scene_evidence' }
    return poi
  }
  if (AOI_SCENIC_RE.test(aoiText)) {
    if (ACCESSORY_RE.test(poiText)) return { ...poi, tier: 'weak', role: 'background_ecology' }
    if (SCENIC_EVIDENCE_RE.test(poiText)) return { ...poi, tier: 'medium', role: 'scene_evidence' }
    return poi
  }
  if (COMMERCIAL_AOI_RE.test(aoiText)) {
    if (ACCESSORY_RE.test(poiText)) return { ...poi, tier: 'weak', role: 'background_ecology' }
    if (COMMERCIAL_EVIDENCE_RE.test(poiText)) return { ...poi, tier: poi.tier === 'core' || poi.tier === 'strong' ? poi.tier : 'medium', role: 'scene_evidence' }
    return poi
  }
  return poi
}

function pointInBoundaryGeometry(poi: NarrativePoi, boundary: NarrativeBoundaryGeometry): boolean {
  return pointInBoundary(lonLat(poi), boundary)
}

function lonLat(poi: NarrativePoi): [number, number] {
  return [poi.lon, poi.lat]
}

function pointInBoundary(point: [number, number], boundary: NarrativeBoundaryGeometry): boolean {
  const ring = boundary.coordinates[0] || []
  if (ring.length < 4) return pointInBounds(point[0], point[1], boundsFromBoundary(boundary))
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function buildAbstractRegionCandidates(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  aois: AoiCandidateRow[]
  scene: SceneProfile
}): RegionCandidate[] {
  return discoverAbstractRegionCandidates(input).map((candidate) => materializeCandidate({
    ...candidate,
    scene: input.scene,
    source: 'abstract_region',
  }))
}

function gcj02Boundary(boundary: NarrativeBoundaryGeometry): NarrativeBoundaryGeometry {
  return {
    type: 'Polygon',
    coordinates: transformPolygonCoordsToGcj02(boundary.coordinates as [number, number][][]),
  }
}

function materializeCandidate(input: {
  id: string
  displayName: string
  role: NarrativeRegion['role']
  boundary: NarrativeBoundaryGeometry
  coreAnchor: { id: string; lon: number; lat: number }
  pois: NarrativePoi[]
  scene: SceneProfile
  source: RegionCandidate['source']
  score: number
  coverage: number
  diversity: number
}): RegionCandidate {
  const color = colorForCandidate(input.id, input.scene)
  const candidatePois = input.pois.slice(0, 240)
  const evidencePois = candidatePois.filter(isCandidateEvidencePoi)
  const heatPois = evidencePois.length > 0 ? evidencePois : candidatePois.filter((poi) => poi.tier === 'weak').slice(0, 80)
  // 内部计算均使用 WGS-84；输出到前端时统一转为 GCJ-02 以匹配高德底图
  const gcjBoundary = gcj02Boundary(input.boundary)
  const [gcjAnchorLon, gcjAnchorLat] = wgs84ToGcj02(input.coreAnchor.lon, input.coreAnchor.lat)
  const gcjPois = candidatePois.map((poi) => {
    const [gcjLon, gcjLat] = wgs84ToGcj02(poi.lon, poi.lat)
    return { ...poi, lon: gcjLon, lat: gcjLat }
  })
  return {
    id: input.id,
    display_name: input.displayName,
    role: input.role,
    core_anchor: { id: input.coreAnchor.id, lon: gcjAnchorLon, lat: gcjAnchorLat },
    boundary: gcjBoundary,
    visual_layer: {
      mode: 'region_glow',
      region_glow: {
        core: gcjBoundary,
        color,
        opacity_profile: { core: 0.24, inner: 0.12, outer: 0.06 },
      },
      poi_heat: {
        radius: 24,
        points: gcjPois
          .filter((poi) => heatPois.some((heatPoi) => heatPoi.id === poi.id))
          .map((poi) => ({ lon: poi.lon, lat: poi.lat, tier: poi.tier })),
      },
    },
    pois: gcjPois,
    narrative_facts: [],
    score: Number(input.score.toFixed(4)),
    source: input.source,
    coverage: Number(input.coverage.toFixed(4)),
    diversity: Number(input.diversity.toFixed(3)),
    effectivePoiCount: evidencePois.length,
  }
}

function mergeOverlappingCandidates(candidates: RegionCandidate[]): RegionCandidate[] {
  const out: RegionCandidate[] = []
  for (const candidate of candidates) {
    const duplicatedIndex = out.findIndex((existing) => {
      const shared = candidate.pois.filter((poi) => existing.pois.some((item) => item.id === poi.id)).length
      const minCount = Math.min(candidate.pois.length, existing.pois.length)
      return minCount > 0 && shared / minCount >= 0.6
    })
    if (duplicatedIndex < 0) {
      out.push(candidate)
      continue
    }
    if (shouldReplaceOverlappingCandidate(out[duplicatedIndex], candidate)) {
      out[duplicatedIndex] = candidate
    }
  }
  return out
}

function shouldReplaceOverlappingCandidate(existing: RegionCandidate, candidate: RegionCandidate): boolean {
  if (existing.source === 'abstract_region' && candidate.source === 'abstract_region') {
    return isCommercialDistrict(candidate.display_name)
      && !isCommercialDistrict(existing.display_name)
      && candidate.pois.length >= existing.pois.length
  }
  return existing.source === 'aoi'
    && candidate.source === 'abstract_region'
    && /(街道|社区|行政|乡镇|镇|村)$/u.test(existing.display_name)
}

function isCommercialDistrict(name: string): boolean {
  return /商圈$/u.test(name)
}

function isKnownAbstractStreet(name: string): boolean {
  return /^(万松园|吉庆街|黎黄陂路|昙华林|水塔街)$/u.test(name)
}

function colorForCandidate(id: string, scene: SceneProfile): string {
  const sceneOffset = scene === 'education_culture' ? 0 : scene === 'heritage_tourism' ? 1 : scene === 'commercial_leisure' ? 2 : scene === 'natural_ecology' ? 3 : 4
  const hash = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), sceneOffset)
  return REGION_COLORS[hash % REGION_COLORS.length]
}

function safeId(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '').slice(0, 48) || 'unknown'
}

function boundsFromBoundary(boundary: NarrativeBoundaryGeometry): Bounds {
  const ring = boundary.coordinates[0] || []
  const lons = ring.map((point) => point[0]).filter(Number.isFinite)
  const lats = ring.map((point) => point[1]).filter(Number.isFinite)
  if (lons.length === 0 || lats.length === 0) return { west: 0, south: 0, east: 0, north: 0 }
  return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }
}

function sceneLabel(scene: SceneProfile): string {
  switch (scene) {
    case 'education_culture': return '教育文化'
    case 'heritage_tourism': return '历史游览'
    case 'commercial_leisure': return '商业休闲'
    case 'natural_ecology': return '自然生态'
    case 'mixed_urban': return '混合城区'
  }
}
