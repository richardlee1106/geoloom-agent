import type {
  EvidenceView,
  EvidenceItem,
  PoiFeatureTag,
  PoiProfileInput,
  RepresentativePoiProfile,
} from '../../chat/types.js'

const CAMPUS_KEYWORDS = ['大学', '学院', '学校', '校园', '校区', 'university', 'campus', 'college', 'school']
const TRANSIT_KEYWORDS = ['地铁', '站', '站口', '公交', 'metro', 'station', 'transit']
const FOOD_KEYWORDS = ['餐饮', '中餐', '小吃', '咖啡', '茶饮', '餐厅', 'food', 'coffee']
const RETAIL_KEYWORDS = ['便利店', '超市', '零售', '购物', 'store', 'retail', 'mart']
const SERVICE_KEYWORDS = ['生活服务', '打印', '快递', '维修', '家政', '洗衣', 'service']

const POI_PROFILE_VOCABULARY = [
  'feature:transit_gateway',
  'feature:campus_anchor',
  'feature:daily_service_node',
  'feature:food_anchor',
  'feature:retail_support',
  'feature:hotspot_anchor',
  'feature:core_ring_sample',
  'feature:student_daily_consumption',
]

function trimText(value: unknown) {
  return String(value || '').trim()
}

function includesAny(text: string, keywords: string[]) {
  const normalized = trimText(text).toLowerCase()
  if (!normalized) return false
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

function pushFeature(tags: PoiFeatureTag[], key: string, label: string, score: number, detail?: string) {
  if (tags.some((item) => item.key === key)) return
  tags.push({
    key,
    label,
    score: Number(score.toFixed(2)),
    detail: detail || null,
  })
}

function isCampusContext(input: PoiProfileInput) {
  const areaSubject = trimText(input.areaSubject)
  const aoiText = (input.aoiContext || []).map((item) => `${item.name} ${item.fclass || ''}`).join(' ')
  return includesAny(`${areaSubject} ${aoiText}`, CAMPUS_KEYWORDS)
}

export function derivePoiFeatureTags(input: PoiProfileInput): PoiFeatureTag[] {
  const tags: PoiFeatureTag[] = []
  const directText = [
    input.name,
    input.categoryMain,
    input.categorySub,
  ]
    .map((value) => trimText(value))
    .filter(Boolean)
    .join(' ')
  const mergedText = [
    directText,
    ...(input.surroundingCategories || []),
  ]
    .map((value) => trimText(value))
    .filter(Boolean)
    .join(' ')
  const campusContext = isCampusContext(input)
  const hotspotLabel = trimText(input.hotspotLabel)
  const distanceM = Number(input.distanceM)

  if (includesAny(directText, TRANSIT_KEYWORDS)) {
    pushFeature(tags, 'transit_gateway', '交通接驳点', 0.93, '这个样本直接承担进出片区与人流导入。')
  }

  if (campusContext && includesAny(`${input.name} ${input.categoryMain} ${input.categorySub}`, CAMPUS_KEYWORDS)) {
    pushFeature(tags, 'campus_anchor', '校园锚点', 0.9, '样本本身就带有明确校园主语。')
  }

  if (campusContext && includesAny(directText, FOOD_KEYWORDS)) {
    pushFeature(tags, 'student_daily_consumption', '校园高频消费点', 0.84, '它更像学生日常消费和停留的高频触发点。')
  }

  if (includesAny(directText, FOOD_KEYWORDS)) {
    pushFeature(tags, 'food_anchor', '餐饮锚点', 0.78, '说明片区活力的一部分由高频餐饮消费承接。')
  }

  if (includesAny(directText, RETAIL_KEYWORDS)) {
    pushFeature(tags, 'retail_support', '零售配套点', 0.74, '更像承接即时补给和便利消费的配套节点。')
  }

  if (includesAny(directText, SERVICE_KEYWORDS) || includesAny(directText, RETAIL_KEYWORDS)) {
    pushFeature(tags, 'daily_service_node', '日常配套支点', 0.76, '它承担的是日常生活补给与便民服务。')
  }

  if (hotspotLabel && trimText(input.name) && hotspotLabel.includes(trimText(input.name))) {
    pushFeature(tags, 'hotspot_anchor', '热点锚点', 0.81, '这个样本直接落在当前热点带上。')
  }

  if (Number.isFinite(distanceM) && distanceM <= 220) {
    pushFeature(tags, 'core_ring_sample', '核心圈层样本', 0.69, '它靠近核心圈层，更能代表片区第一感知。')
  }

  return tags.sort((left, right) => right.score - left.score).slice(0, 4)
}

export function summarizePoiProfile(input: PoiProfileInput, tags: PoiFeatureTag[]) {
  const name = trimText(input.name) || '该样本'
  if (tags.length === 0) {
    return `${name}目前还没提炼出稳定的角色特征。`
  }
  return `${name}更像${tags.slice(0, 2).map((item) => item.label).join('、')}。`
}

export function buildPoiProfileTokens(tags: PoiFeatureTag[]) {
  return tags.map((tag) => `feature:${tag.key}`)
}

export function vectorizePoiProfileTokens(tokens: string[]) {
  return POI_PROFILE_VOCABULARY.map((term) => tokens.includes(term) ? 1 : 0)
}

export function buildPoiProfileInputFromEvidence(input: {
  item: EvidenceItem
  view: EvidenceView
}): PoiProfileInput {
  const surroundingCategories = (input.view.areaProfile?.dominantCategories || [])
    .slice(0, 3)
    .map((category) => category.label)

  return {
    name: input.item.name,
    categoryMain: input.item.categoryMain,
    categorySub: input.item.categorySub,
    distanceM: input.item.distance_m ?? null,
    areaSubject: input.view.areaSubject?.title || input.view.anchor.resolvedPlaceName,
    hotspotLabel: input.view.hotspots?.[0]?.label || null,
    surroundingCategories,
    aoiContext: input.view.aoiContext || [],
  }
}

export function buildRepresentativePoiProfile(input: {
  item: EvidenceItem
  featureTags: PoiFeatureTag[]
  summary: string
}): RepresentativePoiProfile {
  return {
    name: input.item.name,
    summary: input.summary,
    categoryMain: input.item.categoryMain,
    categorySub: input.item.categorySub,
    featureTags: input.featureTags,
  }
}
