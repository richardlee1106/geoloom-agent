export interface RuntimeMetricsOptions {
  windowSize?: number
}

export interface RuntimeRequestMetric {
  latencyMs: number
  sqlValidated: boolean
  sqlAccepted: boolean
  answerGrounded: boolean
}

export interface RuntimeMetricsSnapshot {
  requests_total: number
  latency: {
    count: number
    p50_ms: number
    p95_ms: number
  }
  sql: {
    validation_attempts: number
    validation_passed: number
    validation_failed: number
  }
  sql_valid_rate: number
  answers: {
    total: number
    grounded: number
    ungrounded: number
  }
  evidence_grounded_answer_rate: number
}

function roundRate(value: number) {
  return Number(value.toFixed(3))
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  )
  return sorted[index]
}

export class RuntimeMetrics {
  private readonly windowSize: number

  private readonly latencies: number[] = []

  private requestsTotal = 0

  private sqlValidationAttempts = 0

  private sqlValidationPassed = 0

  private answersTotal = 0

  private answersGrounded = 0

  constructor(options: RuntimeMetricsOptions = {}) {
    this.windowSize = Math.max(1, Number(options.windowSize || 200))
  }

  recordRequest(metric: RuntimeRequestMetric) {
    this.requestsTotal += 1
    this.answersTotal += 1
    this.latencies.push(Math.max(0, Number(metric.latencyMs || 0)))
    if (this.latencies.length > this.windowSize) {
      this.latencies.splice(0, this.latencies.length - this.windowSize)
    }

    if (metric.sqlValidated) {
      this.sqlValidationAttempts += 1
      if (metric.sqlAccepted) {
        this.sqlValidationPassed += 1
      }
    }

    if (metric.answerGrounded) {
      this.answersGrounded += 1
    }
  }

  snapshot(): RuntimeMetricsSnapshot {
    const sqlValidationFailed = this.sqlValidationAttempts - this.sqlValidationPassed
    const answersUngrounded = this.answersTotal - this.answersGrounded

    return {
      requests_total: this.requestsTotal,
      latency: {
        count: this.latencies.length,
        p50_ms: percentile(this.latencies, 0.5),
        p95_ms: percentile(this.latencies, 0.95),
      },
      sql: {
        validation_attempts: this.sqlValidationAttempts,
        validation_passed: this.sqlValidationPassed,
        validation_failed: sqlValidationFailed,
      },
      sql_valid_rate: this.sqlValidationAttempts > 0
        ? roundRate(this.sqlValidationPassed / this.sqlValidationAttempts)
        : 0,
      answers: {
        total: this.answersTotal,
        grounded: this.answersGrounded,
        ungrounded: answersUngrounded,
      },
      evidence_grounded_answer_rate: this.answersTotal > 0
        ? roundRate(this.answersGrounded / this.answersTotal)
        : 0,
    }
  }
}
