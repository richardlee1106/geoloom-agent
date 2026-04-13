import type {
  AreaAoiContextItem,
  AreaHotspot,
  AreaInsightConfidence,
  AreaInsightInput,
  AreaLanduseContextItem,
  AreaSubject,
  DeterministicIntent,
  EvidenceAnchor,
  EvidenceItem,
  EvidenceView,
  ResolvedAnchor,
} from '../../chat/types.js'
import { buildAnomalySignals, buildLivelihoodProfile } from '../areaInsight/livelihoodProfile.js'
import { buildOpportunitySignals } from '../areaInsight/opportunitySignals.js'
import {
  classifyRepresentativeAnchorType,
  getRepresentativeAnchorPriority,
  isLargeViewport,
  prioritizeRepresentativeItems,
  sortRepresentativeAoiContext,
  type RepresentativeAnchorType,
} from '../areaInsight/representativeAnchorPriority.js'

function normalizeAnchor(anchor: ResolvedAnchor): EvidenceAnchor {
  return {
    placeName: anchor.place_name,
    displayName: anchor.display_name,
    resolvedPlaceName: anchor.resolved_place_name,
    lon: anchor.lon,
    lat: anchor.lat,
    source: anchor.source,
    coordSys: String(anchor.coord_sys || 'gcj02').trim().toLowerCase() || 'gcj02',
  }
}

function normalizeAreaItem(row: Record<string, unknown>): EvidenceItem {
  return {
    id: (row.id as string | number | null | undefined) ?? null,
    name: String(row.name || '').trim() || '未命名地点',
    category: String(row.category_sub || row.category_main || row.category || '').trim() || null,
    categoryMain: String(row.category_main || '').trim() || null,
    categorySub: String(row.category_sub || '').trim() || null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : undefined,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : undefined,
    coordSys: String(row.coord_sys || row.coordSys || 'gcj02').trim().toLowerCase() || 'gcj02',
    distance_m: Number.isFinite(Number(row.distance_m)) ? Number(row.distance_m) : null,
  }
}

function buildBuckets(items: EvidenceItem[]) {
  return items
    .reduce<Array<{ label: string, value: number }>>((accumulator, item) => {
      const label = item.categoryMain || item.category || '未分类'
      const existing = accumulator.find((bucket) => bucket.label === label)
      if (existing) {
        existing.value += 1
      } else {
        accumulator.push({ label, value: 1 })
      }
      return accumulator
    }, [])
    .sort((left, right) => right.value - left.value)
}

function buildBucketsFromHistogram(rows: Record<string, unknown>[] = []) {
  return rows
    .map((row) => ({
      label: String(row.category_main || row.categoryMain || row.label || row.competition_key || '').trim() || '未分类',
      value: Number(row.poi_count || row.count || 0),
    }))
    .filter((bucket) => Number.isFinite(bucket.value) && bucket.value > 0)
    .sort((left, right) => right.value - left.value)
}

function parsePolygonWkt(wkt: string) {
  const match = String(wkt || '').trim().match(/^POLYGON\s*\(\((.+)\)\)$/i)
  if (!match) return [] as Array<{ lon: number, lat: number }>

  return match[1]
    .split(',')
    .map((pair) => {
      const [lonText, latText] = pair.trim().split(/\s+/)
      const lon = Number(lonText)
      const lat = Number(latText)
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null
      }
      return { lon, lat }
    })
    .filter((point): point is { lon: number, lat: number } => Boolean(point))
}

function isPointInPolygon(point: { lon: number, lat: number }, polygon: Array<{ lon: number, lat: number }>) {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].lon
    const yi = polygon[i].lat
    const xj = polygon[j].lon
    const yj = polygon[j].lat

    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && (point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function inferHotspotSampleNames(gridWkt: string | null, items: EvidenceItem[]) {
  if (!gridWkt) return []

  const polygon = parsePolygonWkt(gridWkt)
  if (polygon.length < 3) return []

  return items
    .filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude))
    .filter((item) => isPointInPolygon({
      lon: Number(item.longitude),
      lat: Number(item.latitude),
    }, polygon))
    .sort((left, right) => Number(left.distance_m || Number.MAX_SAFE_INTEGER) - Number(right.distance_m || Number.MAX_SAFE_INTEGER))
    .slice(0, 2)
    .map((item) => item.name)
}

function buildHotspotLabel(index: number, sampleNames: string[]) {
  if (sampleNames.length >= 2) {
    return `${sampleNames[0]}、${sampleNames[1]}一带`
  }

  if (sampleNames.length === 1) {
    return `${sampleNames[0]}周边`
  }

  return `热点网格${index + 1}`
}

