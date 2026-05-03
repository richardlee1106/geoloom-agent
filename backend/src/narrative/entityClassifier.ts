import { classifyRepresentativeAnchorType } from '../evidence/areaInsight/representativeAnchorPriority.js'
import type { NarrativeRoleInternal, VisualTier } from './contract.js'

export interface NarrativeEntityClassificationInput {
  name?: unknown
  categoryMain?: unknown
  categorySub?: unknown
  fclass?: unknown
  areaSqm?: unknown
  brandChainCount?: unknown
  supportCount?: unknown
  isAoiEntity?: boolean
}

export interface NarrativeEntityClassification {
  role: NarrativeRoleInternal
  tier: VisualTier
  mainChainEligible: boolean
  representative: boolean
  reason: string
}

const PLACEHOLDER_NAME_RE = /^(none|null|undefined|nan|未命名|未命名地点|未知|未知地点)$/iu
const AMBIGUOUS_FRAGMENT_NAME_RE = /^(?:武汉)?(?:和平|团结)$/u
const PARTY_SCHOOL_RE = /(党校|干部学院|行政学院|社会主义学院)/u
const HOSPITAL_EXCLUDE_RE = /(医院|医学院|医学部|医疗|附属医院|中心医院|人民医院|卫生院|诊所|门诊|卫生服务中心|协和|同济|省医|市医|hospital|medical|clinic|healthcare)/iu
const CAMPUS_INTERNAL_FACILITY_RE = /(大学|学院|校区|校园).{0,24}(图书馆|体育馆|体育场|操场|运动场|教学楼|实验室|行政楼|校史馆|礼堂|活动中心|学生中心|文化中心)/u
const MICRO_FACILITY_RE = /(宿舍|公寓|家属区|住宅小区|小区|楼栋|\d+号楼|\d+栋|门岗|门卫|停车场|收费亭|收费站|出入口|入口|出口|ATM|自动取款|公厕|厕所|卫生间|快递柜|服务中心|管理处|物业|后勤|保卫处|食堂|校医院)/u
const BASIC_EDU_RE = /(小学|中学|初中|高中|幼儿园|附中|附小|托儿所)/u
const RELIGIOUS_EDU_RE = /(神学院|佛学院|道学院|修道院|修院|神哲学院)/u
const GENERIC_CATEGORY_RE = /^(公共设施|公共类|生活服务|购物服务|餐饮美食|餐饮服务|住宿服务|商务住宅|住宅区|公司企业|道路附属设施|室内设施|通行设施|未分类)$/u
const CHAIN_BRANCH_RE = /(\(|（)[^()（）]{0,24}(店|分店|门店|专柜|柜台|营业厅)[^()（）]{0,24}(\)|）)|(?:^|[^大])分店$|门店$|专柜$|柜台$/u
const UNIVERSITY_RE = /(大学|学院|校区|校园|university|college|campus)/iu
const SUPPORT_EDU_RE = /(研究院|研究所|图书馆|博物馆|纪念馆|文化馆|艺术馆|美术馆|科技馆|展览馆|文化中心)/u
const SCENIC_RE = /(公园|景区|景点|风景区|名胜|古迹|旅游区|湿地|湖|山|江滩|博物馆|纪念馆)/u
const COMMERCIAL_COMPLEX_RE = /(购物中心|购物广场|商业广场|商业街|步行街|商场|天地|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|K11|SKP|mall|plaza)/iu
const LANDMARK_RE = /(楼|塔|桥|广场|地标|车站|火车站|高铁站|地铁站|客运站|机场|码头)/u
const MEDICAL_RE = /(医院|医学院|医学部|附属医院|中心医院|人民医院|协和|同济|省医|市医|hospital|medical)/iu
const MAJOR_TRANSPORT_RE = /(火车站|高铁站|客运站|机场|码头|轮渡|港口)/u
const LOCAL_TRANSIT_RE = /(地铁站|地铁口|站口|公交站|公交车站|公交站点|公交线路|公交枢纽)/u

