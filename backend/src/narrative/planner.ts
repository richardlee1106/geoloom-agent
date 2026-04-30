// @ts-nocheck
//
// 该文件是 v3 narrative 系统的旧实现，依赖的 ./gcj02.js / ./nameAlias.js
// 等 helper 已在前一轮清理中删除，因此 TS 编译失败。
//
// 当前状态：纯死代码，整个 backend/src 没有任何文件 import 本模块。
// 与同目录 NarrativeRuntime.ts 保持一致策略：加 @ts-nocheck 跳过类型检查，
// 保留代码作为「阶段 3 narrative 算法重建」的判定词典参考素材
//（CIVIC / CULTURE / RELIGION / MEDICAL / RESIDENTIAL 等正则与角色映射）。
//
// 阶段 3 真正动后端时，需要按 docs/plans/2026-04-29-narrative-engine-rebuild-spec.md
// §1 叙事对象分级与 §4 区域候选规范，重新设计文件结构后再决定哪些代码保留。
//
import type { EvidenceItem, RegionFeatureTag } from '../chat/types.js'
import { classifyRepresentativeAnchorType } from '../evidence/areaInsight/representativeAnchorPriority.js'
import type {
  NarrativeMacroRegionName,
  NarrativeMacroRegionProfile,
  NarrativeRegionCluster,
  NarrativeMacroSpatialForm,
  NarrativeNode,
  NarrativeNodeBoundary,
  NarrativeRelevanceField,
  NarrativeRenderMode,
  NarrativeScaleLevel,
  NarrativeNodeTier,
  NarrativeReasonCard,
  NarrativeTourStep,
  NarrativeTourStyle,
  NarrativeTourTransition,
  NarrativeViewportSummary,
} from './types.js'
import {
  transformGeoJsonCoordinatesWgs84ToGcj02,
  wgs84ToGcj02,
} from './gcj02.js'
import {
  hasCommercialAdminPrefixAlias,
  normalizeCommercialEntityAlias,
} from './nameAlias.js'

/**
 * Name 关键字词典：OSM landuse fclass 常把政府/党政/法院/学校等随手标为 `commercial`，
 * 导致“中共湖北省委员会”这类 POI 被推断成 commercial_anchor 、roleLabel 写成“商业街区”。
 * 用 name 词典在 classifyRepresentativeAnchorType 之前提前拦截，把 role 切到专属锪点。
 */
const CIVIC_NAME_PATTERN = /(党委|党政|人民政府|市政府|区政府|县政府|镇政府|街道办事处|街道办|人民代表大会|政协|党校|新闻办公室|公安(?:分?局)|派出所|消防(?:局|大队)|人民法院|人民检察院|法院|检察院|司法局|纪委|监委|管理委员会|政务服务中心|党群服务中心|社会保障局|民政局|税务局|交通局|规划局|教育局|卫生健康委员会|卫健委|中共.{0,8}委员会|中共.{0,8}省委|中共.{0,8}市委|中共.{0,8}区委)/u

const CULTURE_NAME_PATTERN = /(博物馆|纪念馆|展览馆|文化馆|艺术馆|美术馆|图书馆|科技馆|规划馆|展览中心|剧院|大剧院|音乐厅|文化中心|文化广场|文化城|遗址公园|文保单位|文物)/u

const RELIGION_NAME_PATTERN = /(寺(?:院)?|庙|神社|教堂|道观|清真寺|清真堂|佛堂|禅寺|归元寺|宝通寺|神学院|佛学院|道学院|修道院|修院|神哲学院)/u

const MEDICAL_NAME_PATTERN = /(医学院|医学部|临床学院|护理学院|药学院|公共卫生学院|口腔医学院|口腔医院|附属医院|附属.*医院|人民医院|中医院|妇幼保健院|急救中心|疾控中心|卫生院|社区卫生服务中心|医院(?:总部|分院|门诊部)?|门诊部|防疫站)/u

const CONTINUING_EDUCATION_NAME_PATTERN = /(老年大学|开放大学|社区学院|老年学校|社区教育中心|继续教育学院)/u

const COMMERCIAL_COMPLEX_PATTERN = /(步行街|商业街|购物中心|购物广场|商业广场|商场|天地|汉街|奥特莱斯|奥莱|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城)/iu
const STRONG_COMMERCIAL_COMPLEX_PATTERN = /(购物中心|购物广场|商业综合体|商场|汉街|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城)/iu
const RESIDENTIAL_COMPOUND_PATTERN = /(小区|家属区|家属院|社区|住宅区|居民区|生活区|新村|宿舍区|公寓(?:楼|区)?|(?:佳苑|家园|雅苑|华府|名苑|嘉园|豪庭|花园)(?:东区|西区|南区|北区|一区|二区|三区|四区|一期|二期|三期|四期)?$)/u
const RESIDENTIAL_SEMANTIC_PATTERN = /(商务住宅|住宅区|居民住宅|居住小区|居住社区|公寓住宅|住宅|residential|apartment|compound)/iu
const SYNTHETIC_DISTRICT_CONCEPT_PATTERN = /(商圈|片区|区域|地带)$/u

/** OSM landuse fclass 英文代码 → 中文可读名。外补会在 zhFriendlyCategory 中基于 name 关键字覆写。*/
const OSM_FCLASS_ZH: Record<string, string> = {
  commercial: '商业用地',
  residential: '居住社区',
  industrial: '工业用地',
  retail: '零售地块',
  park: '公园绿地',
  forest: '林地',
  farmland: '农田',
  meadow: '草地',
  grass: '绿地',
  scrub: '灌木地',
  orchard: '果园',
  cemetery: '陵园',
  recreation_ground: '活动场地',
  allotments: '菜地',
  heath: '灌木地',
  quarry: '采石场',
  military: '军事管理区',
  reservoir: '水库',
  basin: '泄洪区',
  water: '水体',
  nature_reserve: '自然保护区',
  village_green: '社区绿地',
  university: '高校用地',
  college: '高校用地',
  school: '教育用地',
}

const TOUR_STYLE_LABELS: Record<NarrativeTourStyle, string> = {
  classic_must_see: '快速了解',
  local_vibe: '本地人版本',
  business_leisure: '商业休闲',
  humanities_walk: '人文慢走',
}

const TIER_LABELS: Record<NarrativeNodeTier, string> = {
  must_see: '必讲',
  optional: '可补充',
  entry: '入口节点',
  local_pick: '本地人会提',
  background: '背景节点',
}

export function resolveNarrativeTourStyle(value: unknown): NarrativeTourStyle {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'local_vibe' || normalized === 'local') return 'local_vibe'
  if (normalized === 'business_leisure' || normalized === 'business') return 'business_leisure'
  if (normalized === 'humanities_walk' || normalized === 'humanities') return 'humanities_walk'
  return 'classic_must_see'
}

export function resolveNarrativeTourStyleLabel(style: NarrativeTourStyle): string {
  return TOUR_STYLE_LABELS[style] || TOUR_STYLE_LABELS.classic_must_see
}

export function resolveNodeTierLabel(tier: NarrativeNodeTier | null | undefined): string {
  if (!tier) return TIER_LABELS.optional
  return TIER_LABELS[tier] || TIER_LABELS.optional
}

export function resolveScaleLevelNodeLimit(scaleLevel: NarrativeScaleLevel): number {
  if (scaleLevel === 'macro') return 8
  if (scaleLevel === 'meso') return 14
  return 10
}

export function resolveNarrativeRenderMode(scaleLevel: NarrativeScaleLevel): NarrativeRenderMode {
  if (scaleLevel === 'micro') return 'hybrid'
  return 'fluorescent_field'
}

/**
 * 从 name 词典推断专属锪点 role；命中则覆盖 fclass 级分类，避免政务/文化被当成 commercial。
 * 返回 null 表示 name 未命中任何专属锪点，由调用方继续走 fclass / anchor type 原逻辑。
 */
export function resolveRoleFromCivicName(name: string): string | null {
  if (!name) return null
  if (MEDICAL_NAME_PATTERN.test(name)) return 'medical_anchor'
  if (CIVIC_NAME_PATTERN.test(name)) return 'civic_anchor'
  if (CONTINUING_EDUCATION_NAME_PATTERN.test(name)) return 'culture_anchor'
  if (CULTURE_NAME_PATTERN.test(name)) return 'culture_anchor'
  if (RELIGION_NAME_PATTERN.test(name)) return 'religious_anchor'
  return null
}

/**
 * 把节点的原始 category（可能是 OSM 英文 fclass）转成前端可读的中文。
 * 优先级：name 关键字 → OSM_FCLASS_ZH 字典 → 中文原值 → roleLabel 兆底
 * ——注意：只用于 voice_text / 用户展示，不替换 node.categorySub 存储。
 */
export function zhFriendlyCategory(node: NarrativeNode): string {
  const name = String(node.name || '')
  if (CIVIC_NAME_PATTERN.test(name)) return '政务办公区'
  if (CONTINUING_EDUCATION_NAME_PATTERN.test(name)) return '终身教育'
  if (CULTURE_NAME_PATTERN.test(name)) return '文化场馆'
  if (RELIGION_NAME_PATTERN.test(name)) return '宗教场所'
  if (MEDICAL_NAME_PATTERN.test(name)) return '医疗配套'
  const raw = String(node.categorySub || node.categoryMain || '').trim().toLowerCase()
  if (raw && OSM_FCLASS_ZH[raw]) return OSM_FCLASS_ZH[raw]
  if (raw && /[\u4e00-\u9fff]/u.test(raw)) return raw
  return node.roleLabel || '区域实体'
}

/** 与 NarrativeRuntime 保持一致的 WGS84 边界源集合。 */
const WGS84_BOUNDARY_SOURCES = new Set<NarrativeNodeBoundary['source']>([
  'aoi_native',
  'landuse_parcel',
  'road_block',
  'concave_hull',
  'buffer',
])

/**
 * 解析 PostGIS ST_AsGeoJSON 字符串为节点模糊边界。
 * 与 NarrativeRuntime 里同名函数保持一致实现，便于纯函数场景使用。
 * 对 WGS84 来源自动做 GCJ02 转换，使后端 narrative 输出统一为 GCJ02。
 */
function parseBoundaryGeoJsonFromRow(
  value: unknown,
  source: NarrativeNodeBoundary['source'] = 'aoi_native',
): NarrativeNodeBoundary | null {
  if (!value) return null
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw === 'null') return null
  try {
    const parsed = JSON.parse(raw) as { type?: string, coordinates?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    const type = String(parsed.type || '')
    if (type !== 'Polygon' && type !== 'MultiPolygon') return null
    if (!Array.isArray(parsed.coordinates) || parsed.coordinates.length === 0) return null
    const normalizedCoordinates = WGS84_BOUNDARY_SOURCES.has(source)
      ? transformGeoJsonCoordinatesWgs84ToGcj02(parsed.coordinates)
      : parsed.coordinates
    return {
      type: type as NarrativeNodeBoundary['type'],
      coordinates: normalizedCoordinates as NarrativeNodeBoundary['coordinates'],
      source,
    }
  } catch {
    return null
  }
}

export function normalizeName(value: unknown) {
  return String(value || '').trim()
}

function isContinuingEducationName(name: string) {
  return CONTINUING_EDUCATION_NAME_PATTERN.test(normalizeName(name))
}

function isReligiousEducationName(name: string) {
  return RELIGION_NAME_PATTERN.test(normalizeName(name))
}

function isUniversityCampusName(name: string) {
  const text = normalizeName(name)
  return (/(大学|学院)/u.test(text) || /(university|college)/iu.test(text))
    && !isContinuingEducationName(text)
    && !isReligiousEducationName(text)
    && !isResidentialCompoundName(text)
    && !/(小学|中学|幼儿园|附小|附中|实验学校|九年一贯制|国际学校|职业学院|职业技术学院|职业大学|职业学校|职业技术学校|高等专科学校|专科学校|高职|中专|中等专业学校|技师学院|技工学校)/u.test(text)
}

function isBasicEducationName(name: string) {
  const text = normalizeName(name)
  return /(小学|中学|幼儿园|附小|附中|实验学校|国际学校|九年一贯制|学校)/u.test(text)
    && !isUniversityCampusName(text)
}

function isVocationalEducationName(name: string) {
  const text = normalizeName(name)
  return /(职业学院|职业技术学院|职业大学|职业学校|职业技术学校|高等专科学校|专科学校|高职|中专|中等专业学校|技师学院|技工学校)/u.test(text)
}

function isGenericCategoryName(name: string) {
  const text = normalizeName(name)
  return /^(公共类|餐饮类|购物类|住宿类|交通类|教育类|景观类|公共服务|生活服务|购物服务|餐饮服务|住宿服务|交通设施服务|公共设施|公司企业|商务住宅|住宅区|教育培训|教育服务|科教文化服务|风景名胜|地名地址信息|医疗保健服务|政府机构及社会团体|金融保险服务|体育休闲服务)$/u.test(text)
    || /^[\u4e00-\u9fa5]{2,6}类$/u.test(text)
}

