import type { NarrativePoi, NarrativePoiBusinessCategoryProfile, NarrativePoiBusinessProfile, NarrativeRegion } from './contract.js'

const LOW_VALUE_CATEGORY_RE = /(商务住宅|住宅区|住宅|小区|宿舍|家属区|楼栋|单元|服务中心|售楼|营销中心|医院|医疗|卫生|党校|政府机构|道路附属设施|通行设施|室内设施|摩托车服务|汽车服务|汽车维修|汽车销售|汽车配件|公司企业|未分类)/u
const LOW_VALUE_SUB_CATEGORY_RE = /(停车场|出入口|入口|出口|门岗|门卫|公厕|厕所|卫生间|ATM|自动提款|收费站|站口|楼栋|宿舍|家属区|小区|社区服务|售楼|营销中心|维修|保养|加油站)/u
const LOW_VALUE_NAME_RE = /(停车场|出入口|入口|出口|门岗|门卫|公厕|厕所|卫生间|ATM|自动提款|宿舍|家属区|楼栋|小区|售楼|营销中心|服务中心|维修|保养)/u
const FOOD_SUB_RE = /(中餐|餐厅|饭店|火锅|烧烤|小吃|快餐|粉面|面馆|咖啡|茶|饮品|甜品|酒吧|宵夜|夜宵)/u
const RETAIL_SUB_RE = /(便利店|超市|商场|购物中心|购物广场|服装|鞋帽|珠宝|书店|市场|专卖|零售)/u
const LIFE_SUB_RE = /(生活服务|快递|洗衣|美容|美发|药店|照相|维修|便民)/u
const CULTURE_SUB_RE = /(图书馆|博物馆|美术馆|艺术馆|文化馆|剧院|书店|教育|培训|学校|学院)/u
const LEISURE_SUB_RE = /(公园|景区|健身|体育|影院|影城|游乐|休闲|茶馆|咖啡)/u

export function buildPoiBusinessProfile(region: Pick<NarrativeRegion, 'pois'>): NarrativePoiBusinessProfile | undefined {
  const pois = eligibleBusinessPois(region.pois)
  if (pois.length < 3) return undefined
  const mainTypes = rankCategoryProfiles(pois, (poi) => poi.category_main || '')
  const subTypes = rankCategoryProfiles(pois, (poi) => poi.category_sub || '')
  if (mainTypes.length === 0 && subTypes.length === 0) return undefined
  const topMain = mainTypes[0]
  const topSub = subTypes[0]
  const hasClearSignal = Boolean((topMain && (topMain.count >= 3 || topMain.share >= 0.34)) || (topSub && topSub.count >= 2))
  if (!hasClearSignal) return undefined
  const representativePlaces = representativePlacesForProfile(pois, mainTypes, subTypes)
  const summaryHint = buildSummaryHint(mainTypes.slice(0, 3), subTypes.slice(0, 3), pois.length)
  if (!summaryHint) return undefined
  return {
    sample_size: pois.length,
    dominant_main_types: mainTypes.slice(0, 3),
    dominant_sub_types: subTypes.slice(0, 4),
    representative_places: representativePlaces,
    summary_hint: summaryHint,
    confidence: profileConfidence(pois.length, topMain?.share || 0, topSub?.count || 0),
  }
}

export function businessProfileFactClaim(regionName: string, profile: NarrativePoiBusinessProfile | undefined): string | undefined {
  if (!profile) return undefined
  return `${regionName}的地图点位里，${profile.summary_hint}`
}

function eligibleBusinessPois(pois: NarrativePoi[]): NarrativePoi[] {
  const byId = new Map<string, NarrativePoi>()
  for (const poi of pois) {
    if (!isEligibleBusinessPoi(poi)) continue
    if (!byId.has(poi.id)) byId.set(poi.id, poi)
  }
  return [...byId.values()]
}

