import { centerFromBoundary } from './geometry.js'
import type { StoryTag } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'

export type RegionSemanticKind =
  | 'education'
  | 'ecology'
  | 'commercial'
  | 'food'
  | 'market'
  | 'heritage'
  | 'transport'
  | 'civic'
  | 'community'
  | 'leisure'
  | 'landmark'
  | 'mixed'

export type RegionRelationType =
  | 'spatial_nearby'
  | 'core_support'
  | 'functional_complement'
  | 'same_function'
  | 'entrance_gateway'
  | 'heritage_modern'
  | 'campus_ecology_edge'
  | 'campus_life_support'
  | 'commerce_food_synergy'
  | 'market_street_life'
  | 'waterfront_leisure_axis'
  | 'culture_heritage_context'
  | 'civic_service_support'
  | 'landmark_orientation'
  | 'ecological_buffer'

export interface RegionRelation {
  type: RegionRelationType
  strength: number
  reason: string
  evidence: string[]
}

const EDUCATION_RE = /(大学|学院|学校|校区|校园|图书馆|科技馆|文化馆|艺术馆|美术馆|研究院|科教|education|university|college|campus)/iu
const ECOLOGY_RE = /(公园|湖|山|江滩|湿地|绿道|景区|风景|生态|森林|游园|绿地|park|lake|riverfront|wetland)/iu
const COMMERCIAL_RE = /(商圈|商业|步行街|购物|商场|广场|万达|万象|天地|汉街|销品茂|餐饮|美食|小吃|咖啡|影院|娱乐|mall|plaza)/iu
const FOOD_RE = /(餐饮|美食|小吃|餐厅|饭店|酒楼|火锅|烧烤|咖啡|茶|饮品|面馆|粉面|包子|汽水包|鸡冠饺|宵夜|夜宵)/iu
const MARKET_RE = /(市场|菜场|集市|批发|农贸|夜市|汉正街|水塔街|保成路|大成路|虎泉)/iu
const HERITAGE_RE = /(历史|老街|古迹|纪念馆|博物馆|昙华林|黎黄陂路|吉庆街|汉正街|水塔街|heritage|museum)/iu
const TRANSPORT_RE = /(地铁|车站|火车站|机场|码头|渡口|枢纽|公交|交通|站口|入口|出口|station|airport|terminal|metro)/iu
const CIVIC_RE = /(医院|政府|政务|服务中心|体育馆|体育场|会展|公共|hospital|civic|government)/iu
const COMMUNITY_RE = /(社区|街道|邻里|生活服务|便民|卫生服务|银行|超市|便利店|居民|里份|坊|巷)/iu
const LEISURE_RE = /(休闲|娱乐|影院|影城|体育|健身|游乐|酒店|民宿|茶馆|咖啡|公园|广场)/iu
const LANDMARK_RE = /(地标|景点|景区|塔|楼|桥|中心|馆|门|城|黄鹤楼|电视塔|广场|纪念)/iu

interface RelationContext {
  previousKind: RegionSemanticKind
  currentKind: RegionSemanticKind
  previousTags: Set<StoryTag>
  currentTags: Set<StoryTag>
  sharedTags: StoryTag[]
  distanceKm: number
}

export function classifyRegionSemantic(candidate: RegionCandidate): RegionSemanticKind {
  const text = semanticText(candidate)
  const scores: Array<[RegionSemanticKind, number]> = [
    ['education', scorePattern(text, EDUCATION_RE) + tagScore(candidate, 'education', 'campus', 'culture')],
    ['ecology', scorePattern(text, ECOLOGY_RE) + tagScore(candidate, 'ecology', 'waterfront')],
    ['food', scorePattern(text, FOOD_RE) + tagScore(candidate, 'food', 'nightlife')],
    ['market', scorePattern(text, MARKET_RE) + tagScore(candidate, 'market', 'nightlife')],
    ['commercial', scorePattern(text, COMMERCIAL_RE) + tagScore(candidate, 'commerce')],
    ['heritage', scorePattern(text, HERITAGE_RE) + tagScore(candidate, 'heritage', 'culture')],
    ['transport', scorePattern(text, TRANSPORT_RE) + tagScore(candidate, 'transit')],
    ['civic', scorePattern(text, CIVIC_RE)],
    ['community', scorePattern(text, COMMUNITY_RE) + tagScore(candidate, 'community', 'urban_life')],
    ['leisure', scorePattern(text, LEISURE_RE) + tagScore(candidate, 'leisure')],
    ['landmark', scorePattern(text, LANDMARK_RE) + tagScore(candidate, 'landmark')],
  ]
  const best = scores.sort((left, right) => right[1] - left[1])[0]
  return best && best[1] > 0 ? best[0] : 'mixed'
}

