import type { NarrativeBoundaryGeometry, NarrativePoi, NarrativeRegion, ViewportBBox } from './contract.js'
import {
  boundaryAreaKm2,
  boundaryFromPoints,
  boundsFromBoundary,
  centerFromPois,
  clipBoundsToViewport,
  polygonFromBounds,
  semanticDiversity,
  viewportAreaKm2,
  type Bounds,
} from './geometry.js'

export interface AbstractRegionAoiLike {
  name: string
  fclass?: string | null
  areaSqm?: number | null
  boundary?: NarrativeBoundaryGeometry
}

export interface AbstractRegionCandidateSeed {
  id: string
  displayName: string
  role: NarrativeRegion['role']
  boundary: NarrativeBoundaryGeometry
  coreAnchor: { id: string; lon: number; lat: number }
  pois: NarrativePoi[]
  score: number
  coverage: number
  diversity: number
}

const ACCESSORY_RE = /(停车场|出入口|入口|出口|门岗|门卫|收费亭|收费站|公厕|厕所|卫生间|地铁站|地铁口|站口|公交站|公交车站)/u
const ABSTRACT_EVIDENCE_RE = /(餐饮|美食|小吃|咖啡|茶|饮品|酒吧|购物|商店|商铺|商场|广场|商业|影院|影城|娱乐|休闲|酒店|服饰|珠宝|书店|超市|便利店|百货|家居|家具|步行街|商业街|街区|商圈|文化|艺术|展览)/u
const ABSTRACT_PRIMARY_RE = /(步行街|商业街|商圈|街区|汉街|天地|汉正街|昙华林|黎黄陂路|吉庆街|万松园|水塔街)$/iu
const ABSTRACT_STRONG_NAME_RE = /(步行街|商业街|商圈|街区|汉街|天地|购物中心|购物广场|商业广场|万达广场|销品茂|K11|SKP)$/iu
const ROAD_CORRIDOR_RE = /(路|街|大道|巷)$/u
const RESIDENTIAL_POI_RE = /(商务住宅|住宅区|小区|家属区|居民区|住宅|公寓|物业|售楼|楼栋|单元|社区服务|居委会)/u
const ABSTRACT_SUPPORTING_CONTEXT_RE = /(餐饮|美食|小吃|咖啡|茶|饮品|酒吧|购物|商店|商铺|商场|广场|商业|影院|影城|娱乐|休闲|服饰|珠宝|书店|超市|便利店|百货|家居|家具|步行街|商业街|街区|商圈|文化|艺术|展览|风景名胜|旅游|历史|地铁|公交|交通)/u

interface WuhanAbstractRegionProfile {
  name: string
  evidence: RegExp
  coreEvidence?: RegExp
  minimumCoreEvidenceCount?: number
  bounds: Bounds
  minimumEvidenceCount: number
  role: NarrativeRegion['role']
}