function isSyntheticDistrictConceptName(name: string) {
  const text = normalizeName(name).replace(/\s+/gu, '')
  if (!text) return false
  return SYNTHETIC_DISTRICT_CONCEPT_PATTERN.test(text)
}

function isMicroFacilityName(name: string) {
  const text = normalizeName(name)
  return /(宿舍|学生公寓|公寓[A-Z0-9一二三四五六七八九十]*栋|[A-Z0-9一二三四五六七八九十]+栋|楼栋|教学楼|实验楼|食堂|便利店|驿站|快递站|菜鸟|停车场|门岗|门卫|出入口|入口|出口|东门|西门|南门|北门|厕所|卫生间|店\)|店$|分店$)/u.test(text)
    || /(大学|学院|校区).*(图书馆|体育馆|教学楼|实验楼|行政楼|食堂|宿舍|学生公寓|便利店|快递站|驿站)/u.test(text)
    || /([一二三四五六七八九十0-9]+号场|体育场|训练场|篮球场|足球场|网球场|羽毛球场|排球场|乒乓球场)$/u.test(text)
    || /(蔬菜批发|批发夜市|批发市场|农贸市场|菜市场|水果批发|果批|海鲜市场|水产市场|建材市场|汽配城)/u.test(text)
}

function isResidentialCompoundName(name: string) {
  const text = normalizeName(name)
  return RESIDENTIAL_COMPOUND_PATTERN.test(text)
}