export function buildRegionRelation(previous: RegionCandidate, current: RegionCandidate): RegionRelation {
  const context = buildRelationContext(previous, current)
  const evidence = baseEvidence(context)

  if (isTransportGateway(context)) {
    return {
      type: 'entrance_gateway',
      strength: relationStrength(context, 0.74),
      reason: `从${previous.display_name}转向${current.display_name}，相当于从交通入口进入这一带的主要活动腹地。`,
      evidence: [...evidence, '入口转场'],
    }
  }

  if (isCampusEcology(context)) {
    return {
      type: 'campus_ecology_edge',
      strength: relationStrength(context, 0.88),
      reason: `从${previous.display_name}转到${current.display_name}，能看到校园文化和开放绿地、水岸空间之间的衔接。`,
      evidence: [...evidence, '校园生态边缘'],
    }
  }

  if (isCampusLifeSupport(context)) {
    return {
      type: 'campus_life_support',
      strength: relationStrength(context, 0.83),
      reason: `从${previous.display_name}延伸到${current.display_name}，可以把学习文化和周边日常消费、生活配套连起来看。`,
      evidence: [...evidence, '校园生活支撑'],
    }
  }

  if (isCommerceFoodSynergy(context)) {
    return {
      type: 'commerce_food_synergy',
      strength: relationStrength(context, 0.84),
      reason: `从${previous.display_name}接到${current.display_name}，商业人流和餐饮烟火气在这一段相互放大。`,
      evidence: [...evidence, '商业餐饮协同'],
    }
  }

  if (isMarketStreetLife(context)) {
    return {
      type: 'market_street_life',
      strength: relationStrength(context, 0.82),
      reason: `从${previous.display_name}讲到${current.display_name}，能把街巷市场和本地生活气连成一条线。`,
      evidence: [...evidence, '街巷市场生活'],
    }
  }

  if (isWaterfrontLeisure(context)) {
    return {
      type: 'waterfront_leisure_axis',
      strength: relationStrength(context, 0.82),
      reason: `从${previous.display_name}转向${current.display_name}，水岸、绿地和休闲活动形成了更舒展的游览轴线。`,
      evidence: [...evidence, '滨水休闲轴线'],
    }
  }

  if (isCultureHeritageContext(context)) {
    return {
      type: 'culture_heritage_context',
      strength: relationStrength(context, 0.8),
      reason: `从${previous.display_name}接到${current.display_name}，可以把文化设施和历史记忆放在同一个时间层次里理解。`,
      evidence: [...evidence, '文化历史上下文'],
    }
  }

  if (isHeritageModern(context)) {
    return {
      type: 'heritage_modern',
      strength: relationStrength(context, 0.76),
      reason: `从${previous.display_name}转到${current.display_name}，能把历史街区记忆和当代城市活力连起来看。`,
      evidence: [...evidence, '历史与现代'],
    }
  }

  if (isCivicServiceSupport(context)) {
    return {
      type: 'civic_service_support',
      strength: relationStrength(context, 0.74),
      reason: `从${previous.display_name}转向${current.display_name}，能看到公共服务如何支撑周边的日常活动。`,
      evidence: [...evidence, '公共服务支撑'],
    }
  }

  if (isLandmarkOrientation(context)) {
    return {
      type: 'landmark_orientation',
      strength: relationStrength(context, 0.7),
      reason: `从${previous.display_name}转到${current.display_name}，可以用醒目的地标帮助定位当前视野里的空间方向。`,
      evidence: [...evidence, '地标定向'],
    }
  }

  if (isEcologicalBuffer(context)) {
    return {
      type: 'ecological_buffer',
      strength: relationStrength(context, 0.72),
      reason: `从${previous.display_name}过渡到${current.display_name}，能看到生态开放空间对周边城市功能的缓冲作用。`,
      evidence: [...evidence, '生态缓冲'],
    }
  }

  if (isFunctionalComplement(context)) {
    return {
      type: 'functional_complement',
      strength: relationStrength(context, 0.82),
      reason: functionalComplementReason(previous, current, context.previousKind, context.currentKind),
      evidence: [...evidence, '功能互补'],
    }
  }

  if (isCoreSupportRelation(previous, current)) {
    return {
      type: 'core_support',
      strength: relationStrength(context, 0.78),
      reason: `从${previous.display_name}延伸到${current.display_name}，可以看到主体片区和周边支撑空间的关系。`,
      evidence: [...evidence, '主从角色'],
    }
  }

  if (context.previousKind === context.currentKind && context.previousKind !== 'mixed') {
    return {
      type: 'same_function',
      strength: relationStrength(context, 0.46),
      reason: `沿着同一类${semanticLabel(context.currentKind)}空间继续展开到${current.display_name}，保持讲解主题的连续性。`,
      evidence: [...evidence, '同类延展'],
    }
  }

  return {
    type: 'spatial_nearby',
    strength: relationStrength(context, 0.34),
    reason: `从${previous.display_name}顺着相邻空间转到${current.display_name}，让当前视野的空间关系逐步展开。`,
    evidence,
  }
}