const WUHAN_ABSTRACT_REGION_PROFILES: WuhanAbstractRegionProfile[] = [
  {
    name: '江汉路步行街',
    evidence: /(江汉路|中山大道|江汉关|中心百货|大洋百货|王府井百货|民众乐园|江汉路万达|happy站台)/iu,
    coreEvidence: /(江汉路|江汉关|民众乐园|happy站台)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.275, south: 30.575, east: 114.305, north: 30.6 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '楚河汉街',
    evidence: /(楚河汉街|汉街|汉街万达|万达汉街|武汉SKP|SKP|汉秀)/iu,
    coreEvidence: /(楚河汉街|汉街|汉秀)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.325, south: 30.545, east: 114.36, north: 30.57 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '光谷步行街',
    evidence: /(光谷步行街|世界城|鲁巷广场|光谷广场|西班牙风情街|意大利风情街|德国风情街)/iu,
    coreEvidence: /(光谷步行街|世界城|光谷广场)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.375, south: 30.49, east: 114.43, north: 30.53 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '武广商圈',
    evidence: /(武广|武商MALL|武商广场|武汉广场|武汉国际广场|世贸广场|航空路|解放大道武广)/iu,
    coreEvidence: /(武广|武商MALL|武商广场|武汉广场|武汉国际广场)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.25, south: 30.57, east: 114.285, north: 30.6 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '中南中北商圈',
    evidence: /(中南路|中北路|中商广场|中商百货|武商梦时代|梦时代|武昌万象城|洪山广场)/iu,
    coreEvidence: /(中南路|中北路|中商广场|武商梦时代|梦时代|武昌万象城)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.315, south: 30.535, east: 114.365, north: 30.57 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '徐东商圈',
    evidence: /(徐东|销品茂|鹏程销品茂|欧亚达|万象汇|群星城|徐东大街|团结大道)/iu,
    coreEvidence: /(徐东|销品茂|鹏程销品茂|欧亚达|万象汇|群星城|徐东大街)/iu,
    minimumCoreEvidenceCount: 2,
    bounds: { west: 114.33, south: 30.575, east: 114.39, north: 30.615 },
    minimumEvidenceCount: 2,
    role: 'primary_region',
  },
  {
    name: '街道口商圈',
    evidence: /(街道口|群光广场|银泰创意城|未来城购物公园|珞喻路|新世界百货武昌店)/iu,
    coreEvidence: /(街道口|群光广场|银泰创意城|未来城购物公园)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.335, south: 30.51, east: 114.37, north: 30.54 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '王家湾商圈',
    evidence: /(王家湾|摩尔城|汉商21世纪|汉阳人信汇|龙阳大道)/iu,
    coreEvidence: /(王家湾|摩尔城|汉商21世纪|汉阳人信汇)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.19, south: 30.545, east: 114.23, north: 30.575 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '钟家村商圈',
    evidence: /(钟家村|汉商银座|汉阳商场|鹦鹉大道)/iu,
    coreEvidence: /(钟家村|汉商银座|汉阳商场)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.245, south: 30.535, east: 114.28, north: 30.56 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '菱角湖商圈',
    evidence: /(菱角湖|菱角湖万达|万达广场菱角湖|唐家墩|新华路)/iu,
    coreEvidence: /(菱角湖|菱角湖万达|万达广场菱角湖)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.25, south: 30.595, east: 114.295, north: 30.63 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '武汉天地',
    evidence: /(武汉天地|新天地街区|壹方购物中心|壹方南馆|壹方北馆|芦沟桥路|永清街)/iu,
    coreEvidence: /(武汉天地|壹方购物中心|壹方南馆|壹方北馆)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.295, south: 30.595, east: 114.325, north: 30.625 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '汉正街',
    evidence: /(汉正街|汉正街市场|多福路|第一大道|品牌服饰批发广场)/iu,
    coreEvidence: /(汉正街|汉正街市场|多福路|品牌服饰批发广场)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.235, south: 30.555, east: 114.285, north: 30.59 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '司门口商圈',
    evidence: /(司门口|户部巷|解放路|民主路|粮道街)/iu,
    coreEvidence: /(司门口|户部巷|粮道街)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.275, south: 30.535, east: 114.315, north: 30.56 },
    minimumEvidenceCount: 3,
    role: 'primary_region',
  },
  {
    name: '万松园',
    evidence: /(万松园|雪松路|万松园美食街)/iu,
    coreEvidence: /(万松园|雪松路)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.25, south: 30.58, east: 114.285, north: 30.605 },
    minimumEvidenceCount: 2,
    role: 'support_region',
  },
  {
    name: '吉庆街',
    evidence: /(吉庆街|大智路)/iu,
    coreEvidence: /(吉庆街)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.285, south: 30.575, east: 114.31, north: 30.6 },
    minimumEvidenceCount: 2,
    role: 'support_region',
  },
  {
    name: '黎黄陂路',
    evidence: /(黎黄陂路|洞庭街|鄱阳街|青岛路)/iu,
    coreEvidence: /(黎黄陂路)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.295, south: 30.585, east: 114.32, north: 30.61 },
    minimumEvidenceCount: 2,
    role: 'support_region',
  },
  {
    name: '昙华林',
    evidence: /(昙华林|胭脂路)/iu,
    coreEvidence: /(昙华林)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.29, south: 30.545, east: 114.325, north: 30.57 },
    minimumEvidenceCount: 2,
    role: 'support_region',
  },
  {
    name: '水塔街',
    evidence: /(水塔街|水塔美食街)/iu,
    coreEvidence: /(水塔街|水塔美食街)/iu,
    minimumCoreEvidenceCount: 1,
    bounds: { west: 114.27, south: 30.565, east: 114.3, north: 30.59 },
    minimumEvidenceCount: 2,
    role: 'support_region',
  },
]

const WUHAN_PROFILE_BY_NAME = new Map(WUHAN_ABSTRACT_REGION_PROFILES.map((profile) => [profile.name, profile]))

