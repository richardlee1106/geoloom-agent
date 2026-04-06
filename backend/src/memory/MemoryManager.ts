import type { MemorySnapshot } from '../agent/types.js'
import type { DependencyStatus } from '../integration/dependencyStatus.js'
import { ProfileManager } from './ProfileManager.js'
import { LongTermMemory } from './LongTermMemory.js'
import { ShortTermMemory } from './ShortTermMemory.js'

export interface MemoryManagerOptions {
  shortTerm: ShortTermMemory
  longTerm: LongTermMemory
  profiles: ProfileManager
}

export class MemoryManager {
  constructor(private readonly options: MemoryManagerOptions) {}

  async getSnapshot(sessionId: string): Promise<MemorySnapshot> {
    const shortTerm = await this.options.shortTerm.getSnapshot(sessionId)
    const longTermSummary = await this.options.longTerm.readSessionSummary(sessionId)

    return {
      ...shortTerm,
      summary: [longTermSummary, shortTerm.summary].filter(Boolean).join(' | '),
    }
  }

  async recordTurn(sessionId: string, turn: MemorySnapshot['turns'][number]) {
    await this.options.shortTerm.appendTurn(sessionId, turn)
    const snapshot = await this.options.shortTerm.getSnapshot(sessionId)
    await this.options.longTerm.appendSessionSummary(sessionId, snapshot.summary)
  }

  async loadProfiles() {
    return this.options.profiles.loadProfiles()
  }

  async getHealth(): Promise<{
    ready: boolean
    short_term: DependencyStatus
    long_term: DependencyStatus
    dependencies: Record<string, DependencyStatus>
  }> {
    const shortTerm = await this.options.shortTerm.getStatus()
    const longTerm: DependencyStatus = {
      name: 'long_term_memory',
      ready: true,
      mode: 'local',
      degraded: false,
      reason: null,
      target: null,
    }

    return {
      ready: shortTerm.ready && longTerm.ready,
      short_term: shortTerm,
      long_term: longTerm,
      dependencies: {
        short_term_memory: shortTerm,
        long_term_memory: longTerm,
      },
    }
  }
}
