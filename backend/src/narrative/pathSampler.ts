import type { LODLevel, NarrativeExplorationControls, NarrativePathNode, NarrativeRouteStrategy, PathNarrationRole, StoryTag, ViewportBBox } from './contract.js'
import { regionExplorationFocusScore, type ExplorationFocus } from './explorationFocus.js'
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
  requested_candidate_count?: number
  requested_diversity?: NarrativeExplorationControls['diversity']
  requested_duration_preset?: NarrativeExplorationControls['duration_preset']
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
  focusWeight: number
}

export function sampleNarrativePath(input: {
  candidates: RegionCandidate[]
  viewport: ViewportBBox
  lod: LODLevel
  seed: string
  focus?: ExplorationFocus
  controls?: NarrativeExplorationControls
}): PathSamplerResult {
  const policy = resolveLodRoutePolicy(input.lod, input.controls)
  const limit = policy.max_nodes
  const focus = input.focus || 'comprehensive'
  const valid = filterCandidatesForFocus(rankCandidatesForFocus(input.candidates, focus), focus, limit)
  const selected: RegionCandidate[] = []
  const pool = valid.slice(0, Math.max(limit * policy.poolMultiplier, policy.poolMin))
  const randomSeed = focus === 'comprehensive'
    ? `${input.seed}:${input.lod}:${viewportSignature(input.viewport)}:${explorationSignature(input.controls)}`
    : `${input.seed}:${input.lod}:${viewportSignature(input.viewport)}:${focus}:${explorationSignature(input.controls)}`
  const random = seededRandom(randomSeed)
  const first = pool.shift()
  if (first) selected.push(first)

  while (selected.length < limit && pool.length > 0) {
    const index = pickSeededNextCandidate(selected, pool, input.lod, random, policy, focus, input.controls)
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
      requested_candidate_count: policy.requested_candidate_count,
      requested_diversity: policy.requested_diversity,
      requested_duration_preset: policy.requested_duration_preset,
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

function rankCandidatesForFocus(candidates: RegionCandidate[], focus: ExplorationFocus): RegionCandidate[] {
  if (focus === 'comprehensive') return [...candidates]
  return [...candidates].sort((left, right) =>
    focusAdjustedRank(right, focus) - focusAdjustedRank(left, focus)
    || candidateRankForSpatialReading(right) - candidateRankForSpatialReading(left))
}

function filterCandidatesForFocus(candidates: RegionCandidate[], focus: ExplorationFocus, limit: number): RegionCandidate[] {
  if (focus === 'comprehensive' || candidates.length <= 1) return candidates
  const scored = candidates.map((candidate) => ({ candidate, focusScore: regionExplorationFocusScore(candidate, focus) }))
  const strong = scored.filter((item) => item.focusScore >= 0.55).map((item) => item.candidate)
  const supportive = scored.filter((item) => item.focusScore >= 0.25).map((item) => item.candidate)
  if (candidates.length <= limit && strong.length > 0) return strong
  if (strong.length >= 2) return strong
  if (supportive.length >= 2) return supportive
  return candidates
}

function focusAdjustedRank(candidate: RegionCandidate, focus: ExplorationFocus): number {
  return candidateRankForSpatialReading(candidate) + regionExplorationFocusScore(candidate, focus) * 0.68
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
  return northSouth && eastWest ? `${eastWest}${northSouth}` : eastWest || northSouth || '相邻'
}

function pickSeededNextCandidate(
  selected: RegionCandidate[],
  pool: RegionCandidate[],
  lod: LODLevel,
  random: () => number,
  policy: LodRoutePolicy,
  focus: ExplorationFocus,
  controls: NarrativeExplorationControls | undefined,
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
      + regionExplorationFocusScore(candidate, focus) * policy.focusWeight
      + explorationPathCandidateBonus(candidate, controls)
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

function resolveLodRoutePolicy(lod: LODLevel, controls?: NarrativeExplorationControls): LodRoutePolicy {
  const policy = baseLodRoutePolicy(lod)
  return applyExplorationControlsToPolicy(policy, controls)
}

function baseLodRoutePolicy(lod: LODLevel): LodRoutePolicy {
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
      focusWeight: 0.34,
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
      focusWeight: 0.36,
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
    focusWeight: 0.38,
  }
}

function applyExplorationControlsToPolicy(policy: LodRoutePolicy, controls?: NarrativeExplorationControls): LodRoutePolicy {
  if (!controls) return policy
  const requestedCount = boundedInteger(controls.candidate_count, 3, 12)
  const durationCount = controls.duration_preset === 'casual'
    ? Math.min(policy.max_nodes, 4)
    : controls.duration_preset === 'detailed'
      ? Math.max(policy.max_nodes, 9)
      : controls.duration_preset === 'standard'
        ? Math.max(policy.max_nodes, 6)
        : policy.max_nodes
  const maxNodes = requestedCount ?? durationCount
  const lowDiversity = controls.diversity === 'low'
  const highDiversity = controls.diversity === 'high'
  return {
    ...policy,
    max_nodes: maxNodes,
    top_k: lowDiversity ? Math.max(2, policy.top_k - 1) : highDiversity ? Math.min(8, policy.top_k + 2) : policy.top_k,
    beta: lowDiversity ? policy.beta + 1.5 : highDiversity ? Math.max(3.5, policy.beta - 1.5) : policy.beta,
    poolMultiplier: lowDiversity ? Math.max(2, policy.poolMultiplier - 1) : highDiversity ? policy.poolMultiplier + 1 : policy.poolMultiplier,
    poolMin: lowDiversity ? Math.max(6, policy.poolMin - 2) : highDiversity ? policy.poolMin + 4 : policy.poolMin,
    diversityBonus: lowDiversity ? policy.diversityBonus * 0.45 : highDiversity ? policy.diversityBonus * 1.7 : policy.diversityBonus,
    relationDiversityBonus: lowDiversity ? policy.relationDiversityBonus * 0.55 : highDiversity ? policy.relationDiversityBonus * 1.55 : policy.relationDiversityBonus,
    newTagWeight: lowDiversity ? policy.newTagWeight * 0.55 : highDiversity ? policy.newTagWeight * 1.7 : policy.newTagWeight,
    sameDominantTagPenalty: lowDiversity ? policy.sameDominantTagPenalty * 0.45 : highDiversity ? policy.sameDominantTagPenalty * 1.35 : policy.sameDominantTagPenalty,
    distanceWeight: controls.localness === 'local' || lowDiversity ? policy.distanceWeight * 1.15 : highDiversity ? policy.distanceWeight * 0.72 : policy.distanceWeight,
    focusWeight: controls.theme && controls.theme !== 'comprehensive' ? policy.focusWeight + 0.08 : policy.focusWeight,
    diversity_bias: lowDiversity ? 'local_detail' : highDiversity ? 'cross_section' : policy.diversity_bias,
    requested_candidate_count: requestedCount,
    requested_diversity: controls.diversity,
    requested_duration_preset: controls.duration_preset,
  }
}

function explorationPathCandidateBonus(candidate: RegionCandidate, controls?: NarrativeExplorationControls): number {
  if (!controls) return 0
  let bonus = 0
  if (controls.centroid_strategy === 'region_first' && (candidate.role === 'primary_region' || candidate.role === 'support_region')) bonus += 0.08
  if (controls.centroid_strategy === 'poi_first') bonus += Math.min(0.1, candidate.effectivePoiCount * 0.012)
  if (controls.localness === 'local') {
    const text = `${candidate.display_name} ${(candidate.story_tags || []).join(' ')}`
    if (candidate.source === 'abstract_region') bonus += 0.08
    if (/(夜市|粮道街|水塔街|万松园|吉庆街|保成路|山海关路|台北路|胜利街|market|nightlife|food|urban_life)/u.test(text)) bonus += 0.08
  }
  if (controls.localness === 'tourist') {
    const text = `${candidate.display_name} ${candidate.pois.map((poi) => `${poi.display_name} ${poi.category_main || ''}`).join(' ')}`
    if (candidate.role === 'landmark_anchor' || /(景区|公园|博物馆|纪念馆|地标|步行街|风景名胜|tourism|landmark)/u.test(text)) bonus += 0.08
  }
  return bonus
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function explorationSignature(controls?: NarrativeExplorationControls): string {
  if (!controls) return 'default'
  return [
    controls.theme || '',
    controls.granularity || '',
    controls.evidence_strictness || '',
    controls.relevance_threshold ?? '',
    controls.diversity || '',
    controls.localness || '',
    controls.duration_preset || '',
    controls.candidate_count ?? '',
    controls.scope_query || '',
    controls.centroid_strategy || '',
  ].join(':')
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