function buildHotspots(rows: Record<string, unknown>[] = [], representativeItems: EvidenceItem[] = []): AreaHotspot[] {
  return rows
    .map((row, index) => {
      const gridWkt = String(row.grid_wkt || row.gridWkt || '').trim() || null
      const sampleNames = inferHotspotSampleNames(gridWkt, representativeItems)

      return {
        label: buildHotspotLabel(index, sampleNames),
        poiCount: Number(row.poi_count || row.count || 0),
        gridWkt,
        sampleNames,
      }
    })
    .filter((row) => Number.isFinite(row.poiCount) && row.poiCount > 0)
    .slice(0, 3)
}

function buildAoiContext(rows: Record<string, unknown>[] = []): AreaAoiContextItem[] {
  return rows
    .map((row) => ({
      id: (row.id as string | number | null | undefined) ?? null,
      name: String(row.name || '').trim() || '未命名 AOI',
      fclass: String(row.fclass || '').trim() || null,
      code: String(row.code || '').trim() || null,
      population: Number.isFinite(Number(row.population)) ? Number(row.population) : null,
      areaSqm: Number.isFinite(Number(row.area_sqm || row.areaSqm)) ? Number(row.area_sqm || row.areaSqm) : null,
    }))
    .filter((item) => Boolean(item.name) && !isInvalidSubjectName(item.name))
    .slice(0, 5)
}

function buildLanduseContext(rows: Record<string, unknown>[] = []): AreaLanduseContextItem[] {
  return rows
    .map((row) => ({
      landType: String(row.land_type || row.landType || '').trim() || 'unknown',
      parcelCount: Number.isFinite(Number(row.parcel_count || row.parcelCount))
        ? Number(row.parcel_count || row.parcelCount)
        : 0,
      totalAreaSqm: Number.isFinite(Number(row.total_area_sqm || row.totalAreaSqm))
        ? Number(row.total_area_sqm || row.totalAreaSqm)
        : 0,
    }))
    .filter((item) => Boolean(item.landType))
    .sort((left, right) => {
      if (right.totalAreaSqm !== left.totalAreaSqm) {
        return right.totalAreaSqm - left.totalAreaSqm
      }
      return right.parcelCount - left.parcelCount
    })
    .slice(0, 5)
}

function isGenericAreaName(name: string) {
  return ['当前区域', '当前片区', '这里', '此处', '当前位置'].includes(String(name || '').trim())
}

function isInvalidSubjectName(name: string) {
  const normalized = String(name || '').trim().toLowerCase()
  if (!normalized) return true
  return [
    'none',
    'null',
    'unknown',
    'n/a',
    'na',
    '未命名',
    '未命名 aoi',
    '未命名地点',
  ].includes(normalized)
}

function isCampusLikeText(text: string) {
  return classifyRepresentativeAnchorType({ name: text }) === 'campus'
}

function normalizeSubjectAnchorName(name: string) {
  const raw = String(name || '').trim()
  if (!raw || isInvalidSubjectName(raw)) return ''

  const explicitCampus = raw.match(/(.+?(大学|学院|学校|校区))/u)
  if (explicitCampus?.[1]) {
    return explicitCampus[1].trim()
  }

  const explicitStation = raw.match(/(.+?地铁站)/u)
  if (explicitStation?.[1]) {
    return explicitStation[1].trim()
  }

  const normalized = raw
    .replace(/(生活区|商业带|地铁商业带|生活带|片区|园区|校区|北区|南区|东区|西区)$/u, '')
    .trim()
  return isInvalidSubjectName(normalized) ? '' : normalized
}

function readAreaSemanticFlags(input: {
  aoiContext: AreaAoiContextItem[]
  landuseContext: AreaLanduseContextItem[]
}) {
  const landTypes = new Set(
    input.landuseContext
      .map((item) => String(item.landType || '').trim().toLowerCase())
      .filter(Boolean),
  )
  const aoiText = input.aoiContext
    .map((item) => `${String(item.name || '')} ${String(item.fclass || '')}`.trim().toLowerCase())
    .join(' ')

  const hasEducation = landTypes.has('education') || /(school|education|campus|university|college|大学|学院|学校|校园)/u.test(aoiText)
  const hasResidential = landTypes.has('residential') || landTypes.has('mixed_use') || /(residential|housing|community|宿舍|生活区|居住)/u.test(aoiText)
  const hasCommercial = landTypes.has('commercial') || landTypes.has('mixed_use') || /(commercial|business|mall|retail|商业|商圈|广场)/u.test(aoiText)

  return {
    hasEducation,
    hasResidential,
    hasCommercial,
  }
}