function isEligibleBusinessPoi(poi: NarrativePoi): boolean {
  if (poi.tier !== 'core' && poi.tier !== 'strong' && poi.tier !== 'medium') return false
  const categoryMain = poi.category_main || ''
  const categorySub = poi.category_sub || ''
  const text = `${poi.display_name} ${categoryMain} ${categorySub}`
  if (!categoryMain || LOW_VALUE_CATEGORY_RE.test(categoryMain)) return false
  if (LOW_VALUE_SUB_CATEGORY_RE.test(categorySub) || LOW_VALUE_NAME_RE.test(text)) return false
  return true
}

function rankCategoryProfiles(pois: NarrativePoi[], readCategory: (poi: NarrativePoi) => string): NarrativePoiBusinessCategoryProfile[] {
  const buckets = new Map<string, { count: number; examples: string[] }>()
  for (const poi of pois) {
    const category = normalizeCategoryName(readCategory(poi))
    if (!category) continue
    const bucket = buckets.get(category) || { count: 0, examples: [] }
    bucket.count += 1
    if (bucket.examples.length < 3 && poi.display_name) bucket.examples.push(poi.display_name)
    buckets.set(category, bucket)
  }
  return [...buckets.entries()]
    .map(([name, bucket]) => ({
      name,
      count: bucket.count,
      share: Number((bucket.count / Math.max(pois.length, 1)).toFixed(3)),
      examples: bucket.examples,
    }))
    .filter((item) => item.count >= 2 || item.share >= 0.18)
    .sort((left, right) => right.count - left.count || right.share - left.share || left.name.localeCompare(right.name, 'zh-CN'))
}

function normalizeCategoryName(value: string): string {
  const category = value.trim()
  if (!category) return ''
  if (LOW_VALUE_CATEGORY_RE.test(category) || LOW_VALUE_SUB_CATEGORY_RE.test(category)) return ''
  return category
}

function representativePlacesForProfile(
  pois: NarrativePoi[],
  mainTypes: NarrativePoiBusinessCategoryProfile[],
  subTypes: NarrativePoiBusinessCategoryProfile[],
): string[] {
  const preferred = new Set([...mainTypes.slice(0, 2).map((item) => item.name), ...subTypes.slice(0, 3).map((item) => item.name)])
  const names: string[] = []
  for (const poi of pois) {
    if (!preferred.has(poi.category_main || '') && !preferred.has(poi.category_sub || '')) continue
    if (!names.includes(poi.display_name)) names.push(poi.display_name)
    if (names.length >= 5) break
  }
  return names
}

function buildSummaryHint(
  mainTypes: NarrativePoiBusinessCategoryProfile[],
  subTypes: NarrativePoiBusinessCategoryProfile[],
  sampleSize: number,
): string {
  const namedTypes = [...subTypes.map((item) => item.name), ...mainTypes.map((item) => item.name)]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 3)
  if (namedTypes.length === 0) return ''
  const flavor = inferBusinessFlavor(namedTypes.join(' '))
  const prefix = sampleSize >= 12 ? '能看出' : '能看出一点'
  if (flavor) return `${prefix}${namedTypes.join('、')}更集中，${flavor}`
  return `${prefix}${namedTypes.join('、')}这几类业态更集中。`
}

function inferBusinessFlavor(text: string): string {
  if (FOOD_SUB_RE.test(text)) return '吃饭、小吃和日常消费的气息更明显。'
  if (RETAIL_SUB_RE.test(text)) return '逛街、补给和街面消费的线索更明显。'
  if (LIFE_SUB_RE.test(text)) return '更像周边居民和通勤人群会顺手使用的生活配套。'
  if (CULTURE_SUB_RE.test(text)) return '学习、文化和日常停留的线索更明显。'
  if (LEISURE_SUB_RE.test(text)) return '休闲停留和慢慢逛的属性更明显。'
  return ''
}

function profileConfidence(sampleSize: number, topMainShare: number, topSubCount: number): NarrativePoiBusinessProfile['confidence'] {
  if (sampleSize >= 12 && (topMainShare >= 0.45 || topSubCount >= 4)) return 'high'
  if (sampleSize >= 6 || topMainShare >= 0.34 || topSubCount >= 3) return 'medium'
  return 'low'
}
