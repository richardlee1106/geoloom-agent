import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalSelf = globalThis.self

async function loadWorkerModule() {
  vi.resetModules()
  await import('../gravity.worker')
  return globalThis.self
}

beforeEach(() => {
  globalThis.self = {
    onmessage: null,
    postMessage: vi.fn()
  }

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.self = originalSelf
  vi.restoreAllMocks()
})

describe('gravity worker', () => {
  it('uses explicit center coordinates even when longitude or latitude is zero', async () => {
    const workerScope = await loadWorkerModule()

    await workerScope.onmessage({
      data: {
        tags: [
          {
            name: 'East Point',
            lon: 1,
            lat: 0
          }
        ],
        width: 400,
        height: 300,
        center: [0, 0]
      }
    })

    const result = workerScope.postMessage.mock.calls.at(-1)?.[0] || []
    const eastPoint = result.find((tag) => tag.name === 'East Point')

    expect(eastPoint).toBeDefined()
    expect(eastPoint.bearing).toBeGreaterThanOrEqual(80)
    expect(eastPoint.bearing).toBeLessThanOrEqual(100)
    expect(eastPoint.distance).toBeGreaterThan(1000)
  })
})