function buildAreaSubject(input: {
  anchor: ResolvedAnchor
  aoiContext: AreaAoiContextItem[]
  landuseContext: AreaLanduseContextItem[]
  representativeItems: EvidenceItem[]
  viewportContext?: DeterministicIntent['viewportContext']
}): AreaSubject | undefined {
  const candidates = input.aoiContext
    .map((item) => {
      const rawName = String(item.name || '').trim()
      const anchorName = normalizeSubjectAnchorName(rawName)
      const anchorType = classifyRepresentativeAnchorType({
        name: rawName,
        fclass: item.fclass,
      })
      return {
        rawName,
        anchorName,
        anchorType,
        weight: Number(item.population || item.areaSqm || 1),
      }
    })
    .filter((item) => item.anchorName && !isGenericAreaName(item.anchorName))
    .sort((left, right) => {
      const priorityDiff = getRepresentativeAnchorPriority(left.anchorType) - getRepresentativeAnchorPriority(right.anchorType)
      if (priorityDiff !== 0) {
        return priorityDiff
      }
      if (right.weight !== left.weight) {
        return right.weight - left.weight
      }
      return left.anchorName.length - right.anchorName.length
    })

  let anchorName = candidates[0]?.anchorName || ''
  let reasons = candidates[0]?.rawName ? [`AOI 命中 ${candidates[0].rawName}`] : []
  let anchorType: RepresentativeAnchorType = candidates[0]?.anchorType || 'other'

  if (!anchorName) {
    const itemCandidate = input.representativeItems
      .map((item) => ({
        rawName: item.name,
        anchorName: normalizeSubjectAnchorName(item.name),
        anchorType: classifyRepresentativeAnchorType({
          name: item.name,
          categoryMain: item.categoryMain,
          categorySub: item.categorySub || item.category,
          allowNameFallback: false,
        }),
        distanceM: Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : Number.MAX_SAFE_INTEGER,
      }))
      .filter((item) => item.anchorName && item.anchorType !== 'other' && !isGenericAreaName(item.anchorName))
      .sort((left, right) => {
        const priorityDiff = getRepresentativeAnchorPriority(left.anchorType) - getRepresentativeAnchorPriority(right.anchorType)
        if (priorityDiff !== 0) {
          return priorityDiff
        }
        return left.distanceM - right.distanceM
      })[0]
    if (itemCandidate) {
      anchorName = itemCandidate.anchorName
      anchorType = itemCandidate.anchorType
      reasons = [`代表样本命中 ${itemCandidate.rawName}`]
    }
  }

  if (!anchorName) {
    const fallbackAnchor = normalizeSubjectAnchorName(input.anchor.resolved_place_name || input.anchor.display_name || input.anchor.place_name)
    if (fallbackAnchor && !isGenericAreaName(fallbackAnchor)) {
      anchorName = fallbackAnchor
      anchorType = classifyRepresentativeAnchorType({ name: fallbackAnchor })
      reasons = [`锚点命中 ${fallbackAnchor}`]
    }
  }

  if (!anchorName) {
    return undefined
  }

  const semanticFlags = readAreaSemanticFlags({
    aoiContext: input.aoiContext,
    landuseContext: input.landuseContext,
  })
  const campusLike = anchorType === 'campus' || isCampusLikeText(anchorName) || semanticFlags.hasEducation

  let typeHint = '混合片区'
  if (anchorType === 'scenic' && semanticFlags.hasCommercial) {
    typeHint = '景区商业带'
  } else if (anchorType === 'scenic') {
    typeHint = '景区片区'
  } else if (anchorType === 'commercial') {
    typeHint = '商业片区'
  } else if (anchorType === 'station') {
    typeHint = '交通节点片区'
  } else if (campusLike && semanticFlags.hasResidential && semanticFlags.hasCommercial) {
    typeHint = '校园生活带'
  } else if (campusLike && semanticFlags.hasCommercial) {
    typeHint = '校园商业带'
  } else if (campusLike && semanticFlags.hasResidential) {
    typeHint = '校园生活片区'
  } else if (campusLike) {
    typeHint = '校园片区'
  } else if (semanticFlags.hasResidential && semanticFlags.hasCommercial) {
    typeHint = '居住商业混合片区'
  } else if (semanticFlags.hasResidential) {
    typeHint = '居住片区'
  } else if (semanticFlags.hasCommercial) {
    typeHint = '商业片区'
  }

  return {
    title: anchorName.includes(typeHint) ? anchorName : `${anchorName}${typeHint}`,
    anchorName,
    typeHint,
    confidence: (
      (campusLike && (semanticFlags.hasResidential || semanticFlags.hasCommercial))
      || (isLargeViewport(input.viewportContext) && getRepresentativeAnchorPriority(anchorType) < getRepresentativeAnchorPriority('other'))
    ) ? 'high' : candidates.length > 0 ? 'medium' : 'low',
    reasons: isLargeViewport(input.viewportContext) && getRepresentativeAnchorPriority(anchorType) < getRepresentativeAnchorPriority('other')
      ? [...reasons, `大 viewport 优先采用 ${anchorType} 主锚点`]
      : reasons,
  }
}

