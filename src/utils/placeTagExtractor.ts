const WEAK_NAME_PATTERNS = [
  /停车场/u,
  /出入口/u,
  /^入口$/u,
  /^出口$/u,
  /无名/u,
  /测试/u,
  /临时/u,
  /通道/u
]

const STRONG_CATEGORY_HINTS = ['公园', '商圈', '高校', '医院', '景区', '地标', '综合体', '商场']
const MICRO_CATEGORY_HINTS = ['地铁', '交通', '餐饮', '便利', '社区', '办公', '写字楼']

type PoiLike = {
  id?: unknown
  poiid?: unknown
  name?: unknown
  poi_name?: unknown
  poiName?: unknown
  label?: unknown
  type?: unknown
  category?: unknown
  category_small?: unknown
  score?: unknown
  relevance_score?: unknown
  relevanceScore?: unknown
  properties?: Record<string, unknown> | null
  [key: string]: unknown
}

type PlaceTagCandidate = {
  name: string
  canonical: string
  category: string
  weight: number
  poi: PoiLike
}

type GroupedPlaceTag = {
  key: string
  name: string
  type: string
  weight: number
  samplePoi: PoiLike
  samplePoiWeight: number
  sampleCount: number
}

type PlaceTag = {
  id: unknown
  name: string
  type: string
  weight: number
  originalPoi: PoiLike
}

type BuildPlaceTagsOptions = {
  maxCount?: unknown
  intentMode?: unknown
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function removeBracketSuffix(name: string): string {
  return name.replace(/（[^）]*）/gu, '').replace(/\([^)]*\)/g, '').trim()
}

function removeEntrySuffix(name: string): string {
  return name.replace(/(东门|西门|南门|北门|北区|南区|东区|西区|一期|二期|三期|四期)$/u, '').trim()
}

function toCanonicalName(name: string): string {
  const withoutBracket = removeBracketSuffix(name)
  const withoutSuffix = removeEntrySuffix(withoutBracket)
  return normalizeText(withoutSuffix || withoutBracket || name)
}

function isWeakPlaceName(name: string): boolean {
  const normalized = normalizeText(name)
  if (!normalized) return true
  if (normalized.length < 2) return true
  if (/^\d+$/u.test(normalized)) return true
  return WEAK_NAME_PATTERNS.some((pattern) => pattern.test(normalized))
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return null
}

function extractPoiName(poi: PoiLike | null | undefined): string {
  const props = poi?.properties || {}
  return normalizeText(
    poi?.name ||
      poi?.poi_name ||
      poi?.poiName ||
      poi?.label ||
      poi?.['名称'] ||
      props.name ||
      props.poi_name ||
      props.poiName ||
      props['名称']
  )
}

function extractPoiCategory(poi: PoiLike | null | undefined): string {
  const props = poi?.properties || {}
  return normalizeText(
    poi?.type ||
      poi?.category ||
      poi?.category_small ||
      poi?.['小类'] ||
      props.category_small ||
      props.category_mid ||
      props.category_big ||
      props.type ||
      props['小类'] ||
      props['大类']
  )
}

function computeSignalScore(name: string, category: string, intentMode: string): number {
  let score = 1
  if (name.length >= 3 && name.length <= 12) {
    score += 0.08
  }
  if (STRONG_CATEGORY_HINTS.some((token) => category.includes(token))) {
    score += 0.08
  }
  if (intentMode === 'micro') {
    if (MICRO_CATEGORY_HINTS.some((token) => category.includes(token))) {
      score += 0.1
    }
  }
  return score
}

function buildCandidate(poi: PoiLike, index: number): PlaceTagCandidate | null {
  const name = extractPoiName(poi)
  if (!name) return null

  const category = extractPoiCategory(poi)
  const canonical = toCanonicalName(name) || name
  const rawWeight = firstNumber(
    poi?.score,
    poi?.relevance_score,
    poi?.relevanceScore,
    poi?.properties?.score,
    poi?.properties?.relevance_score
  )
  const weight = rawWeight === null ? Math.max(0.1, 1 / (index + 1)) : rawWeight

  return {
    name,
    canonical,
    category,
    weight,
    poi
  }
}

export function buildPlaceTagsFromPois(
  pois: PoiLike[] = [],
  options: BuildPlaceTagsOptions = {}
): PlaceTag[] {
  const maxCount = Math.max(1, Number(options.maxCount) || 20)
  const intentMode = String(options.intentMode || '').toLowerCase()
  const candidates: PlaceTagCandidate[] = []
  const fallback: PlaceTagCandidate[] = []

  for (let index = 0; index < pois.length; index += 1) {
    const candidate = buildCandidate(pois[index], index)
    if (!candidate) continue

    if (isWeakPlaceName(candidate.name)) {
      fallback.push(candidate)
      continue
    }
    candidates.push(candidate)
  }

  const source = candidates.length > 0 ? candidates : fallback
  const grouped = new Map<string, GroupedPlaceTag>()

  source.forEach((candidate) => {
    const key = candidate.canonical || candidate.name
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        key,
        name: key,
        type: candidate.category,
        weight: candidate.weight,
        samplePoi: candidate.poi,
        samplePoiWeight: candidate.weight,
        sampleCount: 1
      })
      return
    }

    existing.weight += candidate.weight
    existing.sampleCount += 1
    if (candidate.weight > existing.samplePoiWeight) {
      existing.samplePoi = candidate.poi
      existing.samplePoiWeight = candidate.weight
      if (candidate.category) {
        existing.type = candidate.category
      }
    }
  })

  const tags = [...grouped.values()]
    .map((entry, index) => {
      const frequencyBoost = 1 + Math.log1p(entry.sampleCount - 1) * 0.12
      const signalScore = computeSignalScore(entry.name, entry.type || '', intentMode)
      const finalWeight = Number((entry.weight * frequencyBoost * signalScore).toFixed(6))
      return {
        id: entry.samplePoi?.id || entry.samplePoi?.poiid || `${entry.key}-${index}`,
        name: entry.name,
        type: entry.type || '',
        weight: finalWeight,
        originalPoi: entry.samplePoi
      }
    })
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })

  return tags.slice(0, maxCount)
}
