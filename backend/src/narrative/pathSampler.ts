import type { LODLevel, NarrativePathNode, NarrativeRouteStrategy, PathNarrationRole, StoryTag, ViewportBBox } from './contract.js'
import { boundsFromBoundary } from './geometry.js'
import type { RegionCandidate } from './regionCandidate.js'
import { buildRegionRelation, type RegionRelationType } from './regionRelations.js'
import { chooseRouteStrategy, inferPathStoryTags, sharedStoryTags } from './storyTags.js'

export interface PathSamplerResult {
  nodes: NarrativePathNode[]
  alternativesCount: number
  relations: PathRelationDebug[]
  engine: 'seeded_lod_bbox_sampler'
  strategy: NarrativeRouteStrategy
  storyTags: StoryTag[]
  lodPolicy: LodRoutePolicyDebug
}

export interface PathRelationDebug {
  from_region_id: string
  to_region_id: string
  type: RegionRelationType
  strength: number
  evidence: string[]
  shared_story_tags: StoryTag[]
}

export interface LodRoutePolicyDebug {
  lod: LODLevel
  max_nodes: number
  top_k: number
  beta: number
  distance_bias: 'strong' | 'balanced' | 'loose'
  continuity_bias: 'strong' | 'balanced' | 'loose'
  diversity_bias: 'local_detail' | 'mixed_cluster' | 'cross_section'
}

interface LodRoutePolicy extends LodRoutePolicyDebug {
  poolMultiplier: number
  poolMin: number
  candidateWeight: number
  relationWeight: number
  lodFitWeight: number
  sharedTagWeight: number
  newTagWeight: number
  diversityBonus: number
  relationDiversityBonus: number
  sameRolePenalty: number
  thirdRolePenalty: number
  sameDominantTagPenalty: number
  distanceWeight: number
}

export function sampleNarrativePath(input: {
  candidates: RegionCandidate[]
  viewport: ViewportBBox
  lod: LODLevel
  seed: string
}): PathSamplerResult {
  const policy = resolveLodRoutePolicy(input.lod)
  const limit = policy.max_nodes
  const valid = [...input.candidates]
  const selected: RegionCandidate[] = []
  const pool = valid.slice(0, Math.max(limit * policy.poolMultiplier, policy.poolMin))
  const random = seededRandom(`${input.seed}:${input.lod}:${viewportSignature(input.viewport)}`)
  const first = pool.shift()
  if (first) selected.push(first)

  while (selected.length < limit && pool.length > 0) {
    const index = pickSeededNextCandidate(selected, pool, input.lod, random, policy)
    selected.push(pool.splice(index, 1)[0])
  }

  const ordered = smoothConsecutiveRoles(orderSelectedForSpatialReading(selected))

  const relations = ordered.slice(1).map((candidate, index) => {
    const previous = ordered[index]
    const relation = buildRegionRelation(previous, candidate)
    return {
      from_region_id: previous.id,
      to_region_id: candidate.id,
      type: relation.type,
      strength: Number(relation.strength.toFixed(3)),
      evidence: relation.evidence,
      shared_story_tags: sharedStoryTags(previous, candidate),
    }
  })
  const relationTypes = relations.map((relation) => relation.type)
  const nodes = ordered.map((candidate, index): NarrativePathNode => ({
    region_id: candidate.id,
    narration_role: resolveNarrationRole(candidate, index),
    transition_reason: buildTransitionReason(ordered[index - 1] || null, candidate),
    story_tags: candidate.story_tags,
  }))
  const storyTags = inferPathStoryTags(ordered)

  return {
    nodes,
    alternativesCount: Math.max(0, valid.length - selected.length),
    relations,
    engine: 'seeded_lod_bbox_sampler',
    strategy: chooseRouteStrategy(ordered, { lod: input.lod, relationTypes }),
    storyTags,
    lodPolicy: {
      lod: policy.lod,
      max_nodes: policy.max_nodes,
      top_k: policy.top_k,
      beta: policy.beta,
      distance_bias: policy.distance_bias,
      continuity_bias: policy.continuity_bias,
      diversity_bias: policy.diversity_bias,
    },
  }
}

function resolveNarrationRole(candidate: RegionCandidate, index: number): PathNarrationRole {
  if (index === 0) return 'core'
  if (candidate.role === 'landmark_anchor') return 'landmark'
  if (candidate.role === 'primary_region' || candidate.role === 'support_region') {
    if (/(大学|学院|学校|文化|博物馆|纪念馆)/u.test(candidate.display_name)) return 'educational'
    if (/(公园|湖|山|景区|生态)/u.test(candidate.display_name)) return 'ecological'
    return 'related'
  }
  if (/(文化|博物馆|纪念馆|历史)/u.test(candidate.display_name)) return 'cultural'
  return 'related'
}

