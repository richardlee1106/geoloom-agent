import type { ConfidenceDecision } from './types.js'

export class ConfidenceGate {
  evaluate(input: {
    anchorResolved: boolean
    evidenceCount: number
    hasConflict: boolean
  }): ConfidenceDecision {
    if (!input.anchorResolved) {
      return {
        status: 'clarify',
        reason: 'unresolved_anchor',
        message: '我还没有定位到明确锚点，请补充更具体的地点。',
      }
    }

    if (input.hasConflict) {
      return {
        status: 'clarify',
        reason: 'conflicting_evidence',
        message: '当前证据之间存在冲突，我需要你进一步明确问题范围后再继续。',
      }
    }

    if (input.evidenceCount <= 0) {
      return {
        status: 'degraded',
        reason: 'insufficient_evidence',
        message: '当前证据不足，我先返回确定性摘要结果。',
      }
    }

    return {
      status: 'allow',
      reason: 'ok',
      message: null,
    }
  }
}
