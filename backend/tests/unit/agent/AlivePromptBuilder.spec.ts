import { describe, expect, it } from 'vitest'

import { AlivePromptBuilder } from '../../../src/agent/AlivePromptBuilder.js'

describe('AlivePromptBuilder', () => {
  it('combines profiles, memory snapshot and skill prompt snippets into one prompt', () => {
    const builder = new AlivePromptBuilder()

    const prompt = builder.build({
      sessionId: 'sess_phase3_alive',
      profiles: {
        soul: '你是一个谨慎、证据驱动的空间助手。',
        user: '用户偏好简洁回答，但要明确说明证据来源。',
      },
      memory: {
        summary: '上轮已经定位过武汉大学，最近在问咖啡和地铁。',
        recentTurns: [
          {
            traceId: 'trace_alive_001',
            userQuery: '武汉大学附近有哪些咖啡店？',
            answer: '找到 5 家咖啡店。',
            createdAt: '2026-04-02T00:00:00.000Z',
          },
        ],
      },
      skillSnippets: [
        'postgis: 只读空间事实技能，可解析锚点并执行受限 SQL。',
        'route_distance: 可估算步行距离并返回降级标记。',
      ],
    })

    expect(prompt).toContain('sess_phase3_alive')
    expect(prompt).toContain('谨慎、证据驱动')
    expect(prompt).toContain('上轮已经定位过武汉大学')
    expect(prompt).toContain('postgis')
    expect(prompt).toContain('route_distance')
  })
})