export function discoverAbstractRegionCandidates(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  aois: AbstractRegionAoiLike[]
}): AbstractRegionCandidateSeed[] {
  const groups = groupPoisByAbstractRegion(input.pois.filter(isAbstractRegionSeedPoi))
  const viewportArea = viewportAreaKm2(input.viewport)
  const out: AbstractRegionCandidateSeed[] = []
  for (const [token, pois] of groups) {
    const minimumEvidenceCount = minimumAbstractRegionEvidenceCount(token)
    if (pois.length < minimumEvidenceCount) continue
    if (!hasRequiredProfileCoreEvidence(token, pois)) continue
    if (hasOverlappingRepresentativeAoiName(token, input.aois)) continue
    const abstractPois = pois.map((poi) => retierPoiWithinAbstractRegion(poi))
    const evidencePois = abstractPois.filter(isCandidateEvidencePoi)
    if (evidencePois.length < minimumEvidenceCount) continue
    const displayName = displayNameForAbstractRegion(token)
    const boundary = buildAbstractBoundary({
      token,
      displayName,
      pois: abstractPois,
      viewport: input.viewport,
      aois: input.aois,
    })
    const areaKm2 = Math.max(boundaryAreaKm2(boundary), 0.0001)
    const coverage = Math.min(0.72, areaKm2 / viewportArea)
    const diversity = semanticDiversity(evidencePois)
    const densityScore = Math.min(1, abstractPois.length / Math.max(areaKm2 * 120, 1))
    const nameScore = abstractNameConfidence(token, displayName)
    const role = abstractRegionRole(displayName, evidencePois)
    const score = 0.2 * coverage + 0.28 * densityScore + 0.22 * Math.min(1, diversity / 1.5) + 0.2 * nameScore + 0.1
    const [lon, lat] = centerFromPois(evidencePois, input.viewport)
    const id = `abstract-${safeId(displayName)}`
    out.push({
      id,
      displayName,
      role,
      boundary,
      coreAnchor: { id, lon, lat },
      pois: abstractPois,
      score,
      coverage,
      diversity,
    })
  }
  return out
}

function isCandidateEvidencePoi(poi: NarrativePoi): boolean {
  return poi.tier === 'core' || poi.tier === 'strong' || poi.tier === 'medium'
}

function isAbstractRegionSeedPoi(poi: NarrativePoi): boolean {
  const text = `${poi.display_name} ${poi.category_main || ''}`
  if (RESIDENTIAL_POI_RE.test(text)) return false
  if (poi.tier === 'excluded' && !ABSTRACT_EVIDENCE_RE.test(text)) return false
  if (ACCESSORY_RE.test(text) && !ABSTRACT_EVIDENCE_RE.test(text)) return false
  return extractAbstractRegionTokens(poi).length > 0
}

function groupPoisByAbstractRegion(pois: NarrativePoi[]): Map<string, NarrativePoi[]> {
  const map = new Map<string, NarrativePoi[]>()
  for (const poi of pois) {
    for (const token of extractAbstractRegionTokens(poi)) {
      if (!map.has(token)) map.set(token, [])
      map.get(token)!.push(poi)
    }
  }
  return map
}

function extractAbstractRegionTokens(poi: NarrativePoi): string[] {
  const tokens = new Set<string>()
  const text = `${poi.display_name} ${poi.category_main || ''}`
  if (RESIDENTIAL_POI_RE.test(text)) return []
  if (!ABSTRACT_SUPPORTING_CONTEXT_RE.test(text) && !isCandidateEvidencePoi(poi)) return []
  for (const profile of WUHAN_ABSTRACT_REGION_PROFILES) {
    if (profile.evidence.test(text) && poiInProfileBounds(poi, profile)) addAbstractToken(tokens, profile.name)
  }
  return [...tokens]
}

function poiInProfileBounds(poi: NarrativePoi, profile: WuhanAbstractRegionProfile): boolean {
  return poi.lon >= profile.bounds.west
    && poi.lon <= profile.bounds.east
    && poi.lat >= profile.bounds.south
    && poi.lat <= profile.bounds.north
}

function addAbstractToken(tokens: Set<string>, token: string) {
  const normalized = token.trim()
  if (normalized.length < 2 || normalized.length > 18) return
  tokens.add(normalized)
}

function minimumAbstractRegionEvidenceCount(token: string): number {
  return WUHAN_PROFILE_BY_NAME.get(token)?.minimumEvidenceCount ?? 3
}

function hasRequiredProfileCoreEvidence(token: string, pois: NarrativePoi[]): boolean {
  const profile = WUHAN_PROFILE_BY_NAME.get(token)
  if (!profile?.coreEvidence) return true
  const minimum = profile.minimumCoreEvidenceCount ?? 1
  return pois.filter((poi) => profile.coreEvidence!.test(`${poi.display_name} ${poi.category_main || ''}`)).length >= minimum
}

function hasOverlappingRepresentativeAoiName(token: string, aois: AbstractRegionAoiLike[]): boolean {
  return aois.some((aoi) => {
    const name = aoi.name.trim()
    return name.length > 0 && (name.includes(token) || token.includes(name)) && !isAdministrativeAoi(aoi)
  })
}

