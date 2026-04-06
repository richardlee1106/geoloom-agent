import { describe, expect, it } from 'vitest'

import { RuntimeMetrics } from '../../../src/metrics/RuntimeMetrics.js'

describe('RuntimeMetrics', () => {
  it('aggregates latency percentiles and derived rates from recent requests', () => {
    const metrics = new RuntimeMetrics({ windowSize: 10 })

    metrics.recordRequest({
      latencyMs: 100,
      sqlValidated: true,
      sqlAccepted: true,
      answerGrounded: true,
    })
    metrics.recordRequest({
      latencyMs: 500,
      sqlValidated: true,
      sqlAccepted: false,
      answerGrounded: false,
    })
    metrics.recordRequest({
      latencyMs: 300,
      sqlValidated: false,
      sqlAccepted: false,
      answerGrounded: true,
    })

    expect(metrics.snapshot()).toEqual({
      requests_total: 3,
      latency: {
        count: 3,
        p50_ms: 300,
        p95_ms: 500,
      },
      sql: {
        validation_attempts: 2,
        validation_passed: 1,
        validation_failed: 1,
      },
      sql_valid_rate: 0.5,
      answers: {
        total: 3,
        grounded: 2,
        ungrounded: 1,
      },
      evidence_grounded_answer_rate: 0.667,
    })
  })

  it('limits latency percentiles to the configured rolling window', () => {
    const metrics = new RuntimeMetrics({ windowSize: 3 })

    metrics.recordRequest({ latencyMs: 100, sqlValidated: false, sqlAccepted: false, answerGrounded: false })
    metrics.recordRequest({ latencyMs: 200, sqlValidated: false, sqlAccepted: false, answerGrounded: false })
    metrics.recordRequest({ latencyMs: 300, sqlValidated: false, sqlAccepted: false, answerGrounded: false })
    metrics.recordRequest({ latencyMs: 1000, sqlValidated: false, sqlAccepted: false, answerGrounded: false })

    expect(metrics.snapshot().latency).toEqual({
      count: 3,
      p50_ms: 300,
      p95_ms: 1000,
    })
  })
})
