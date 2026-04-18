import type { EvidenceItem, RegionFeatureTag } from '../chat/types.js'
import { classifyRepresentativeAnchorType } from '../evidence/areaInsight/representativeAnchorPriority.js'
import type {
  NarrativeNode,
  NarrativeNodeBoundary,
  NarrativeTourStep,
  NarrativeTourTransition,
  NarrativeViewportSummary,
} from './types.js'
import {
  transformGeoJsonCoordinatesWgs84ToGcj02,
  wgs84ToGcj02,
} from './gcj02.js'

/**
 * Name 关键字词典：OSM landuse fclass 常把政府/党政/法院/学校等随手标为 `commercial`，
 * 导致“中共湖北省委员会”这类 POI 被推断成 commercial_anchor 、roleLabel 写成“商业街区”。
 * 用 name 词典在 classifyRepresentativeAnchorType 之前提前拦截，把 role 切到专属锪点。
 */
const CIVIC_NAME_PATTERN = /(党委|党政|人民政府|市政府|区政府|县政府|镇政府|街道办事处|街道办|人民代表大会|政协|党校|新闻办公室|公安(?:分?局)|派出所|消防(?:局|大队)|人民法院|人民检察院|法院|检察院|司法局|纪委|监委|管理委员会|政务服务中心|党群服务中心|社会保障局|民政局|税务局|交通局|规划局|教育局|卫生健康委员会|卫健委|中共.{0,8}委员会|中共.{0,8}省委|中共.{0,8}市委|中共.{0,8}区委)/u

const CULTURE_NAME_PATTERN = /(博物馆|纪念馆|展览馆|文化馆|艺术馆|美术馆|图书馆|科技馆|规划馆|展览中心|剧院|大剧院|音乐厅|文化中心|文化广场|文化城|遗址公园|文保单位|文物)/u

const RELIGION_NAME_PATTERN = /(寺(?:院)?|庙|神社|教堂|道观|清真寺|清真堂|佛堂|禅寺|归元寺|宝通寺)/u

const MEDICAL_NAME_PATTERN = /(人民医院|中医院|妇幼保健院|急救中心|疾控中心|卫生院|社区卫生服务中心|医院(?:总部|分院|门诊部)?|门诊部|防疫站)/u

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

/**
 * 从 name 词典推断专属锪点 role；命中则覆盖 fclass 级分类，避免政务/文化被当成 commercial。
 * 返回 null 表示 name 未命中任何专属锪点，由调用方继续走 fclass / anchor type 原逻辑。
 */
