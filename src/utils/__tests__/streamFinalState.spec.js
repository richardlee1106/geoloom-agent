import { describe, expect, it } from 'vitest'

import { resolveStreamFinalState } from '../streamFinalState'

describe('resolveStreamFinalState', () => {
  it('marks successful requests as completed', () => {
    expect(resolveStreamFinalState({ requestSucceeded: true })).toEqual({
      isStreaming: false,
      isThinking: false,
      thinkingMessage: '分析已经完成',
      pipelineCompleted: true,
      finalizeAtAnswerStage: true,
    })
  })

  it('keeps failed requests from pretending they completed', () => {
    expect(resolveStreamFinalState({ requestSucceeded: false })).toEqual({
      isStreaming: false,
      isThinking: false,
      thinkingMessage: '请求已中断',
      pipelineCompleted: false,
      finalizeAtAnswerStage: false,
    })
  })
})
