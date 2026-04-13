export interface RuntimeMetricsOptions {
  windowSize?: number
}

export interface RuntimeRequestMetric {
  latencyMs: number
  sqlValidated: boolean
  sqlAccepted: boolean
  answerGrounded: boolean
  // 阶段 0：分段耗时与可观测性指标
  intentMs?: number
  evidenceRuntimeMs?: number
  synthesisMs?: number
  llmRoundCount?: number
  toolCallCount?: number
  unnecessaryAnalysis?: boolean
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
  // 阶段 0：分段耗时聚合
  phase_latency: {
    intent_p50_ms: number
    intent_p95_ms: number
    evidence_p50_ms: number
    evidence_p95_ms: number
    synthesis_p50_ms: number
    synthesis_p95_ms: number
  }
  llm_rounds: {
    avg: number
    max: number
  }
  tool_calls: {
    avg: number
    max: number
  }
  unnecessary_analysis_rate: number
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

  // 阶段 0：分段耗时滑动窗口
  private readonly intentLatencies: number[] = []
  private readonly evidenceLatencies: number[] = []
  private readonly synthesisLatencies: number[] = []
  private readonly llmRounds: number[] = []
  private readonly toolCalls: number[] = []
  private unnecessaryAnalysisCount = 0

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

    // 阶段 0：采集分段耗时
    if (metric.intentMs != null) {
      this.intentLatencies.push(Math.max(0, metric.intentMs))
      if (this.intentLatencies.length > this.windowSize) {
        this.intentLatencies.splice(0, this.intentLatencies.length - this.windowSize)
      }
    }
    if (metric.evidenceRuntimeMs != null) {
      this.evidenceLatencies.push(Math.max(0, metric.evidenceRuntimeMs))
      if (this.evidenceLatencies.length > this.windowSize) {
        this.evidenceLatencies.splice(0, this.evidenceLatencies.length - this.windowSize)
      }
    }
    if (metric.synthesisMs != null) {
      this.synthesisLatencies.push(Math.max(0, metric.synthesisMs))
      if (this.synthesisLatencies.length > this.windowSize) {
        this.synthesisLatencies.splice(0, this.synthesisLatencies.length - this.windowSize)
      }
    }
    if (metric.llmRoundCount != null) {
      this.llmRounds.push(Math.max(0, metric.llmRoundCount))
      if (this.llmRounds.length > this.windowSize) {
        this.llmRounds.splice(0, this.llmRounds.length - this.windowSize)
      }
    }
    if (metric.toolCallCount != null) {
      this.toolCalls.push(Math.max(0, metric.toolCallCount))
      if (this.toolCalls.length > this.windowSize) {
        this.toolCalls.splice(0, this.toolCalls.length - this.windowSize)
      }
    }
    if (metric.unnecessaryAnalysis) {
      this.unnecessaryAnalysisCount += 1
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
      phase_latency: {
        intent_p50_ms: percentile(this.intentLatencies, 0.5),
        intent_p95_ms: percentile(this.intentLatencies, 0.95),
        evidence_p50_ms: percentile(this.evidenceLatencies, 0.5),
        evidence_p95_ms: percentile(this.evidenceLatencies, 0.95),
        synthesis_p50_ms: percentile(this.synthesisLatencies, 0.5),
        synthesis_p95_ms: percentile(this.synthesisLatencies, 0.95),
      },
      llm_rounds: {
        avg: this.llmRounds.length > 0
          ? roundRate(this.llmRounds.reduce((a, b) => a + b, 0) / this.llmRounds.length)
          : 0,
        max: this.llmRounds.length > 0
          ? Math.max(...this.llmRounds)
          : 0,
      },
      tool_calls: {
        avg: this.toolCalls.length > 0
          ? roundRate(this.toolCalls.reduce((a, b) => a + b, 0) / this.toolCalls.length)
          : 0,
        max: this.toolCalls.length > 0
          ? Math.max(...this.toolCalls)
          : 0,
      },
      unnecessary_analysis_rate: this.answersTotal > 0
        ? roundRate(this.unnecessaryAnalysisCount / this.answersTotal)
        : 0,
    }
  }
}