function inferAreaQuestionMode(rawQuery: string) {
  if (/居住|商业|混合|片区类型|说明依据/u.test(rawQuery)) {
    return 'semantic'
  }

  if (/开店|开什么店|适合开什么店|值得优先考虑|补什么配套|补位|供给|需求|竞争/u.test(rawQuery)) {
    return 'opportunity'
  }

  if (/异常点|异常/u.test(rawQuery) && !/主导业态|热点|机会|读懂|总结/u.test(rawQuery)) {
    return 'anomaly'
  }

  return 'summary'
}

function buildConfidence(input: {
  hotspots: AreaHotspot[]
  profileAvailable: boolean
  representativeSamples: EvidenceItem[]
  competitionDensity?: Record<string, unknown>[]
}) {
  const components = [
    input.profileAvailable,
    input.hotspots.length > 0,
    input.representativeSamples.length > 0,
    (input.competitionDensity || []).length > 0,
  ].filter(Boolean).length

  if (components === 0) {
    return undefined
  }

  const score = Number(Math.min(0.35 + components * 0.12, 0.9).toFixed(2))
  const reasons: string[] = []
  if (input.profileAvailable) reasons.push('已拿到结构化 livelihood profile')
  if (input.hotspots.length > 0) reasons.push('已拿到热点聚合')
  if ((input.competitionDensity || []).length > 0) reasons.push('已拿到竞争密度')
  if (input.representativeSamples.length > 0) reasons.push('已拿到代表样本')

  return {
    score,
    level: score >= 0.75 ? 'high' : score >= 0.55 ? 'medium' : 'low',
    reasons,
  } satisfies AreaInsightConfidence
}

export function buildAreaOverviewView(input: {
  anchor: ResolvedAnchor
  rows: Record<string, unknown>[]
  intent: DeterministicIntent
  areaInsight?: AreaInsightInput
}): EvidenceView {
  const representativeRows = input.areaInsight?.representativeSamples?.length
    ? input.areaInsight.representativeSamples
    : input.rows
  const items = representativeRows.map(normalizeAreaItem)
  const representativeSamples = prioritizeRepresentativeItems(items, input.intent.viewportContext)
  const histogramBuckets = buildBucketsFromHistogram(input.areaInsight?.categoryHistogram)
  const buckets = histogramBuckets.length > 0
    ? histogramBuckets
    : buildBuckets(items)
  const hotspots = buildHotspots(
    input.areaInsight?.hotspotCells,
    representativeSamples.length > 0 ? representativeSamples : items,
  )
  const aoiContext = sortRepresentativeAoiContext(
    buildAoiContext(input.areaInsight?.aoiContext),
    input.intent.viewportContext,
  )
  const landuseContext = buildLanduseContext(input.areaInsight?.landuseContext)
  const areaProfile = buildLivelihoodProfile({
    items,
    buckets,
    ringDistribution: input.areaInsight?.ringDistribution,
  })
  const anomalySignals = buildAnomalySignals(areaProfile, hotspots)
  const opportunitySignals = buildOpportunitySignals({
    profile: areaProfile,
    competitionDensity: input.areaInsight?.competitionDensity,
  })
  const confidence = buildConfidence({
    hotspots,
    profileAvailable: Boolean(areaProfile),
    representativeSamples: representativeSamples.length > 0 ? representativeSamples : items,
    competitionDensity: input.areaInsight?.competitionDensity,
  })
  const areaSubject = buildAreaSubject({
    anchor: input.anchor,
    aoiContext,
    landuseContext,
    representativeItems: representativeSamples.length > 0 ? representativeSamples : items,
    viewportContext: input.intent.viewportContext,
  })

  return {
    type: 'area_overview',
    anchor: normalizeAnchor(input.anchor),
    items,
    buckets,
    meta: {
      resultCount: items.length,
      radiusM: input.intent.radiusM,
      targetCategory: input.intent.targetCategory,
      queryType: input.intent.queryType,
      rawQuery: input.intent.rawQuery,
      questionMode: inferAreaQuestionMode(input.intent.rawQuery),
      viewportScale: input.intent.viewportContext?.scale || 'unknown',
    },
    areaProfile,
    hotspots,
    anomalySignals,
    opportunitySignals,
    representativeSamples: representativeSamples.length > 0 ? representativeSamples : items,
    confidence,
    areaSubject,
    aoiContext,
    landuseContext,
  }
}
