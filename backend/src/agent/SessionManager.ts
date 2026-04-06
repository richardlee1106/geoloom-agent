import { randomUUID } from 'node:crypto'

import type { SessionRecord } from './types.js'
import { ShortTermMemory } from '../memory/ShortTermMemory.js'

export interface SessionManagerOptions {
  memory: ShortTermMemory
}

export class SessionManager {
  constructor(private readonly options: SessionManagerOptions) {}

  async getOrCreate(input: { requestId: string, sessionId?: string }): Promise<SessionRecord> {
    const now = new Date().toISOString()
    const sessionId = input.sessionId || `sess_${randomUUID()}`
    const snapshot = await this.options.memory.getSnapshot(sessionId)
    const createdAt = snapshot.turns[0]?.createdAt || now

    return {
      id: sessionId,
      requestId: input.requestId,
      createdAt,
      updatedAt: now,
    }
  }

  async recordTurn(sessionId: string, input: {
    traceId: string
    userQuery: string
    answer: string
    intent?: Record<string, unknown>
  }) {
    await this.options.memory.appendTurn(sessionId, {
      traceId: input.traceId,
      userQuery: input.userQuery,
      answer: input.answer,
      intent: input.intent,
      createdAt: new Date().toISOString(),
    })
  }
}
