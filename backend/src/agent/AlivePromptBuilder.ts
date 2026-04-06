import type { MemorySnapshot, ProfilesSnapshot } from './types.js'

export class AlivePromptBuilder {
  build(input: {
    sessionId: string
    profiles: ProfilesSnapshot
    memory: Pick<MemorySnapshot, 'summary' | 'recentTurns'>
    skillSnippets: string[]
  }) {
    const lines = [
      '你是 GeoLoom V4 的空间智能助手。',
      `当前 session_id: ${input.sessionId}`,
      '',
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
      '回答要求：所有结论都必须对应真实证据；证据不足时先澄清，不允许脑补。',
    ]

    return lines.join('\n')
  }
}
