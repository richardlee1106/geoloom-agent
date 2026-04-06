import { describe, expect, it } from 'vitest'

import { buildChatHistoryExportContent } from '../chatHistoryExport.js'

describe('chatHistoryExport', () => {
  it('includes numbered dialogue entries and assistant reasoning content in exported chat history', () => {
    const content = buildChatHistoryExportContent([
      {
        role: 'user',
        content: '湖北大学附近有哪些地铁站？',
        timestamp: 1
      },
      {
        role: 'assistant',
        content: '根据空间检索，先给您列出候选结果。',
        timestamp: 2,
        thinkingMessage: '正在整合空间证据...',
        reasoningContent: '我会围绕“湖北大学”附近展开检索，优先筛选交通设施服务。'
      }
    ], {
      poiCount: 0,
      exportedAt: new Date('2026-03-24T10:59:59+08:00'),
      sanitizeAssistantText: (text) => text,
      formatNow: () => '2026/3/24 10:59:59',
      formatTimestamp: () => '10:59:47'
    })

    expect(content).toContain('===== 标签云智能助手对话记录 =====')
    expect(content).toContain('① [用户] 10:59:47:')
    expect(content).toContain('① [智能助手] 10:59:47:')
    expect(content).toContain('① [空间推理] 10:59:47:')
    expect(content).toContain('状态: 正在整合空间证据...')
    expect(content).toContain('我会围绕“湖北大学”附近展开检索')
  })
})
