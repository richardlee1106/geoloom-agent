import { describe, expect, it } from 'vitest'

import { SessionManager } from '../../../src/agent/SessionManager.js'
import { ShortTermMemory } from '../../../src/memory/ShortTermMemory.js'

describe('SessionManager', () => {
  it('reuses the provided session id and stores turn metadata', async () => {
    const memory = new ShortTermMemory()
    const manager = new SessionManager({ memory })

    const session = await manager.getOrCreate({
      requestId: 'req_phase3_001',
      sessionId: 'sess_phase3_existing',
    })

    expect(session.id).toBe('sess_phase3_existing')

    await manager.recordTurn(session.id, {
      traceId: 'trace_phase3_001',
      userQuery: '武汉大学附近有哪些咖啡店？',
      answer: '已找到结果',
      intent: { queryType: 'nearby_poi' },
    })

    const snapshot = await memory.getSnapshot(session.id)
    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.turns[0]).toMatchObject({
      traceId: 'trace_phase3_001',
      userQuery: '武汉大学附近有哪些咖啡店？',
    })
  })

  it('creates a new session id when none is supplied', async () => {
    const manager = new SessionManager({
      memory: new ShortTermMemory(),
    })

    const session = await manager.getOrCreate({
      requestId: 'req_phase3_002',
    })

    expect(session.id).toMatch(/^sess_/)
    expect(session.requestId).toBe('req_phase3_002')
  })
})
