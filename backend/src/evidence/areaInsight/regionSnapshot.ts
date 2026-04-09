import type {
  EvidenceView,
  RegionFeatureTag,
  RegionSnapshotCompetition,
  RegionSnapshotInput,
} from '../../chat/types.js'

const CAMPUS_KEYWORDS = ['大学', '学院', '学校', '校园', '校区', 'university', 'college', 'campus', 'school']
const RESIDENTIAL_KEYWORDS = ['生活区', '宿舍', '住宅', '社区', '居住', 'residential', 'housing', 'community', 'apartment']
const COMMERCIAL_KEYWORDS = ['商业', '商圈', '广场', 'mall', 'retail', 'commercial', 'shopping', 'business']
const TRANSIT_KEYWORDS = ['地铁', '站', '交通', 'metro', 'station', 'transit']

const REGION_SNAPSHOT_VOCABULARY = [
  'feature:campus_anchor',
  'feature:mixed_use',
  'feature:residential_support',
  'feature:commercial_vitality',
  'feature:transit_connected',
  'feature:food_dominant',
  'feature:retail_support',
  'feature:single_core_hotspot',
  'feature:multi_core_hotspot',
  'feature:inner_ring_concentration',
  'feature:food_competition_dense',
  'feature:life_service_gap',
  'category:food',
  'category:retail',
  'category:transport',
  'landuse:education',
  'landuse:residential',
  'landuse:commercial',
  'landuse:mixed_use',
]

function trimText(value: unknown) {
  return String(value || '').trim()
}

function includesAny(text: string, keywords: string[]) {
  const normalized = trimText(text).toLowerCase()
  if (!normalized) return false
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

function normalizeCategoryToken(label: string) {
  const normalized = trimText(label)
  if (/餐饮|美食|咖啡|饮品|餐厅/u.test(normalized)) return 'food'
  if (/购物|零售|超市|便利店/u.test(normalized)) return 'retail'
  if (/交通|地铁|公交|站/u.test(normalized)) return 'transport'
  return normalized.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_')
}

function humanizeCategoryLabel(label: string) {
  const alias: Record<string, string> = {
    餐饮美食: '餐饮',
    购物服务: '零售配套',
    生活服务: '生活服务',
    交通设施服务: '交通接驳',
    科教文化服务: '教育文化',
    医疗保健服务: '医疗配套',
    体育休闲服务: '休闲活力',
    住宿服务: '停留配套',
  }
  return alias[trimText(label)] || trimText(label)
}

function pushFeature(
  tags: RegionFeatureTag[],
  key: string,
  label: string,
  score: number,
  detail?: string,
) {
  if (tags.some((item) => item.key === key)) return
  tags.push({
    key,
    label,
    score: Number(score.toFixed(2)),
    detail: detail || null,
  })
}

function collectSemanticText(snapshot: RegionSnapshotInput) {
  return [
    snapshot.subjectName,
    snapshot.anchorName,
    ...(snapshot.aoiContext || []).map((item) => `${item.name} ${item.fclass || ''}`),
    ...(snapshot.representativePois || []).map((item) => `${item.name} ${item.categoryMain || ''} ${item.categorySub || ''}`),
  ]
    .map((value) => trimText(value))
    .filter(Boolean)
    .join(' ')
}

function hasCampusSignal(snapshot: RegionSnapshotInput) {
  const text = collectSemanticText(snapshot)
  const landTypes = new Set((snapshot.landuseContext || []).map((item) => trimText(item.landType).toLowerCase()))
  return includesAny(text, CAMPUS_KEYWORDS) || landTypes.has('education')
}

function hasResidentialSignal(snapshot: RegionSnapshotInput) {
  const text = collectSemanticText(snapshot)
  const landTypes = new Set((snapshot.landuseContext || []).map((item) => trimText(item.landType).toLowerCase()))
  return includesAny(text, RESIDENTIAL_KEYWORDS) || landTypes.has('residential') || landTypes.has('mixed_use')
}

function hasCommercialSignal(snapshot: RegionSnapshotInput) {
  const text = collectSemanticText(snapshot)
  const landTypes = new Set((snapshot.landuseContext || []).map((item) => trimText(item.landType).toLowerCase()))
  return includesAny(text, COMMERCIAL_KEYWORDS) || landTypes.has('commercial') || landTypes.has('mixed_use')
}

function hasTransitSignal(snapshot: RegionSnapshotInput) {
  const text = collectSemanticText(snapshot)
  return includesAny(text, TRANSIT_KEYWORDS)
}

function readTopCompetition(snapshot: RegionSnapshotInput): RegionSnapshotCompetition | undefined {
  return [...(snapshot.competitionDensity || [])]
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count
      return Number(left.avgDistanceM || Number.MAX_SAFE_INTEGER) - Number(right.avgDistanceM || Number.MAX_SAFE_INTEGER)
    })[0]
}

