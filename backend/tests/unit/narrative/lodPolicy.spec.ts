import { describe, expect, it } from 'vitest'

import { applyLodHysteresis, classifyLod } from '../../../src/narrative/lodPolicy.js'

describe('narrative LOD policy', () => {
  it('classifies golden viewport signals into micro, meso and macro', () => {
    const cases = [
      { name: '单主体校园视野', signals: { dominantCoverage: 0.62, candidateCount: 1, semanticDiversity: 0.4 }, expected: 'micro' },
      { name: '高校加公园混合视野', signals: { dominantCoverage: 0.34, candidateCount: 4, semanticDiversity: 1.1 }, expected: 'meso' },
      { name: '城市级多片区视野', signals: { dominantCoverage: 0.12, candidateCount: 7, semanticDiversity: 1.8 }, expected: 'macro' },
    ] as const

    for (const item of cases) {
      expect(classifyLod(item.signals).lod, item.name).toBe(item.expected)
    }
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

  it('does not switch LOD when the winning score margin is weak', () => {
    const next = classifyLod({ dominantCoverage: 0.2, candidateCount: 2, semanticDiversity: 0.4 })

    const result = applyLodHysteresis({ current: 'meso' }, next)

    expect(next.lod).toBe('macro')
    expect(result.current).toBe('meso')
    expect(result.pending).toBeNull()
  })
})
