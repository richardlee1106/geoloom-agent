import type { LODLevel, NarrativeChapter, NarrativeFact, NarrativePathNode, NarrativeRouteStrategy, NarrationTone, SceneProfile, UserContext } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'
import { storyTagPhrase } from './storyTags.js'

type ExplorationFocus = 'comprehensive' | 'commerce' | 'nightlife' | 'memory' | 'family' | 'education' | 'commute' | 'tourism'

const FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|商务住宅|住宅区|小区|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier)/u
const NARRATION_CATEGORY_FORBIDDEN_RE = /(商务住宅|住宅区|住宅|小区|宿舍|家属区|楼栋|单元|服务中心|售楼|营销中心|医院|医疗|党校)/u

export function buildRegionFacts(input: {
  region: RegionCandidate
  scene: SceneProfile
}): NarrativeFact[] {
  const evidenceCount = input.region.visual_layer.poi_heat?.points.length || input.region.effectivePoiCount
  const facts: NarrativeFact[] = [
    {
      claim: input.region.source === 'aoi'
        ? `${input.region.display_name}拥有可解释的真实地界。`
        : `${input.region.display_name}由真实点簇和片区证据共同支撑。`,
      source: input.region.source === 'aoi' ? 'aoi_entity' : 'postgis',
      confidence: input.region.source === 'aoi' ? 0.92 : 0.82,
      verified: true,
      related_entity: { type: 'region', id: input.region.id },
    },
    {
      claim: evidenceCount >= 5
        ? `${input.region.display_name}在地图上形成了连续可辨的点簇。`
        : `${input.region.display_name}周边有可用于讲解的空间证据。`,
      source: 'postgis',
      confidence: 0.9,
      verified: true,
      related_entity: { type: 'region', id: input.region.id },
    },
    {
      claim: `${input.region.display_name}与当前视野中的${sceneLabel(input.scene)}空间联系较强。`,
      source: 'spatial_encoder',
      confidence: 0.72,
      verified: true,
      related_entity: { type: 'region', id: input.region.id },
    },
  ]
  return facts.filter(isAllowedFact)
}

export function buildNarrationChapters(input: {
  regions: RegionCandidate[]
  tone: NarrationTone
  scene: SceneProfile
  lod?: LODLevel
  strategy?: NarrativeRouteStrategy
  pathNodes?: Array<Pick<NarrativePathNode, 'region_id' | 'transition_reason'>>
  userContext?: UserContext
}): NarrativeChapter[] {
  const transitionByRegion = new Map((input.pathNodes || []).map((node) => [node.region_id, node.transition_reason]))
  const focus = resolveExplorationFocus(input.userContext, input.tone)
  return input.regions.map((region, index) => {
    const allowed = region.narrative_facts.filter(isAllowedFact)
    const sampleFact = rewriteSpatialFillerFact(stripRepeatedRegionPrefix(allowed[0]?.claim || `${region.display_name}由真实点簇和地界关系支撑。`, region.display_name))
    const text = buildChapterText(region, sampleFact, input.scene, input.lod || 'meso', input.strategy, focus, index, transitionByRegion.get(region.id))
    return {
      region_id: region.id,
      text,
      length_ms: chapterLengthMs(region, input.lod || 'meso'),
      story_tags: region.story_tags,
    }
  })
}

export function isAllowedFact(fact: NarrativeFact): boolean {
  if (!fact.verified) return false
  if (fact.confidence < 0.7) return false
  if (FORBIDDEN_RE.test(fact.claim)) return false
  return true
}

function stripRepeatedRegionPrefix(fact: string, regionName: string): string {
  let normalized = fact.trim()
  const name = regionName.trim()
  if (!name || !normalized.startsWith(name)) return normalized
  normalized = normalized.slice(name.length).replace(/^[，,。；;：:\s]+/u, '')
  while (normalized.startsWith(name)) {
    normalized = normalized.slice(name.length).replace(/^[，,。；;：:\s]+/u, '')
  }
  return normalized || fact.trim()
}

function rewriteSpatialFillerFact(fact: string): string {
  return fact
    .replace(/在当前视野中有可用的真实地界。?/gu, '拥有可解释的真实地界。')
    .replace(/位于当前视野范围内。?/gu, '由真实点簇和片区证据共同支撑。')
    .replace(/在当前视野中。?/gu, '')
}

function buildChapterText(region: RegionCandidate, fact: string, scene: SceneProfile, lod: LODLevel, strategy: NarrativeRouteStrategy | undefined, focus: ExplorationFocus, index: number, transitionReason?: string): string {
  const lead = index === 0 ? `先看${region.display_name}。` : transitionLead(region, transitionReason)
  const tagPhrase = storyTagPhrase(region.story_tags, scene)
  const lodPhrase = lodNarrationPhrase(lod)
  const strategyPhrase = strategyNarrationPhrase(strategy)
  const focusPhrase = focusNarrationPhrase(region, focus)
  const ecologyPhrase = surroundingEcologyPhrase(region, scene, focus)
  const relationPhrase = contextRelationPhrase(region, scene, focus)
  const closingPhrase = focusClosingPhrase(focus, scene)
  if (region.role === 'primary_region') {
    return `${lead}${fact}${tagPhrase}${focusPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}${closingPhrase}`
  }
  if (region.role === 'support_region' || region.role === 'landmark_anchor') {
    return `${lead}${fact}${tagPhrase}${focusPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}它不是孤立出现的地点，而是连接这一轮${focusLabel(focus)}讲解的重要支撑。`
  }
  return `${lead}${fact}${tagPhrase}${focusPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}它帮助我们理解这片区域为什么呈现出${focusLabel(focus)}与${sceneLabel(scene)}交织的整体气质。`
}

