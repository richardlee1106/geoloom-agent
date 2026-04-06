import { describe, expect, it } from 'vitest'

import { ConfidenceGate } from '../../../src/agent/ConfidenceGate.js'

describe('ConfidenceGate', () => {
  const gate = new ConfidenceGate()

  it('requests clarification when the anchor is unresolved', () => {
    const decision = gate.evaluate({
      anchorResolved: false,
      evidenceCount: 0,
      hasConflict: false,
    })

    expect(decision.status).toBe('clarify')
    expect(decision.reason).toBe('unresolved_anchor')
  })

  it('degrades when evidence is missing', () => {
    const decision = gate.evaluate({
      anchorResolved: true,
      evidenceCount: 0,
      hasConflict: false,
    })

    expect(decision.status).toBe('degraded')
    expect(decision.reason).toBe('insufficient_evidence')
  })

  it('blocks conflicting evidence from being rendered as a confident answer', () => {
    const decision = gate.evaluate({
      anchorResolved: true,
      evidenceCount: 3,
      hasConflict: true,
    })

    expect(decision.status).toBe('clarify')
    expect(decision.reason).toBe('conflicting_evidence')
  })
})