export function resolveRoleFromCivicName(name: string): string | null {
  if (!name) return null
  if (MEDICAL_NAME_PATTERN.test(name)) return 'medical_anchor'
  if (CIVIC_NAME_PATTERN.test(name)) return 'civic_anchor'
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

function isUniversityCampusName(name: string) {
  const text = normalizeName(name)
  return (/(大学|学院)/u.test(text) || /(university|college)/iu.test(text))
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

function isMicroFacilityName(name: string) {
  const text = normalizeName(name)
  return /(宿舍|学生公寓|公寓[A-Z0-9一二三四五六七八九十]*栋|[A-Z0-9一二三四五六七八九十]+栋|楼栋|教学楼|实验楼|食堂|便利店|驿站|快递站|菜鸟|停车场|门岗|门卫|出入口|入口|出口|东门|西门|南门|北门|厕所|卫生间|店\)|店$|分店$)/u.test(text)
    || /(大学|学院|校区).*(图书馆|体育馆|教学楼|实验楼|行政楼|食堂|宿舍|学生公寓|便利店|快递站|驿站)/u.test(text)
    || /(蔬菜批发|批发夜市|批发市场|农贸市场|菜市场|水果批发|果批|海鲜市场|水产市场|建材市场|汽配城)/u.test(text)
}

function hasRepresentativeClusterSupport(node: NarrativeNode) {
  return node.source === 'aoi_context'
    || (node.childPoiIds?.length || 0) >= 2
    || Boolean(node.encoderSummary)
}

function passesRepresentativeEntityStandard(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const name = normalizeName(node.name)
  if (!name) return false
  if (isGenericCategoryName(name)) return false
  if (isMicroFacilityName(name)) return false
  if (isBasicEducationName(name) || isVocationalEducationName(name)) return false
  if (node.role === 'campus_anchor' && !isUniversityCampusName(name)) return false
  if (node.role === 'local_life_anchor' && !hasRepresentativeClusterSupport(node)) return false
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

export function resolveRoleLabel(role: string) {
  if (role === 'scenic_landmark') return '景区地标'
  if (role === 'campus_anchor') return '高校锚点'
  if (role === 'medical_anchor') return '医疗配套'
  if (role === 'commercial_anchor') return '商业街区'
  if (role === 'food_street_anchor') return '小吃街区'
  if (role === 'transit_connector') return '交通节点'
  if (role === 'local_life_anchor') return '本地生活'
  if (role === 'civic_anchor') return '政务配套'
  if (role === 'culture_anchor') return '文化场馆'
  if (role === 'religious_anchor') return '宗教场所'
  return '片区节点'
}

export function resolveRoleWeight(role: string) {
  if (role === 'scenic_landmark') return 0.96
  if (role === 'commercial_anchor') return 0.88
  if (role === 'food_street_anchor') return 0.86
  if (role === 'culture_anchor') return 0.84
  if (role === 'campus_anchor') return 0.82
  if (role === 'medical_anchor') return 0.78
  if (role === 'local_life_anchor') return 0.76
  if (role === 'civic_anchor') return 0.7
  if (role === 'religious_anchor') return 0.68
  if (role === 'transit_connector') return 0.6
  return 0.52
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
  if (/(商业|商圈|零售|购物|retail|mall|commercial)/iu.test(text)) return '商业'
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
  return '片区综览'
}

function representativeSupportScore(node: NarrativeNode) {
  const childCount = node.childPoiIds?.length || 0
  const hasAoiSupport = (node.tags || []).some((tag) => tag === 'aoi_support')
  if (node.source === 'aoi_context') return 4
  if (hasAoiSupport) return 3.8
  if (node.source === 'brand_cluster' && childCount >= 2) return 3 + Math.min(childCount, 6) * 0.12
  if (node.source === 'brand_cluster') return 1.4
  if (childCount >= 4) return 1.8
  if (childCount >= 2) return 1.3
  return 1
}

function hasStableRepresentativeSupport(node: NarrativeNode) {
  return representativeSupportScore(node) >= 3
}

function resolveBucketOrder(mode: string) {
  if (mode === 'campus_to_commerce') return ['景观', '文化', '宗教', '商业', '小吃', '生活', '校园', '医疗', '政务', '交通', '片区']
  if (mode === 'district_sweep') return ['商业', '小吃', '景观', '文化', '宗教', '生活', '校园', '医疗', '政务', '交通', '片区']
  return ['景观', '文化', '宗教', '商业', '小吃', '生活', '校园', '医疗', '政务', '交通', '片区']
}

function topEncoderTagScore(node: NarrativeNode) {
  const scores = (node.encoderTags || []).map((item) => Number(item.score || 0)).filter((item) => Number.isFinite(item))
  return scores.length > 0 ? Math.max(...scores) : 0
}

function buildSelectionReason(node: NarrativeNode, summary: NarrativeViewportSummary) {
  const bucket = node.sceneBucket || inferNodeSceneBucket(node)
  const lead = resolveSceneBucketLead(bucket)
  const roleLabel = node.roleLabel || '片区节点'

  // 角色优先：根据角色生成核心描述，encoder 数据仅作补充
  if (roleLabel === '景区地标') {
    const topTag = (node.encoderTags || []).find((item) => Number(item.score || 0) >= 0.72)
    const tagHint = topTag?.label ? `，${topTag.label}特色突出` : ''
    return `${node.name}是这片区域的核心${roleLabel}，代表“${lead}”导览主线${tagHint}。`
  }
  if (roleLabel === '高校锚点') return `${node.name}是区域核心${roleLabel}，代表“${lead}”导览主线。`
  if (roleLabel === '医疗配套') return `${node.name}是区域重要${roleLabel}，代表“${lead}”导览主线。`
  if (roleLabel === '商业街区') return `${node.name}是区域核心${roleLabel}，代表“${lead}”导览主线。`
  if (roleLabel === '小吃街区') return `${node.name}是区域特色${roleLabel}，代表“${lead}”导览主线。`
  if (roleLabel === '本地生活') return `${node.name}是区域日常${roleLabel}节点，补足“${lead}”导览主线。`
  if (roleLabel === '政务配套') return `${node.name}是这片区域的${roleLabel}中枢，补足“${lead}”导览主线。`
  if (roleLabel === '文化场馆') return `${node.name}是区域核心${roleLabel}，代表“${lead}”导览主线。`
  if (roleLabel === '宗教场所') return `${node.name}是这片区域的${roleLabel}，承载“${lead}”导览主线。`

  // 非锚点角色：有高分 encoder 标签时补充语义
  const topTag = (node.encoderTags || []).find((item) => Number(item.score || 0) >= 0.72)
  if (topTag?.label) {
    return `${node.name}更适合作为这片区域里的"${topTag.label}"代表点。`
  }
  return `${node.name}能补足"${lead}"这条导览主线。`
}

function computeNarrativeFit(node: NarrativeNode, summary: NarrativeViewportSummary, bucketOrder: string[]) {
  const bucket = inferNodeSceneBucket(node)
  const bucketIndex = Math.max(bucketOrder.indexOf(bucket), 0)
  const bucketBoost = Math.max(0, 0.24 - bucketIndex * 0.04)
  const encoderBoost = Math.min(topEncoderTagScore(node), 1) * 0.2
  const summaryBoost = node.encoderSummary ? 0.1 : 0
  const sceneAlign = summary.sceneMix.some((item) => matchesSceneBucket(item, bucket)) ? 0.08 : 0
  const supportBoost = Math.min((representativeSupportScore(node) - 1) * 0.06, 0.22)
  const singletonPenalty = node.source === 'brand_cluster' && (node.childPoiIds?.length || 0) <= 1 ? 0.04 : 0
  return Number((node.score + bucketBoost + encoderBoost + summaryBoost + sceneAlign + supportBoost - singletonPenalty).toFixed(3))
}

function hasStrongSemanticSignal(node: NarrativeNode, summary: NarrativeViewportSummary) {
  if (hasStableRepresentativeSupport(node)) return true
  const topScore = topEncoderTagScore(node)
  const bucket = inferNodeSceneBucket(node)
  const sceneAlign = summary.sceneMix.some((item) => matchesSceneBucket(item, bucket))
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
  if (node.role === 'district_anchor') risk += 0.08
  if (node.role === 'local_life_anchor' && topScore < 0.58) risk += 0.06
  if (summary.sceneMix.includes('高校') && isBasicEducationName(node.name)) risk += 0.22
  if (isGenericCategoryName(node.name)) risk += 0.3
  if (isMicroFacilityName(node.name)) risk += 0.32
  if (node.role === 'local_life_anchor' && !hasRepresentativeClusterSupport(node)) risk += 0.12
  if (isGenericNarrativeNoise(node) && topScore < 0.76 && !node.encoderSummary) risk += 0.24
  if (normalizeName(node.name).length <= 4 && topScore < 0.68 && !node.encoderSummary) risk += 0.1
  if (bucket === '片区' && topScore < 0.6 && !node.encoderSummary) risk += 0.12
  return Number(risk.toFixed(3))
}

function isNarrativeEligible(node: NarrativeNode, summary: NarrativeViewportSummary) {
  if (!passesRepresentativeEntityStandard(node, summary)) {
    return false
  }
  if (node.role === 'scenic_landmark' || node.role === 'campus_anchor' || node.role === 'medical_anchor' || node.role === 'commercial_anchor') {
    return computeNoiseRisk(node, summary) <= 0.42
  }
  return hasStrongSemanticSignal(node, summary) && computeNoiseRisk(node, summary) <= 0.34
}

const ROLE_MAX_CAP: Record<string, number> = {
  scenic_landmark: 7,
  campus_anchor: 3,
  medical_anchor: 1,
  commercial_anchor: 5,
  food_street_anchor: 3,
  local_life_anchor: 2,
  transit_connector: 1,
  district_anchor: 1,
}

const BUCKET_MAX_CAP: Record<string, number> = {
  景观: 7,
  医疗: 1,
  校园: 3,
  商业: 5,
  小吃: 3,
  生活: 2,
  交通: 1,
  片区: 1,
}

function canAppendNarrativeNode(selected: NarrativeNode[], candidate: NarrativeNode, limit: number) {
  if (candidate.cellId && selected.some((item) => item.cellId && item.cellId === candidate.cellId)) {
    return false
  }
  // 按 name 强去重，避免「湖北大学」与「湖北大学三期公寓」同时入选
  const candidateName = normalizeName(candidate.name)
  if (candidateName && selected.some((item) => normalizeName(item.name) === candidateName)) {
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

  return !selected.some((item) => {
    const itemBucket = inferNodeSceneBucket(item)
    return haversine(item.center, candidate.center) < 300
      && (item.role === candidate.role || itemBucket === bucket)
  })
}

function isMeaningfullyBetterReplacement(
  current: NarrativeNode,
  candidate: NarrativeNode,
  summary: NarrativeViewportSummary,
  bucketOrder: string[],
) {
  const currentRisk = computeNoiseRisk(current, summary)
  const candidateRisk = computeNoiseRisk(candidate, summary)
  const currentFit = computeNarrativeFit(current, summary, bucketOrder)
  const candidateFit = computeNarrativeFit(candidate, summary, bucketOrder)
  const supportDelta = representativeSupportScore(candidate) - representativeSupportScore(current)
  if (candidateRisk + 0.1 < currentRisk) return true
  if (supportDelta >= 1 && candidateFit >= currentFit - 0.04) return true
  return candidateFit > currentFit + 0.1
}

function reviewSelectedNodes(selected: NarrativeNode[], ranked: NarrativeNode[], summary: NarrativeViewportSummary, limit: number) {
  const revised = [...selected]
  const bucketOrder = resolveBucketOrder(resolveNarrativeMode(summary))
  for (let index = 0; index < revised.length; index += 1) {
    const current = revised[index]
    const currentRisk = computeNoiseRisk(current, summary)
    if (currentRisk < 0.34 && (hasStrongSemanticSignal(current, summary) || hasStableRepresentativeSupport(current))) continue
    const replacement = ranked.find((candidate) => {
      if (revised.some((item) => item.id === candidate.id)) return false
      if (!isNarrativeEligible(candidate, summary)) return false
      const trial = revised.filter((_, candidateIndex) => candidateIndex !== index)
      if (!canAppendNarrativeNode(trial, candidate, limit)) return false
      return isMeaningfullyBetterReplacement(current, candidate, summary, bucketOrder)
    })
    if (replacement) {
      revised[index] = replacement
    }
  }
  return revised
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
  if (input.candidates.some((item) => item.role === 'local_life_anchor')) mix.add('本地生活')
  return [...mix]
}

export function buildNarrativeViewportSummary(input: {
  featureTags: RegionFeatureTag[]
  featureSummary: string
  encoderSummary?: string | null
  encoderTags?: RegionFeatureTag[]
  encoderSceneTags?: string[]
  encoderDominantBuckets?: string[]
  candidates: NarrativeNode[]
}) {
  const sceneMix = inferSceneMix({
    featureTags: input.featureTags,
    encoderSceneTags: input.encoderSceneTags,
    candidates: input.candidates,
  })
  const dominantScene = sceneMix[0] || '混合片区'
  const summarySentence = input.encoderSummary
    || (sceneMix.length > 0
      ? `这片区域更像一个${sceneMix.join(' + ')}叠加的混合片区，适合按代表地标到生活节点的顺序展开。`
      : input.featureSummary)

  const summary: NarrativeViewportSummary = {
    dominantScene,
    sceneMix,
    summarySentence,
    featureTags: input.featureTags,
    encoderSummary: input.encoderSummary || null,
    encoderTags: input.encoderTags || [],
    sceneTags: input.encoderSceneTags || [],
    dominantBuckets: input.encoderDominantBuckets || [],
  }

  return summary
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
    const key = node.name.toLowerCase()
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

export function rankNarrativeNodes(candidates: NarrativeNode[], summary: NarrativeViewportSummary, limit = 7) {
  const mode = resolveNarrativeMode(summary)
  const bucketOrder = resolveBucketOrder(mode)
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
    .map((node) => ({ node, fit: computeNarrativeFit(node, summary, bucketOrder) }))
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
    // 硬约束：职业院校和基础教育绝不能通过 fallback 池混入导览
    if (isVocationalEducationName(normalizeName(candidate.name))) continue
    if (isBasicEducationName(normalizeName(candidate.name))) continue
    if (!canAppendNarrativeNode(selected, candidate, limit)) continue
    selected.push(candidate)
  }

  const reviewed = reviewSelectedNodes(selected, ranked.map((item) => item.node), summary, limit)

  return {
    narrativeMode: mode,
    selectedNodes: reviewed.sort((left, right) => {
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
  if (fromBucket === toBucket) return `继续沿着“${fromBucket}”这条线展开，把这一层区域语义讲完整。`
  return `从${from.roleLabel}转到${to.roleLabel}，把这片区域的“${fromBucket}—${toBucket}”两层结构串起来。`
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

function buildNodeVoiceText(node: NarrativeNode, transition?: NarrativeTourTransition | null) {
  const intro = transition ? `${transition.rationale} 接着看 ${node.name}。` : `先看 ${node.name}。`
  // 将 OSM fclass 英文分类 中文化，并对政务/文化/宗教/医疗用 name 词典覆写，
  // 避免 voice_text 出现“commercial 代表点”这类中英文混合 / 分类错误的描述。
  const categoryText = zhFriendlyCategory(node)
  const reasonText = node.selectionReason || node.encoderSummary || `${node.name}是这片区域里比较有代表性的${node.roleLabel}。`
  const factLabels = (node.webFacts?.labels || []).length > 0 ? `（${node.webFacts!.labels.join('、')}）` : ''
  // factSnippet 不再拼接进 voice_text，改由前端 narrator 卡片用独立底色展示（标识为网页来源），
  // 配合 webFactHint 规范化 UI。打字机正文只保留事实标签。
  return `${intro}${node.name}更像这里的“${categoryText}”代表点${factLabels}。${reasonText}`
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
    },
  ]

  for (let index = 0; index < input.nodes.length; index += 1) {
    const node = input.nodes[index]
    const transition = index > 0 ? input.transitions[index - 1] : null
    steps.push({
      focus: node.name,
      voice_text: buildNodeVoiceText(node, transition),
      duration: 5000,
      center: node.center,
      node_id: node.id,
      role: node.role,
      transition_reason: transition?.rationale,
      hotness: node.hotness,
      tagline: node.selectionReason || node.encoderSummary || null,
      webFactHint: buildWebFactHint(node),
      webFactSnippet: buildWebFactSnippet(node),
      boundary: node.boundary || null,
    })
  }

  return steps
}

export function buildNarrativeAnswer(input: {
  summary: NarrativeViewportSummary
  nodes: NarrativeNode[]
  transitions: NarrativeTourTransition[]
  narrativeMode: string
}) {
  const lines = [
    '## 当前视口画像',
    input.summary.summarySentence,
    '',
    '## 第一版导览顺序',
  ]

  input.nodes.forEach((node, index) => {
    lines.push(`${index + 1}. **${node.name}** · ${node.roleLabel}`)
    lines.push(`   - 代表理由：${node.selectionReason || node.encoderSummary || node.reasons.join(' / ')}`)
    const factLabels = node.webFacts?.labels || []
    if (factLabels.length > 0) {
      lines.push(`   - 事实标签：${factLabels.join('、')}`)
    }
    if (index > 0) {
      lines.push(`   - 转场逻辑：${input.transitions[index - 1]?.rationale || '承接上一节点继续展开。'}`)
    }
  })

  lines.push('')
  lines.push('## 编排方式')
  lines.push(`当前采用 **${input.narrativeMode}** 顺序，把区域地标、功能锚点和生活节点串成一条可播放的导览骨架。`)
  return lines.join('\n')
}
