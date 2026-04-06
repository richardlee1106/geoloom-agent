import { describe, expect, it } from 'vitest'

import { ConversationMemory } from '../../../src/agent/ConversationMemory.js'

describe('ConversationMemory', () => {
  it('returns an empty summary when snapshot has no summary', () => {
    const memory = new ConversationMemory()
    const result = memory.summarize({
      sessionId: 'sess_empty',
      summary: '',
      recentTurns: [
        {
          traceId: 'trace_001',
          userQuery: '武汉大学附近有什么',
          answer: '暂无结果',
          createdAt: '2026-04-02T00:00:00.000Z',
        },
      ],
      turns: [],
    })

    expect(result).toEqual({
      summary: '',
      recentTurns: [],
    })
  })

  it('keeps the summary and trims recent turns to the latest three', () => {
    const memory = new ConversationMemory()
    const result = memory.summarize({
      sessionId: 'sess_full',
      summary: '用户最近在比较高校周边业态。',
      recentTurns: [
        {
          traceId: 'trace_001',
          userQuery: '第一轮',
          answer: '结果一',
          createdAt: '2026-04-02T00:00:00.000Z',
        },
        {
          traceId: 'trace_002',
          userQuery: '第二轮',
          answer: '结果二',
          createdAt: '2026-04-02T00:01:00.000Z',
        },
        {
          traceId: 'trace_003',
          userQuery: '第三轮',
          answer: '结果三',
          createdAt: '2026-04-02T00:02:00.000Z',
        },
        {
          traceId: 'trace_004',
          userQuery: '第四轮',
          answer: '结果四',
          createdAt: '2026-04-02T00:03:00.000Z',
        },
      ],
      turns: [],
    })

    expect(result.summary).toBe('用户最近在比较高校周边业态。')
    expect(result.recentTurns).toHaveLength(3)
    expect(result.recentTurns.map((turn) => turn.traceId)).toEqual([
      'trace_002',
      'trace_003',
      'trace_004',
    ])
  })
})