function buildRelationContext(previous: RegionCandidate, current: RegionCandidate): RelationContext {
  const previousTags = new Set(previous.story_tags || [])
  const currentTags = new Set(current.story_tags || [])
  return {
    previousKind: classifyRegionSemantic(previous),
    currentKind: classifyRegionSemantic(current),
    previousTags,
    currentTags,
    sharedTags: [...previousTags].filter((tag) => currentTags.has(tag)),
    distanceKm: distanceKm(previous, current),
  }
}

function baseEvidence(context: RelationContext): string[] {
  const evidence = [`${semanticLabel(context.previousKind)}→${semanticLabel(context.currentKind)}`, `距离${context.distanceKm.toFixed(1)}公里`]
  if (context.sharedTags.length > 0) evidence.push(`共享线索:${context.sharedTags.join('/')}`)
  return evidence
}

function relationStrength(context: RelationContext, base: number): number {
  const distanceBonus = clamp((2.8 - context.distanceKm) / 2.8, 0, 1) * 0.06
  const sharedTagBonus = Math.min(0.08, context.sharedTags.length * 0.035)
  const sameSemanticPenalty = context.previousKind === context.currentKind && context.previousKind !== 'mixed' ? 0.025 : 0
  const farPenalty = context.distanceKm > 8 ? Math.min(0.08, (context.distanceKm - 8) * 0.01) : 0
  return Number(clamp(base + distanceBonus + sharedTagBonus - sameSemanticPenalty - farPenalty, 0.18, 0.96).toFixed(3))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function semanticText(candidate: RegionCandidate): string {
  return [
    candidate.display_name,
    candidate.role,
    candidate.source,
    ...(candidate.story_tags || []),
    ...candidate.pois.slice(0, 80).flatMap((poi) => [poi.display_name, poi.category_main || '', poi.role]),
    ...candidate.narrative_facts.slice(0, 20).map((fact) => fact.claim),
  ].join(' ')
}

function tagScore(candidate: RegionCandidate, ...tags: StoryTag[]): number {
  const set = new Set(candidate.story_tags || [])
  return tags.reduce((sum, tag) => sum + (set.has(tag) ? 1.3 : 0), 0)
}

function scorePattern(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))
  return matches?.length || 0
}

function isCoreSupportRelation(previous: RegionCandidate, current: RegionCandidate): boolean {
  return previous.role === 'primary_region'
    && (current.role === 'support_region' || current.role === 'landmark_anchor')
    && sameLocalContext(previous, current)
}

function sameLocalContext(previous: RegionCandidate, current: RegionCandidate): boolean {
  return distanceKm(previous, current) <= 2.2
}

function isTransportGateway(context: RelationContext): boolean {
  return context.previousKind === 'transport' && context.currentKind !== 'transport'
}

function isHeritageModern(context: RelationContext): boolean {
  return pairHas(context, 'heritage', 'commercial') || pairHas(context, 'heritage', 'food') || pairHas(context, 'heritage', 'market')
}

function isCampusEcology(context: RelationContext): boolean {
  return (kindOrTag(context, 'education', 'campus', 'education') && kindOrTag(context, 'ecology', 'ecology', 'waterfront'))
}

function isCampusLifeSupport(context: RelationContext): boolean {
  return kindOrTag(context, 'education', 'campus', 'education') && hasAnyCityLife(context)
}

function isCommerceFoodSynergy(context: RelationContext): boolean {
  return kindOrTag(context, 'commercial', 'commerce') && (kindOrTag(context, 'food', 'food', 'nightlife') || kindOrTag(context, 'market', 'market'))
}

function isMarketStreetLife(context: RelationContext): boolean {
  return kindOrTag(context, 'market', 'market', 'nightlife') && (kindOrTag(context, 'food', 'food') || kindOrTag(context, 'community', 'community', 'urban_life') || kindOrTag(context, 'commercial', 'commerce'))
}