function isResidentialSemanticNode(node: NarrativeNode) {
  const text = [
    normalizeName(node.name),
    String(node.categoryMain || '').trim(),
    String(node.categorySub || '').trim(),
    String(node.roleLabel || '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
  return isResidentialCompoundName(node.name) || RESIDENTIAL_SEMANTIC_PATTERN.test(text)
}

function isSupportFacilityName(name: string) {
  const text = normalizeName(name)
  return /(线网管理服务中心|管理服务中心|管理中心|运营中心|客服中心|接待中心|服务大厅|服务站|游客中心|售票处|调度中心|指挥中心)/u.test(text)
}

function isIndependentMedicalAcademicName(name: string) {
  const text = normalizeName(name)
  return /(医学院|医学部|临床学院|护理学院|药学院|公共卫生学院|口腔医学院|口腔医院|附属医院|附属.*医院)/u.test(text)
}

function extractAcademicBrand(name: string) {
  const text = normalizeName(name)
  if (!text) return ''
  const match = text.match(/^(.{2,16}?(?:大学|学院))/u)
  if (!match) return ''
  const brand = normalizeName(match[1])
  if (!brand) return ''
  if (isContinuingEducationName(brand) || isReligiousEducationName(brand)) return ''
  return brand
}

function sharesAcademicBrand(left: NarrativeNode, right: NarrativeNode) {
  const leftBrand = extractAcademicBrand(left.name)
  const rightBrand = extractAcademicBrand(right.name)
  return Boolean(leftBrand && rightBrand && leftBrand === rightBrand)
}

function hasRepresentativeClusterSupport(node: NarrativeNode) {
  return node.source === 'aoi_context'
    || (node.childPoiIds?.length || 0) >= 2
    || Boolean(node.encoderSummary)
}

function passesRepresentativeEntityStandard(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const name = normalizeName(node.name)
  if (!name) return false
  if (isSyntheticDistrictConceptName(name)) return false
  if (isGenericCategoryName(name)) return false
  if (isMicroFacilityName(name)) return false
  if (isResidentialSemanticNode(node)) return false
  if (isSupportFacilityName(name) && node.role !== 'civic_anchor' && node.role !== 'medical_anchor') return false
  if (isBasicEducationName(name) || isVocationalEducationName(name)) return false
  if (node.role === 'campus_anchor' && isIndependentMedicalAcademicName(name)) return false
  if (node.role === 'campus_anchor' && !isUniversityCampusName(name)) return false
  if (node.role === 'local_life_anchor' && !hasRepresentativeClusterSupport(node)) return false
  if (isSingletonBrandCluster(node) && !hasStableRepresentativeSupport(node)) {
    if (node.role !== 'commercial_anchor') return false
    if (!hasStrongCommercialComplexSignal(node)) return false
  }
  return true
}

function haversine(left: { lon: number, lat: number }, right: { lon: number, lat: number }) {
  const dLat = (right.lat - left.lat) * Math.PI / 180
  const dLon = (right.lon - left.lon) * Math.PI / 180
  const lat1 = left.lat * Math.PI / 180
  const lat2 = right.lat * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function buildComparableEntityKey(node: NarrativeNode) {
  const rawCompact = normalizeName(node.name)
    .replace(/[（(][^（）()]{0,24}[）)]/gu, '')
    .replace(/\s+/gu, '')
    .trim()
  const compact = normalizeCommercialEntityAlias(rawCompact)
  if (!compact) return ''

  if (node.role === 'scenic_landmark' || /(湖|江|河|湿地|公园|景区|景点|风景区|旅游区)/u.test(`${compact} ${node.categorySub || ''}`)) {
    const scenicBase = compact.replace(/(湿地公园|森林公园|主题公园|国家公园|文化园|旅游区|风景区|景区|景点|公园)$/u, '')
    if (scenicBase && scenicBase.length >= 2) return `scenic:${scenicBase.toLowerCase()}`
  }

  if (node.role === 'commercial_anchor' || COMMERCIAL_COMPLEX_PATTERN.test(`${compact} ${node.categorySub || ''} ${node.categoryMain || ''}`)) {
    const commercialBase = compact.replace(/(步行街|商业街|购物中心|购物广场|商业广场|商场|天地|汉街|奥特莱斯|奥莱|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城)$/iu, '')
    if (commercialBase && commercialBase.length >= 4) return `commercial:${commercialBase.toLowerCase()}`
    return `commercial:${compact.toLowerCase()}`
  }

  if (node.role === 'transit_connector') {
    const stationBase = compact.replace(/(地铁站|地铁口|站口|换乘站)$/u, '')
    if (stationBase && stationBase.length >= 2) return `station:${stationBase.toLowerCase()}`
  }

  return `${node.role}:${compact.toLowerCase()}`
}

function resolveNarrativeDedupDistanceM(node: NarrativeNode, limit: number) {
  if (node.role === 'transit_connector') return limit >= 16 ? 80 : 110
  if (node.role === 'commercial_anchor' || node.role === 'food_street_anchor') return limit >= 16 ? 92 : 120
  if (node.role === 'scenic_landmark') return limit >= 16 ? 130 : 180
  if (node.role === 'campus_anchor' || node.role === 'medical_anchor') return limit >= 16 ? 145 : 200
  return limit >= 16 ? 96 : (limit >= 10 ? 140 : 220)
}

export function resolveRoleLabel(role: string) {
  if (role === 'scenic_landmark') return '景区地标'
  if (role === 'campus_anchor') return '高校锚点'
  if (role === 'medical_anchor') return '医疗配套'
  if (role === 'commercial_anchor') return '商业节点'
  if (role === 'food_street_anchor') return '小吃街区'
  if (role === 'transit_connector') return '交通节点'
  if (role === 'local_life_anchor') return '本地生活'
  if (role === 'civic_anchor') return '政务配套'
  if (role === 'culture_anchor') return '文化场馆'
  if (role === 'religious_anchor') return '宗教场所'
  if (role === 'district_anchor') return '区域代表'
  return '区域代表'
}

export function resolveRoleWeight(role: string) {
  if (role === 'scenic_landmark') return 0.96
  if (role === 'commercial_anchor') return 0.9
  if (role === 'food_street_anchor') return 0.86
  if (role === 'culture_anchor') return 0.84
  if (role === 'campus_anchor') return 0.82
  if (role === 'medical_anchor') return 0.78
  if (role === 'local_life_anchor') return 0.76
  if (role === 'civic_anchor') return 0.7
  if (role === 'religious_anchor') return 0.68
  if (role === 'transit_connector') return 0.68
  if (role === 'district_anchor') return 0.6
  return 0.6
}

export function resolveNodeRoleFromPoi(item: EvidenceItem) {
  // name 词典优先：政务/文化/宗教/医疗直接走专属锪点，避免 fclass 为 commercial 时被误分
  const civicRole = resolveRoleFromCivicName(String(item.name || ''))
  if (civicRole) return civicRole
  const anchorType = classifyRepresentativeAnchorType({
    name: item.name,
    categoryMain: item.categoryMain,
    categorySub: item.categorySub || item.category,
    allowNameFallback: true,
  })
  if (anchorType === 'scenic') return 'scenic_landmark'
  if (anchorType === 'medical') return 'medical_anchor'
  if (anchorType === 'campus') {
    return isUniversityCampusName(String(item.name || '')) ? 'campus_anchor' : 'district_anchor'
  }
  if (anchorType === 'commercial') return 'commercial_anchor'
  if (anchorType === 'station') return 'transit_connector'
  if (/(餐饮|生活服务|住宿服务|购物服务|便利店)/u.test(`${item.categoryMain || ''} ${item.categorySub || ''}`)) {
    return 'local_life_anchor'
  }
  return 'district_anchor'
}

export function resolveNodeRoleFromAoi(item: Record<string, unknown>) {
  const name = normalizeName(item.name)
  // name 词典优先：例如“中共湖北省委员会”被 OSM landuse 标为 commercial，先按名字关键字覆写
  const civicRole = resolveRoleFromCivicName(name)
  if (civicRole) return civicRole
  const anchorType = classifyRepresentativeAnchorType({
    name,
    fclass: String(item.fclass || '').trim() || null,
  })
  if (anchorType === 'scenic') return 'scenic_landmark'
  if (anchorType === 'medical') return 'medical_anchor'
  if (anchorType === 'campus') {
    const fclass = String(item.fclass || '').trim().toLowerCase()
    return !isVocationalEducationName(name) && (isUniversityCampusName(name) || fclass === 'university' || fclass === 'college')
      ? 'campus_anchor'
      : 'district_anchor'
  }
  if (anchorType === 'commercial') return 'commercial_anchor'
  if (anchorType === 'station') return 'transit_connector'
  return 'district_anchor'
}

function inferNodeSceneBucket(node: NarrativeNode) {
  // name 关键字优先：政务/文化/宗教 不该因 fclass=commercial 被杂进商业 bucket
  const name = String(node.name || '')
  if (CIVIC_NAME_PATTERN.test(name)) return '政务'
  if (CONTINUING_EDUCATION_NAME_PATTERN.test(name)) return '文化'
  if (CULTURE_NAME_PATTERN.test(name)) return '文化'
  if (RELIGION_NAME_PATTERN.test(name)) return '宗教'

  const text = [
    node.sceneBucket,
    node.encoderSummary,
    ...(node.encoderTags || []).map((item) => item.label),
    node.categoryMain,
    node.categorySub,
    node.roleLabel,
  ].filter(Boolean).join(' ')

  if (/(小吃街|美食街|夜市|food_street|street_food)/iu.test(text)) return '小吃'
  if (/(景观|景区|滨水|湖|公园|风景|scenic|park|water)/iu.test(text)) return '景观'
  if (/(博物馆|纪念馆|展览馆|文化馆|艺术馆|美术馆|图书馆|科技馆|museum|library)/iu.test(text)) return '文化'
  if (/(医疗|医院|医学院|附属|clinic|hospital|medical|healthcare)/iu.test(text)) return '医疗'
  if (/(校园|高校|大学|学院|education|campus)/iu.test(text)) return '校园'
  if (COMMERCIAL_COMPLEX_PATTERN.test(text) || /(商业|零售|购物|retail|commercial)/iu.test(text)) return '商业'
  if (/(生活|社区|居住|餐饮|配套|residential|daily|food)/iu.test(text)) return '生活'
  if (/(交通|地铁|公交|枢纽|station|transit)/iu.test(text)) return '交通'
  return '片区'
}

function matchesSceneBucket(sceneLabel: string, bucket: string) {
  if (bucket === '景观') return /景观|滨水|风景|公园/u.test(sceneLabel)
  if (bucket === '文化') return /文化|博物|纪念馆|展览|艺术/u.test(sceneLabel)
  if (bucket === '宗教') return /宗教|寺|庙|教堂/u.test(sceneLabel)
  if (bucket === '政务') return /政务|政府|委员会|党政/u.test(sceneLabel)
  if (bucket === '医疗') return /医疗|医院|卫生/u.test(sceneLabel)
  if (bucket === '校园') return /校园|高校/u.test(sceneLabel)
  if (bucket === '商业') return /商业/u.test(sceneLabel)
  if (bucket === '小吃') return /小吃|美食|烟火/u.test(sceneLabel)
  if (bucket === '生活') return /生活/u.test(sceneLabel)
  if (bucket === '交通') return /交通/u.test(sceneLabel)
  return sceneLabel.includes(bucket)
}

function resolveSceneBucketLead(bucket: string) {
  if (bucket === '景观') return '景观地标'
  if (bucket === '文化') return '文化人文'
  if (bucket === '宗教') return '宗教人文'
  if (bucket === '政务') return '政务办公'
  if (bucket === '医疗') return '医疗配套'
  if (bucket === '校园') return '校园人文'
  if (bucket === '商业') return '商业休闲'
  if (bucket === '小吃') return '街巷烟火'
  if (bucket === '生活') return '本地生活'
  if (bucket === '交通') return '交通接驳'
  return '区域综览'
}

function representativeSupportScore(node: NarrativeNode) {
  const childCount = node.childPoiIds?.length || 0
  const hasAoiSupport = (node.tags || []).some((tag) => tag === 'aoi_support')
  if (node.source === 'aoi_context') return 4
  if (hasAoiSupport) return 3.8
  if (node.source === 'brand_cluster' && childCount >= 2) return 3 + Math.min(childCount, 6) * 0.12
  if (node.source === 'brand_cluster') return 1.4
  if (node.source === 'cell_entity' && childCount >= 4) return 2
  if (node.source === 'cell_entity' && childCount >= 2) return 1.5
  if (childCount >= 4) return 1.8
  if (childCount >= 2) return 1.3
  return 1
}

function hasStableRepresentativeSupport(node: NarrativeNode) {
  return representativeSupportScore(node) >= 3
}

function isSingletonBrandCluster(node: NarrativeNode) {
  return node.source === 'brand_cluster' && (node.childPoiIds?.length || 0) <= 1
}

function hasStrongCommercialComplexSignal(node: NarrativeNode) {
  const text = [
    normalizeName(node.name),
    String(node.categoryMain || '').trim(),
    String(node.categorySub || '').trim(),
    String(node.encoderSummary || '').trim(),
    ...(node.encoderTags || []).map((item) => String(item.label || '').trim()),
  ]
    .filter(Boolean)
    .join(' ')
  return STRONG_COMMERCIAL_COMPLEX_PATTERN.test(text)
}

function resolveBucketOrder(mode: string, style: NarrativeTourStyle) {
  if (style === 'local_vibe') {
    return ['交通', '生活', '商业', '小吃', '文化', '景观', '校园', '医疗', '宗教', '政务', '片区']
  }
  if (style === 'business_leisure') {
    return ['商业', '交通', '景观', '文化', '小吃', '生活', '校园', '医疗', '宗教', '政务', '片区']
  }
  if (style === 'humanities_walk') {
    return ['文化', '宗教', '校园', '景观', '政务', '医疗', '生活', '商业', '小吃', '交通', '片区']
  }
  if (mode === 'campus_to_commerce') return ['景观', '文化', '宗教', '校园', '医疗', '商业', '小吃', '生活', '政务', '交通', '片区']
  if (mode === 'district_sweep') return ['景观', '商业', '文化', '校园', '生活', '小吃', '医疗', '宗教', '政务', '交通', '片区']
  return ['景观', '文化', '宗教', '校园', '商业', '小吃', '生活', '医疗', '政务', '交通', '片区']
}

function topEncoderTagScore(node: NarrativeNode) {
  const scores = (node.encoderTags || []).map((item) => Number(item.score || 0)).filter((item) => Number.isFinite(item))
  return scores.length > 0 ? Math.max(...scores) : 0
}

function buildSelectionReason(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const bucket = node.sceneBucket || inferNodeSceneBucket(node)
  const lead = resolveSceneBucketLead(bucket)
  const roleLabel = node.roleLabel || '区域代表'
  const supportCount = Math.max(node.childPoiIds?.length || 0, node.memberPoints?.length || 0)
  const factLabel = (node.webFacts?.labels || [])[0] || ''
  const factTail = factLabel ? `，还有“${factLabel}”这一层辨识度` : ''

  if (isContinuingEducationName(node.name)) {
    return `${node.name}更像片区气质里的温和底色，适合作为解释人文与终身教育的一笔补充。`
  }
  if (roleLabel === '景区地标') {
    if (/(江|湖|河|滩|湿地)/u.test(node.name)) {
      return `${node.name}适合放在前面讲，因为它先把这片区域的开阔感和空间边界定下来${factTail}。`
    }
    return `${node.name}适合当作这条线的视觉起点，一站到这里，这片区域的${lead}就清楚了${factTail}。`
  }
  if (roleLabel === '高校锚点') return `${node.name}把这片区域最稳定的人流来源托住了，周边不少节奏都是顺着它展开的。`
  if (roleLabel === '医疗配套') return `${node.name}让这片区域不只是校园或商业，还多出一层专业服务的重量。`
  if (roleLabel === '商业节点') return `${node.name}更适合单独展开，因为这里最能把逛街、吃饭、看电影和夜间停留的节奏讲具体。`
  if (roleLabel === '小吃街区') return `${node.name}最能把这片区域的烟火气拉近，不用铺陈太多，气氛自己就出来了。`
  if (roleLabel === '本地生活') return `${node.name}不一定最响亮，但最能把导览从地标拉回真实生活。`
  if (roleLabel === '交通节点') return `${node.name}适合拿来交代入口，因为人流怎么进、怎么散，往往要从这里讲顺。`
  if (roleLabel === '政务配套') return `${node.name}更像片区秩序感的一部分，能补足这里为什么显得稳、显得有组织。`
  if (roleLabel === '文化场馆') return `${node.name}能把导览从功能层往人文层抬一下，让这片区域不只是“能干什么”。`
  if (roleLabel === '宗教场所') return `${node.name}适合拿来压一压节奏，把这片区域更安静、更耐回味的一面带出来。`
  if (roleLabel === '区域代表') {
    if (supportCount >= 3) {
      return `${node.name}更像一块片区底板，讲它不是为了抢主角，而是为了把周边关系先安顿好。`
    }
    return `${node.name}适合放在后面补一句，帮你把这片区域的骨架讲完整。`
  }

  const topTag = (node.encoderTags || []).find((item) => Number(item.score || 0) >= 0.72)
  if (topTag?.label) {
    return `${node.name}值得被放进来，因为它把这片区域“${topTag.label}”这一层讲得最具体。`
  }
  return `${node.name}能补足这片区域的${lead}线索。`
}

function computeStyleBoost(node: NarrativeNode, style: NarrativeTourStyle) {
  const bucket = inferNodeSceneBucket(node)
  const strongCommercial = node.role === 'commercial_anchor' && hasStrongCommercialComplexSignal(node)
  if (style === 'local_vibe') {
    if (node.role === 'transit_connector') return 0.18
    if (node.role === 'local_life_anchor') return 0.16
    if (strongCommercial) return 0.14
    if (bucket === '商业') return 0.12
    if (bucket === '文化') return 0.06
    if (bucket === '景观') return -0.02
    return 0
  }
  if (style === 'business_leisure') {
    if (strongCommercial) return 0.24
    if (bucket === '商业') return 0.2
    if (node.role === 'transit_connector') return 0.12
    if (bucket === '景观') return 0.08
    if (bucket === '文化') return 0.05
    if (bucket === '医疗') return -0.04
    return 0
  }
  if (style === 'humanities_walk') {
    if (bucket === '文化' || bucket === '宗教') return 0.18
    if (bucket === '校园') return 0.12
    if (bucket === '景观') return 0.08
    if (bucket === '政务') return 0.04
    if (bucket === '商业') return -0.02
    return 0
  }
  if (strongCommercial) return 0.08
  if (bucket === '景观' || bucket === '校园') return 0.08
  if (bucket === '文化' || bucket === '医疗') return 0.05
  if (node.role === 'transit_connector') return 0.02
  return 0
}

function computeSpecificityPenalty(node: NarrativeNode, candidates: NarrativeNode[]) {
  if (node.role !== 'campus_anchor') return 0
  const brand = extractAcademicBrand(node.name)
  if (!brand) return 0
  const overshadowedByMedicalSubCampus = candidates.some((candidate) =>
    candidate.id !== node.id
      && candidate.role === 'medical_anchor'
      && sharesAcademicBrand(node, candidate)
      && haversine(candidate.center, node.center) <= 900,
  )
  return overshadowedByMedicalSubCampus ? 0.2 : 0
}

function computeNarrativeFit(
  node: NarrativeNode,
  summary: NarrativeViewportSummary,
  bucketOrder: string[],
  candidates: NarrativeNode[] = [],
) {
  const bucket = inferNodeSceneBucket(node)
  const bucketIndex = Math.max(bucketOrder.indexOf(bucket), 0)
  const bucketBoost = Math.max(0, 0.24 - bucketIndex * 0.04)
  const encoderBoost = Math.min(topEncoderTagScore(node), 1) * 0.2
  const summaryBoost = node.encoderSummary ? 0.1 : 0
  const sceneAlign = summary.sceneMix.some((item) => matchesSceneBucket(item, bucket)) ? 0.08 : 0
  const supportBoost = Math.min((representativeSupportScore(node) - 1) * 0.06, 0.22)
  const commercialBoost = node.role === 'commercial_anchor' && hasStrongCommercialComplexSignal(node) ? 0.08 : 0
  const singletonPenalty = isSingletonBrandCluster(node)
    ? (node.role === 'commercial_anchor' && hasStrongCommercialComplexSignal(node) ? 0.08 : 0.22)
    : 0
  const styleBoost = computeStyleBoost(node, summary.requestedStyle)
  const scaleBoost = computeScaleLevelBoost(node, summary)
  const specificityPenalty = computeSpecificityPenalty(node, candidates)
  const aliasPenalty = node.role === 'commercial_anchor' && hasCommercialAdminPrefixAlias(node.name) ? 0.16 : 0
  return Number((node.score + bucketBoost + encoderBoost + summaryBoost + sceneAlign + supportBoost + commercialBoost + styleBoost + scaleBoost - singletonPenalty - specificityPenalty - aliasPenalty).toFixed(3))
}

function computeScaleLevelBoost(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const scaleLevel = summary.scaleLevel || 'micro'
  if (scaleLevel === 'macro') {
    let boost = 0
    if (node.source === 'aoi_context') boost += 0.18
    if (node.role === 'district_anchor' || node.role === 'civic_anchor' || node.role === 'campus_anchor') boost += 0.08
    if (node.role === 'transit_connector') boost -= 0.08
    if ((node.source === 'representative_sample' || node.source === 'cell_entity') && !node.boundary) boost -= 0.06
    return boost
  }
  if (scaleLevel === 'meso') {
    let boost = 0
    if (node.source === 'brand_cluster') boost += 0.14
    if (node.source === 'cell_entity') boost += 0.04
    if (node.role === 'commercial_anchor' || node.role === 'campus_anchor' || node.role === 'district_anchor') boost += 0.06
    if (node.role === 'transit_connector') boost -= 0.04
    return boost
  }
  let boost = 0
  if (node.source === 'representative_sample') boost += 0.08
  if (node.source === 'cell_entity') boost += 0.03
  if (node.source === 'brand_cluster') boost -= 0.04
  if (node.role === 'district_anchor' || node.role === 'civic_anchor') boost -= 0.08
  return boost
}

function hasStrongSemanticSignal(node: NarrativeNode, summary: NarrativeViewportSummary) {
  if (hasStableRepresentativeSupport(node)) return true
  const topScore = topEncoderTagScore(node)
  const bucket = inferNodeSceneBucket(node)
  const sceneAlign = summary.sceneMix.some((item) => matchesSceneBucket(item, bucket))
  if (node.role === 'transit_connector') {
    return /(地铁站|换乘站|轨道交通|枢纽|站口)/u.test(node.name)
      && (Boolean(node.encoderSummary) || topScore >= 0.46 || representativeSupportScore(node) >= 1.3)
  }
  return Boolean(node.encoderSummary) || topScore >= 0.64 || (topScore >= 0.54 && sceneAlign)
}

function isGenericNarrativeNoise(node: NarrativeNode) {
  const text = `${node.name} ${node.categoryMain || ''} ${node.categorySub || ''} ${node.roleLabel || ''}`
  return /(停车场|停车楼|售票处|服务中心|游客中心|公共厕所|卫生间|菜鸟驿站|快递站|便利店|食堂|宿舍|住宅楼|门岗|校门|东门|西门|南门|北门|出入口|入口|出口|A口|B口|C口|D口|E口|F口)/u.test(text)
}

function computeNoiseRisk(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const topScore = topEncoderTagScore(node)
  const bucket = inferNodeSceneBucket(node)
  let risk = 0
  if (!passesRepresentativeEntityStandard(node, summary)) risk += 0.38
  if (!hasStrongSemanticSignal(node, summary)) risk += 0.22
  if (node.role === 'district_anchor') risk += 0.03
  if (node.role === 'local_life_anchor' && topScore < 0.58) risk += 0.06
  if (summary.sceneMix.includes('高校') && isBasicEducationName(node.name)) risk += 0.22
  if (isGenericCategoryName(node.name)) risk += 0.3
  if (isMicroFacilityName(node.name)) risk += 0.32
  if (isResidentialSemanticNode(node)) risk += 0.42
  if (isSupportFacilityName(node.name) && node.role !== 'civic_anchor' && node.role !== 'medical_anchor') risk += 0.28
  if (isContinuingEducationName(node.name) && bucket !== '文化') risk += 0.22
  if (node.role === 'local_life_anchor' && !hasRepresentativeClusterSupport(node)) risk += 0.12
  if (isSingletonBrandCluster(node) && !hasStableRepresentativeSupport(node) && !(node.role === 'commercial_anchor' && hasStrongCommercialComplexSignal(node))) {
    risk += 0.22
  }
  if (isGenericNarrativeNoise(node) && topScore < 0.76 && !node.encoderSummary) risk += 0.24
  if (normalizeName(node.name).length <= 4 && topScore < 0.68 && !node.encoderSummary) risk += 0.1
  if (bucket === '片区' && topScore < 0.6 && !node.encoderSummary) risk += 0.12
  return Number(risk.toFixed(3))
}

function isNarrativeEligible(node: NarrativeNode, summary: NarrativeViewportSummary) {
  if (!passesRepresentativeEntityStandard(node, summary)) {
    return false
  }
  if (node.role === 'scenic_landmark'
    || node.role === 'campus_anchor'
    || node.role === 'medical_anchor'
    || node.role === 'commercial_anchor'
    || node.role === 'transit_connector'
    || node.role === 'culture_anchor'
    || node.role === 'religious_anchor'
    || node.role === 'civic_anchor') {
    return computeNoiseRisk(node, summary) <= 0.42
  }
  return hasStrongSemanticSignal(node, summary) && computeNoiseRisk(node, summary) <= 0.38
}

const ROLE_MAX_CAP: Record<string, number> = {
  scenic_landmark: 9,
  campus_anchor: 4,
  medical_anchor: 2,
  commercial_anchor: 8,
  food_street_anchor: 4,
  local_life_anchor: 5,
  transit_connector: 4,
  culture_anchor: 4,
  religious_anchor: 3,
  civic_anchor: 3,
  district_anchor: 3,
}

const BUCKET_MAX_CAP: Record<string, number> = {
  景观: 9,
  文化: 4,
  宗教: 3,
  医疗: 2,
  校园: 4,
  商业: 8,
  小吃: 4,
  生活: 5,
  政务: 3,
  交通: 4,
  片区: 3,
}

const MIN_NARRATIVE_NODE_COUNT = 10

function canAppendNarrativeNode(selected: NarrativeNode[], candidate: NarrativeNode, limit: number) {
  if (candidate.cellId && selected.some((item) => item.cellId && item.cellId === candidate.cellId)) {
    return false
  }
  // 按 name 强去重，避免「湖北大学」与「湖北大学三期公寓」同时入选
  const candidateName = normalizeName(candidate.name)
  if (candidateName && selected.some((item) => normalizeName(item.name) === candidateName)) {
    return false
  }
  const comparableKey = buildComparableEntityKey(candidate)
  if (comparableKey && selected.some((item) => buildComparableEntityKey(item) === comparableKey)) {
    return false
  }
  const roleCounts = new Map<string, number>()
  const bucketCounts = new Map<string, number>()
  for (const item of selected) {
    roleCounts.set(item.role, (roleCounts.get(item.role) || 0) + 1)
    const bucket = inferNodeSceneBucket(item)
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
  }
  const roleCap = ROLE_MAX_CAP[candidate.role] ?? 2
  const roleCount = roleCounts.get(candidate.role) || 0
  if (roleCount >= roleCap) return false

  const bucket = inferNodeSceneBucket(candidate)
  const bucketCap = BUCKET_MAX_CAP[bucket] ?? 2
  const bucketCount = bucketCounts.get(bucket) || 0
  if (bucketCount >= bucketCap && selected.length < limit - 1) return false

  const dedupDistanceM = resolveNarrativeDedupDistanceM(candidate, limit)
  return !selected.some((item) => {
    const itemBucket = inferNodeSceneBucket(item)
    return haversine(item.center, candidate.center) < dedupDistanceM
      && (item.role === candidate.role || itemBucket === bucket)
  })
}

function isMeaningfullyBetterReplacement(
  current: NarrativeNode,
  candidate: NarrativeNode,
  summary: NarrativeViewportSummary,
  bucketOrder: string[],
  ranked: NarrativeNode[],
) {
  const currentRisk = computeNoiseRisk(current, summary)
  const candidateRisk = computeNoiseRisk(candidate, summary)
  const currentFit = computeNarrativeFit(current, summary, bucketOrder, ranked)
  const candidateFit = computeNarrativeFit(candidate, summary, bucketOrder, ranked)
  const supportDelta = representativeSupportScore(candidate) - representativeSupportScore(current)
  if (candidateRisk + 0.1 < currentRisk) return true
  if (supportDelta >= 1 && candidateFit >= currentFit - 0.04) return true
  return candidateFit > currentFit + 0.1
}

function reviewSelectedNodes(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  const revised = [...selected]
  const bucketOrder = resolveBucketOrder(resolveNarrativeMode(summary), summary.requestedStyle)
  for (let index = 0; index < revised.length; index += 1) {
    const current = revised[index]
    const currentRisk = computeNoiseRisk(current, summary)
    if (currentRisk < 0.34 && (hasStrongSemanticSignal(current, summary) || hasStableRepresentativeSupport(current))) continue
    const replacement = ranked.find((candidate) => {
      if (revised.some((item) => item.id === candidate.id)) return false
      if (!isNarrativeEligible(candidate, summary)) return false
      const trial = revised.filter((_, candidateIndex) => candidateIndex !== index)
      if (!canAppendNarrativeNode(trial, candidate, limit)) return false
      return isMeaningfullyBetterReplacement(current, candidate, summary, bucketOrder, ranked)
    })
    if (replacement) {
      revised[index] = replacement
    }
  }
  return revised
}

function backfillSelectedNodes(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  const revised = [...selected]
  for (const candidate of ranked) {
    if (revised.length >= limit) break
    if (revised.some((item) => item.id === candidate.id)) continue
    if (!passesRepresentativeEntityStandard(candidate, summary)) continue
    if (!canAppendNarrativeNode(revised, candidate, limit)) continue
    revised.push(candidate)
  }
  return revised
}

function passesMinimumCoverageCandidate(candidate: NarrativeNode, summary: NarrativeViewportSummary) {
  const name = normalizeName(candidate.name)
  if (!name) return false
  if (!passesRepresentativeEntityStandard(candidate, summary)) return false
  if (isVocationalEducationName(name) || isBasicEducationName(name)) return false
  if (isResidentialSemanticNode(candidate) || isMicroFacilityName(name)) return false
  if (computeNoiseRisk(candidate, summary) > 0.56) return false
  return hasStrongSemanticSignal(candidate, summary)
    || representativeSupportScore(candidate) >= 1.3
    || candidate.role === 'commercial_anchor'
    || candidate.role === 'transit_connector'
    || candidate.role === 'scenic_landmark'
    || candidate.role === 'culture_anchor'
}

function canAppendMinimumCoverageNode(selected: NarrativeNode[], candidate: NarrativeNode) {
  if (candidate.cellId && selected.some((item) => item.cellId && item.cellId === candidate.cellId)) {
    return false
  }
  const candidateName = normalizeName(candidate.name)
  if (candidateName && selected.some((item) => normalizeName(item.name) === candidateName)) {
    return false
  }
  const comparableKey = buildComparableEntityKey(candidate)
  if (comparableKey && selected.some((item) => buildComparableEntityKey(item) === comparableKey)) {
    return false
  }

  const candidateBucket = inferNodeSceneBucket(candidate)
  const relaxedDedupDistanceM = candidate.role === 'commercial_anchor'
    ? 56
    : (candidate.role === 'transit_connector' ? 60 : 72)

  return !selected.some((item) => {
    const itemBucket = inferNodeSceneBucket(item)
    return haversine(item.center, candidate.center) < relaxedDedupDistanceM
      && (item.role === candidate.role || itemBucket === candidateBucket)
  })
}

function ensureMinimumNarrativeNodeCount(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  const requiredCount = Math.min(limit, MIN_NARRATIVE_NODE_COUNT)
  if (selected.length >= requiredCount) return selected

  const revised = [...selected]
  for (const candidate of ranked) {
    if (revised.length >= requiredCount) break
    if (revised.some((item) => item.id === candidate.id)) continue
    if (!passesMinimumCoverageCandidate(candidate, summary)) continue
    if (!canAppendMinimumCoverageNode(revised, candidate)) continue
    revised.push(candidate)
  }
  return revised
}

function ensureEntryNodeCoverage(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  if (selected.some((node) => node.role === 'transit_connector')) return selected
  const entryCandidate = ranked.find((node) => node.role === 'transit_connector' && isNarrativeEligible(node, summary))
  if (!entryCandidate) return selected
  if (canAppendNarrativeNode(selected, entryCandidate, limit)) {
    return [...selected, entryCandidate]
  }

  const revised = [...selected]
  const replaceableIndex = [...revised.keys()].reverse().find((index) => {
    const node = revised[index]
    return node.role === 'district_anchor'
      || node.role === 'local_life_anchor'
      || node.role === 'civic_anchor'
      || computeNoiseRisk(node, summary) >= 0.28
  })
  if (replaceableIndex === undefined) return selected
  const trial = revised.filter((_, index) => index !== replaceableIndex)
  if (!canAppendNarrativeNode(trial, entryCandidate, limit)) return selected
  trial.push(entryCandidate)
  return trial
}

function collapseAcademicParentNodes(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  const revised = [...selected]
  for (let index = 0; index < revised.length; index += 1) {
    const current = revised[index]
    if (current.role !== 'campus_anchor') continue
    const hasSpecificMedicalPeer = revised.some((node, nodeIndex) =>
      nodeIndex !== index
        && node.role === 'medical_anchor'
        && sharesAcademicBrand(node, current)
        && haversine(node.center, current.center) <= 900,
    )
    if (!hasSpecificMedicalPeer) continue
    const trial = revised.filter((_, nodeIndex) => nodeIndex !== index)
    const replacement = ranked.find((candidate) =>
      candidate.id !== current.id
        && !trial.some((node) => node.id === candidate.id)
        && isNarrativeEligible(candidate, summary)
        && canAppendNarrativeNode(trial, candidate, limit),
    )
    if (replacement) {
      revised[index] = replacement
    } else {
      revised.splice(index, 1)
      index -= 1
    }
  }
  return backfillSelectedNodes(revised, ranked, summary, limit)
}

function inferSceneMix(input: {
  featureTags: RegionFeatureTag[]
  encoderSceneTags?: string[]
  candidates: NarrativeNode[]
}) {
  const mix = new Set<string>()
  const rawSceneTags = input.encoderSceneTags || []
  if (rawSceneTags.some((tag) => /(water|park|scenic|tour|滨水|景观|公园|风景)/iu.test(tag))) mix.add('景观地标')
  if (input.featureTags.some((tag) => tag.key === 'campus_anchor')) mix.add('高校')
  if (input.featureTags.some((tag) => tag.key === 'commercial_vitality')) mix.add('商业休闲')
  if (input.featureTags.some((tag) => tag.key === 'mixed_use' || tag.key === 'residential_support')) mix.add('本地生活')
  if (input.featureTags.some((tag) => tag.key === 'transit_connected')) mix.add('交通接驳')
  if (input.candidates.some((item) => item.role === 'scenic_landmark')) mix.add('景观地标')
  if (input.candidates.some((item) => item.role === 'campus_anchor')) mix.add('高校')
  if (input.candidates.some((item) => item.role === 'commercial_anchor')) mix.add('商业休闲')
  if (input.candidates.some((item) => item.role === 'culture_anchor')) mix.add('文化人文')
  if (input.candidates.some((item) => item.role === 'local_life_anchor')) mix.add('本地生活')
  if (input.candidates.some((item) => item.role === 'transit_connector')) mix.add('交通接驳')
  return [...mix]
}

function buildNarrativeStyleTail(style: NarrativeTourStyle) {
  if (style === 'local_vibe') return '我会更偏向入口、人流和真正顺路会经过的地方。'
  if (style === 'business_leisure') return '我会顺着逛街、吃饭、停留和转场的节奏来带。'
  if (style === 'humanities_walk') return '我会把脚步放慢一点，把更耐看的气质和余味留出来。'
  return '我会先带你快速了解这片区域最值得抓住的几处骨架。'
}

function buildNarrativeViewportLead(sceneMix: string[], candidates: NarrativeNode[]) {
  const hasCampus = candidates.some((item) => item.role === 'campus_anchor')
  const hasMedical = candidates.some((item) => item.role === 'medical_anchor')
  const hasCommercial = candidates.some((item) => item.role === 'commercial_anchor' || item.role === 'food_street_anchor')
  const hasLocalLife = candidates.some((item) => item.role === 'local_life_anchor')
  const hasTransit = candidates.some((item) => item.role === 'transit_connector')
  const hasScenic = candidates.some((item) => item.role === 'scenic_landmark')
  const hasCulture = candidates.some((item) => item.role === 'culture_anchor' || item.role === 'religious_anchor')

  if (hasCampus && hasMedical && hasCommercial) {
    return '这一带不是单纯一所学校的展开，而是校园、医疗和周边商业贴得很近的一片地方。'
  }
  if (hasCampus && hasCommercial && hasLocalLife) {
    return '这一带最像校园、商业和日常生活挨得很近的一片地方，书卷气和烟火气切换得很快。'
  }
  if (hasScenic && hasCommercial) {
    return '这一带一边开阔、一边热闹，景观界面和停留节奏几乎是并排展开的。'
  }
  if (hasScenic && hasCulture) {
    return '这一带不只是好看，更适合边走边看，景观外面还包着一层更慢的人文气。'
  }
  if (hasCommercial && hasTransit && hasLocalLife) {
    return '这一带的人流来得快、停得住，入口、商业和日常街区几乎是一口气连起来的。'
  }
  if (hasCulture && hasLocalLife) {
    return '这一带不喧哗，但很耐走，人文界面和日常生活挨得很近。'
  }
  if (hasCampus) {
    return '这一带的校园气质很鲜明，周边不少节奏都是围着它慢慢展开的。'
  }
  if (hasScenic) {
    return '这一带最先抓住人的，往往就是空间的开阔感，走起来也更容易留下记忆点。'
  }
  if (hasCommercial) {
    return '这一带的停留感很强，逛街、吃饭和转场会比单纯穿行更重要。'
  }
  if (hasTransit) {
    return '这一带先要看懂入口和人流怎么进来，后面的街区节奏才会顺。'
  }
  if (sceneMix.includes('高校') && sceneMix.includes('商业休闲')) {
    return '这一带能明显感觉到校园和商业挨得很近，走几步就会切到完全不同的节奏。'
  }
  if (sceneMix.includes('景观地标') && sceneMix.includes('本地生活')) {
    return '这一带不是只有景观可看，更像风景和日常生活贴在一起的一块地方。'
  }
  return '这一带不是单一功能区，更像几种日常节奏叠在一起的一块地方。'
}

function buildNarrativeViewportAnchors(candidates: NarrativeNode[]) {
  const anchors = candidates
    .filter((node) => node.role !== 'district_anchor')
    .slice()
    .sort((left, right) => right.score - left.score)
    .map((node) => node.name)
    .filter(Boolean)
    .slice(0, 2)
  if (anchors.length >= 2) return `先抓住${anchors[0]}和${anchors[1]}，这片区域的轮廓会快很多。`
  if (anchors.length === 1) return `先抓住${anchors[0]}，这片区域的轮廓就出来了。`
  return ''
}

export function buildNarrativeViewportSummary(input: {
  featureTags: RegionFeatureTag[]
  featureSummary: string
  encoderSummary?: string | null
  encoderTags?: RegionFeatureTag[]
  encoderSceneTags?: string[]
  encoderDominantBuckets?: string[]
  candidates: NarrativeNode[]
  scaleLevel?: NarrativeScaleLevel
  requestedStyle?: NarrativeTourStyle
}) {
  const requestedStyle = input.requestedStyle || 'classic_must_see'
  const sceneMix = inferSceneMix({
    featureTags: input.featureTags,
    encoderSceneTags: input.encoderSceneTags,
    candidates: input.candidates,
  })
  const dominantScene = sceneMix[0] || '混合片区'
  const summarySentence = [
    buildNarrativeViewportLead(sceneMix, input.candidates),
    buildNarrativeViewportAnchors(input.candidates),
    buildNarrativeStyleTail(requestedStyle),
  ].filter(Boolean).join(' ')

  const summary: NarrativeViewportSummary = {
    dominantScene,
    sceneMix,
    summarySentence,
    scaleLevel: input.scaleLevel || 'micro',
    macroRegionProfile: null,
    macroRegionName: null,
    featureTags: input.featureTags,
    encoderSummary: input.encoderSummary || null,
    encoderTags: input.encoderTags || [],
    sceneTags: input.encoderSceneTags || [],
    dominantBuckets: input.encoderDominantBuckets || [],
    requestedStyle,
    requestedStyleLabel: resolveNarrativeTourStyleLabel(requestedStyle),
  }

  return summary
}

function resolveMacroSpatialForm(nodes: NarrativeNode[], buckets: string[], waterfrontHint: boolean): NarrativeMacroSpatialForm {
  if (nodes.length <= 2) return 'cluster'
  const lons = nodes.map((node) => node.center.lon)
  const lats = nodes.map((node) => node.center.lat)
  const midLat = lats.reduce((sum, item) => sum + item, 0) / Math.max(lats.length, 1)
  const lonSpanM = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.max(Math.cos(midLat * Math.PI / 180), 0.2)
  const latSpanM = (Math.max(...lats) - Math.min(...lats)) * 110540
  const major = Math.max(lonSpanM, latSpanM, 1)
  const minor = Math.max(Math.min(lonSpanM, latSpanM), 1)
  const aspectRatio = major / minor
  if (waterfrontHint && buckets.includes('景观')) return 'interface'
  if (aspectRatio >= 2.8 && (buckets.includes('商业') || buckets.includes('交通'))) return 'belt'
  if (aspectRatio >= 2.4) return 'corridor'
  if (nodes.length <= 4) return 'cluster'
  return 'district'
}

function resolveMacroAxisHint(nodes: NarrativeNode[]): string | null {
  for (const node of nodes) {
    const name = normalizeName(node.name)
    const roadMatch = name.match(/(.{1,12}?(?:路|街|大道))/u)
    if (roadMatch?.[1]) return roadMatch[1]
  }
  return null
}

function resolveMacroAdminHint(anchorNames: string[]): string | null {
  const joined = anchorNames.join(' ')
  const candidates = ['武昌', '汉口', '汉阳', '光谷', '东湖', '洪山', '青山', '江夏']
  return candidates.find((item) => joined.includes(item)) || null
}

function resolveMacroPrimaryAnchor(nodes: NarrativeNode[]): string | null {
  const preferred = nodes
    .filter((node) => node.role !== 'transit_connector')
    .slice()
    .sort((left, right) => representativeSupportScore(right) - representativeSupportScore(left) || right.score - left.score)
  return preferred[0]?.name || nodes[0]?.name || null
}

function resolveMacroSemanticCore(profile: NarrativeMacroRegionProfile): string {
  const dominant = profile.dominantBuckets[0] || ''
  const support = new Set(profile.supportingBuckets)
  if (profile.waterfrontHint && (dominant === '景观' || support.has('景观'))) {
    if (support.has('商业')) return '滨水休闲'
    if (support.has('文化')) return '滨水人文'
    return '滨水休闲'
  }
  if (dominant === '校园') {
    if (support.has('文化') || support.has('商业')) return '科教文化'
    return '科教'
  }
  if (dominant === '商业') {
    if (support.has('景观') || support.has('生活')) return '商务休闲'
    return '商务商业'
  }
  if (dominant === '文化') {
    if (support.has('宗教') || support.has('景观')) return '人文游览'
    return '人文文化'
  }
  if (dominant === '景观') return profile.waterfrontHint ? '滨水休闲' : '景观休闲'
  if (dominant === '交通') return '枢纽活力'
  return '复合活力'
}

function resolveMacroFormSuffix(form: NarrativeMacroSpatialForm): string {
  if (form === 'belt') return '带'
  if (form === 'interface') return '界面'
  if (form === 'corridor') return '走廊'
  if (form === 'cluster') return '组团'
  return '区'
}

function resolveMacroAnchorPrefix(profile: NarrativeMacroRegionProfile): string {
  const anchor = normalizeName(profile.primaryAnchor || profile.anchorNames[0] || '')
  if (!anchor) return profile.axisHint || profile.adminHint || '当前区域'
  const academicBrand = extractAcademicBrand(anchor)
  if (academicBrand && profile.dominantBuckets.includes('校园')) {
    if (/大学$/u.test(academicBrand)) return `${academicBrand.replace(/大学$/u, '')}大学城`
    return academicBrand
  }
  if (/(湖|江|河|湿地)/u.test(anchor)) {
    return anchor.replace(/(湿地公园|森林公园|主题公园|国家公园|文化园|旅游区|风景区|景区|景点|公园)$/u, '') || anchor
  }
  const compact = anchor.replace(/(购物中心|购物广场|商业广场|商场|天地|汉街|奥特莱斯|奥莱|万象城|万象汇|天街|印象城|吾悦广场|万达广场|销品茂|k11|skp|mall|plaza|欧亚达|摩尔城|景区|景点|公园)$/iu, '')
  return compact || anchor
}

export function buildMacroRegionProfile(nodes: NarrativeNode[], summary: NarrativeViewportSummary): NarrativeMacroRegionProfile | null {
  if ((summary.scaleLevel || 'micro') !== 'macro' || nodes.length === 0) return null
  const bucketCounts = new Map<string, number>()
  for (const node of nodes) {
    const bucket = inferNodeSceneBucket(node)
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
  }
  const sortedBuckets = [...bucketCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([bucket]) => bucket)
  const anchorNames = [...new Set(nodes.map((node) => normalizeName(node.name)).filter(Boolean))].slice(0, 4)
  // waterfrontHint 只看节点名称是否命中真实水体/滨水特征。
  // 原来 || sortedBuckets.includes('景观') 会把所有含公园/山体/风景区的 macro
  // 误判为滨水，导致命名冒出"滨水休闲区"，这里收紧。
  const waterfrontHint = nodes.some((node) =>
    /(湖|江|河|滩|湿地|滨水|沿江|沿湖)/u.test(normalizeName(node.name)),
  )
  return {
    scaleLevel: 'macro',
    primaryAnchor: resolveMacroPrimaryAnchor(nodes),
    anchorNames,
    dominantBuckets: sortedBuckets.slice(0, 2),
    supportingBuckets: sortedBuckets.slice(2, 4),
    spatialForm: resolveMacroSpatialForm(nodes, sortedBuckets, waterfrontHint),
    waterfrontHint,
    axisHint: resolveMacroAxisHint(nodes),
    adminHint: resolveMacroAdminHint(anchorNames),
  }
}

export function generateMacroRegionName(profile: NarrativeMacroRegionProfile | null): NarrativeMacroRegionName | null {
  if (!profile) return null
  const prefix = resolveMacroAnchorPrefix(profile)
  const semanticCore = resolveMacroSemanticCore(profile)
  const suffix = resolveMacroFormSuffix(profile.spatialForm)
  const primaryName = `${prefix}${semanticCore}${suffix}`
  const shortName = `${semanticCore}${suffix}`
  const spokenName = prefix && prefix !== '当前区域' ? `${prefix}这一带` : shortName
  const reason = `主锚点集中于${profile.anchorNames.slice(0, 2).join('、') || '当前区域'}，语义以${profile.dominantBuckets.join('、') || '复合功能'}为主，空间形态更接近${suffix}。`
  const confidence = profile.anchorNames.length >= 3 ? 0.82 : 0.74
  return {
    primaryName,
    shortName,
    spokenName,
    labelType: profile.spatialForm,
    source: 'deterministic',
    confidence,
    reason,
  }
}

export function buildNarrativeCandidates(input: {
  representativeSamples: EvidenceItem[]
  aoiContext: Record<string, unknown>[]
}) {
  const nodes: NarrativeNode[] = []

  for (const item of input.representativeSamples) {
    if (!Number.isFinite(item.longitude) || !Number.isFinite(item.latitude)) continue
    const role = resolveNodeRoleFromPoi(item)
    const distancePenalty = Number.isFinite(Number(item.distance_m)) ? Math.min(Number(item.distance_m) / 12000, 0.22) : 0
    nodes.push({
      id: `poi:${String(item.id ?? item.name)}`,
      name: normalizeName(item.name),
      role,
      roleLabel: resolveRoleLabel(role),
      source: 'representative_sample',
      center: { lon: Number(item.longitude), lat: Number(item.latitude) },
      score: Number((resolveRoleWeight(role) + 0.18 - distancePenalty).toFixed(3)),
      categoryMain: item.categoryMain || null,
      categorySub: item.categorySub || item.category || null,
      distanceM: Number.isFinite(Number(item.distance_m)) ? Number(item.distance_m) : null,
      tags: [role, String(item.categoryMain || ''), String(item.categorySub || item.category || '')].filter(Boolean),
      reasons: [resolveRoleLabel(role), String(item.categorySub || item.categoryMain || '空间代表点')].filter(Boolean),
      hotness: 'low' as const,
    })
  }

  for (const item of input.aoiContext) {
    const name = normalizeName(item.name)
    if (!name) continue
    const lon = Number(item.longitude)
    const lat = Number(item.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const role = resolveNodeRoleFromAoi(item)
    const weight = Number(item.population || item.area_sqm || item.areaSqm || 1)
    const scaleBonus = Math.min(Math.log10(Math.max(weight, 1) + 1) / 10, 0.18)
    const boundary = parseBoundaryGeoJsonFromRow(item.boundary_geojson, 'aoi_native')
    // AOI centroid 来自 aois 表（WGS84），转 GCJ02 与 POI/前端底图对齐
    const [gcjLon, gcjLat] = wgs84ToGcj02(lon, lat)
    nodes.push({
      id: `aoi:${String(item.id ?? name)}`,
      name,
      role,
      roleLabel: resolveRoleLabel(role),
      source: 'aoi_context',
      center: { lon: gcjLon, lat: gcjLat },
      score: Number((resolveRoleWeight(role) + 0.24 + scaleBonus).toFixed(3)),
      categoryMain: null,
      categorySub: String(item.fclass || '').trim() || null,
      distanceM: null,
      tags: [role, String(item.fclass || '')].filter(Boolean),
      reasons: [resolveRoleLabel(role), 'AOI 代表锚点'].filter(Boolean),
      hotness: 'low' as const,
      boundary,
    })
  }

  const deduped = new Map<string, NarrativeNode>()
  for (const node of nodes.sort((left, right) => right.score - left.score)) {
    const key = buildComparableEntityKey(node) || node.name.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, node)
    }
  }

  return [...deduped.values()].sort((left, right) => right.score - left.score)
}

function resolveNarrativeMode(summary: NarrativeViewportSummary) {
  if (summary.sceneMix.includes('景观地标')) return 'landmark_to_life'
  if (summary.sceneMix.includes('高校')) return 'campus_to_commerce'
  return 'district_sweep'
}

function resolveNodeTier(node: NarrativeNode, summary: NarrativeViewportSummary): NarrativeNodeTier {
  const bucket = inferNodeSceneBucket(node)
  if (node.role === 'transit_connector') return 'entry'
  if (summary.requestedStyle === 'local_vibe') {
    if (node.role === 'local_life_anchor') return 'local_pick'
    if (node.role === 'district_anchor' || node.role === 'civic_anchor') return 'background'
  }
  if (summary.requestedStyle === 'humanities_walk') {
    if (bucket === '文化' || bucket === '宗教' || bucket === '校园') return 'must_see'
    if (node.role === 'district_anchor' || node.role === 'civic_anchor') return 'background'
  }
  if (node.role === 'district_anchor' || node.role === 'civic_anchor') return 'background'
  if (node.role === 'local_life_anchor') return summary.requestedStyle === 'classic_must_see' ? 'optional' : 'local_pick'
  if (bucket === '文化' || bucket === '宗教' || bucket === '景观' || bucket === '校园') return 'must_see'
  if (node.role === 'medical_anchor' || node.role === 'commercial_anchor' || representativeSupportScore(node) >= 3) return 'must_see'
  return 'optional'
}

function resolveTierPriority(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const tier = node.tier || resolveNodeTier(node, summary)
  if (summary.requestedStyle === 'local_vibe' || summary.requestedStyle === 'business_leisure') {
    if (tier === 'entry') return 0
    if (tier === 'must_see') return 1
    if (tier === 'local_pick') return 2
    if (tier === 'optional') return 3
    return 4
  }
  if (summary.requestedStyle === 'humanities_walk') {
    if (tier === 'must_see') return 0
    if (tier === 'local_pick') return 1
    if (tier === 'optional') return 2
    if (tier === 'entry') return 3
    return 4
  }
  if (tier === 'must_see') return 0
  if (tier === 'entry') return 1
  if (tier === 'optional') return 2
  if (tier === 'local_pick') return 3
  return 4
}

export function rankNarrativeNodes(candidates: NarrativeNode[], summary: NarrativeViewportSummary, limit = 10) {
  const mode = resolveNarrativeMode(summary)
  const bucketOrder = resolveBucketOrder(mode, summary.requestedStyle)
  const normalized = candidates.map((node) => {
    const sceneBucket = inferNodeSceneBucket(node)
    return {
      ...node,
      sceneBucket,
      // 始终重新生成 selectionReason，确保角色感知优先于 encoder 泛化 summary
      selectionReason: buildSelectionReason({ ...node, sceneBucket }, summary),
    }
  })
  const ranked = normalized
    .map((node) => ({ node, fit: computeNarrativeFit(node, summary, bucketOrder, normalized) }))
    .sort((left, right) => right.fit - left.fit || right.node.score - left.node.score)

  const selected: NarrativeNode[] = []
  const primaryPool = ranked
    .map((item) => item.node)
    .filter((node) => isNarrativeEligible(node, summary))
  const fallbackPool = ranked
    .map((item) => item.node)
    .filter((node) => !primaryPool.some((item) => item.id === node.id))

  for (const candidate of primaryPool) {
    if (selected.length >= limit) break
    if (selected.some((item) => item.id === candidate.id)) continue
    if (!canAppendNarrativeNode(selected, candidate, limit)) continue
    selected.push(candidate)
  }

  for (const candidate of fallbackPool) {
    if (selected.length >= limit) break
    if (selected.some((item) => item.id === candidate.id)) continue
    if (!passesRepresentativeEntityStandard(candidate, summary)) continue
    // 硬约束：职业院校和基础教育绝不能通过 fallback 池混入导览
    if (isVocationalEducationName(normalizeName(candidate.name))) continue
    if (isBasicEducationName(normalizeName(candidate.name))) continue
    if (!canAppendNarrativeNode(selected, candidate, limit)) continue
    selected.push(candidate)
  }

  const rankedNodes = ranked.map((item) => item.node)
  const reviewed = reviewSelectedNodes(selected, rankedNodes, summary, limit)
  const withEntry = ensureEntryNodeCoverage(reviewed, rankedNodes, summary, limit)
  const collapsed = collapseAcademicParentNodes(withEntry, rankedNodes, summary, limit)
  const backfilled = backfillSelectedNodes(collapsed, rankedNodes, summary, limit)
  const finalized = ensureMinimumNarrativeNodeCount(backfilled, rankedNodes, summary, limit)
    .map((node) => ({ ...node, tier: resolveNodeTier(node, summary) }))

  return {
    narrativeMode: mode,
    selectedNodes: finalized.sort((left, right) => {
      const tierPriority = resolveTierPriority(left, summary) - resolveTierPriority(right, summary)
      if (tierPriority !== 0) return tierPriority
      const leftBucket = bucketOrder.indexOf(inferNodeSceneBucket(left))
      const rightBucket = bucketOrder.indexOf(inferNodeSceneBucket(right))
      return leftBucket - rightBucket || right.score - left.score
    }),
  }
}

function buildTransitionRationale(from: NarrativeNode, to: NarrativeNode) {
  const fromBucket = inferNodeSceneBucket(from)
  const toBucket = inferNodeSceneBucket(to)
  if (fromBucket === '景观' && toBucket === '校园') return '先从区域最显眼的景观地标切到校园语义，补足这片区域的人文气质。'
  if (fromBucket === '校园' && toBucket === '商业') return '从校园人流延伸到商业承接区，更容易看出这片区域的活力外溢。'
  if (fromBucket === '商业' && toBucket === '生活') return '从显性的消费界面转到更贴近日常生活的街区，导览会更落地。'
  if (toBucket === '交通') return '最后补一个交通节点，方便理解这片区域的人流组织与到达方式。'
  if (fromBucket === toBucket) {
    if (fromBucket === '商业') {
      return '商业这条线继续往前走，能看出不同商业体各自承接的人流和停留方式。'
    }
    if (fromBucket === '景观') return '景观这一层还没讲完，顺着看下去，空间气质会更完整。'
    if (fromBucket === '文化' || fromBucket === '宗教') return '先别急着换线，把这一层更慢一点的人文气息继续展开。'
    if (fromBucket === '校园') return '校园这条线还可以再往里走一步，前后关系会更清楚。'
    if (fromBucket === '生活') return '继续顺着日常界面往下带，这片区域会显得更真实。'
    return `先把“${fromBucket}”这一层讲透，再切到下一层会更自然。`
  }
  return `从${from.name}转到${to.name}，视角会从${fromBucket}慢慢切到${toBucket}，层次也会更清楚。`
}

export function buildNarrativeTransitions(nodes: NarrativeNode[]) {
  const transitions: NarrativeTourTransition[] = []
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes[index - 1]
    const to = nodes[index]
    transitions.push({
      fromId: from.id,
      toId: to.id,
      rationale: buildTransitionRationale(from, to),
    })
  }
  return transitions
}

function buildRegionTransitionRationale(from: NarrativeRegionCluster, to: NarrativeRegionCluster) {
  const fromBucket = from.dominantBucket || '复合'
  const toBucket = to.dominantBucket || '复合'
  if (fromBucket === toBucket) {
    return `继续顺着${fromBucket}这条线往前带，片区层次会更完整。`
  }
  return `从${from.name}切到${to.name}，视角会从${fromBucket}慢慢过渡到${toBucket}。`
}

export function buildNarrativeRegionTransitions(regions: NarrativeRegionCluster[]) {
  const transitions: NarrativeTourTransition[] = []
  for (let index = 1; index < regions.length; index += 1) {
    const from = regions[index - 1]
    const to = regions[index]
    transitions.push({
      fromId: from.id,
      toId: to.id,
      rationale: buildRegionTransitionRationale(from, to),
    })
  }
  return transitions
}

function buildRegionFactFallback(region: NarrativeRegionCluster) {
  if (region.webFacts) return region.webFacts
  const nodeFact = region.nodes.find((node) => node.webFacts)?.webFacts || null
  if (!nodeFact) return null
  return {
    regionId: region.id,
    query: region.name,
    snippets: Array.isArray(nodeFact.snippets) ? nodeFact.snippets : [],
    labels: Array.isArray(nodeFact.labels) ? nodeFact.labels : [],
    titles: Array.isArray(nodeFact.titles) ? nodeFact.titles : [],
    urls: Array.isArray(nodeFact.urls) ? nodeFact.urls : [],
    searchAnswer: nodeFact.searchAnswer || null,
    source: nodeFact.source || 'unknown',
    sourceItems: (Array.isArray(nodeFact.urls) ? nodeFact.urls : [])
      .map((url, index) => ({
        title: String((nodeFact.titles || [])[index] || region.name).trim(),
        snippet: String((nodeFact.snippets || [])[index] || '').trim() || undefined,
        url: String(url || '').trim(),
        source: nodeFact.source || 'unknown',
      }))
      .filter((item) => item.url),
  }
}

function buildRegionVoiceText(
  region: NarrativeRegionCluster,
  summary: NarrativeViewportSummary,
  transition?: NarrativeTourTransition | null,
) {
  const lead = buildNarrationLead(summary.requestedStyle, transition)
  const supportText = region.supportNames.slice(0, 4).join('、') || '周边支撑点'
  const hotspotText = region.hotspots.length > 0 ? '从热度分布上也能看出这是当前视口里更集中的一块。' : ''
  const fact = buildRegionFactFallback(region)
  const factText = String(fact?.searchAnswer || fact?.snippets?.[0] || '').trim()
  const factSentence = factText
    ? (/[。！？；]$/u.test(factText) ? factText : `${factText}。`)
    : ''
  return [
    `${lead}。`,
    `${region.name}是当前视口里更偏${region.dominantBucket}的一片区域，不是单个点位，而是由${supportText}等一组相互关联的节点共同支撑出来的。`,
    hotspotText,
    factSentence,
  ].filter(Boolean).join(' ')
}

function buildRegionWebFactHint(region: NarrativeRegionCluster) {
  const fact = buildRegionFactFallback(region)
  const labels = fact?.labels || []
  if (labels.length > 0) return labels.join('·')
  const fallback = region.supportNames.slice(0, 3)
  return fallback.length > 0 ? fallback.join('·') : null
}

function buildRegionWebFactSnippet(region: NarrativeRegionCluster) {
  const fact = buildRegionFactFallback(region)
  const snippet = (fact?.snippets || [])[0] || null
  if (!snippet) return null
  return snippet.length > 140 ? snippet.slice(0, 140) + '…' : snippet
}

function buildRegionWebSources(region: NarrativeRegionCluster) {
  const fact = buildRegionFactFallback(region)
  const sources = fact?.sourceItems || []
  if (!Array.isArray(sources) || sources.length === 0) return []
  return sources.slice(0, 3)
}

export function buildNarrativeRegionSteps(input: {
  summary: NarrativeViewportSummary
  regions: NarrativeRegionCluster[]
  transitions: NarrativeTourTransition[]
}) {
  const steps: NarrativeTourStep[] = [
    {
      focus: 'overview',
      voice_text: input.summary.summarySentence,
      duration: 4200,
      voiceTextSource: 'template',
    },
  ]

  for (let index = 0; index < input.regions.length; index += 1) {
    const region = input.regions[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    steps.push({
      focus: region.name,
      voice_text: buildRegionVoiceText(region, input.summary, transition),
      duration: 5200,
      center: region.center,
      region_id: region.id,
      region_index: index,
      transition_reason: transition?.rationale,
      tagline: `${region.dominantBucket}片区 · ${region.nodeCount} 个支撑节点`,
      webFactHint: buildRegionWebFactHint(region),
      webFactSnippet: buildRegionWebFactSnippet(region),
      webSources: buildRegionWebSources(region),
      regionSupportNames: region.supportNames.slice(0, 5),
      boundary: region.boundary || null,
      glowBoundary: region.glowBoundary || null,
      glowLayers: region.glowLayers || [],
      voiceTextSource: 'template',
    })
  }

  return steps
}

export function buildNarrativeRegionStepsSkeleton(input: {
  summary: NarrativeViewportSummary
  regions: NarrativeRegionCluster[]
  transitions: NarrativeTourTransition[]
}) {
  const steps: NarrativeTourStep[] = [
    {
      focus: 'overview',
      voice_text: input.summary.summarySentence,
      duration: 4200,
      voiceTextSource: 'template',
    },
  ]

  for (let index = 0; index < input.regions.length; index += 1) {
    const region = input.regions[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    steps.push({
      focus: region.name,
      voice_text: `${region.name}是当前视口中的重点区域簇，可先用它理解这片区域的整体空间关系。`,
      duration: 5200,
      center: region.center,
      region_id: region.id,
      region_index: index,
      transition_reason: transition?.rationale,
      tagline: `${region.dominantBucket}片区 · ${region.nodeCount} 个支撑节点`,
      webFactHint: buildRegionWebFactHint(region),
      webFactSnippet: buildRegionWebFactSnippet(region),
      webSources: buildRegionWebSources(region),
      regionSupportNames: region.supportNames.slice(0, 5),
      boundary: region.boundary || null,
      glowBoundary: region.glowBoundary || null,
      glowLayers: region.glowLayers || [],
      voiceTextSource: 'placeholder',
    })
  }

  return steps
}

export function buildNarrativeRegionAnswer(input: {
  summary: NarrativeViewportSummary
  regions: NarrativeRegionCluster[]
  steps: NarrativeTourStep[]
  transitions: NarrativeTourTransition[]
}) {
  const stepByRegionId = new Map(
    input.steps
      .filter((step) => step.region_id)
      .map((step) => [String(step.region_id), step] as const),
  )
  const lines = [
    '## 当前视口画像',
    input.steps[0]?.voice_text || input.summary.summarySentence,
    '',
    '## 第一版区域导览顺序',
  ]

  input.regions.forEach((region, index) => {
    const step = stepByRegionId.get(region.id)
    lines.push(`${index + 1}. **${region.name}** · ${region.dominantBucket}片区 · ${region.nodeCount} 个支撑节点`)
    lines.push(`   - 解说词：${step?.voice_text || region.summary || '区域讲解生成中…'}`)
    if (region.supportNames.length > 0) {
      lines.push(`   - 支撑线索：${region.supportNames.slice(0, 5).join('、')}`)
    }
    const fact = buildRegionFactFallback(region)
    if (fact?.snippets?.[0]) {
      lines.push(`   - 网页来源：${fact.snippets[0]}`)
    }
    if (index > 0) {
      lines.push(`   - 转场逻辑：${step?.transition_reason || input.transitions[index - 1]?.rationale || '承接上一片区继续展开。'}`)
    }
  })

  lines.push('')
  lines.push('## 编排方式')
  lines.push(`当前采用 **${input.summary.requestedStyleLabel}** 视角，把视口内的重点区域簇串成一条可播放的导览骨架。`)
  return lines.join('\n')
}

function resolveRegionName(region: {
  quadrant?: string | null
  dominantBucket: string
  supportNames: string[]
}, summary: NarrativeViewportSummary, index: number, total: number) {
  if (total === 1 && summary.macroRegionName?.primaryName) {
    return summary.macroRegionName.primaryName
  }
  const firstSupport = region.supportNames[0] || ''
  if (firstSupport && firstSupport.length <= 16) {
    if (region.dominantBucket === '校园') return `${firstSupport}科教文化区`
    if (region.dominantBucket === '景观') return `${firstSupport}景观休闲区`
    if (region.dominantBucket === '商业') return `${firstSupport}商业活力区`
    if (region.dominantBucket === '文化' || region.dominantBucket === '宗教') return `${firstSupport}人文片区`
  }
  const quadrantLabel = region.quadrant === 'right_bottom'
    ? '右下'
    : region.quadrant === 'right_top'
      ? '右上'
      : region.quadrant === 'left_top'
        ? '左上'
        : region.quadrant === 'left_bottom'
          ? '左下'
          : '中部'
  return `${quadrantLabel}${region.dominantBucket || '复合'}片区 ${index + 1}`
}

export function buildNarrativeRegionClusters(input: {
  nodes: NarrativeNode[]
  relevanceField: NarrativeRelevanceField | null | undefined
  summary: NarrativeViewportSummary
}) {
  const nodes = input.nodes || []
  const relevanceField = input.relevanceField || null
  if (nodes.length === 0) return [] as NarrativeRegionCluster[]

  const anchorNodeIds = new Set<string>()
  const clusters = relevanceField?.clusters || []
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))

  const regionClusters: NarrativeRegionCluster[] = clusters.map((cluster, index) => {
    const regionNodes = cluster.anchors
      .map((anchor) => nodeById.get(anchor.nodeId))
      .filter(Boolean) as NarrativeNode[]

    for (const node of regionNodes) anchorNodeIds.add(node.id)

    const dominantBuckets = [...new Set(regionNodes.map((node) => inferNodeSceneBucket(node)).filter(Boolean))]
    const dominantBucket = dominantBuckets[0] || '复合'
    const supportNames = [...new Set(regionNodes.map((node) => normalizeName(node.name)).filter(Boolean))].slice(0, 5)
    const boundary = regionNodes.find((node) => node.boundary)?.boundary || null
    const glowBoundary = regionNodes.find((node) => node.boundary)?.boundary || null
    const name = resolveRegionName({
      quadrant: cluster.quadrant,
      dominantBucket,
      supportNames,
    }, input.summary, index, clusters.length)

    return {
      id: `region:${cluster.quadrant || index}`,
      name,
      spokenName: name,
      regionClass: index < 2 ? 'primary' : 'support',
      center: cluster.centroid,
      quadrant: cluster.quadrant,
      nodes: regionNodes,
      nodeIds: regionNodes.map((node) => node.id),
      nodeCount: regionNodes.length,
      dominantBucket,
      dominantBuckets,
      supportNames,
      anchors: cluster.anchors,
      hotspots: cluster.hotspots,
      summary: `${name}由${supportNames.join('、') || '多个支撑节点'}共同构成。`,
      boundary,
      glowBoundary,
      webFacts: null,
    } satisfies NarrativeRegionCluster
  }).filter((region) => region.nodeCount > 0)

  const unassignedNodes = nodes.filter((node) => !anchorNodeIds.has(node.id))
  if (unassignedNodes.length > 0) {
    const dominantBuckets = [...new Set(unassignedNodes.map((node) => inferNodeSceneBucket(node)).filter(Boolean))]
    const dominantBucket = dominantBuckets[0] || '复合'
    const supportNames = [...new Set(unassignedNodes.map((node) => normalizeName(node.name)).filter(Boolean))].slice(0, 5)
    regionClusters.push({
      id: 'region:overflow',
      name: resolveRegionName({ quadrant: 'center', dominantBucket, supportNames }, input.summary, regionClusters.length, regionClusters.length + 1),
      spokenName: null,
      regionClass: 'overflow',
      center: unassignedNodes[0].center,
      quadrant: 'center',
      nodes: unassignedNodes,
      nodeIds: unassignedNodes.map((node) => node.id),
      nodeCount: unassignedNodes.length,
      dominantBucket,
      dominantBuckets,
      supportNames,
      anchors: [],
      hotspots: [],
      summary: `${supportNames.join('、') || '若干节点'}组成了这一片补充区域。`,
      boundary: unassignedNodes.find((node) => node.boundary)?.boundary || null,
      glowBoundary: unassignedNodes.find((node) => node.boundary)?.boundary || null,
      webFacts: null,
    })
  }

  return regionClusters.sort((left, right) => right.nodeCount - left.nodeCount)
}

export function resolveScaleLevelRegionLimit(scaleLevel: NarrativeScaleLevel) {
  if (scaleLevel === 'macro') return 4
  if (scaleLevel === 'meso') return 5
  return 6
}

function computeNarrativeRegionFit(region: NarrativeRegionCluster, summary: NarrativeViewportSummary) {
  const topNodeScore = region.nodes
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .reduce((sum, node) => sum + Number(node.score || 0), 0)
  const dominantBucketBonus = summary.dominantBuckets.includes(region.dominantBucket) ? 0.42 : 0
  const regionClassBoost = region.regionClass === 'primary'
    ? 0.34
    : region.regionClass === 'support'
      ? 0.12
      : 0
  const overflowPenalty = region.id === 'region:overflow' || region.regionClass === 'overflow' ? 0.28 : 0
  const fact = buildRegionFactFallback(region)
  const evidenceBoost = Number((
    (fact?.searchAnswer ? 0.24 : 0)
    + (fact?.snippets?.[0] ? 0.18 : 0)
    + Math.min((fact?.labels?.length || 0) * 0.08, 0.2)
    + Math.min((fact?.titles?.length || 0) * 0.05, 0.12)
  ).toFixed(3))
  const genericNamePenalty = /^(?:右上|右下|左上|左下|中部|中心|北部|南部|东部|西部).*(?:片区|区域)(?:\s*\d+)?$/u.test(normalizeName(region.name))
    || /^热点\d+$/u.test(normalizeName(region.name))
    ? (fact ? 0.08 : 0.22)
    : 0
  return Number((
    topNodeScore
    + region.nodeCount * 0.22
    + region.anchors.length * 0.15
    + region.hotspots.length * 0.12
    + dominantBucketBonus
    + regionClassBoost
    + evidenceBoost
    - overflowPenalty
    - genericNamePenalty
  ).toFixed(3))
}

export function rankNarrativeRegions(
  regions: NarrativeRegionCluster[],
  summary: NarrativeViewportSummary,
  limit = 4,
) {
  if (regions.length <= 1) return regions
  return regions
    .slice()
    .sort((left, right) => {
      const fitDiff = computeNarrativeRegionFit(right, summary) - computeNarrativeRegionFit(left, summary)
      if (fitDiff !== 0) return fitDiff
      return right.nodeCount - left.nodeCount
    })
    .slice(0, Math.max(1, limit))
}

export function projectNarrativeRegionsToNodes(input: {
  regions: NarrativeRegionCluster[]
  nodes: NarrativeNode[]
}) {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const))
  return input.regions
    .map((region) => {
      const regionNodes = region.nodeIds
        .map((nodeId) => nodeById.get(nodeId))
        .filter(Boolean) as NarrativeNode[]
      if (regionNodes.length === 0) return null
      const dominantBuckets = [...new Set(regionNodes.map((node) => inferNodeSceneBucket(node)).filter(Boolean))]
      const dominantBucket = dominantBuckets[0] || region.dominantBucket || '复合'
      const supportNames = [...new Set(regionNodes.map((node) => normalizeName(node.name)).filter(Boolean))].slice(0, 5)
      return {
        ...region,
        nodes: regionNodes,
        nodeIds: regionNodes.map((node) => node.id),
        nodeCount: regionNodes.length,
        regionClass: region.regionClass,
        dominantBucket,
        dominantBuckets,
        supportNames,
        summary: region.summary || `${supportNames.join('、') || '多个支撑节点'}共同构成这一片区域。`,
        boundary: regionNodes.find((node) => node.boundary)?.boundary || region.boundary || null,
        glowBoundary: region.glowBoundary || regionNodes.find((node) => node.boundary)?.boundary || region.boundary || null,
        webFacts: region.webFacts || null,
      } satisfies NarrativeRegionCluster
    })
    .filter(Boolean) as NarrativeRegionCluster[]
}