function transitionLead(region: RegionCandidate, transitionReason?: string): string {
  const cleaned = String(transitionReason || '').trim()
  if (!cleaned) return `再转到${region.display_name}。`
  return `${/[。！？]$/u.test(cleaned) ? cleaned : `${cleaned}。`}`
}

function surroundingEcologyPhrase(region: RegionCandidate, scene: SceneProfile, focus: ExplorationFocus): string {
  const categories = [...new Set(region.pois
    .filter((poi) => poi.tier !== 'excluded')
    .map((poi) => poi.category_main || '')
    .filter((category) => category && !NARRATION_CATEGORY_FORBIDDEN_RE.test(category)))].slice(0, 3)
  if (categories.length > 0) {
    return `周边生态上，${categories.join('、')}等真实地点共同构成${focusLabel(focus)}可观察的活动底盘。`
  }
  return `周边生态上，它需要放在当前${sceneLabel(scene)}视野的真实地界和空间证据中理解。`
}

function contextRelationPhrase(region: RegionCandidate, scene: SceneProfile, focus: ExplorationFocus): string {
  if (region.role === 'primary_region') return `片区上下文上，它承担当前${focusLabel(focus)}讲解的主轴。`
  if (region.role === 'support_region' || region.role === 'landmark_anchor') return `片区上下文上，它负责把主体片区和周边${focusLabel(focus)}线索串联起来。`
  return `片区上下文上，它补足了当前${focusLabel(focus)}观察里的${sceneLabel(scene)}背景关系。`
}

function chapterLengthMs(region: RegionCandidate, lod: LODLevel): number {
  const base = lod === 'micro' ? 10500 : lod === 'meso' ? 9000 : 7600
  const cap = lod === 'micro' ? 21000 : lod === 'meso' ? 18000 : 15000
  return Math.max(base, Math.min(cap, base + region.effectivePoiCount * 180))
}

function lodNarrationPhrase(lod: LODLevel): string {
  if (lod === 'micro') return '这里适合把镜头压近，解释主体和贴身支撑点之间的细节关系。'
  if (lod === 'macro') return '这里更像城市横截面中的一个坐标，需要放到更大范围的功能拼图里理解。'
  return '这里适合按片区尺度观察主体、支撑空间和周边活动的互补。'
}

function strategyNarrationPhrase(strategy: NarrativeRouteStrategy | undefined): string {
  switch (strategy) {
    case 'macro_city_cross_section': return '这一段要服务城市横截面的整体拼图。'
    case 'campus_ecology_walk': return '讲法上要把校园文化和生态开放空间接起来。'
    case 'campus_life_loop': return '讲法上要突出校园与日常生活配套的环线关系。'
    case 'commercial_food_walk': return '讲法上要突出商业人流和餐饮烟火气的互动。'
    case 'night_market_walk': return '讲法上要保留街市和夜间消费的本地生活气。'
    case 'heritage_culture_walk': return '讲法上要保留历史文化线索的递进。'
    case 'heritage_commerce_walk': return '讲法上要把历史记忆和当代商业活力并置起来。'
    case 'waterfront_ecology_walk': return '讲法上要突出水岸与生态开放空间的舒展感。'
    case 'waterfront_leisure_walk': return '讲法上要把滨水、绿地和休闲活动连成轴线。'
    case 'commercial_axis_walk': return '讲法上要突出商业轴线和步行动线。'
    case 'civic_service_walk': return '讲法上要看到公共服务对周边日常活动的支撑。'
    case 'transit_gateway_walk': return '讲法上要体现从交通入口进入片区腹地的方向感。'
    case 'micro_detail_walk': return '讲法上要避免大而泛的概括，优先解释近景细节。'
    case 'meso_mixed_cluster_walk': return '讲法上要突出片区内不同功能的混合与互补。'
    case 'mixed_discovery_walk': return '讲法上要保留探索式转场。'
    case 'seeded_spatial_story': return '讲法上要顺着相邻空间自然推进。'
    default: return ''
  }
}

