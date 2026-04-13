import type {
  AreaAoiContextItem,
  EvidenceItem,
  ViewportContextMeta,
} from '../../chat/types.js'

export type RepresentativeAnchorType =
  | 'campus'
  | 'scenic'
  | 'commercial'
  | 'station'
  | 'other'

const CAMPUS_PATTERNS = [
  /大学|学院|学校|校园|校区/u,
  /university|college|school|campus/i,
]

const SCENIC_PATTERNS = [
  /景区|景点|公园|博物馆|风景区|名胜|古迹|旅游区|文旅/u,
  /park|museum|scenic|heritage|resort/i,
]

const COMMERCIAL_PATTERNS = [
  /商圈|步行街|商业街|购物中心|商场|广场|天地|奥特莱斯|mall|plaza/u,
  /shopping|retail|commercial|business|mall|plaza/i,
]

const STATION_PATTERNS = [
  /地铁站|地铁口|站口|换乘站|轨道交通/u,
  /metro|subway|station|transit/i,
]

function trimText(value: unknown) {
  return String(value || '').trim()
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text))
}

export function getRepresentativeAnchorPriority(type: RepresentativeAnchorType) {
  switch (type) {
    case 'campus':
      return 0
    case 'scenic':
      return 1
    case 'commercial':
      return 2
    case 'station':
      return 3
    default:
      return 4
  }
}

export function isPriorityRepresentativeAnchorType(type: RepresentativeAnchorType) {
  return getRepresentativeAnchorPriority(type) < getRepresentativeAnchorPriority('other')
}

export function isLargeViewport(viewportContext?: ViewportContextMeta | null) {
  return viewportContext?.scale === 'large'
}

export function classifyRepresentativeAnchorType(input: {
  name?: unknown
  fclass?: unknown
  categoryMain?: unknown
  categorySub?: unknown
  allowNameFallback?: boolean
}): RepresentativeAnchorType {
  const structured = [
    trimText(input.fclass),
    trimText(input.categoryMain),
    trimText(input.categorySub),
  ]
    .filter(Boolean)
    .join(' ')

  if (matchesAny(structured, STATION_PATTERNS)) return 'station'
  if (matchesAny(structured, CAMPUS_PATTERNS)) return 'campus'
  if (matchesAny(structured, SCENIC_PATTERNS)) return 'scenic'
  if (matchesAny(structured, COMMERCIAL_PATTERNS)) return 'commercial'

  if (input.allowNameFallback === false) {
    return 'other'
  }

  const combined = [
    trimText(input.name),
    structured,
  ]
    .filter(Boolean)
    .join(' ')

  if (matchesAny(combined, CAMPUS_PATTERNS)) return 'campus'
  if (matchesAny(combined, SCENIC_PATTERNS)) return 'scenic'
  if (matchesAny(combined, COMMERCIAL_PATTERNS)) return 'commercial'
  if (matchesAny(combined, STATION_PATTERNS)) return 'station'
  return 'other'
}

function rankAoiItem(item: AreaAoiContextItem) {
  return {
    item,
    type: classifyRepresentativeAnchorType({
      name: item.name,
      fclass: item.fclass,
    }),
    weight: Number(item.population || item.areaSqm || 1),
  }
}

function rankEvidenceItem(item: EvidenceItem) {
      return {
        item,
        type: classifyRepresentativeAnchorType({
          name: item.name,
          categoryMain: item.categoryMain,
          categorySub: item.categorySub || item.category,
          allowNameFallback: false,
        }),
        distanceM: Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : Number.MAX_SAFE_INTEGER,
      }
}

export function sortRepresentativeAoiContext(
  items: AreaAoiContextItem[],
  viewportContext?: ViewportContextMeta | null,
) {
  const ranked = items
    .map(rankAoiItem)
    .sort((left, right) => {
      const priorityDiff = getRepresentativeAnchorPriority(left.type) - getRepresentativeAnchorPriority(right.type)
      if (priorityDiff !== 0) return priorityDiff
      if (right.weight !== left.weight) return right.weight - left.weight
      return left.item.name.length - right.item.name.length
    })

  if (!isLargeViewport(viewportContext)) {
    return items
  }

  const preferred = ranked.filter((entry) => isPriorityRepresentativeAnchorType(entry.type))
  return (preferred.length > 0 ? preferred : ranked).map((entry) => entry.item)
}

export function prioritizeRepresentativeItems(
  items: EvidenceItem[],
  viewportContext?: ViewportContextMeta | null,
) {
  const ranked = items
    .map(rankEvidenceItem)
    .sort((left, right) => {
      const priorityDiff = getRepresentativeAnchorPriority(left.type) - getRepresentativeAnchorPriority(right.type)
      if (priorityDiff !== 0) return priorityDiff
      return left.distanceM - right.distanceM
    })

  if (ranked.length === 0) {
    return []
  }

  const preferred = ranked.filter((entry) => isPriorityRepresentativeAnchorType(entry.type))
  if (isLargeViewport(viewportContext) && preferred.length > 0) {
    return preferred.map((entry) => entry.item)
  }

  if (preferred.length === 0) {
    return ranked.map((entry) => entry.item)
  }

  return [
    ...preferred,
    ...ranked.filter((entry) => !isPriorityRepresentativeAnchorType(entry.type)),
  ].map((entry) => entry.item)
}

export function pickRepresentativeAnchorName(input: {
  rawAnchorName?: unknown
  aoiContext?: Array<AreaAoiContextItem | Record<string, unknown>>
  representativeItems?: Array<EvidenceItem | Record<string, unknown>>
  viewportContext?: ViewportContextMeta | null
}) {
  const genericNames = new Set(['当前区域', '当前片区', '这里', '此处', '当前位置'])

  const aoiCandidates = (input.aoiContext || [])
    .map((row) => {
      const item = row as AreaAoiContextItem & Record<string, unknown>
      return {
        name: trimText(item.name),
        type: classifyRepresentativeAnchorType({
          name: item.name,
          fclass: item.fclass,
        }),
        weight: Number(item.population || item.areaSqm || item.area_sqm || 1),
      }
    })
    .filter((item) => item.name && !genericNames.has(item.name))

  const representativeCandidates = (input.representativeItems || [])
    .map((row) => {
      const item = row as EvidenceItem & Record<string, unknown>
      return {
        name: trimText(item.name),
        type: classifyRepresentativeAnchorType({
          name: item.name,
          categoryMain: item.categoryMain || item.category_main,
          categorySub: item.categorySub || item.category || item.category_sub,
          allowNameFallback: false,
        }),
        weight: Number.isFinite(Number(item.distance_m))
          ? 1 / Math.max(Number(item.distance_m), 1)
          : 0,
      }
    })
    .filter((item) => item.name && !genericNames.has(item.name))

  const allCandidates = [...aoiCandidates, ...representativeCandidates]
    .sort((left, right) => {
      const priorityDiff = getRepresentativeAnchorPriority(left.type) - getRepresentativeAnchorPriority(right.type)
      if (priorityDiff !== 0) return priorityDiff
      return right.weight - left.weight
    })

  const preferred = allCandidates.filter((item) => isPriorityRepresentativeAnchorType(item.type))
  const selected = isLargeViewport(input.viewportContext) && preferred.length > 0
    ? preferred[0]
    : (preferred[0] || allCandidates[0])

  if (selected?.name) {
    return selected.name
  }

  const fallbackName = trimText(input.rawAnchorName)
  return genericNames.has(fallbackName) ? null : (fallbackName || null)
}