function isCompetitionDense(entry?: RegionSnapshotCompetition) {
  if (!entry) return false
  return entry.count >= 8
    || (
      Number.isFinite(entry.avgDistanceM)
      && Number(entry.avgDistanceM) <= 180
      && entry.count >= 5
    )
}

export function deriveRegionFeatureTags(snapshot: RegionSnapshotInput): RegionFeatureTag[] {
  const tags: RegionFeatureTag[] = []
  const dominantCategories = [...(snapshot.dominantCategories || [])]
    .sort((left, right) => Number(right.share || right.count || 0) - Number(left.share || left.count || 0))
  const topCategory = dominantCategories[0]
  const secondCategory = dominantCategories[1]
  const firstRing = [...(snapshot.ringDistribution || [])]
    .sort((left, right) => right.share - left.share)[0]
  const hotspotCount = (snapshot.hotspots || []).length
  const topCompetition = readTopCompetition(snapshot)

  if (hasCampusSignal(snapshot)) {
    pushFeature(tags, 'campus_anchor', '校园主导', 0.93, '片区主语与 AOI / 用地共同指向校园驱动。')
  }

  if (hasResidentialSignal(snapshot) && hasCommercialSignal(snapshot)) {
    pushFeature(tags, 'mixed_use', '居住商业混合', 0.88, '居住与商业信号同时出现，不像单一功能片区。')
  } else if (hasResidentialSignal(snapshot)) {
    pushFeature(tags, 'residential_support', '居住支撑', 0.72, '片区有稳定居住承接。')
  } else if (hasCommercialSignal(snapshot)) {
    pushFeature(tags, 'commercial_vitality', '商业活力带', 0.72, '商业与消费信号更强。')
  }

  if (hasTransitSignal(snapshot)) {
    pushFeature(tags, 'transit_connected', '交通口活力', 0.76, '热点和代表样本明显贴近站点或交通接驳。')
  }

  if (topCategory && normalizeCategoryToken(topCategory.label) === 'food' && Number(topCategory.share || 0) >= 0.42) {
    pushFeature(tags, 'food_dominant', '餐饮主导', Math.max(0.68, Number(topCategory.share || 0)), '餐饮供给占比已经进入头部。')
  }

  if (secondCategory && normalizeCategoryToken(secondCategory.label) === 'retail' && Number(secondCategory.share || 0) >= 0.18) {
    pushFeature(tags, 'retail_support', '零售配套跟随', Math.max(0.58, Number(secondCategory.share || 0)), '零售更多像承接型配套而不是主导功能。')
  }

  if (hotspotCount === 1) {
    pushFeature(tags, 'single_core_hotspot', '单核热点', 0.82, '活力更像围绕一个核心点位或带状节点集聚。')
  } else if (hotspotCount >= 2) {
    pushFeature(tags, 'multi_core_hotspot', '多核活力', 0.74, '热点不是只集中在单一点位。')
  }

  if (
    firstRing
    && Number(firstRing.share || 0) >= 0.45
    && /^0-?\d+/u.test(trimText(firstRing.label))
  ) {
    pushFeature(tags, 'inner_ring_concentration', '近圈层集聚', 0.77, '头部活力更多挤在最近圈层。')
  }

  if (isCompetitionDense(topCompetition) && normalizeCategoryToken(topCompetition?.label || '') === 'food') {
    pushFeature(tags, 'food_competition_dense', '餐饮竞争偏密', 0.81, '餐饮竞争层已经比较拥挤。')
  }

  const dominantLabels = new Set(dominantCategories.map((item) => trimText(item.label)))
  if (!dominantLabels.has('生活服务')) {
    pushFeature(tags, 'life_service_gap', '生活服务待补', 0.61, '日常生活服务还没进入稳定头部结构。')
  }

  return tags
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
}