function buildNearbyConnections(nodes: NarrativeNode[], index: number) {
  const explicit = [nodes[index - 1]?.name, nodes[index + 1]?.name].filter(Boolean) as string[]
  if (explicit.length > 0) {
    return [...new Set(explicit)].slice(0, 2)
  }
  const current = nodes[index]
  if (!current) return []
  return nodes
    .filter((_, nodeIndex) => nodeIndex !== index)
    .map((node) => ({ name: node.name, distance: haversine(current.center, node.center) }))
    .sort((left, right) => left.distance - right.distance)
    .map((item) => item.name)
    .slice(0, 2)
}

function buildReasonCard(node: NarrativeNode, summary: NarrativeViewportSummary, nodes: NarrativeNode[], index: number): NarrativeReasonCard {
  const bucket = inferNodeSceneBucket(node)
  const nearbyConnections = buildNearbyConnections(nodes, index)
  let represents = '这片区域里帮助理解整体结构的一层补充界面'
  let whyWorthVisiting = node.selectionReason || `${node.name}值得被解释。`
  let bestTime = '适合顺着导览节奏带着看，不必单独久留。'

  if (bucket === '景观') {
    represents = '这片区域最容易先被感知到的景观界面'
    whyWorthVisiting = `站在这里更容易把${nearbyConnections.join('、') || '周边的开敞空间'}和整体空间关系一起看清。`
    bestTime = '白天看空间层次最清楚，傍晚更容易感到舒服和开阔。'
  } else if (bucket === '校园') {
    represents = '这片片区里最能代表校园骨架和年轻人流的一层'
    whyWorthVisiting = `它不是孤立建筑，而是${nearbyConnections.join('、') || '周边商业和生活'}背后稳定人流的重要来源。`
    bestTime = '工作日白天更容易感受到真实的校园节奏。'
  } else if (bucket === '医疗') {
    represents = '校园片区里更专业、也更具体的医疗与训练界面'
    whyWorthVisiting = '它能把“大学片区”讲得更具体，不再只停留在抽象校名。'
    bestTime = '白天更适合讲功能位置与片区结构，不建议当成观光停留点。'
  } else if (bucket === '商业') {
    represents = '片区里最能承接人流与消费停留的商业节点'
    whyWorthVisiting = `看这里，就能明白人为什么会在这一站停下来，再顺着${nearbyConnections.join('、') || '周边街区'}继续流动。`
    bestTime = '下午到夜间更有状态，下雨天也常常更好用。'
  } else if (bucket === '生活' || node.role === 'local_life_anchor') {
    represents = '把片区从大地标拉回真实日常生活的一层'
    whyWorthVisiting = '它也许不最出名，却最像本地人真正会用到、会经过的地方。'
    bestTime = '傍晚或顺路经过时最容易看出真实生活感。'
  } else if (bucket === '交通' || node.role === 'transit_connector') {
    represents = '进入这片区域的入口与人流分发口'
    whyWorthVisiting = '把这里讲明白，整片区域的到达方式、人流走向和商业承接都会顺起来。'
    bestTime = '适合作为第一站，或者放在换线、转场时顺路解释。'
  } else if (bucket === '文化') {
    represents = '让片区气质变得更厚、更有记忆点的人文界面'
    whyWorthVisiting = '它能让导览不只剩功能和消费，还能留下更慢一点的人文纹理。'
    bestTime = '白天慢走更合适，别赶时间。'
  } else if (bucket === '宗教') {
    represents = '这片区域里更安静、也更耐回味的一条精神线索'
    whyWorthVisiting = '它不是最喧闹的点，却能把片区的历史感和情绪层次慢慢带出来。'
    bestTime = '清晨或傍晚更安静，更适合慢慢进入氛围。'
  } else if (bucket === '政务') {
    represents = '支撑片区秩序感和公共服务的一层背景结构'
    whyWorthVisiting = '不一定需要久留，但很适合解释为什么这片区域会显得稳、有组织。'
    bestTime = '白天最直观，适合在结构说明里简洁带过。'
  }

  if (summary.requestedStyle === 'local_vibe' && node.role === 'local_life_anchor') {
    whyWorthVisiting = '它未必会出现在游客清单里，但很能说明本地人怎样真正使用这片区域。'
  }
  if (summary.requestedStyle === 'humanities_walk' && (bucket === '文化' || bucket === '宗教')) {
    whyWorthVisiting = '把脚步放慢，这里会比热闹地标更能留下片区的气味和记忆。'
  }

  return {
    represents,
    whyWorthVisiting,
    bestTime,
    nearbyConnections,
  }
}

