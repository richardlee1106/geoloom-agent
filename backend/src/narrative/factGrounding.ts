import type { LODLevel, NarrativeChapter, NarrativeExplorationControls, NarrativeFact, NarrativePathNode, NarrativeRouteStrategy, NarrationTone, SceneProfile, UserContext, ViewportBBox } from './contract.js'
import { businessProfileFactClaim } from './poiBusinessProfile.js'
import type { RegionCandidate } from './regionCandidate.js'

// FORBIDDEN_RE 仅用于过滤可见解说事实里不应出现的词，例如住宅、广告语和工程术语；
// 不再用于生成模板文本（模板文本已彻底删除，章节文本由 LLM 单一负责）。
const FORBIDDEN_RE = /(宿舍|家属区|楼栋|服务中心|商务住宅|住宅区|小区|广告|优惠|促销|热线|联系电话|招商|加盟|POI|样本|节点|权重|score|tier)/u

export function buildRegionFacts(input: {
  region: RegionCandidate
  scene: SceneProfile
}): NarrativeFact[] {
  const evidenceCount = input.region.visual_layer.poi_heat?.points.length || input.region.effectivePoiCount
  const businessProfileClaim = businessProfileFactClaim(input.region.display_name, input.region.business_profile)
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
    ...(businessProfileClaim ? [{
      claim: businessProfileClaim,
      source: 'poi_business_profile' as const,
      confidence: businessProfileConfidence(input.region.business_profile?.confidence),
      verified: true,
      related_entity: { type: 'region' as const, id: input.region.id },
    }] : []),
  ]
  return facts.filter(isAllowedFact)
}

// 章节骨架：只产出 region_id / length_ms / story_tags / text=''，
// 不在后端做任何模板文案拼接，文案统一由 LLM 单章生成。
export function buildChapterScaffolds(input: {
  regions: RegionCandidate[]
  lod?: LODLevel
}): NarrativeChapter[] {
  const lod: LODLevel = input.lod || 'meso'
  return input.regions.map((region) => ({
    region_id: region.id,
    text: '',
    length_ms: chapterLengthMs(region, lod),
    story_tags: region.story_tags,
  }))
}

export function buildNarrationChapters(input: {
  regions: RegionCandidate[]
  tone?: NarrationTone
  scene: SceneProfile
  lod?: LODLevel
  strategy?: NarrativeRouteStrategy
  pathNodes?: NarrativePathNode[]
  viewport?: ViewportBBox
  userContext?: UserContext
  controls?: NarrativeExplorationControls
}): NarrativeChapter[] {
  const scaffolds = buildChapterScaffolds({ regions: input.regions, lod: input.lod })
  return scaffolds.map((chapter, index) => {
    const region = input.regions[index]
    return {
      ...chapter,
      text: region ? buildChapterText({
        region,
        scene: input.scene,
        index,
        pathNode: input.pathNodes?.find((node) => node.region_id === region.id),
        nextRegion: input.regions[index + 1],
        userContext: input.userContext,
        controls: input.controls,
      }) : chapter.text,
    }
  })
}

export function isAllowedFact(fact: NarrativeFact): boolean {
  if (!fact.verified) return false
  if (fact.confidence < 0.7) return false
  if (FORBIDDEN_RE.test(fact.claim)) return false
  return true
}

function chapterLengthMs(region: RegionCandidate, lod: LODLevel): number {
  const base = lod === 'micro' ? 10500 : lod === 'meso' ? 9000 : 7600
  const cap = lod === 'micro' ? 21000 : lod === 'meso' ? 18000 : 15000
  return Math.max(base, Math.min(cap, base + region.effectivePoiCount * 180))
}

function businessProfileConfidence(confidence: 'low' | 'medium' | 'high' | undefined): number {
  if (confidence === 'high') return 0.86
  if (confidence === 'medium') return 0.8
  return 0.72
}

function buildChapterText(input: {
  region: RegionCandidate
  scene: SceneProfile
  index: number
  pathNode?: NarrativePathNode
  nextRegion?: RegionCandidate
  userContext?: UserContext
  controls?: NarrativeExplorationControls
}): string {
  const name = input.region.display_name
  const open = input.index === 0 ? `先看${name}。` : `${input.pathNode?.transition_reason || `接着看${name}。`}`
  const focus = focusSentence(input.userContext, input.controls)
  const facts = input.region.narrative_facts
    .filter(isAllowedFact)
    .map((fact) => normalizeFactClaim(fact.claim, name))
    .filter(Boolean)
    .slice(0, 3)
  const next = input.nextRegion ? `往后顺着看，就是${input.nextRegion.display_name}。` : ''
  return [open, focus, ...facts, sceneSentence(input.scene, input.region), next]
    .filter(Boolean)
    .join('')
}

function normalizeFactClaim(claim: string, regionName: string): string {
  const normalized = claim
    .replace(new RegExp(`^${escapeRegExp(regionName)}[。；，,\\s]*`, 'u'), '')
    .replace(/当前视野中的?/gu, '')
    .trim()
  if (!normalized) return ''
  return /[。！？]$/u.test(normalized) ? normalized : `${normalized}。`
}

function focusSentence(userContext: UserContext | undefined, controls: NarrativeExplorationControls | undefined): string {
  const label = `${controls?.theme || ''} ${userContext?.preference_label || ''} ${userContext?.history_label || ''}`
  if (/commerce|商业活力|消费锚点|商圈层级|餐饮休闲/u.test(label)) return '这次把商业活力和消费锚点放在前面看。'
  if (/education|高校科教|校园文化|知识社区/u.test(label)) return '这次把高校科教和校园文化放在前面看。'
  if (/nightlife|夜生活|夜市|宵夜|晚间/u.test(label)) return '这次把夜间烟火气和小吃消费放在前面看。'
  if (/commute|通勤生活|交通节点|日常便利/u.test(label)) return '这次把通勤生活和日常便利放在前面看。'
  if (/tourism|文旅|打卡|地标|游览/u.test(label)) return '这次把文旅游览和城市名片放在前面看。'
  if (/memory|城市记忆|历史街巷|老地名|人文/u.test(label)) return '这次把城市记忆和人文线索放在前面看。'
  return ''
}

function sceneSentence(scene: SceneProfile, region: RegionCandidate): string {
  if (region.business_profile?.summary_hint) return ''
  if (scene === 'education_culture') return '这里的教育文化底色比较清楚。'
  if (scene === 'commercial_leisure') return '这里的消费和休闲线索比较清楚。'
  if (scene === 'natural_ecology') return '这里的开放空间和自然休闲感更明显。'
  if (scene === 'heritage_tourism') return '这里适合从历史游览线索慢慢展开。'
  return '这里能看出一段日常城市生活。'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
