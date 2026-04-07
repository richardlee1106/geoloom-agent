import type { SkillExecutionResult } from '../../types.js'

interface AnchorCandidate {
  id?: string | number
  name: string
  lon?: number
  lat?: number
  distance_m?: number
  category_main?: string
  category_sub?: string
  category_big?: string
  category_mid?: string
  category_small?: string
}

interface ResolveAnchorPayload {
  place_name?: string
  placeName?: string
  anchor_text?: string
  anchor_name?: string
  anchorName?: string
  anchor?: string
  place?: string
  query?: string
  name?: string
  role?: string
}

function readPlaceName(payload: ResolveAnchorPayload) {
  const candidates = [
    payload.place_name,
    payload.placeName,
    payload.anchor_text,
    payload.anchor_name,
    payload.anchorName,
    payload.anchor,
    payload.place,
    payload.query,
    payload.name,
  ]

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (normalized) return normalized
  }

  return ''
}

const PLACE_ALIASES: Record<string, string[]> = {
  '华师一附中': ['华中师范大学第一附属中学', '华师一附中'],
  '武大': ['武汉大学', '武大'],
}

const EDUCATION_SAME_ENTITY_SUFFIX_RE = /^(?:[（(][^()（）]*校区[^()（）]*[)）]|[-·]?(?:[^()（）\s]{1,12}校区|校区|本部|东区|西区|南区|北区))$/u
const EDUCATION_DERIVATIVE_SUFFIX_RE = /(保卫|一分部|二分部|三分部|文理学部|工学部|医学部|信息学部|继续教育|校医院|研究院|实验室|服务中心|中心|图书馆|教学楼|办公楼|宿舍|公寓|食堂|体育馆|礼堂|门诊|附属|幼儿园|学院|\d+号楼|\d+栋|楼栋)/u
const EDUCATION_CATEGORY_RE = /(学校|高等院校|中学|小学|幼儿园|教育)/u
const TRANSPORT_CATEGORY_RE = /(地铁站|公交车站|火车站|高铁站)/u

function normalizeSearchText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[()（）[\]【】·\-—_.,，。:：;；\s]/g, '')
}

function inferPlaceKind(placeName = '') {
  if (/(大学|学院|学校|校区|中学|小学|幼儿园|附中|高中|初中)/.test(placeName)) return 'education'
  if (/(地铁站|地铁口|火车站|高铁站|站)/.test(placeName)) return 'transport'
  if (/(公园|景区|广场)/.test(placeName)) return 'scenic'
  return 'generic'
}

