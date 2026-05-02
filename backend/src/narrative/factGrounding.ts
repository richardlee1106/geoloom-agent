import type { NarrativeChapter, NarrativeFact, NarrationTone, SceneProfile } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'

const FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier)/u

export function buildRegionFacts(input: {
  region: RegionCandidate
  scene: SceneProfile
}): NarrativeFact[] {
  const evidenceCount = input.region.visual_layer.poi_heat?.points.length || input.region.effectivePoiCount
  const facts: NarrativeFact[] = [
    {
      claim: input.region.source === 'aoi'
        ? `${input.region.display_name}在当前视野中有可用的真实地界。`
        : `${input.region.display_name}位于当前视野范围内。`,
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
}): NarrativeChapter[] {
  return input.regions.map((region, index) => {
    const allowed = region.narrative_facts.filter(isAllowedFact)
    const sampleFact = allowed[0]?.claim || `${region.display_name}位于当前视野范围内。`
    const text = buildChapterText(region, sampleFact, input.scene, index)
    return {
      region_id: region.id,
      text,
      length_ms: Math.max(9000, Math.min(18000, 9000 + region.effectivePoiCount * 180)),
    }
  })
}

export function isAllowedFact(fact: NarrativeFact): boolean {
  if (!fact.verified) return false
  if (fact.confidence < 0.7) return false
  if (FORBIDDEN_RE.test(fact.claim)) return false
  return true
}

function buildChapterText(region: RegionCandidate, fact: string, scene: SceneProfile, index: number): string {
  const prefix = index === 0 ? '先看' : '接着看'
  if (region.role === 'primary_region') {
    return `${prefix}${region.display_name}。${fact}从空间结构上看，它和周边${sceneLabel(scene)}氛围共同构成这一段解说的重心。`
  }
  if (region.role === 'support_region' || region.role === 'landmark_anchor') {
    return `${prefix}${region.display_name}。${fact}它不是孤立出现的地点，而是连接当前视野空间关系的重要支撑。`
  }
  return `${prefix}${region.display_name}。${fact}它帮助我们理解当前视野为什么呈现出${sceneLabel(scene)}的整体气质。`
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