function buildLocalTip(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const bucket = inferNodeSceneBucket(node)
  if (node.role === 'transit_connector') return '这里适合作为第一站或换乘锚点，先把片区入口和人流走向讲顺。'
  if (bucket === '景观') return '适合和周边景观带一起理解，不建议孤立解读。'
  if (bucket === '商业') return summary.requestedStyle === 'business_leisure'
    ? '更适合放在消费动线里一起讲。'
    : '更适合放进周边街区整体讲。'
  if (bucket === '生活') return '更适合作为片区日常生活背景，不建议单独展开。'
  if (bucket === '文化' || bucket === '宗教') return '适合和周边历史文化节点一起讲。'
  if (bucket === '医疗') return '它更能说明片区专业功能，而不是景点属性。'
  if (node.tier === 'background') return '可作为区域背景补充，不必单独停留。'
  return '更适合放进周边节点关系里一起理解。'
}

function buildNarrationLead(style: NarrativeTourStyle, transition?: NarrativeTourTransition | null) {
  if (transition) {
    if (style === 'local_vibe') return '顺着刚才那股人流和日常气息，再往里走一步'
    if (style === 'business_leisure') return '沿着刚才那层停留与消费界面，视线继续往前推'
    if (style === 'humanities_walk') return '把脚步再放慢一点，顺着上一层气质往里走'
    return '沿着刚才那层空间关系继续往前看'
  }
  if (style === 'local_vibe') return '我们先从更接近日常入口的位置开始'
  if (style === 'business_leisure') return '先把这片区域最有停留感的一面拉出来看'
  if (style === 'humanities_walk') return '先别急着追热点，先把这片区域的气质慢慢展开'
  return '先把这片区域最值得抓住的骨架看清楚'
}

