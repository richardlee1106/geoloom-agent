import { describe, expect, it } from 'vitest'

import { buildChatHistoryExportContent } from '../chatHistoryExport'

describe('chatHistoryExport', () => {
  it('exports the current session as markdown with panel meta, visible answer, reasoning and timeline', () => {
    const content = buildChatHistoryExportContent([
      {
        role: 'user',
        content: '湖北大学附近有哪些地铁站？',
        timestamp: 1
      },
      {
        role: 'assistant',
        content: '## 区域主语\n- 湖北大学校园片区\n\n## 热点与结构\n- 活力集中在地铁口周边。',
        timestamp: 2,
        thinkingMessage: '正在整合空间证据...',
        reasoningContent: '我会围绕“湖北大学”附近展开检索，优先筛选交通设施服务。',
        pipelineCompleted: true,
        runStartedAt: 2000,
        runCompletedAt: 6500,
        agentEvents: [
          {
            id: 'evt-1',
            type: 'queued',
            state: 'info',
            title: '已接收问题',
            detail: '开始准备当前轮分析',
            timestamp: 2000,
          },
          {
            id: 'evt-2',
            type: 'refined_result',
            state: 'success',
            title: '汇总证据并生成回答',
            detail: '已返回结构化结果',
            timestamp: 6400,
          },
        ],
        toolCalls: [
          {
            skill: 'postgis',
            action: 'execute_spatial_sql',
            status: 'done',
            latency_ms: 182,
          },
        ],
        toolCallsRecordedAt: 5000,
      }
    ], {
      poiCount: 0,
      exportedAt: new Date('2026-03-24T10:59:59+08:00'),
      panelMetaItems: [
        { key: 'backend', label: '后端', value: '在线' },
        { key: 'poi', label: 'POI', value: '12 个' },
      ],
      sanitizeAssistantText: (text) => text,
      formatNow: () => '2026/3/24 10:59:59',
      formatTimestamp: () => '10:59:47',
      formatTimelineTimestamp: () => '10:59:48',
    })

    expect(content).toContain('# GeoLoom AI 对话记录')
    expect(content).toContain('- 后端: 在线')
    expect(content).toContain('- POI: 12 个')
    expect(content).toContain('## 第 1 轮')
    expect(content).toContain('### 用户')
    expect(content).toContain('### 助手')
    expect(content).toContain('## 区域主语')
    expect(content).toContain('### 推理过程')
    expect(content).toContain('状态: 正在整合空间证据...')
    expect(content).toContain('### 过程时间线')
    expect(content).toContain('1. [10:59:48] 已接收问题')
    expect(content).toContain('2. [10:59:48] postgis.execute_spatial_sql')
    expect(content).toContain('3. [10:59:48] 汇总证据并生成回答')
    expect(content).toContain('### 运行摘要')
    expect(content).toContain('已完成分析 · 用时 4.5 s')
  })
})