function orderSelectedForSpatialReading(candidates: RegionCandidate[]): RegionCandidate[] {
  if (candidates.length <= 1) return [...candidates]
  const centers = candidates.map((candidate) => ({ candidate, center: centerOfCandidate(candidate) }))
  const lonValues = centers.map((item) => item.center[0])
  const latValues = centers.map((item) => item.center[1])
  const minLon = Math.min(...lonValues)
  const maxLon = Math.max(...lonValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const lonSpan = Math.max(maxLon - minLon, 0.000001)
  const latSpan = Math.max(maxLat - minLat, 0.000001)
  return centers
    .map(({ candidate, center }) => ({
      candidate,
      column: Math.min(2, Math.floor(((center[0] - minLon) / lonSpan) * 3)),
      row: (maxLat - center[1]) / latSpan,
      lon: center[0],
      rank: candidateRankForSpatialReading(candidate),
    }))
    .sort((left, right) =>
      left.column - right.column
      || left.row - right.row
      || left.lon - right.lon
      || right.rank - left.rank)
    .map((item) => item.candidate)
}

function smoothConsecutiveRoles(candidates: RegionCandidate[]): RegionCandidate[] {
  const ordered = [...candidates]
  for (let index = 2; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const beforePrevious = ordered[index - 2]
    if (previous.role !== beforePrevious.role || ordered[index].role !== previous.role) continue
    const alternativeIndex = ordered.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.role !== previous.role)
    if (alternativeIndex < 0) continue
    const [alternative] = ordered.splice(alternativeIndex, 1)
    ordered.splice(index, 0, alternative)
  }
  return ordered
}

function candidateRankForSpatialReading(candidate: RegionCandidate): number {
  const roleBoost = candidate.role === 'primary_region' ? 0.3 : candidate.role === 'support_region' || candidate.role === 'landmark_anchor' ? 0.16 : 0
  return candidate.score + roleBoost
}

function buildTransitionReason(previous: RegionCandidate | null, current: RegionCandidate): string {
  if (!previous) return '从这组片区的西侧或北侧开始讲起，再按从左到右、由上到下的空间顺序推进。'
  const relation = buildRegionRelation(previous, current)
  const relationReason = relation.reason.replace(/^从[^，。]+[，,]/u, '')
  return `${current.display_name}在${previous.display_name}的${relativeDirection(previous, current)}侧，${relationReason}`
}

function relativeDirection(previous: RegionCandidate, current: RegionCandidate): string {
  const [previousLon, previousLat] = centerOfCandidate(previous)
  const [currentLon, currentLat] = centerOfCandidate(current)
  const dx = currentLon - previousLon
  const dy = currentLat - previousLat
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const eastWest = Math.abs(dx) < 0.0006 ? '' : dx > 0 ? '东' : '西'
  const northSouth = Math.abs(dy) < 0.0006 ? '' : dy > 0 ? '北' : '南'
  if (northSouth && absDy > absDx * 1.6) return northSouth
  if (eastWest && absDx > absDy * 1.6) return eastWest
  return northSouth && eastWest ? `${northSouth}${eastWest}` : eastWest || northSouth || '相邻'
}

function pickSeededNextCandidate(
  selected: RegionCandidate[],
  pool: RegionCandidate[],
  lod: LODLevel,
  random: () => number,
  policy: LodRoutePolicy,
): number {
  const previous = selected[selected.length - 1]
  const avoidRole = selected.length >= 2 && selected[selected.length - 2].role === previous.role ? previous.role : null
  const usedStoryTags = new Set(selected.flatMap((candidate) => candidate.story_tags || []))
  const usedRelationTypes = new Set(selected.slice(1).map((candidate, index) => buildRegionRelation(selected[index], candidate).type))
  const previousDominantTag = previous.story_tags?.[0] ?? null
  const scored = pool.map((candidate, index) => {
    const relation = buildRegionRelation(previous, candidate)
    const candidateTags = candidate.story_tags || []
    const sharedTagCount = sharedStoryTags(previous, candidate).length
    const newTagCount = candidateTags.filter((tag) => !usedStoryTags.has(tag)).length
    const distancePenalty = spatialDistanceScore(previous, candidate) * policy.distanceWeight
    const sameRolePenalty = previous.role === candidate.role ? policy.sameRolePenalty : 0
    const thirdRolePenalty = avoidRole && candidate.role === avoidRole ? policy.thirdRolePenalty : 0
    const sameDominantTagPenalty = previousDominantTag && previousDominantTag === candidateTags[0] ? policy.sameDominantTagPenalty : 0
    const diversityBonus = selected.some((item) => item.role === candidate.role) ? 0 : policy.diversityBonus
    const relationDiversityBonus = usedRelationTypes.has(relation.type) ? 0 : policy.relationDiversityBonus
    const storyTagBonus = Math.min(0.2, sharedTagCount * policy.sharedTagWeight + newTagCount * policy.newTagWeight)
    const score = candidate.score * policy.candidateWeight
      + relation.strength * policy.relationWeight
      + diversityBonus
      + relationDiversityBonus
      + storyTagBonus
      + lodFitScore(candidate, lod) * policy.lodFitWeight
      - sameRolePenalty
      - thirdRolePenalty
      - sameDominantTagPenalty
      - distancePenalty
    return { index, score }
  }).sort((left, right) => right.score - left.score)
  const head = scored.slice(0, Math.min(scored.length, policy.top_k))
  if (head.length === 0) return 0
  const minScore = Math.min(...head.map((item) => item.score))
  const weights = head.map((item) => Math.exp((item.score - minScore) * policy.beta))
  const total = weights.reduce((sum, item) => sum + item, 0)
  let cursor = random() * total
  for (let i = 0; i < head.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return head[i].index
  }
  return head[0].index
}

