import type {
  AreaAoiContextItem,
  EvidenceItem,
  ViewportContextMeta,
} from '../../chat/types.js'

export type RepresentativeAnchorType =
  | 'campus'
  | 'medical'
  | 'scenic'
  | 'commercial'
  | 'station'
  | 'other'

const MEDICAL_PATTERNS = [
  /医学院|附属医院|附属.*医院|临床学院|医院|中心医院|人民医院|协和|同济|省医|市医|军区总医院/u,
  /hospital|medical|clinic|healthcare/i,
]

const CONTINUING_EDUCATION_PATTERNS = [
  /老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院|党校|干部学院|行政学院|社会主义学院/u,
  /continuing education|open university|community college|lifelong learning/i,
]

const RELIGIOUS_EDUCATION_PATTERNS = [
  /神学院|佛学院|道学院|修道院|修院|神哲学院/u,
  /seminary|theological school|divinity school|monastery/i,
]

const CAMPUS_PATTERNS = [
  /大学|学院|学校|校园|校区/u,
  /university|college|school|campus/i,
]

const SCENIC_PATTERNS = [
  /景区|景点|公园|博物馆|风景区|名胜|古迹|旅游区|文旅/u,
  /park|museum|scenic|heritage|resort/i,
]

const COMMERCIAL_PATTERNS = [
  /步行街|商业街|购物中心|购物广场|商业广场|商场|天地|汉街|奥特莱斯|奥莱|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城/u,
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

  const nameText = trimText(input.name)
  if (matchesAny(`${nameText} ${structured}`, CONTINUING_EDUCATION_PATTERNS)) return 'other'
  if (matchesAny(`${nameText} ${structured}`, RELIGIOUS_EDUCATION_PATTERNS)) return 'other'

  if (matchesAny(structured, STATION_PATTERNS)) return 'station'
  if (matchesAny(structured, MEDICAL_PATTERNS)) return 'medical'
  if (matchesAny(structured, CAMPUS_PATTERNS)) return 'campus'
  if (matchesAny(structured, SCENIC_PATTERNS)) return 'scenic'
  if (matchesAny(structured, COMMERCIAL_PATTERNS)) return 'commercial'

  if (input.allowNameFallback === false) {
    return 'other'
  }

  const combined = [
    nameText,
    structured,
  ]
    .filter(Boolean)
    .join(' ')

  if (matchesAny(combined, CONTINUING_EDUCATION_PATTERNS)) return 'other'
  if (matchesAny(combined, RELIGIOUS_EDUCATION_PATTERNS)) return 'other'
  if (matchesAny(combined, MEDICAL_PATTERNS)) return 'medical'
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
