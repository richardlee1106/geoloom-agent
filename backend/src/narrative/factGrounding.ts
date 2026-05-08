import type { LODLevel, NarrativeChapter, NarrativeFact, NarrativePathNode, NarrativeRouteStrategy, NarrationTone, SceneProfile } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'
import { storyTagPhrase } from './storyTags.js'

const FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier)/u

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
}): NarrativeChapter[] {
  const transitionByRegion = new Map((input.pathNodes || []).map((node) => [node.region_id, node.transition_reason]))
  return input.regions.map((region, index) => {
    const allowed = region.narrative_facts.filter(isAllowedFact)
    const sampleFact = rewriteSpatialFillerFact(stripRepeatedRegionPrefix(allowed[0]?.claim || `${region.display_name}由真实点簇和地界关系支撑。`, region.display_name))
    const text = buildChapterText(region, sampleFact, input.scene, input.lod || 'meso', input.strategy, index, transitionByRegion.get(region.id))
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

function buildChapterText(region: RegionCandidate, fact: string, scene: SceneProfile, lod: LODLevel, strategy: NarrativeRouteStrategy | undefined, index: number, transitionReason?: string): string {
  const lead = index === 0 ? `先看${region.display_name}。` : transitionLead(region, transitionReason)
  const tagPhrase = storyTagPhrase(region.story_tags, scene)
  const lodPhrase = lodNarrationPhrase(lod)
  const strategyPhrase = strategyNarrationPhrase(strategy)
  const ecologyPhrase = surroundingEcologyPhrase(region, scene)
  const relationPhrase = contextRelationPhrase(region, scene)
  if (region.role === 'primary_region') {
    return `${lead}${fact}${tagPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}从空间结构上看，它和周边${sceneLabel(scene)}氛围共同构成这一段解说的重心。`
  }
  if (region.role === 'support_region' || region.role === 'landmark_anchor') {
    return `${lead}${fact}${tagPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}它不是孤立出现的地点，而是连接当前视野空间关系的重要支撑。`
  }
  return `${lead}${fact}${tagPhrase}${lodPhrase}${strategyPhrase}${ecologyPhrase}${relationPhrase}它帮助我们理解当前视野为什么呈现出${sceneLabel(scene)}的整体气质。`
}

function transitionLead(region: RegionCandidate, transitionReason?: string): string {
  const cleaned = String(transitionReason || '').trim()
  if (!cleaned) return `再转到${region.display_name}。`
  return `${/[。！？]$/u.test(cleaned) ? cleaned : `${cleaned}。`}`
}

function surroundingEcologyPhrase(region: RegionCandidate, scene: SceneProfile): string {
  const categories = [...new Set(region.pois
    .filter((poi) => poi.tier !== 'excluded')
    .map((poi) => poi.category_main || '')
    .filter(Boolean))].slice(0, 3)
  if (categories.length > 0) {
    return `周边生态上，${categories.join('、')}等真实地点共同构成可观察的活动底盘。`
  }
  return `周边生态上，它需要放在当前${sceneLabel(scene)}视野的真实地界和空间证据中理解。`
}

function contextRelationPhrase(region: RegionCandidate, scene: SceneProfile): string {
  if (region.role === 'primary_region') return `片区上下文上，它承担当前${sceneLabel(scene)}叙事的主轴。`
  if (region.role === 'support_region' || region.role === 'landmark_anchor') return `片区上下文上，它负责把主体片区和周边功能点位串联起来。`
  return `片区上下文上，它补足了当前视野的${sceneLabel(scene)}背景关系。`
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

function sceneLabel(scene: SceneProfile): string {
  switch (scene) {
    case 'education_culture': return '教育文化'
    case 'heritage_tourism': return '历史游览'
    case 'commercial_leisure': return '商业休闲'
    case 'natural_ecology': return '自然生态'
    case 'mixed_urban': return '混合城区'
  }
}
