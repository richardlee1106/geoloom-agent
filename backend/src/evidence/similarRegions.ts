import type {
  EvidenceView,
  SimilarRegionDimension,
  SimilarRegionEvidenceItem,
} from '../chat/types.js'

export interface SimilarRegionCandidateInput {
  regionId?: string | null
  name: string
  summary?: string | null
  score?: number | null
  rerankScore?: number | null
  tags?: string[]
}

interface ReferenceDimensionSeed {
  key: string
  label: string
  score: number
  keywords: string[]
  detail?: string | null
}

const CAMPUS_KEYWORDS = ['大学', '学院', '学校', '校园', '校区', '高校', '学生', 'campus', 'college', 'university']
const FOOD_KEYWORDS = ['餐饮', '美食', '咖啡', '轻食', '夜间', '餐厅', 'food', 'dining', 'coffee']
const MIXED_USE_KEYWORDS = ['居住', '住宅', '社区', '生活', '商业', '商圈', '购物', 'mixed', 'residential', 'commercial']
const TRANSIT_KEYWORDS = ['地铁', '站', '交通', '接驳', '枢纽', 'metro', 'station', 'transit']
const ACTIVITY_KEYWORDS = ['活跃', '热点', '年轻', '夜间', '消费', '人流', 'active', 'youth', 'night']
const RETAIL_KEYWORDS = ['商业', '购物', '零售', '商场', '广场', 'mall', 'retail', 'shopping']

function trimText(value: unknown) {
  return String(value || '').trim()
}

function normalizeScore(value: unknown, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  const normalized = numeric <= 1 ? numeric : numeric / 100
  return Math.max(0, Math.min(1, Number(normalized.toFixed(2))))
}

function uniqueStrings(values: Array<unknown>) {
  return [...new Set(values.map((value) => trimText(value)).filter(Boolean))]
}

function mergeDimension(
  map: Map<string, ReferenceDimensionSeed>,
  next: ReferenceDimensionSeed,
) {
  const existing = map.get(next.key)
  if (!existing || next.score > existing.score) {
    map.set(next.key, {
      ...next,
      score: Number(next.score.toFixed(2)),
    })
  }
}

