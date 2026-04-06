import { describe, expect, it, vi } from 'vitest'

import { LocalOSMBridge, RemoteFirstOSMBridge } from '../../../src/integration/osmBridge.js'

describe('RemoteFirstOSMBridge', () => {
  it('uses the remote routing service when it is reachable', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      }

      return new Response(JSON.stringify({
        distance_m: 820,
        duration_min: 11,
        degraded: false,
        degraded_reason: null,
      }), { status: 200 })
    })

    const bridge = new RemoteFirstOSMBridge({
      baseUrl: 'http://routing.test',
      fetchImpl,
      fallback: new LocalOSMBridge(),
    })

    const route = await bridge.estimateRoute([114.364339, 30.536334], [114.355, 30.54], 'walking')

    expect(route).toMatchObject({
      distance_m: 820,
      duration_min: 11,
      degraded: false,
    })
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'route_distance',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://routing.test',
    })
  })

  it('falls back to local distance estimation when the routing service fails', async () => {
    const bridge = new RemoteFirstOSMBridge({
      baseUrl: 'http://routing.test',
      fetchImpl: vi.fn(async () => {
        throw new Error('routing service unavailable')
      }),
      fallback: new LocalOSMBridge(),
    })

    const route = await bridge.estimateRoute([114.364339, 30.536334], [114.355, 30.54], 'walking')

    expect(route.distance_m).toBeGreaterThan(0)
    expect(route.degraded).toBe(true)
    await expect(bridge.getStatus()).resolves.toMatchObject({
      name: 'route_distance',
      mode: 'fallback',
      ready: true,
      degraded: true,
      reason: 'remote_request_failed',
    })
  })

  it('recovers status after a transient routing failure', async () => {
    let routeAttempts = 0
    const bridge = new RemoteFirstOSMBridge({
      baseUrl: 'http://routing.test',
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
        }

        routeAttempts += 1
        if (routeAttempts === 1) {
          throw new Error('routing service unavailable')
        }

        return new Response(JSON.stringify({
          distance_m: 820,
          duration_min: 11,
          degraded: false,
          degraded_reason: null,
        }), { status: 200 })
      }),
      fallback: new LocalOSMBridge(),
    })

    const firstRoute = await bridge.estimateRoute([114.364339, 30.536334], [114.355, 30.54], 'walking')
    expect(firstRoute.distance_m).toBeGreaterThan(0)

    const recoveredStatus = await bridge.getStatus()
    expect(recoveredStatus).toMatchObject({
      name: 'route_distance',
      mode: 'remote',
      ready: true,
      degraded: false,
      target: 'http://routing.test',
    })
  })
})
