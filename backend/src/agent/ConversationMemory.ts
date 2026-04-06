import type { MemorySnapshot } from './types.js'

export class ConversationMemory {
  summarize(snapshot: MemorySnapshot) {
    if (!snapshot.summary) {
      return {
        summary: '',
        recentTurns: [],
      }
    }

    return {
      summary: snapshot.summary,
      recentTurns: snapshot.recentTurns.slice(-3),
    }
  }
}
