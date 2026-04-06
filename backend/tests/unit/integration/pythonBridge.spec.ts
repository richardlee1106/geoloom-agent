import { describe, expect, it, vi } from 'vitest'

import { LocalPythonBridge, RemoteFirstPythonBridge } from '../../../src/integration/pythonBridge.js'

describe('RemoteFirstPythonBridge', () => {
  it('prefers the remote encoder when configured and reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        vector: [0.12, 0.88],
        tokens: ['武汉大学', '咖啡'],
        dimension: 2,
      }), { status: 200 })
    })

    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl,
      fallback: new LocalPythonBridge(),
    })

    const encoded = await bridge.encodeText('武汉大学附近咖啡店')

    expect(encoded).toEqual({
      vector: [0.12, 0.88],
      tokens: ['武汉大学', '咖啡'],
      dimension: 2,
    })
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://encoder.test',
    })
  })

  it('falls back to the local encoder when the remote request fails', async () => {
    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED')
      }),
      fallback: new LocalPythonBridge(),
    })

    const encoded = await bridge.encodeText('高校周边咖啡和夜间活跃')

    expect(encoded.dimension).toBeGreaterThan(0)
    expect(encoded.vector.length).toBe(encoded.dimension)
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'spatial_encoder',
      mode: 'fallback',
      ready: true,
      degraded: true,
      reason: 'remote_request_failed',
    })
  })

  it('recovers health status after a transient remote encoder failure', async () => {
    let encodeAttempts = 0
    const bridge = new RemoteFirstPythonBridge({
      baseUrl: 'http://encoder.test',
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }

        encodeAttempts += 1
        if (encodeAttempts === 1) {
          throw new Error('connect ECONNREFUSED')
        }

        return new Response(JSON.stringify({
          vector: [0.12, 0.88],
          tokens: ['武汉大学', '咖啡'],
          dimension: 2,
        }), { status: 200 })
      }),
      fallback: new LocalPythonBridge(),
    })

    const firstEncoded = await bridge.encodeText('武汉大学附近咖啡店')
    expect(firstEncoded.dimension).toBeGreaterThan(0)

    const recoveredStatus = await bridge.getStatus()
    expect(recoveredStatus).toMatchObject({
      name: 'spatial_encoder',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://encoder.test',
    })
  })
})