function resolveExplorationFocus(userContext: UserContext | undefined, tone: NarrationTone): ExplorationFocus {
  const label = `${userContext?.preference_label || ''} ${userContext?.history_label || ''}`
  if (/夜生活|夜市|晚间|烟火气/u.test(label)) return 'nightlife'
  if (/商业活力|消费锚点|商圈层级|餐饮休闲/u.test(label)) return 'commerce'
  if (/城市记忆|历史街巷|老地名|人文线索/u.test(label)) return 'memory'
  if (/亲子休闲|公园绿地|公共服务|步行友好/u.test(label)) return 'family'
  if (/高校科教|校园文化|知识社区/u.test(label)) return 'education'
  if (/通勤生活|交通节点|日常便利|社区服务/u.test(label)) return 'commute'
  if (/文旅打卡|地标景点|游览动线|城市名片/u.test(label)) return 'tourism'
  if (tone === 'humanity') return 'memory'
  if (tone === 'tour') return 'tourism'
  return 'comprehensive'
}

function focusLabel(focus: ExplorationFocus): string {
  switch (focus) {
    case 'commerce': return '商业活力'
    case 'nightlife': return '夜生活'
    case 'memory': return '城市记忆'
    case 'family': return '亲子休闲'
    case 'education': return '高校科教'
    case 'commute': return '通勤生活'
    case 'tourism': return '文旅游览'
    case 'comprehensive': return '综合观察'
  }
}

function focusNarrationPhrase(region: RegionCandidate, focus: ExplorationFocus): string {
  const categories = categoryText(region)
  switch (focus) {
    case 'commerce':
      return /(购物|餐饮|住宿|商业|休闲|娱乐|商场|广场)/u.test(categories)
        ? '这一轮要优先看它怎样聚拢消费、人流和商业支撑。'
        : '这一轮只把它作为商业活动外缘来理解，不把它硬讲成消费核心。'
    case 'nightlife':
      return /(餐饮|美食|小吃|酒吧|娱乐|夜市|休闲)/u.test(categories)
        ? '这一轮要优先看它怎样承接晚间餐饮、街巷烟火和停留活动。'
        : '这一轮要判断它能否支撑夜间活动，不能只按白天功能泛泛介绍。'
    case 'memory':
      return /(文化|历史|博物馆|纪念|老街|街巷|古迹)/u.test(categories)
        ? '这一轮要优先看它留下的城市记忆、文化线索和时间层次。'
        : '这一轮更适合把它放进周边历史文化关系里，而不是硬编掌故。'
    case 'family':
      return /(公园|绿地|体育|休闲|公共|生活|科教)/u.test(categories)
        ? '这一轮要优先看它对亲子停留、步行休闲和公共活动的友好度。'
        : '这一轮只把它作为家庭出行路线上的辅助节点来讲。'
    case 'education':
      return /(大学|学院|学校|科教|文化|图书|书店)/u.test(`${region.display_name} ${categories}`)
        ? '这一轮要优先看它怎样形成校园文化、学习活动和知识社区的外延。'
        : '这一轮要看它和周边校园或文化设施之间有没有真实联系。'
    case 'commute':
      return /(交通|地铁|公交|停车|道路|站|生活|便利|公共)/u.test(categories)
        ? '这一轮要优先看它怎样服务通勤入口、日常便利和片区到达性。'
        : '这一轮只把它作为通勤路径上的背景，不夸大交通功能。'
    case 'tourism':
      return /(风景|景区|公园|文化|购物|休闲|地标|广场)/u.test(categories)
        ? '这一轮要优先看它是否适合作为外来者理解这片区域的游览锚点。'
        : '这一轮要把它解释成路线中的识别点，而不是单独打卡景点。'
    case 'comprehensive':
      return '这一轮要平衡看它的空间结构、功能混合和代表性。'
  }
}

function focusClosingPhrase(focus: ExplorationFocus, scene: SceneProfile): string {
  switch (focus) {
    case 'commerce': return '所以这里的重点不是罗列店铺，而是看消费锚点怎样带动周边片区。'
    case 'nightlife': return '所以这里的重点是夜间停留、餐饮烟火和街巷活动能不能连成气氛。'
    case 'memory': return '所以这里的重点是把真实空间证据讲成时间层次，而不是编造故事。'
    case 'family': return '所以这里的重点是亲子、慢行和公共休闲是否能形成轻松的停留半径。'
    case 'education': return '所以这里的重点是校园、知识活动和周边生活如何互相渗透。'
    case 'commute': return '所以这里的重点是到达、换乘和日常便利如何支撑本地人的使用路径。'
    case 'tourism': return '所以这里的重点是它能不能成为游览路线里的清晰识别点。'
    case 'comprehensive': return `从空间结构上看，它和周边${sceneLabel(scene)}氛围共同构成这一段解说的重心。`
  }
}

function categoryText(region: RegionCandidate): string {
  return [
    region.display_name,
    ...(region.story_tags || []),
    ...region.pois.map((poi) => `${poi.display_name} ${poi.category_main || ''} ${poi.category_sub || ''}`),
  ].join(' ')
}

function sceneLabel(scene: SceneProfile): string {
  switch (scene) {
    case 'education_culture': return '教育文化'
    case 'heritage_tourism': return '历史游览'
    case 'commercial_leisure': return '商业休闲'
    case 'natural_ecology': return '自然生态'
    case 'mixed_urban': return '混合城区'
  }
}