function text(value: unknown): string {
  return String(value || '').trim()
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function combinedText(input: NarrativeEntityClassificationInput): string {
  return [input.name, input.categoryMain, input.categorySub, input.fclass]
    .map(text)
    .filter(Boolean)
    .join(' ')
}

function hasStableArea(input: NarrativeEntityClassificationInput): boolean {
  return Boolean(input.isAoiEntity) || numberValue(input.areaSqm) >= 5000
}

function hasClusterSupport(input: NarrativeEntityClassificationInput): boolean {
  return numberValue(input.supportCount) >= 2
}

function isSingleChainBranch(input: NarrativeEntityClassificationInput, raw: string): boolean {
  if (numberValue(input.brandChainCount) > 1) return false
  return CHAIN_BRANCH_RE.test(raw)
}

function result(
  role: NarrativeRoleInternal,
  tier: VisualTier,
  mainChainEligible: boolean,
  representative: boolean,
  reason: string,
): NarrativeEntityClassification {
  return { role, tier, mainChainEligible, representative, reason }
}

export function classifyNarrativeEntity(input: NarrativeEntityClassificationInput): NarrativeEntityClassification {
  const raw = combinedText(input)
  const name = text(input.name)
  const categoryMain = text(input.categoryMain)
  const categorySub = text(input.categorySub)
  const anchorType = classifyRepresentativeAnchorType({
    name,
    fclass: input.fclass,
    categoryMain,
    categorySub,
    allowNameFallback: true,
  })

  if (!name) return result('noise', 'excluded', false, false, 'empty_name')
  if (PLACEHOLDER_NAME_RE.test(name)) return result('noise', 'excluded', false, false, 'placeholder_name')
  if (AMBIGUOUS_FRAGMENT_NAME_RE.test(name)) return result('noise', 'excluded', false, false, 'ambiguous_fragment_name')
  if (PARTY_SCHOOL_RE.test(raw)) return result('noise', 'excluded', false, false, 'party_school_excluded')
  if (HOSPITAL_EXCLUDE_RE.test(raw)) return result('noise', 'excluded', false, false, 'hospital_excluded')
  if (MICRO_FACILITY_RE.test(raw)) return result('micro_facility', 'excluded', false, false, 'micro_facility')
  if (CAMPUS_INTERNAL_FACILITY_RE.test(raw)) return result('scene_evidence', 'medium', false, false, 'campus_internal_facility')
  if (BASIC_EDU_RE.test(raw)) return result('scene_evidence', 'medium', false, false, 'basic_education')
  if (RELIGIOUS_EDU_RE.test(raw)) return result('scene_evidence', 'medium', false, false, 'religious_education')
  if (isSingleChainBranch(input, raw)) return result('background_ecology', 'medium', false, false, 'single_chain_branch')

  if (hasStableArea(input)) {
    if (anchorType === 'campus' && UNIVERSITY_RE.test(raw)) return result('primary_region', 'core', true, true, 'large_campus_aoi')
    if (anchorType === 'scenic' && SCENIC_RE.test(raw)) return result('primary_region', 'core', true, true, 'large_scenic_aoi')
    if (anchorType === 'commercial' && COMMERCIAL_COMPLEX_RE.test(raw)) return result('primary_region', 'core', true, true, 'large_commercial_aoi')
    if (anchorType === 'medical' && MEDICAL_RE.test(raw)) return result('primary_region', 'core', true, true, 'large_medical_aoi')
  }

  if (GENERIC_CATEGORY_RE.test(name) || GENERIC_CATEGORY_RE.test(categoryMain)) return result('background_ecology', 'weak', false, false, 'generic_category')
  if (LOCAL_TRANSIT_RE.test(raw) || (categoryMain === '交通设施服务' && !MAJOR_TRANSPORT_RE.test(raw))) return result('background_ecology', 'weak', false, false, 'local_transit_access')

  if (anchorType === 'campus' && UNIVERSITY_RE.test(raw)) return result('support_region', 'strong', true, true, 'campus_support')
  if (anchorType === 'scenic' && SCENIC_RE.test(raw)) return result('landmark_anchor', 'strong', true, true, 'scenic_landmark')
  if (anchorType === 'medical' && MEDICAL_RE.test(raw)) return result('support_region', 'strong', true, true, 'medical_support')
  if (anchorType === 'commercial' && COMMERCIAL_COMPLEX_RE.test(raw) && hasClusterSupport(input)) return result('support_region', 'strong', true, true, 'commercial_cluster_support')
  if (anchorType === 'station' || LANDMARK_RE.test(raw)) return result('landmark_anchor', 'strong', true, true, 'landmark_anchor')
  if (SUPPORT_EDU_RE.test(raw)) return result('scene_evidence', 'medium', false, false, 'scene_evidence')
  if (/(餐饮|咖啡|书店|商店|购物|酒店|住宿|休闲|娱乐|生活)/u.test(raw)) return result('background_ecology', 'weak', false, false, 'background_ecology')

  return result('background_ecology', 'weak', false, false, 'default_background')
}
