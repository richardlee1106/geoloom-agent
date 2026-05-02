import type { NarrativeChapter, NarrativeFact, NarrationTone, SceneProfile } from './contract.js'
import type { RegionCandidate } from './regionCandidate.js'

const FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|广告|优惠|促销|热线|联系电话|招商|加盟)/u

export function buildRegionFacts(input: {
  region: RegionCandidate
  scene: SceneProfile
}): NarrativeFact[] {
  const facts: NarrativeFact[] = [
    {
      claim: `${input.region.display_name}位于当前视野范围内。`,
      source: input.region.source === 'aoi' ? 'aoi_entity' : 'postgis',
      confidence: input.region.source === 'aoi' ? 0.92 : 0.82,
      verified: true,
      related_entity: { type: 'region', id: input.region.id },
    },
    {
      claim: `${input.region.display_name}内有 ${input.region.effectivePoiCount} 个有效 POI 样本。`,
      source: 'postgis',
      confidence: 0.9,
      verified: true,
      related_entity: { type: 'region', id: input.region.id },
    },
    {
      claim: `${input.region.display_name}的初步场景画像是${sceneLabel(input.scene)}。`,
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
    const sampleFact = allowed[1]?.claim || allowed[0]?.claim || `${region.display_name}位于当前视野范围内。`
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
    return `${prefix}${region.display_name}。这里是当前视野里最适合展开讲解的区域主体，${fact}从空间结构上看，它和周边${sceneLabel(scene)}氛围共同构成这一段解说的重心。`
  }
  if (region.role === 'support_region' || region.role === 'landmark_anchor') {
    return `${prefix}${region.display_name}。它不是孤立的点，而是连接当前视野空间关系的重要支撑，${fact}这一段适合用来解释区域之间的过渡。`
  }
  return `${prefix}${region.display_name}。这里更多承担背景生态和氛围说明的作用，${fact}它帮助我们理解当前视野为什么呈现出${sceneLabel(scene)}的整体气质。`
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
