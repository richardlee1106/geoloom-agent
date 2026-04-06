import { describe, expect, it, vi } from 'vitest'

import type { ShortTermRecordData } from '../../../src/memory/ShortTermMemory.js'
import { ShortTermMemory } from '../../../src/memory/ShortTermMemory.js'

describe('ShortTermMemory', () => {
  it('persists snapshots through the remote store when the store is available', async () => {
    const records = new Map<string, ShortTermRecordData>()
    const store = {
      ping: vi.fn(async () => true),
      getRecord: vi.fn(async (sessionId: string) => records.get(sessionId) || null),
      setRecord: vi.fn(async (sessionId: string, record: ShortTermRecordData) => {
        records.set(sessionId, structuredClone(record))
      }),
    }

    const memory = new ShortTermMemory({
      ttlMs: 60_000,
      store,
    })

    await memory.appendTurn('sess_remote_memory', {
      traceId: 'trace_remote_memory_001',
      userQuery: '武汉大学附近有哪些咖啡店？',
      answer: '已找到附近咖啡店。',
      createdAt: '2026-04-02T10:00:00.000Z',
    })

    const snapshot = await memory.getSnapshot('sess_remote_memory')

    expect(snapshot.turns).toHaveLength(1)
    expect(store.setRecord).toHaveBeenCalledTimes(1)
    await expect(memory.getStatus()).resolves.toMatchObject({
      name: 'short_term_memory',
      mode: 'remote',
      ready: true,
      degraded: false,
    })
  })

  it('falls back to in-memory state when the remote store is unavailable', async () => {
    const store = {
      ping: vi.fn(async () => {
        throw new Error('redis unavailable')
      }),
      getRecord: vi.fn(async () => {
        throw new Error('redis unavailable')
      }),
      setRecord: vi.fn(async () => {
        throw new Error('redis unavailable')
      }),
    }

    const memory = new ShortTermMemory({
      ttlMs: 60_000,
      store,
    })

    await memory.appendTurn('sess_memory_fallback', {
      traceId: 'trace_memory_fallback_001',
      userQuery: '湖北大学最近的地铁站是什么？',
      answer: '正在使用本地 fallback 继续保存会话。',
      createdAt: '2026-04-02T10:05:00.000Z',
    })

    const snapshot = await memory.getSnapshot('sess_memory_fallback')

    expect(snapshot.turns).toHaveLength(1)
    await expect(memory.getStatus()).resolves.toMatchObject({
      name: 'short_term_memory',
      mode: 'fallback',
      ready: true,
      degraded: true,
      reason: 'remote_store_unavailable',
    })
  })
})
