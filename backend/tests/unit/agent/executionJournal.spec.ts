import { describe, expect, it } from 'vitest'

import type { DeterministicIntent, ToolExecutionTrace } from '../../../src/chat/types.js'
import {
  appendToolTraceEvent,
  createAgentExecutionJournal,
  finalizeAgentExecutionJournal,
  toAgentExecutionLogPayload,
} from '../../../src/agent/executionJournal.js'

function buildIntent(overrides: Partial<DeterministicIntent> = {}): DeterministicIntent {
  return {
    queryType: 'nearby_poi',
    intentMode: 'deterministic_visible_loop',
    rawQuery: '湖北大学附近有什么吃的',
    placeName: '湖北大学',
    anchorSource: 'place',
    secondaryPlaceName: null,
    targetCategory: '美食',
    comparisonTarget: null,
    categoryKey: 'food',
    categoryMain: '餐饮服务',
    categorySub: '餐厅',
    radiusM: 800,
    needsClarification: false,
    clarificationHint: null,
    needsWebSearch: false,
    toolIntent: 'candidate_lookup',
    searchIntentHint: null,
    ...overrides,
  }
}

function buildTrace(): ToolExecutionTrace {
  return {
    id: 'tool-1',
    skill: 'postgis',
    action: 'execute_spatial_sql',
    status: 'done',
    payload: {
      template: 'nearby_poi',
    },
    latency_ms: 42,
  }
}

describe('executionJournal', () => {
  it('builds a composite recommendation plan with stage-specific steps', () => {
    const journal = createAgentExecutionJournal({
      rawQuery: '在湖北大学地铁站和三角路地铁站之间找吃的，吃完去万象城逛服装店',
      intent: buildIntent({
        queryType: 'composite_recommendation',
        targetCategory: '美食 + 服装店',
        placeName: '湖北大学地铁站 - 三角路地铁站',
      }),
      taskMode: 'analysis',
      plannerSource: 'rule_composite_detector',
      recommendedTrack: 'composite',
      needsWebSearch: false,
    })

    expect(journal.summary).toContain('多阶段行程建议')
    expect(journal.steps.map((step) => step.id)).toEqual([
      'decompose_request',
      'resolve_stage_anchors',
      'collect_corridor_evidence',
      'collect_destination_evidence',
      'synthesize_answer',
      'verify_answer',
    ])
  })

  it('adds enrich_evidence for nearby queries that need web evidence', () => {
    const journal = createAgentExecutionJournal({
      rawQuery: '湖北大学附近有哪些评分高的餐厅',
      intent: buildIntent({
        needsWebSearch: true,
      }),
      taskMode: 'query',
      plannerSource: 'llm',
      recommendedTrack: 'deep',
      needsWebSearch: true,
    })

    expect(journal.steps.map((step) => step.id)).toContain('enrich_evidence')
    expect(journal.steps.find((step) => step.id === 'enrich_evidence')?.detail).toContain('联网')
  })

  it('finalizes verification and records tool trace events', () => {
    const journal = createAgentExecutionJournal({
      rawQuery: '湖北大学附近有什么吃的',
      intent: buildIntent(),
      taskMode: 'query',
      plannerSource: 'embedding',
      recommendedTrack: 'fast',
      needsWebSearch: false,
    })

    appendToolTraceEvent(journal, buildTrace())
    finalizeAgentExecutionJournal(journal, {
      verificationStatus: 'allow',
      verificationReason: 'ok',
      answerGrounded: true,
      evidenceCount: 4,
      toolCallCount: 1,
      answerSource: 'deterministic_renderer',
    })

    expect(journal.verification).toMatchObject({
      status: 'allow',
      reason: 'ok',
      answerGrounded: true,
      evidenceCount: 4,
      toolCallCount: 1,
      answerSource: 'deterministic_renderer',
      needsUserFollowUp: false,
    })
    expect(journal.steps.find((step) => step.id === 'verify_answer')).toMatchObject({
      status: 'completed',
    })

    const payload = toAgentExecutionLogPayload(journal)
    expect(payload?.events).toHaveLength(2)
    expect(payload?.events[0]).toMatchObject({
      kind: 'tool',
      message: 'postgis.execute_spatial_sql -> done',
    })
    expect(payload?.events[1]).toMatchObject({
      kind: 'verification',
      message: 'verification=allow/ok',
    })
  })
})