function buildFactSentence(node: NarrativeNode) {
  const fact = String(node.webFacts?.searchAnswer || node.webFacts?.snippets?.[0] || '').trim()
  if (!fact) return ''
  const normalized = fact.replace(/\s+/gu, ' ').trim()
  if (!normalized) return ''
  const sentence = (normalized.match(/^[^。！？；]{16,90}[。！？；]?/u)?.[0] || normalized).trim()
  if (!sentence) return ''
  return /[。！？；]$/u.test(sentence) ? sentence : `${sentence}。`
}

function buildNodeVoiceText(
  node: NarrativeNode,
  summary: NarrativeViewportSummary,
  reasonCard: NarrativeReasonCard,
  localTip: string | null,
  transition?: NarrativeTourTransition | null,
) {
  const lead = buildNarrationLead(summary.requestedStyle, transition)
  const bucket = inferNodeSceneBucket(node)
  const categoryText = zhFriendlyCategory(node)
  const nearbySentence = reasonCard.nearbyConnections.length > 0
    ? `往周边顺着看，还能很自然地接到${reasonCard.nearbyConnections.join('、')}。`
    : ''
  const factSentence = buildFactSentence(node)
  const coreSentence = (() => {
    if (node.role === 'transit_connector') return `${node.name}更像进出这片区域的门把手，人流怎么进、怎么换线，通常都要从这里说顺。`
    if (node.role === 'medical_anchor') return `${node.name}把抽象的校园片区，落成了一处带着专业气质的具体场所。`
    if (node.role === 'local_life_anchor') return `${node.name}不一定最响亮，却最像这片区域真正被使用时的样子。`
    if (bucket === '商业') return `${node.name}把这片区域最具体的逛街、吃饭和停留方式摆在了眼前。`
    if (bucket === '文化' || bucket === '宗教') return `${node.name}让这片区域不只剩功能，也多了一层能慢慢回味的人文纹理。`
    if (bucket === '景观') return `${node.name}把这里的开敞面、边界感和空间层次先提了出来。`
    return `${node.name}是这里比较有代表性的${categoryText}节点。`
  })()
  return [
    `${lead}。`,
    coreSentence,
    reasonCard.whyWorthVisiting,
    nearbySentence,
    factSentence,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 给前端卡片提供的短 fact badge：只拼 labels，不再混入网页摘要原文，
 * 摘要原文改走 `webFactSnippet` 字段，前端用独立样式标识为"网页来源"。
 */
function buildWebFactHint(node: NarrativeNode) {
  const labels = node.webFacts?.labels || []
  if (labels.length === 0) return null
  return labels.join('·')
}

/**
 * 网页原文摘要（已在后端滤掉广告文案），独立字段供前端用单独底色/引用样式展示。
 * 限 120 字，拿一条即可，缺失返回 null。
 */
function buildWebFactSnippet(node: NarrativeNode) {
  const snippet = (node.webFacts?.snippets || [])[0] || null
  if (!snippet) return null
  return snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet
}

export function buildNarrativeSteps(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
}) {
  const steps: NarrativeTourStep[] = [
    {
      focus: 'overview',
      voice_text: input.summary.summarySentence,
      duration: 4200,
      voiceTextSource: 'template',
    },
  ]

  for (let index = 0; index < input.nodes.length; index += 1) {
    const node = input.nodes[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    const reasonCard = buildReasonCard(node, input.summary, input.nodes, index)
    const localTip = buildLocalTip(node, input.summary)
    const tier = node.tier || resolveNodeTier(node, input.summary)
    steps.push({
      focus: node.name,
      voice_text: buildNodeVoiceText(node, input.summary, reasonCard, localTip, transition),
      duration: 5000,
      center: node.center,
      node_id: node.id,
      role: node.role,
      transition_reason: transition?.rationale,
      hotness: node.hotness,
      tagline: node.selectionReason || reasonCard.represents || null,
      tier,
      tierLabel: resolveNodeTierLabel(tier),
      reasonCard,
      localTip,
      tourStyle: input.summary.requestedStyle,
      tourStyleLabel: input.summary.requestedStyleLabel,
      webFactHint: buildWebFactHint(node),
      webFactSnippet: buildWebFactSnippet(node),
      boundary: node.boundary || null,
      voiceTextSource: 'template',
    })
  }

  return steps
}

/**
 * 骨架版（first paint）叙事步骤：
 *
 * 对应"分段下发"策略的 C 选项——概览模板 + 节点 LLM 后填：
 *   - overview step 用确定性 summarySentence（`voiceTextSource: 'template'`），
 *     用户必听；
 *   - 各节点 step 用短标题占位（`voiceTextSource: 'placeholder'`），
 *     等 final patch 到达后由 LLM 文案或 deterministic fallback 覆盖。
 *
 * 占位文案保留"可播报"属性——即使 final patch 异常未到达，用户听到的
 * 依旧是一个闭合的短句，不会是空字符串或调试日志。
 *
 * 骨架 step 会填充 reasonCard / localTip / webFactHint 等结构化字段，
 * 确保前端在骨架阶段就能展示节点卡片的基础信息（品类、层级、周边关联）。
 */
export function buildNarrativeStepsSkeleton(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
}) {
  const steps: NarrativeTourStep[] = [
    {
      focus: 'overview',
      voice_text: input.summary.summarySentence,
      duration: 4200,
      voiceTextSource: 'template',
    },
  ]

  for (let index = 0; index < input.nodes.length; index += 1) {
    const node = input.nodes[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    const reasonCard = buildReasonCard(node, input.summary, input.nodes, index)
    const localTip = buildLocalTip(node, input.summary)
    const tier = node.tier || resolveNodeTier(node, input.summary)
    const placeholderVoice = `${node.name}是当前视口中的${node.roleLabel}节点，可先用它定位这片区域的空间结构。`
    steps.push({
      focus: node.name,
      voice_text: placeholderVoice,
      duration: 5000,
      center: node.center,
      node_id: node.id,
      role: node.role,
      transition_reason: transition?.rationale,
      hotness: node.hotness,
      tagline: node.selectionReason || reasonCard.represents || null,
      tier,
      tierLabel: resolveNodeTierLabel(tier),
      reasonCard,
      localTip,
      tourStyle: input.summary.requestedStyle,
      tourStyleLabel: input.summary.requestedStyleLabel,
      webFactHint: null,
      webFactSnippet: null,
      boundary: node.boundary || null,
      voiceTextSource: 'placeholder',
    })
  }

  return steps
}

export function buildNarrativeAnswer(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  steps: NarrativeTourStep[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
}) {
  const stepByNodeId = new Map(
    input.steps
      .filter((step) => step.node_id)
      .map((step) => [String(step.node_id), step] as const),
  )
  const lines = [
    '## 当前视口画像',
    input.steps[0]?.voice_text || input.summary.summarySentence,
    '',
    '## 第一版导览顺序',
  ]

  input.nodes.forEach((node, index) => {
    const step = stepByNodeId.get(node.id)
    lines.push(`${index + 1}. **${node.name}** · ${resolveNodeTierLabel(node.tier || 'optional')} · ${node.roleLabel}`)
    // 骨架阶段的 voice_text 是占位符，写到 answer 里会显示"即将讲到：XXX..."，
    // 用户阅读脚本会感到突兀。placeholder 时退回到 selectionReason / reasons，
    // final patch 到来后再由新 answer 整体覆盖。
    const isPlaceholder = step?.voiceTextSource === 'placeholder'
    const narrationForAnswer = isPlaceholder
      ? (node.selectionReason || node.reasons.join(' / ') || step?.tagline || '讲解词生成中…')
      : (step?.voice_text || node.selectionReason || node.reasons.join(' / '))
    lines.push(`   - 解说词：${narrationForAnswer}`)
    if (step?.reasonCard?.nearbyConnections?.length) {
      lines.push(`   - 周边关联：${step.reasonCard.nearbyConnections.join('、')}`)
    }
    if (step?.webFactSnippet) {
      lines.push(`   - 网页补充：${step.webFactSnippet}`)
    }
    if (index > 0) {
      lines.push(`   - 转场逻辑：${step?.transition_reason || input.transitions[index - 1]?.rationale || '承接上一节点继续展开。'}`)
    }
  })

  lines.push('')
  lines.push('## 编排方式')
  lines.push(`当前采用 **${input.summary.requestedStyleLabel}** 视角，把区域地标、入口、生活节点和背景信息串成一条可播放的导览骨架。`)
  return lines.join('\n')
}