function hasTextSignal(text: string, keywords: string[]) {
  const normalized = trimText(text).toLowerCase()
  if (!normalized) return false
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

function collectReferenceCorpus(view: EvidenceView) {
  return [
    view.areaSubject?.title,
    view.areaSubject?.anchorName,
    view.regionFeatureSummary,
    ...(view.aoiContext || []).map((item) => `${item.name} ${item.fclass || ''}`),
    ...(view.landuseContext || []).map((item) => item.landType),
    ...(view.representativeSamples || view.items || []).map((item) => `${item.name} ${item.categoryMain || item.category || ''}`),
  ]
    .map((value) => trimText(value))
    .filter(Boolean)
    .join(' ')
}

function collectReferenceDimensions(view: EvidenceView): SimilarRegionDimension[] {
  const dimensionMap = new Map<string, ReferenceDimensionSeed>()
  const referenceCorpus = collectReferenceCorpus(view)

  for (const feature of view.regionFeatures || []) {
    switch (feature.key) {
      case 'campus_anchor':
        mergeDimension(dimensionMap, {
          key: 'campus_vibe',
          label: '校园氛围',
          score: Math.max(normalizeScore(feature.score), 0.82),
          keywords: CAMPUS_KEYWORDS,
          detail: feature.detail || '参考片区具备明显校园驱动。',
        })
        break
      case 'food_dominant':
      case 'food_competition_dense':
        mergeDimension(dimensionMap, {
          key: 'food_density',
          label: '餐饮密度',
          score: Math.max(normalizeScore(feature.score), 0.78),
          keywords: FOOD_KEYWORDS,
          detail: feature.detail || '参考片区的餐饮供给比较集中。',
        })
        break
      case 'mixed_use':
      case 'residential_support':
        mergeDimension(dimensionMap, {
          key: 'lifestyle_mix',
          label: '生活混合度',
          score: Math.max(normalizeScore(feature.score), 0.72),
          keywords: MIXED_USE_KEYWORDS,
          detail: feature.detail || '参考片区兼具居住、商业或生活承接。',
        })
        break
      case 'commercial_vitality':
        mergeDimension(dimensionMap, {
          key: 'retail_vitality',
          label: '商业活力',
          score: Math.max(normalizeScore(feature.score), 0.72),
          keywords: RETAIL_KEYWORDS,
          detail: feature.detail || '参考片区有持续的消费和零售活力。',
        })
        break
      case 'transit_connected':
        mergeDimension(dimensionMap, {
          key: 'transit_access',
          label: '交通便利度',
          score: Math.max(normalizeScore(feature.score), 0.72),
          keywords: TRANSIT_KEYWORDS,
          detail: feature.detail || '参考片区与站点或交通接驳关系紧密。',
        })
        break
      case 'single_core_hotspot':
      case 'multi_core_hotspot':
      case 'inner_ring_concentration':
        mergeDimension(dimensionMap, {
          key: 'activity_hotspot',
          label: '活力热点',
          score: Math.max(normalizeScore(feature.score), 0.7),
          keywords: ACTIVITY_KEYWORDS,
          detail: feature.detail || '参考片区存在相对稳定的热点集聚。',
        })
        break
      default:
        break
    }
  }

  const dominantCategories = view.areaProfile?.dominantCategories || []
  const topFoodShare = dominantCategories
    .filter((item) => /餐饮|美食|咖啡|饮品/u.test(trimText(item.label)))
    .reduce((best, item) => Math.max(best, normalizeScore(item.share, 0)), 0)
  if (topFoodShare >= 0.32 || hasTextSignal(referenceCorpus, FOOD_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'food_density',
      label: '餐饮密度',
      score: Math.max(topFoodShare, 0.74),
      keywords: FOOD_KEYWORDS,
      detail: '参考片区的餐饮与轻消费信号比较稳定。',
    })
  }

  if (hasTextSignal(referenceCorpus, CAMPUS_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'campus_vibe',
      label: '校园氛围',
      score: 0.84,
      keywords: CAMPUS_KEYWORDS,
      detail: '参考片区有明显的校园或学生群体氛围。',
    })
  }

  if (hasTextSignal(referenceCorpus, MIXED_USE_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'lifestyle_mix',
      label: '生活混合度',
      score: 0.72,
      keywords: MIXED_USE_KEYWORDS,
      detail: '参考片区同时承接居住、商业或生活服务。',
    })
  }

  if (hasTextSignal(referenceCorpus, TRANSIT_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'transit_access',
      label: '交通便利度',
      score: 0.7,
      keywords: TRANSIT_KEYWORDS,
      detail: '参考片区与地铁或交通接驳关系较近。',
    })
  }

  if ((view.hotspots || []).length > 0 || hasTextSignal(referenceCorpus, ACTIVITY_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'activity_hotspot',
      label: '活力热点',
      score: 0.72,
      keywords: ACTIVITY_KEYWORDS,
      detail: '参考片区存在较稳定的活力热点。',
    })
  }

  if (hasTextSignal(referenceCorpus, RETAIL_KEYWORDS)) {
    mergeDimension(dimensionMap, {
      key: 'retail_vitality',
      label: '商业活力',
      score: 0.68,
      keywords: RETAIL_KEYWORDS,
      detail: '参考片区存在持续商业或零售活力。',
    })
  }

  return [...dimensionMap.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => ({
      key: item.key,
      label: item.label,
      score: item.score,
      detail: item.detail || null,
    }))
}

