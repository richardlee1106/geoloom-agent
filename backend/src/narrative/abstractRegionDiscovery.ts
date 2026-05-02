import type { NarrativeBoundaryGeometry, NarrativePoi, NarrativeRegion, ViewportBBox } from './contract.js'
import { boundaryAreaKm2, boundaryFromPoints, centerFromPois, semanticDiversity, viewportAreaKm2 } from './geometry.js'

export interface AbstractRegionAoiLike {
  name: string
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
const ABSTRACT_REGION_EXACT_RE = /([\u4e00-\u9fa5A-Za-z0-9·]{2,18}(?:步行街|商业街|商圈|街区|汉街|天地|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|购物中心|购物广场|商业广场|K11|SKP))/giu
const ABSTRACT_REGION_STREET_RE = /([\u4e00-\u9fa5]{2,10}(?:路|街|大道|巷))/gu
const ABSTRACT_REGION_COMMERCIAL_PREFIX_RE = /([\u4e00-\u9fa5]{2,8})(?:商场|广场|购物中心|销品茂|万达|天地|影城|美食街|百货|商业街|步行街)/gu
const ABSTRACT_GENERIC_TOKEN_RE = /^(购物|商业|餐饮|美食|小吃|咖啡|酒店|影院|影城|广场|商场|中心|公园|大学|学院)$/u
const ABSTRACT_EVIDENCE_RE = /(餐饮|美食|小吃|咖啡|茶|饮品|酒吧|购物|商店|商铺|商场|广场|商业|影院|影城|娱乐|休闲|酒店|服饰|珠宝|书店|超市|便利店|百货|步行街|商业街|街区|商圈|文化|艺术|展览)/u
const ABSTRACT_PRIMARY_RE = /(步行街|商业街|商圈|街区|汉街|天地|万达广场|购物中心|购物广场|商业广场|销品茂|K11|SKP)$/iu
const ABSTRACT_STRONG_NAME_RE = /(步行街|商业街|商圈|街区|汉街|天地|购物中心|购物广场|商业广场|万达广场|销品茂|K11|SKP)$/iu

export function discoverAbstractRegionCandidates(input: {
  viewport: ViewportBBox
  pois: NarrativePoi[]
  aois: AbstractRegionAoiLike[]
}): AbstractRegionCandidateSeed[] {
  const groups = groupPoisByAbstractRegion(input.pois.filter(isAbstractRegionSeedPoi))
  const viewportArea = viewportAreaKm2(input.viewport)
  const out: AbstractRegionCandidateSeed[] = []
  for (const [token, pois] of groups) {
    if (pois.length < minimumAbstractRegionEvidenceCount(token)) continue
    if (hasOverlappingAoiName(token, input.aois)) continue
    const abstractPois = pois.map((poi) => retierPoiWithinAbstractRegion(poi))
    const evidencePois = abstractPois.filter(isCandidateEvidencePoi)
    if (evidencePois.length < 2) continue
    const displayName = displayNameForAbstractRegion(token, abstractPois)
    const boundary = boundaryFromPoints(abstractPois, input.viewport)
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
  if (poi.tier === 'excluded' && !ABSTRACT_EVIDENCE_RE.test(text)) return false
  if (ACCESSORY_RE.test(text) && !ABSTRACT_EVIDENCE_RE.test(text)) return false
  return ABSTRACT_EVIDENCE_RE.test(text) || isCandidateEvidencePoi(poi)
}

function groupPoisByAbstractRegion(pois: NarrativePoi[]): Map<string, NarrativePoi[]> {
  const map = new Map<string, NarrativePoi[]>()
  for (const poi of pois) {
    for (const token of extractAbstractRegionTokens(poi.display_name)) {
      if (!map.has(token)) map.set(token, [])
      map.get(token)!.push(poi)
    }
  }
  return map
}

function extractAbstractRegionTokens(name: string): string[] {
  const tokens = new Set<string>()
  for (const match of name.matchAll(ABSTRACT_REGION_EXACT_RE)) addAbstractToken(tokens, match[1])
  for (const match of name.matchAll(ABSTRACT_REGION_STREET_RE)) addAbstractToken(tokens, normalizeStreetToken(match[1]))
  for (const match of name.matchAll(ABSTRACT_REGION_COMMERCIAL_PREFIX_RE)) addAbstractToken(tokens, normalizeCommercialPrefix(match[1]))
  return [...tokens]
}

function addAbstractToken(tokens: Set<string>, token: string) {
  const normalized = token.trim()
  if (normalized.length < 2 || normalized.length > 18) return
  if (ABSTRACT_GENERIC_TOKEN_RE.test(normalized)) return
  tokens.add(normalized)
}

function normalizeStreetToken(token: string): string {
  return token.endsWith('大道') ? token.slice(0, -2) : token
}

function normalizeCommercialPrefix(token: string): string {
  if (token.endsWith('大街')) return token.slice(0, -2)
  return token
}

function minimumAbstractRegionEvidenceCount(token: string): number {
  return ABSTRACT_STRONG_NAME_RE.test(token) ? 2 : 3
}

function hasOverlappingAoiName(token: string, aois: AbstractRegionAoiLike[]): boolean {
  return aois.some((aoi) => {
    const name = aoi.name.trim()
    return name.length > 0 && (name.includes(token) || token.includes(name))
  })
}

function retierPoiWithinAbstractRegion(poi: NarrativePoi): NarrativePoi {
  const text = `${poi.display_name} ${poi.category_main || ''}`
  if (ACCESSORY_RE.test(text)) return { ...poi, tier: 'weak', role: 'background_ecology' }
  if (ABSTRACT_EVIDENCE_RE.test(text)) return { ...poi, tier: poi.tier === 'core' || poi.tier === 'strong' ? poi.tier : 'medium', role: 'scene_evidence' }
  return poi
}

function displayNameForAbstractRegion(token: string, pois: NarrativePoi[]): string {
  if (ABSTRACT_STRONG_NAME_RE.test(token)) return token
  const text = pois.map((poi) => `${poi.display_name} ${poi.category_main || ''}`).join(' ')
  if (/商圈|商场|购物|商业|百货|销品茂|万达|美食|餐饮|影院|影城|服饰/u.test(text) && !/(路|街|巷)$/u.test(token)) {
    return `${token}商圈`
  }
  return token
}

function abstractNameConfidence(token: string, displayName: string): number {
  if (ABSTRACT_STRONG_NAME_RE.test(displayName)) return 1
  if (/(路|街|大道|巷)$/u.test(token)) return 0.75
  return 0.65
}

function abstractRegionRole(displayName: string, pois: NarrativePoi[]): NarrativeRegion['role'] {
  if (ABSTRACT_PRIMARY_RE.test(displayName) || pois.length >= 5) {
    return 'primary_region'
  }
  return 'support_region'
}

function safeId(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '').slice(0, 48) || 'unknown'
}