function spatialDistanceScore(left: RegionCandidate, right: RegionCandidate): number {
  const [leftLon, leftLat] = centerOfCandidate(left)
  const [rightLon, rightLat] = centerOfCandidate(right)
  const dx = leftLon - rightLon
  const dy = leftLat - rightLat
  return dx * dx + dy * dy
}

function centerOfCandidate(candidate: RegionCandidate): [number, number] {
  const bounds = boundsFromBoundary(candidate.boundary)
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
}

function lodFitScore(candidate: RegionCandidate, lod: LODLevel): number {
  if (lod === 'micro') return candidate.source === 'abstract_region' && candidate.role === 'support_region' ? 1 : candidate.coverage < 0.08 ? 0.75 : 0.35
  if (lod === 'meso') return candidate.role === 'support_region' || candidate.role === 'primary_region' ? 0.85 : 0.55
  return candidate.role === 'primary_region' ? 1 : candidate.coverage >= 0.08 ? 0.75 : 0.45
}

function resolveLodRoutePolicy(lod: LODLevel): LodRoutePolicy {
  if (lod === 'micro') {
    return {
      lod,
      max_nodes: 5,
      top_k: 3,
      beta: 9,
      distance_bias: 'strong',
      continuity_bias: 'strong',
      diversity_bias: 'local_detail',
      poolMultiplier: 3,
      poolMin: 8,
      candidateWeight: 0.36,
      relationWeight: 0.38,
      lodFitWeight: 0.16,
      sharedTagWeight: 0.055,
      newTagWeight: 0.02,
      diversityBonus: 0.04,
      relationDiversityBonus: 0.025,
      sameRolePenalty: 0.045,
      thirdRolePenalty: 0.26,
      sameDominantTagPenalty: 0.035,
      distanceWeight: 11,
    }
  }
  if (lod === 'meso') {
    return {
      lod,
      max_nodes: 8,
      top_k: 4,
      beta: 8,
      distance_bias: 'balanced',
      continuity_bias: 'balanced',
      diversity_bias: 'mixed_cluster',
      poolMultiplier: 3,
      poolMin: 10,
      candidateWeight: 0.4,
      relationWeight: 0.32,
      lodFitWeight: 0.12,
      sharedTagWeight: 0.04,
      newTagWeight: 0.035,
      diversityBonus: 0.06,
      relationDiversityBonus: 0.04,
      sameRolePenalty: 0.055,
      thirdRolePenalty: 0.24,
      sameDominantTagPenalty: 0.045,
      distanceWeight: 6,
    }
  }
  return {
    lod,
    max_nodes: 10,
    top_k: 5,
    beta: 6.5,
    distance_bias: 'loose',
    continuity_bias: 'loose',
    diversity_bias: 'cross_section',
    poolMultiplier: 4,
    poolMin: 12,
    candidateWeight: 0.44,
    relationWeight: 0.22,
    lodFitWeight: 0.14,
    sharedTagWeight: 0.02,
    newTagWeight: 0.06,
    diversityBonus: 0.09,
    relationDiversityBonus: 0.065,
    sameRolePenalty: 0.075,
    thirdRolePenalty: 0.3,
    sameDominantTagPenalty: 0.075,
    distanceWeight: 2.4,
  }
}

function viewportSignature(viewport: ViewportBBox): string {
  return `${viewport.west.toFixed(3)}:${viewport.south.toFixed(3)}:${viewport.east.toFixed(3)}:${viewport.north.toFixed(3)}:${viewport.zoom.toFixed(1)}`
}

function seededRandom(seed: string): () => number {
  let state = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state += 0x6D2B79F5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