function scoreCandidateDimension(input: {
  dimension: SimilarRegionDimension
  candidate: SimilarRegionCandidateInput
}): SimilarRegionDimension {
  const candidateCorpus = [
    input.candidate.name,
    input.candidate.summary,
    ...(input.candidate.tags || []),
  ]
    .map((value) => trimText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const keywords = (() => {
    switch (input.dimension.key) {
      case 'campus_vibe':
        return CAMPUS_KEYWORDS
      case 'food_density':
        return FOOD_KEYWORDS
      case 'lifestyle_mix':
        return MIXED_USE_KEYWORDS
      case 'transit_access':
        return TRANSIT_KEYWORDS
      case 'activity_hotspot':
        return ACTIVITY_KEYWORDS
      case 'retail_vitality':
        return RETAIL_KEYWORDS
      default:
        return []
    }
  })()
  const matchedKeywords = uniqueStrings(
    keywords.filter((keyword) => candidateCorpus.includes(keyword.toLowerCase())),
  )

  let candidateSignal = 0.38
  if (matchedKeywords.length >= 3) {
    candidateSignal = 0.94
  } else if (matchedKeywords.length === 2) {
    candidateSignal = 0.86
  } else if (matchedKeywords.length === 1) {
    candidateSignal = 0.74
  }

  const score = Number((
    normalizeScore(input.dimension.score) * 0.3
    + candidateSignal * 0.6
    + (matchedKeywords.length > 0 ? normalizeScore(input.candidate.score) * 0.1 : 0)
  ).toFixed(2))

  return {
    key: input.dimension.key,
    label: input.dimension.label,
    score,
    detail: matchedKeywords.length > 0
      ? `命中 ${matchedKeywords.slice(0, 2).join('、')} 等语义`
      : '候选摘要里该维度信号相对更弱',
  }
}

function buildCandidateSummary(
  candidate: SimilarRegionCandidateInput,
  dimensions: SimilarRegionDimension[],
) {
  const summary = trimText(candidate.summary)
  if (summary) {
    return summary
  }

  const labels = dimensions
    .slice(0, 2)
    .map((item) => item.label)
    .filter(Boolean)
  if (labels.length === 0) {
    return '当前只拿到整体相似度，摘要还不够稳定。'
  }
  return `当前更接近 ${labels.join('、')} 这几类片区信号。`
}

function buildOverallSimilarity(input: {
  recallScore?: number | null
  rerankScore?: number | null
  dimensions: SimilarRegionDimension[]
}) {
  const recallScore = normalizeScore(input.recallScore, 0)
  const rerankScore = normalizeScore(input.rerankScore, 0)
  const topDimensionAverage = input.dimensions.length > 0
    ? input.dimensions
      .slice(0, 3)
      .reduce((sum, item) => sum + normalizeScore(item.score), 0) / Math.min(input.dimensions.length, 3)
    : 0

  if (rerankScore > 0) {
    if (recallScore === 0) {
      return Number(rerankScore.toFixed(2))
    }
    return Number((recallScore * 0.55 + rerankScore * 0.45).toFixed(2))
  }

  if (recallScore > 0) {
    return Number(Math.max(recallScore, topDimensionAverage * 0.92).toFixed(2))
  }

  return Number(topDimensionAverage.toFixed(2))
}

export function buildSimilarRegionSearchText(input: {
  rawQuery: string
  referenceView: EvidenceView
  featureSummary?: string | null
  referenceDimensions?: SimilarRegionDimension[]
}) {
  const anchorLabel = trimText(
    input.referenceView.areaSubject?.title
    || input.referenceView.areaSubject?.anchorName
    || input.referenceView.anchor.resolvedPlaceName
    || input.referenceView.anchor.displayName
    || input.referenceView.anchor.placeName,
  )
  const dominantCategories = (input.referenceView.areaProfile?.dominantCategories || [])
    .slice(0, 2)
    .map((item) => trimText(item.label))
    .filter(Boolean)
  const dimensionLabels = (input.referenceDimensions || [])
    .slice(0, 3)
    .map((item) => item.label)
    .filter(Boolean)

  return [
    trimText(input.rawQuery),
    anchorLabel ? `参考片区：${anchorLabel}` : '',
    trimText(input.featureSummary),
    dominantCategories.length > 0 ? `主要结构：${dominantCategories.join('、')}` : '',
    dimensionLabels.length > 0 ? `关键维度：${dimensionLabels.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；')
}

export function buildSimilarRegionEvidence(input: {
  referenceView: EvidenceView
  candidates: SimilarRegionCandidateInput[]
}): {
  referenceDimensions: SimilarRegionDimension[]
  regions: SimilarRegionEvidenceItem[]
} {
  const referenceDimensions = collectReferenceDimensions(input.referenceView)

  const regions = input.candidates
    .filter((candidate) => trimText(candidate.name))
    .map((candidate) => {
      const dimensions = referenceDimensions
        .map((dimension) => scoreCandidateDimension({ dimension, candidate }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 4)

      return {
        regionId: candidate.regionId || null,
        name: trimText(candidate.name) || '相似片区',
        score: buildOverallSimilarity({
          recallScore: candidate.score,
          rerankScore: candidate.rerankScore,
          dimensions,
        }),
        summary: buildCandidateSummary(candidate, dimensions),
        tags: uniqueStrings(candidate.tags || []),
        dimensions,
      } satisfies SimilarRegionEvidenceItem
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((region, index) => ({
      ...region,
      rank: index + 1,
    }))

  return {
    referenceDimensions,
    regions,
  }
}
