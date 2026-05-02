import type { LODLevel, NarrativePathNode, PathNarrationRole, ViewportBBox } from './contract.js'
import { boundsFromBoundary } from './geometry.js'
import type { RegionCandidate } from './regionCandidate.js'

export interface PathSamplerResult {
  nodes: NarrativePathNode[]
  alternativesCount: number
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

  while (selected.length < limit && pool.length > 0) {
    const nextIndex = pool.findIndex((candidate) => !isHomogeneousWithLast(selected[selected.length - 1], candidate))
    const index = nextIndex >= 0 ? nextIndex : 0
    selected.push(pool.splice(index, 1)[0])
  }

  const nodes = selected.map((candidate, index): NarrativePathNode => ({
    region_id: candidate.id,
    narration_role: resolveNarrationRole(candidate, index),
    transition_reason: buildTransitionReason(selected[index - 1] || null, candidate),
  }))

  return {
    nodes,
    alternativesCount: Math.max(0, valid.length - selected.length),
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
  if (previous.role !== current.role) return `从${previous.display_name}转到${current.display_name}，切换到另一类空间角色。`
  return `沿着当前视野的空间结构继续展开到${current.display_name}。`
}

function isHomogeneousWithLast(previous: RegionCandidate | undefined, next: RegionCandidate): boolean {
  if (!previous) return false
  if (previous.role === next.role) return true
  const prevBounds = boundsFromBoundary(previous.boundary)
  const nextBounds = boundsFromBoundary(next.boundary)
  const prevCenter = [(prevBounds.west + prevBounds.east) / 2, (prevBounds.south + prevBounds.north) / 2]
  const nextCenter = [(nextBounds.west + nextBounds.east) / 2, (nextBounds.south + nextBounds.north) / 2]
  return Math.abs(prevCenter[0] - nextCenter[0]) < 0.003 && Math.abs(prevCenter[1] - nextCenter[1]) < 0.003
}