function buildAbstractBoundary(input: {
  token: string
  displayName: string
  pois: NarrativePoi[]
  viewport: ViewportBBox
  aois: AbstractRegionAoiLike[]
}): NarrativeBoundaryGeometry {
  const baseBoundary = ROAD_CORRIDOR_RE.test(input.token)
    ? boundaryFromRoadCorridor(input.pois, input.viewport)
    : boundaryFromPoints(input.pois, input.viewport)
  const adminHint = findAdministrativeBoundaryHint(input.token, input.displayName, input.aois)
  if (!adminHint?.boundary) return baseBoundary
  return intersectBoundaryBounds(baseBoundary, adminHint.boundary, input.viewport) || baseBoundary
}

function boundaryFromRoadCorridor(pois: NarrativePoi[], viewport: ViewportBBox): NarrativeBoundaryGeometry {
  const visible = pois.filter((poi) => poi.tier !== 'excluded')
  if (visible.length === 0) return boundaryFromPoints(pois, viewport)
  const lons = visible.map((poi) => poi.lon)
  const lats = visible.map((poi) => poi.lat)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const lonSpan = Math.max(east - west, 0.0001)
  const latSpan = Math.max(north - south, 0.0001)
  const avgLon = lons.reduce((sum, lon) => sum + lon, 0) / lons.length
  const avgLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length
  const bounds = lonSpan >= latSpan
    ? {
      west: west - Math.max(lonSpan * 0.12, 0.001),
      east: east + Math.max(lonSpan * 0.12, 0.001),
      south: avgLat - Math.max(latSpan * 0.7, 0.0008),
      north: avgLat + Math.max(latSpan * 0.7, 0.0008),
    }
    : {
      west: avgLon - Math.max(lonSpan * 0.7, 0.0008),
      east: avgLon + Math.max(lonSpan * 0.7, 0.0008),
      south: south - Math.max(latSpan * 0.12, 0.001),
      north: north + Math.max(latSpan * 0.12, 0.001),
    }
  return polygonFromBounds(clipBoundsToViewport(bounds, viewport) || boundsFromBoundary(boundaryFromPoints(visible, viewport)))
}

function findAdministrativeBoundaryHint(token: string, displayName: string, aois: AbstractRegionAoiLike[]): AbstractRegionAoiLike | null {
  return aois.find((aoi) => {
    if (!aoi.boundary || !isAdministrativeAoi(aoi)) return false
    if (Number.isFinite(Number(aoi.areaSqm)) && Number(aoi.areaSqm) > 2_500_000) return false
    const name = aoi.name.trim()
    return name.length > 0 && (name.includes(token) || name.includes(displayName) || displayName.includes(name.replace(/(街道|社区|片区)$/u, '')))
  }) || null
}

function isAdministrativeAoi(aoi: AbstractRegionAoiLike): boolean {
  const text = `${aoi.name} ${aoi.fclass || ''}`
  return /(街道|社区|行政|乡镇|镇|村|subdistrict|administrative|neighbourhood|neighborhood|boundary)/iu.test(text)
}

function intersectBoundaryBounds(left: NarrativeBoundaryGeometry, right: NarrativeBoundaryGeometry, viewport: ViewportBBox): NarrativeBoundaryGeometry | null {
  const leftBounds = boundsFromBoundary(left)
  const rightBounds = boundsFromBoundary(right)
  const intersection: Bounds = {
    west: Math.max(leftBounds.west, rightBounds.west),
    south: Math.max(leftBounds.south, rightBounds.south),
    east: Math.min(leftBounds.east, rightBounds.east),
    north: Math.min(leftBounds.north, rightBounds.north),
  }
  const clipped = clipBoundsToViewport(intersection, viewport)
  return clipped ? polygonFromBounds(clipped) : null
}

function retierPoiWithinAbstractRegion(poi: NarrativePoi): NarrativePoi {
  const text = `${poi.display_name} ${poi.category_main || ''}`
  if (ACCESSORY_RE.test(text)) return { ...poi, tier: 'weak', role: 'background_ecology' }
  if (ABSTRACT_EVIDENCE_RE.test(text)) return { ...poi, tier: poi.tier === 'core' || poi.tier === 'strong' ? poi.tier : 'medium', role: 'scene_evidence' }
  return poi
}

function displayNameForAbstractRegion(token: string): string {
  return token
}

function abstractNameConfidence(token: string, displayName: string): number {
  if (ABSTRACT_STRONG_NAME_RE.test(displayName)) return 1
  if (/(路|街|大道|巷)$/u.test(token)) return 0.75
  return 0.65
}

function abstractRegionRole(displayName: string, pois: NarrativePoi[]): NarrativeRegion['role'] {
  const profile = WUHAN_PROFILE_BY_NAME.get(displayName)
  if (profile) return profile.role
  if (ABSTRACT_PRIMARY_RE.test(displayName) || pois.length >= 5) {
    return 'primary_region'
  }
  return 'support_region'
}

function safeId(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '').slice(0, 48) || 'unknown'
}
