import { describe, expect, it, vi } from 'vitest'

import { LocalFaissIndex, RemoteFirstFaissIndex } from '../../../src/integration/faissIndex.js'

describe('RemoteFirstFaissIndex', () => {
  it('uses remote semantic search results when the vector service is reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        candidates: [
          { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
        ],
      }), { status: 200 })
    })

    const index = new RemoteFirstFaissIndex({
      baseUrl: 'http://vector.test',
      fetchImpl,
      fallback: new LocalFaissIndex(),
    })

    const candidates = await index.searchSemanticPOIs('高校周边的咖啡馆', 3)

    expect(candidates).toEqual([
      { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
    ])
    await expect(index.getStatus()).resolves.toMatchObject({
      name: 'spatial_vector',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://vector.test',
    })
  })

  it('falls back to the local semantic index when the remote vector service fails', async () => {
    const index = new RemoteFirstFaissIndex({
      baseUrl: 'http://vector.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('vector service timeout')
      }),
      fallback: new LocalFaissIndex(),
    })

    const regions = await index.searchSimilarRegions('和武汉大学周边气质相似的片区', 3)

    expect(regions.length).toBeGreaterThan(0)
    await expect(index.getStatus()).resolves.toMatchObject({
      name: 'spatial_vector',
      mode: 'fallback',
      ready: true,
      degraded: true,
      reason: 'remote_request_failed',
    })
  })

  it('recovers status after a transient vector-service failure', async () => {
    let searchAttempts = 0
    const index = new RemoteFirstFaissIndex({
      baseUrl: 'http://vector.test',
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }

        searchAttempts += 1
        if (searchAttempts === 1) {
          throw new Error('vector service timeout')
        }

        return new Response(JSON.stringify({
          candidates: [
            { id: 'poi_remote_001', name: '远程咖啡馆', category: '咖啡', score: 0.97 },
          ],
        }), { status: 200 })
      }),
      fallback: new LocalFaissIndex(),
    })

    const firstCandidates = await index.searchSemanticPOIs('武汉大学附近咖啡店', 3)
    expect(firstCandidates.length).toBeGreaterThan(0)

    const recoveredStatus = await index.getStatus()
    expect(recoveredStatus).toMatchObject({
      name: 'spatial_vector',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://vector.test',
    })
  })
})
