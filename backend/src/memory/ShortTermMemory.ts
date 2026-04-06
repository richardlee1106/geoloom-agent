import type { MemorySnapshot, MemoryTurn } from '../agent/types.js'
import { createDependencyStatus, type DependencyStatus } from '../integration/dependencyStatus.js'

export interface ShortTermRecordData {
  sessionId: string
  summary: string
  turns: MemoryTurn[]
  updatedAt: number
}

export interface ShortTermMemoryStore {
  getRecord(sessionId: string): Promise<ShortTermRecordData | null>
  setRecord(sessionId: string, record: ShortTermRecordData, ttlMs: number): Promise<void>
  ping?(): Promise<unknown>
}

export interface ShortTermMemoryOptions {
  ttlMs?: number
  store?: ShortTermMemoryStore | null
}

export class ShortTermMemory {
  private readonly sessions = new Map<string, ShortTermRecordData>()

  private readonly ttlMs: number

  private readonly store: ShortTermMemoryStore | null

  private status: DependencyStatus

  constructor(options: number | ShortTermMemoryOptions = {}) {
    const normalized = typeof options === 'number' ? { ttlMs: options } : options
    this.ttlMs = normalized.ttlMs || 24 * 60 * 60 * 1000
    this.store = normalized.store || null
    this.status = this.store
      ? createDependencyStatus({
        name: 'short_term_memory',
        ready: false,
        mode: 'remote',
        degraded: true,
        reason: 'awaiting_probe',
      })
      : createDependencyStatus({
        name: 'short_term_memory',
        ready: true,
        mode: 'local',
        degraded: true,
        reason: 'remote_unconfigured',
      })
  }

  async getSnapshot(sessionId: string): Promise<MemorySnapshot> {
    this.prune()
    let record = this.sessions.get(sessionId)

    if (this.store) {
      try {
        const remote = await this.store.getRecord(sessionId)
        if (remote) {
          this.sessions.set(sessionId, remote)
          record = remote
        }
        this.status = createDependencyStatus({
          name: 'short_term_memory',
          ready: true,
          mode: 'remote',
          degraded: false,
        })
      } catch {
        this.markFallback()
      }
    }

    if (!record) {
      return {
        sessionId,
        summary: '',
        recentTurns: [],
        turns: [],
      }
    }

    return {
      sessionId,
      summary: record.summary,
      recentTurns: record.turns.slice(-3),
      turns: record.turns.slice(),
    }
  }

  async appendTurn(sessionId: string, turn: MemoryTurn) {
    const snapshot = this.ensure(sessionId)
    snapshot.turns.push(turn)
    snapshot.updatedAt = Date.now()
    snapshot.summary = this.buildSummary(snapshot.turns)
    await this.syncRemote(snapshot)
  }

  async setSummary(sessionId: string, summary: string) {
    const snapshot = this.ensure(sessionId)
    snapshot.summary = summary
    snapshot.updatedAt = Date.now()
    await this.syncRemote(snapshot)
  }

  async getStatus(): Promise<DependencyStatus> {
    if (!this.store) {
      return this.status
    }

    if (this.status.mode === 'fallback') {
      return this.status
    }

    if (this.store.ping) {
      try {
        await this.store.ping()
        this.status = createDependencyStatus({
          name: 'short_term_memory',
          ready: true,
          mode: 'remote',
          degraded: false,
        })
      } catch {
        this.markFallback()
      }
    }

    return this.status
  }

  private ensure(sessionId: string) {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing

    const created: ShortTermRecordData = {
      sessionId,
      summary: '',
      turns: [],
      updatedAt: Date.now(),
    }
    this.sessions.set(sessionId, created)
    return created
  }

  private async syncRemote(record: ShortTermRecordData) {
    if (!this.store) return

    try {
      await this.store.setRecord(record.sessionId, record, this.ttlMs)
      this.status = createDependencyStatus({
        name: 'short_term_memory',
        ready: true,
        mode: 'remote',
        degraded: false,
      })
    } catch {
      this.markFallback()
    }
  }

  private prune() {
    const now = Date.now()
    for (const [sessionId, record] of this.sessions.entries()) {
      if (now - record.updatedAt > this.ttlMs) {
        this.sessions.delete(sessionId)
      }
    }
  }

  private buildSummary(turns: MemoryTurn[]) {
    if (turns.length === 0) return ''

    return turns
      .slice(-2)
      .map((turn) => `${turn.userQuery} -> ${turn.answer}`)
      .join(' | ')
  }

  private markFallback() {
    this.status = createDependencyStatus({
      name: 'short_term_memory',
      ready: true,
      mode: 'fallback',
      degraded: true,
      reason: 'remote_store_unavailable',
    })
  }
}
