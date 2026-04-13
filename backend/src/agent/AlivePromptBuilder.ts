import type { MemorySnapshot, ProfilesSnapshot } from './types.js'

export class AlivePromptBuilder {
  build(input: {
    sessionId: string
    profiles: ProfilesSnapshot
    memory: Pick<MemorySnapshot, 'summary' | 'recentTurns'>
    skillSnippets: string[]
    requestContext?: {
      rawQuery?: string
      intentHint?: string | null
      intentSource?: string | null
      routerHint?: string | null
      anchorHint?: string | null
      spatialScopeHint?: string | null
      taskModeHint?: 'query' | 'analysis' | null
    }
  }) {
    const requestContextLines = input.requestContext
      ? [
          '【Current Request】',
          `用户原问题: ${String(input.requestContext.rawQuery || '').trim() || '未提供'}`,
          `entry intent hint: ${String(input.requestContext.intentHint || input.requestContext.routerHint || '').trim() || 'none'}`,
          `entry intent source: ${String(input.requestContext.intentSource || '').trim() || 'none'}`,
          `anchor hint: ${String(input.requestContext.anchorHint || '').trim() || 'none'}`,
          `spatial scope hint: ${String(input.requestContext.spatialScopeHint || '').trim() || 'none'}`,
          `task mode hint: ${String(input.requestContext.taskModeHint || '').trim() || 'none'}`,
          '',
        ]
      : []

    const lines = [
      '你是 GeoLoom V4 的空间智能助手。',
      `当前 session_id: ${input.sessionId}`,
      '',
      '【Agent Contract】',
      '你是一个绝对客观的事实陈述器，不是城市规划师也不是分析专家。',
      '所有结论都必须对应真实的工具返回证据。',
      '证据不足时先澄清，不允许脑补任何数据。',
      '用户问什么就回答什么，不要自作主张地扩展分析范围。',
      '严禁输出用户没有请求的"机会点"、"异常点"、"投资建议"。',
      '如果底层数据没有呈现，直接说明"未包含相关数据"。',
      '如果多个工具彼此没有前后输入依赖，应在同一轮直接发起多个 tool calls 并行执行；只有后一工具必须读取前一工具结果时才串行。',
      'spatial_encoder 与 spatial_vector 只提供语义辅助证据，不能冒充硬事实。',
      '',
      ...requestContextLines,
      '【Soul】',
      input.profiles.soul.trim(),
      '',
      '【User Profile】',
      input.profiles.user.trim(),
      '',
      '【Conversation Memory】',
      input.memory.summary || '当前没有可复用的历史摘要。',
      '',
      '【Recent Turns】',
      ...(input.memory.recentTurns.length > 0
        ? input.memory.recentTurns.map((turn) => `- ${turn.userQuery} -> ${turn.answer}`)
        : ['- 无']),
      '',
      '【Skill Contracts】',
      ...input.skillSnippets.map((snippet) => `- ${snippet}`),
      '',
      '回答要求：忠于原问题，客观陈述，不推演。',
    ]

    return lines.join('\n')
  }
}