function isWaterfrontLeisure(context: RelationContext): boolean {
  return hasAnyTag(context, 'waterfront') && (kindOrTag(context, 'leisure', 'leisure') || kindOrTag(context, 'commercial', 'commerce') || kindOrTag(context, 'food', 'food'))
}

function isCultureHeritageContext(context: RelationContext): boolean {
  return kindOrTag(context, 'heritage', 'heritage') && hasAnyTag(context, 'culture')
}

function isCivicServiceSupport(context: RelationContext): boolean {
  return kindOrTag(context, 'civic') && (hasAnyCityLife(context) || kindOrTag(context, 'ecology', 'ecology'))
}

function isLandmarkOrientation(context: RelationContext): boolean {
  return kindOrTag(context, 'landmark', 'landmark') && context.distanceKm <= 4
}

function isEcologicalBuffer(context: RelationContext): boolean {
  return kindOrTag(context, 'ecology', 'ecology', 'waterfront') && (kindOrTag(context, 'civic') || kindOrTag(context, 'commercial', 'commerce') || kindOrTag(context, 'community', 'community'))
}

function isFunctionalComplement(context: RelationContext): boolean {
  const pair = new Set([context.previousKind, context.currentKind])
  if (pair.has('mixed')) return false
  return (pair.has('education') && pair.has('ecology'))
    || (pair.has('education') && pair.has('commercial'))
    || (pair.has('commercial') && pair.has('ecology'))
    || (pair.has('civic') && pair.has('commercial'))
    || (pair.has('civic') && pair.has('ecology'))
}

function pairHas(context: RelationContext, left: RegionSemanticKind, right: RegionSemanticKind): boolean {
  return (context.previousKind === left && context.currentKind === right) || (context.previousKind === right && context.currentKind === left)
}

function kindOrTag(context: RelationContext, kind: RegionSemanticKind, ...tags: StoryTag[]): boolean {
  return context.previousKind === kind || context.currentKind === kind || hasAnyTag(context, ...tags)
}

function hasAnyCityLife(context: RelationContext): boolean {
  return kindOrTag(context, 'commercial', 'commerce')
    || kindOrTag(context, 'food', 'food', 'nightlife')
    || kindOrTag(context, 'market', 'market')
    || kindOrTag(context, 'community', 'community', 'urban_life')
    || kindOrTag(context, 'leisure', 'leisure')
}

function hasAnyTag(context: RelationContext, ...tags: StoryTag[]): boolean {
  return tags.some((tag) => context.previousTags.has(tag) || context.currentTags.has(tag))
}

function functionalComplementReason(previous: RegionCandidate, current: RegionCandidate, previousKind: RegionSemanticKind, currentKind: RegionSemanticKind): string {
  const pair = new Set([previousKind, currentKind])
  if (pair.has('education') && pair.has('ecology')) {
    return `从${previous.display_name}转到${current.display_name}，能看到教育文化空间和开放生态空间之间的衔接。`
  }
  if (pair.has('commercial') && pair.has('ecology')) {
    return `讲完${previous.display_name}再看${current.display_name}，可以比较消费活力和公共生态空间的过渡。`
  }
  if (pair.has('education') && pair.has('commercial')) {
    return `从${previous.display_name}转向${current.display_name}，能看到科教文化片区和周边生活消费配套的联系。`
  }
  return `从${previous.display_name}转向${current.display_name}，可以看到不同城市功能在当前视野里的互补关系。`
}

function semanticLabel(kind: RegionSemanticKind): string {
  const labels: Record<RegionSemanticKind, string> = {
    education: '教育文化',
    ecology: '生态休闲',
    commercial: '商业消费',
    food: '餐饮烟火',
    market: '街市生活',
    heritage: '历史文旅',
    transport: '交通入口',
    civic: '公共服务',
    community: '社区生活',
    leisure: '休闲活动',
    landmark: '地标识别',
    mixed: '混合城市',
  }
  return labels[kind]
}

function distanceKm(previous: RegionCandidate, current: RegionCandidate): number {
  const [leftLon, leftLat] = centerFromBoundary(previous.boundary)
  const [rightLon, rightLat] = centerFromBoundary(current.boundary)
  const midLat = ((leftLat + rightLat) / 2) * Math.PI / 180
  const dx = (leftLon - rightLon) * 111.32 * Math.cos(midLat)
  const dy = (leftLat - rightLat) * 110.54
  return Math.sqrt(dx * dx + dy * dy)
}
