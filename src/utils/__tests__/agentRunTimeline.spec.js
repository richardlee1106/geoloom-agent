import { describe, expect, it } from 'vitest'

import { appendAgentEventToMessage, buildAgentRunSnapshot } from '../agentRunTimeline'

describe('buildAgentRunSnapshot', () => {
  it('merges agent events and tool calls into one readable timeline', () => {
    const snapshot = buildAgentRunSnapshot({
      pipelineCompleted: true,
      isStreaming: false,
      isThinking: false,
      runStartedAt: 1000,
      runCompletedAt: 5200,
      agentEvents: [
        {
          id: 'evt-1',
          type: 'queued',
          state: 'info',
          title: '已接收问题',
          detail: '开始准备当前轮分析',
          timestamp: 1000,
        },
        {
          id: 'evt-2',
          type: 'stage',
          state: 'running',
          title: '识别问题',
          detail: '正在识别锚点与需求',
          timestamp: 2000,
        },
        {
          id: 'evt-3',
          type: 'refined_result',
          state: 'success',
          title: '汇总证据并生成回答',
          detail: '已返回结构化结果',
          timestamp: 3000,
        },
      ],
      toolCalls: [
        {
          skill: 'postgis',
          action: 'viewport_poi_scan',
          status: 'done',
          latency_ms: 182,
        },
      ],
      toolCallsRecordedAt: 2800,
    })

    expect(snapshot.summary.label).toBe('已完成分析')
    expect(snapshot.summary.elapsedLabel).toBe('用时 4.2 s')
    expect(snapshot.summary.detail).toContain('用时 4.2 s')
    expect(snapshot.summary.toolCount).toBe(1)
    expect(snapshot.summary.eventCount).toBe(4)
    expect(snapshot.timeline.map((item) => item.title)).toEqual([
      '已接收问题',
      '识别问题',
      'postgis.viewport_poi_scan',
      '汇总证据并生成回答',
    ])
    expect(snapshot.timeline[2]).toMatchObject({
      kind: 'tool',
      state: 'success',
    })
    expect(snapshot.timeline[2].detail).toContain('182 ms')
  })

  it('reports running state even before the final answer arrives', () => {
    const snapshot = buildAgentRunSnapshot({
      isStreaming: true,
      isThinking: true,
      pipelineCompleted: false,
      agentEvents: [],
      toolCalls: [],
    })

    expect(snapshot.summary.label).toBe('正在运行')
    expect(snapshot.summary.detail).toContain('过程记录会持续更新')
    expect(snapshot.timeline).toEqual([])
  })

  it('keeps reasoning chunks as visible timeline nodes instead of dropping them', () => {
    const message = {
      pipelineCompleted: false,
      isStreaming: true,
      isThinking: true,
      agentEvents: [],
      toolCalls: [],
    }

    const event = appendAgentEventToMessage(message, 'reasoning', {
      content: '先锁定当前范围，再判断主导业态和热点是不是挤在同一片网格里。',
    })

    expect(event).toMatchObject({
      title: '推理片段',
      detail: '先锁定当前范围，再判断主导业态和热点是不是挤在同一片网格里。',
    })

    const snapshot = buildAgentRunSnapshot(message)

    expect(snapshot.timeline).toHaveLength(1)
    expect(snapshot.timeline[0]).toMatchObject({
      title: '推理片段',
      detail: '先锁定当前范围，再判断主导业态和热点是不是挤在同一片网格里。',
    })
  })
})
