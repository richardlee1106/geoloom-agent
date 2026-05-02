import type { LODLevel } from './contract.js'
import { clamp } from './geometry.js'

export interface LodSignals {
  dominantCoverage: number
  candidateCount: number
  semanticDiversity: number
}

export interface LodScores {
  micro: number
  meso: number
  macro: number
}

export interface LodDecision {
  lod: LODLevel
  scores: LodScores
}

export interface LodHysteresisState {
  current: LODLevel
  pending?: LODLevel | null
  pendingCount?: number
}

export function classifyLod(signals: LodSignals): LodDecision {
  const dominantCoverage = clamp(signals.dominantCoverage, 0, 1)
  const candidateCount = Math.max(0, signals.candidateCount)
  const semanticDiversity = Math.max(0, signals.semanticDiversity)

  if (dominantCoverage >= 0.5 && candidateCount <= 2) {
    return { lod: 'micro', scores: { micro: 1, meso: 0, macro: 0 } }
  }
  if (dominantCoverage < 0.2 && (candidateCount > 5 || semanticDiversity > 1.5)) {
    return { lod: 'macro', scores: { micro: 0, meso: 0, macro: 1 } }
  }

  const coverageNorm = dominantCoverage
  const countNorm = clamp(candidateCount / 8, 0, 1)
  const diversityNorm = clamp(semanticDiversity / 2, 0, 1)
  const midCoverageScore = clamp(1 - Math.abs(dominantCoverage - 0.35) / 0.35, 0, 1)
  const midCountScore = clamp(1 - Math.abs(candidateCount - 4) / 4, 0, 1)
  const scores = {
    micro: 0.55 * coverageNorm + 0.25 * (1 - countNorm) + 0.20 * (1 - diversityNorm),
    meso: 0.35 * midCoverageScore + 0.35 * midCountScore + 0.30 * diversityNorm,
    macro: 0.45 * (1 - coverageNorm) + 0.30 * countNorm + 0.25 * diversityNorm,
  }
  const lod = Object.entries(scores).sort((left, right) => right[1] - left[1])[0][0] as LODLevel
  return { lod, scores }
}

export function applyLodHysteresis(state: LodHysteresisState, next: LodDecision): LodHysteresisState {
  const currentScore = next.scores[state.current]
  const nextScore = next.scores[next.lod]
  if (next.lod === state.current) {
    return { current: state.current, pending: null, pendingCount: 0 }
  }

  const requiredDelta = Math.abs(levelRank(next.lod) - levelRank(state.current)) > 1 ? 0.12 : 0.08
  if (nextScore - currentScore < requiredDelta) {
    return { current: state.current, pending: null, pendingCount: 0 }
  }

  const pendingCount = state.pending === next.lod ? (state.pendingCount || 0) + 1 : 1
  if (pendingCount >= 2) {
    return { current: next.lod, pending: null, pendingCount: 0 }
  }
  return { current: state.current, pending: next.lod, pendingCount }
}

function levelRank(level: LODLevel): number {
  if (level === 'micro') return 0
  if (level === 'meso') return 1
  return 2
}
