import { describe, expect, it } from 'vitest'

import { applyLodHysteresis, classifyLod } from '../../../src/narrative/lodPolicy.js'

describe('narrative LOD policy', () => {
  it('classifies golden viewport signals into micro, meso and macro', () => {
    expect(classifyLod({ dominantCoverage: 0.62, candidateCount: 1, semanticDiversity: 0.4 }).lod).toBe('micro')
    expect(classifyLod({ dominantCoverage: 0.34, candidateCount: 4, semanticDiversity: 1.1 }).lod).toBe('meso')
    expect(classifyLod({ dominantCoverage: 0.12, candidateCount: 7, semanticDiversity: 1.8 }).lod).toBe('macro')
  })

  it('requires two stable frames before switching LOD through hysteresis', () => {
    const next = classifyLod({ dominantCoverage: 0.12, candidateCount: 7, semanticDiversity: 1.8 })

    const first = applyLodHysteresis({ current: 'meso' }, next)
    expect(first.current).toBe('meso')
    expect(first.pending).toBe('macro')
    expect(first.pendingCount).toBe(1)

    const second = applyLodHysteresis(first, next)
    expect(second.current).toBe('macro')
    expect(second.pending).toBeNull()
  })
})
