import { describe, expect, it } from 'vitest'

import {
  getAgentStageSteps,
  getRunStatusCopy,
  normalizeAgentStage
} from '../agentStageConfig.js'

describe('agentStageConfig', () => {
  it('uses the real v4 pipeline instead of legacy v1 labels', () => {
    const steps = getAgentStageSteps({ backendVersion: 'v4' })

    expect(steps.map((step) => step.key)).toEqual([
      'intent',
      'memory',
      'tool_select',
      'tool_run',
      'evidence',
      'answer'
    ])
    expect(steps[0].label).toBe('识别问题')
    expect(steps[3].label).toBe('执行检索')
  })

  it('normalizes deterministic query stage names into the shared v4 pipeline', () => {
    expect(normalizeAgentStage('query')).toBe('tool_run')
    expect(normalizeAgentStage('writer')).toBe('answer')
    expect(normalizeAgentStage('tool_select')).toBe('tool_select')
  })

  it('returns a completed status copy when the run has finished', () => {
    const copy = getRunStatusCopy({
      pipelineCompleted: true,
      isThinking: false,
      activeStageKey: 'answer',
      stageSteps: getAgentStageSteps({ backendVersion: 'v4' })
    })

    expect(copy.label).toBe('分析已经完成')
    expect(copy.tone).toBe('done')
  })
})