function getCategoryTokens(candidate: AnchorCandidate) {
  return [
    candidate.category_main,
    candidate.category_sub,
    candidate.category_big,
    candidate.category_mid,
    candidate.category_small,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function buildCandidateDensityMap(candidates: AnchorCandidate[] = []) {
  const densityMap = new Map<string, number>()
  for (const candidate of candidates) {
    const lon = Number(candidate.lon)
    const lat = Number(candidate.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
    densityMap.set(key, (densityMap.get(key) || 0) + 1)
  }
  return densityMap
}

function buildVariants(placeName: string) {
  const direct = PLACE_ALIASES[placeName] || []
  return [...new Set([placeName, ...direct])]
}

function getBestVariantMatch(candidateName: string, variants: string[]) {
  const normalizedName = normalizeSearchText(candidateName)
  let bestTier = -1
  let bestVariant = ''
  let bestGap = Number.POSITIVE_INFINITY

  for (const variant of variants) {
    const normalizedVariant = normalizeSearchText(variant)
    if (!normalizedVariant) continue

    let tier = -1
    if (normalizedName === normalizedVariant) {
      tier = 3
    } else if (normalizedName.startsWith(normalizedVariant)) {
      tier = 2
    } else if (normalizedName.includes(normalizedVariant)) {
      tier = 1
    }

    if (tier < 0) continue

    const gap = Math.abs(candidateName.length - variant.length)
    if (tier > bestTier || (tier === bestTier && gap < bestGap)) {
      bestTier = tier
      bestVariant = variant
      bestGap = gap
    }
  }

  return {
    exact: bestTier === 3,
    prefix: bestTier === 2,
    includes: bestTier === 1,
    variant: bestVariant,
    lengthGap: Number.isFinite(bestGap) ? bestGap : 0,
    score: bestTier === 3 ? 3000 : bestTier === 2 ? 1800 : bestTier === 1 ? 900 : 0,
  }
}

function hasCategoryMatch(categoryTokens: string[], pattern: RegExp) {
  return categoryTokens.some((token) => pattern.test(token))
}

function readMatchedSuffix(candidateName: string, variant: string) {
  if (!variant || !candidateName.startsWith(variant) || candidateName === variant) return ''
  return candidateName.slice(variant.length).trim()
}

function scoreCandidate(candidate: AnchorCandidate, variants: string[], placeName: string) {
  const placeKind = inferPlaceKind(placeName)
  const categoryTokens = getCategoryTokens(candidate)
  const match = getBestVariantMatch(candidate.name, variants)
  const matchedSuffix = readMatchedSuffix(candidate.name, match.variant)
  const isEducationCategory = hasCategoryMatch(categoryTokens, EDUCATION_CATEGORY_RE)
  const isTransportCategory = hasCategoryMatch(categoryTokens, TRANSPORT_CATEGORY_RE)
  const isCanonicalEducationEntity = isEducationCategory || EDUCATION_SAME_ENTITY_SUFFIX_RE.test(matchedSuffix)
  let score = match.score - (match.lengthGap * 2)

  if (placeKind === 'education') {
    if (isEducationCategory) score += 1000
    if (categoryTokens.includes('中学') || categoryTokens.includes('高等院校')) score += 600
    if (EDUCATION_SAME_ENTITY_SUFFIX_RE.test(matchedSuffix)) score += 1100
    if (/(东门|西门|南门|北门|图书馆|教学楼|宿舍)/.test(candidate.name)) score -= 500
    if (match.exact && !isCanonicalEducationEntity) score -= 2200
    if (!isCanonicalEducationEntity && match.score > 0) score -= 600
    if (matchedSuffix && EDUCATION_DERIVATIVE_SUFFIX_RE.test(matchedSuffix)) {
      score -= 1800
    }
  }

  if (placeKind === 'transport') {
    if (isTransportCategory) score += 700
  }

  if (Number.isFinite(candidate.distance_m)) {
    score -= Math.min(Number(candidate.distance_m) / 20, 200)
  }

  return score
}

function buildAnchor(candidate: AnchorCandidate | null, placeName: string, role = 'primary') {
  if (!candidate) {
    return {
      place_name: placeName,
      display_name: placeName,
      role,
      source: 'unresolved',
      resolved_place_name: placeName,
      poi_id: null,
    }
  }

  return {
    place_name: placeName,
    display_name: placeName,
    role,
    source: 'poi_search',
    resolved_place_name: candidate.name,
    poi_id: candidate.id ?? null,
    lon: candidate.lon,
    lat: candidate.lat,
    coord_sys: 'gcj02',
  }
}

export async function resolveAnchorAction(
  payload: ResolveAnchorPayload,
  deps: {
    searchCandidates: (placeName: string, variants: string[]) => Promise<AnchorCandidate[]>
  },
): Promise<SkillExecutionResult<{ anchor: ReturnType<typeof buildAnchor> }>> {
  const placeName = readPlaceName(payload)
  const role = payload.role || 'primary'
  const variants = buildVariants(placeName)
  const candidates = await deps.searchCandidates(placeName, variants)
  const densityMap = buildCandidateDensityMap(candidates)

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, variants, placeName) + (() => {
        const lon = Number(candidate.lon)
        const lat = Number(candidate.lat)
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 0
        const key = `${lon.toFixed(6)},${lat.toFixed(6)}`
        return Math.max((densityMap.get(key) || 1) - 1, 0) * 320
      })(),
    }))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]?.candidate || null

  return {
    ok: true,
    data: {
      anchor: buildAnchor(best, placeName, role),
    },
    meta: {
      action: 'resolve_anchor',
      audited: true,
      candidates: candidates.length,
    },
  }
}
