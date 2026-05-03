import type { LODLevel, NarrativePathNode, PathNarrationRole, ViewportBBox } from './contract.js'
import { boundsFromBoundary } from './geometry.js'
import type { RegionCandidate } from './regionCandidate.js'
import { buildRegionRelation, type RegionRelationType } from './regionRelations.js'

export interface PathSamplerResult {
  nodes: NarrativePathNode[]
  alternativesCount: number
  relations: PathRelationDebug[]
}

export interface PathRelationDebug {
  from_region_id: string
  to_region_id: string
  type: RegionRelationType
  strength: number
  evidence: string[]
}

export function sampleNarrativePath(input: {
  candidates: RegionCandidate[]
  viewport: ViewportBBox
  lod: LODLevel
  seed: string
}): PathSamplerResult {
  const limit = input.lod === 'micro' ? 5 : input.lod === 'meso' ? 8 : 10
  const valid = [...input.candidates]
  const selected: RegionCandidate[] = []
  const pool = valid.slice(0, Math.max(limit * 2, 6))
  const first = pool.shift()
  if (first) selected.push(first)

  while (selected.length < limit && pool.length > 0) {
    const index = pickNearestNextCandidate(selected, pool)
    selected.push(pool.splice(index, 1)[0])
  }

  const relations = selected.slice(1).map((candidate, index) => {
    const previous = selected[index]
    const relation = buildRegionRelation(previous, candidate)
    return {
      from_region_id: previous.id,
      to_region_id: candidate.id,
      type: relation.type,
      strength: Number(relation.strength.toFixed(3)),
      evidence: relation.evidence,
    }
  })
  const nodes = selected.map((candidate, index): NarrativePathNode => ({
    region_id: candidate.id,
    narration_role: resolveNarrationRole(candidate, index),
    transition_reason: buildTransitionReason(selected[index - 1] || null, candidate),
  }))

  return {
    nodes,
    alternativesCount: Math.max(0, valid.length - selected.length),
    relations,
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

function buildTransitionReason(previous: RegionCandidate | null, current: RegionCandidate): string {
  if (!previous) return '从当前视野中最有代表性的区域开始讲起。'
  return buildRegionRelation(previous, current).reason
}

function pickNearestNextCandidate(selected: RegionCandidate[], pool: RegionCandidate[]): number {
  const previous = selected[selected.length - 1]
  const avoidRole = selected.length >= 2 && selected[selected.length - 2].role === previous.role ? previous.role : null
  let bestIndex = 0
  let bestScore = Infinity
  for (const [index, candidate] of pool.entries()) {
    const score = spatialDistanceScore(previous, candidate)
      + (previous.role === candidate.role ? 0.0002 : 0)
      + (avoidRole && candidate.role === avoidRole ? 0.0012 : 0)
      - buildRegionRelation(previous, candidate).strength * 0.00008
      - candidate.score * 0.00005
    if (score < bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
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