export function summarizeRegionFeatures(snapshot: RegionSnapshotInput, tags: RegionFeatureTag[]) {
  const subject = trimText(snapshot.subjectName || snapshot.anchorName) || '当前片区'
  if (tags.length === 0) {
    return `围绕${subject}，编码器暂时还没提取到稳定的片区特征。`
  }

  return `围绕${subject}，编码器提取的片区特征包括：${tags.slice(0, 4).map((item) => item.label).join('、')}。`
}

export function buildRegionSnapshotTokens(snapshot: RegionSnapshotInput, tags: RegionFeatureTag[]) {
  const tokens = new Set<string>()

  for (const tag of tags) {
    tokens.add(`feature:${tag.key}`)
  }

  for (const category of snapshot.dominantCategories || []) {
    const token = normalizeCategoryToken(category.label)
    if (token) {
      tokens.add(`category:${token}`)
    }
  }

  for (const landuse of snapshot.landuseContext || []) {
    const normalized = trimText(landuse.landType).toLowerCase()
    if (normalized) {
      tokens.add(`landuse:${normalized}`)
    }
  }

  return [...tokens]
}

export function vectorizeRegionSnapshotTokens(tokens: string[]) {
  return REGION_SNAPSHOT_VOCABULARY.map((term) => tokens.includes(term) ? 1 : 0)
}

function readCompetitionDensity(rows: Record<string, unknown>[] = []): RegionSnapshotCompetition[] {
  return rows
    .map((row) => ({
      label: trimText(row.competition_key || row.label),
      count: Number(row.poi_count || row.count || 0),
      avgDistanceM: Number.isFinite(Number(row.avg_distance_m || row.avgDistanceM))
        ? Number(row.avg_distance_m || row.avgDistanceM)
        : null,
    }))
    .filter((row) => Boolean(row.label) && Number.isFinite(row.count) && row.count > 0)
}

export function buildRegionSnapshotFromEvidence(input: {
  view: EvidenceView
  rawQuery?: string
  competitionDensity?: Record<string, unknown>[]
}): RegionSnapshotInput {
  const dominantCategories = input.view.areaProfile?.dominantCategories?.map((item) => ({
    label: item.label,
    count: item.count,
    share: item.share,
  })) || input.view.buckets?.map((item) => ({
    label: item.label,
    count: item.value,
    share: null,
  })) || []

  return {
    anchorName: input.view.areaSubject?.anchorName || input.view.anchor.resolvedPlaceName || input.view.anchor.displayName,
    subjectName: input.view.areaSubject?.title || input.view.anchor.resolvedPlaceName || input.view.anchor.displayName,
    rawQuery: input.rawQuery || trimText(input.view.meta.rawQuery),
    dominantCategories,
    ringDistribution: input.view.areaProfile?.ringFootfall || [],
    hotspots: (input.view.hotspots || []).map((item) => ({
      label: item.label,
      poiCount: item.poiCount,
      sampleNames: item.sampleNames,
    })),
    representativePois: (input.view.representativeSamples || input.view.items || []).slice(0, 8).map((item) => ({
      name: item.name,
      categoryMain: item.categoryMain,
      categorySub: item.categorySub,
      distanceM: item.distance_m ?? null,
    })),
    aoiContext: input.view.aoiContext || [],
    landuseContext: input.view.landuseContext || [],
    competitionDensity: readCompetitionDensity(input.competitionDensity || []),
  }
}
