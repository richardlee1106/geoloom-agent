import { describe, expect, it } from 'vitest'

import { NarrativeWebFactCache } from '../../../src/narrative/NarrativeWebFactCache.js'

describe('NarrativeWebFactCache', () => {
  it('stores and returns cloned web fact sources until ttl expires', () => {
    let now = 1_000
    const cache = new NarrativeWebFactCache({ ttlMs: 1_000, failureTtlMs: 200, now: () => now })

    cache.set('沙湖公园 介绍', 3, [
      { title: '沙湖公园介绍', url: 'https://example.com/shahu', snippet: '城市公园。' },
    ])

    const first = cache.get('沙湖公园 介绍', 3)
    expect(first.status).toBe('hit')
    expect(first.entry?.sources[0]?.title).toBe('沙湖公园介绍')

    first.entry!.sources[0]!.title = '被外部修改'
    expect(cache.get('沙湖公园 介绍', 3).entry?.sources[0]?.title).toBe('沙湖公园介绍')

    now = 2_001
    expect(cache.get('沙湖公园 介绍', 3).status).toBe('stale')
    expect(cache.get('沙湖公园 介绍', 3).status).toBe('miss')
  })

  it('stores short-lived failure entries to avoid immediate repeated upstream calls', () => {
    let now = 10_000
    const cache = new NarrativeWebFactCache({ ttlMs: 1_000, failureTtlMs: 200, now: () => now })

    cache.setError('沙湖公园 介绍', 3, 'upstream timeout')

    const hit = cache.get('沙湖公园 介绍', 3)
    expect(hit.status).toBe('hit')
    expect(hit.entry).toMatchObject({ error: 'upstream timeout', sources: [] })

    now = 11_001
    expect(cache.get('沙湖公园 介绍', 3).status).toBe('stale')
  })
})
