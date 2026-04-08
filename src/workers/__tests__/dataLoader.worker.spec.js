import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch
const originalSelf = globalThis.self

function createSuccessResponse(features = []) {
  return {
    ok: true,
    async json() {
      return {
        success: true,
        features
      }
    }
  }
}

async function loadWorkerModule() {
  vi.resetModules()
  await import('../dataLoader.worker')
  return globalThis.self
}

beforeEach(() => {
  globalThis.self = {
    onmessage: null,
    postMessage: vi.fn()
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.self = originalSelf
  vi.restoreAllMocks()
})

describe('dataLoader worker', () => {
  it('falls back to the single category when categories is an empty array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSuccessResponse([{ id: 1, name: '湖北大学' }])
    )

    const workerScope = await loadWorkerModule()

    await workerScope.onmessage({
      data: {
        category: '中餐厅',
        categories: [],
        name: '餐饮 > 中餐厅',
        bounds: [114.1, 30.5, 114.5, 30.7],
        baseUrl: 'http://example.test'
      }
    })

    const [, requestInit] = globalThis.fetch.mock.calls[0]
    const payload = JSON.parse(requestInit.body)

    expect(payload.categories).toEqual(['中餐厅'])
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      success: true,
      name: '餐饮 > 中餐厅',
      features: [{ id: 1, name: '湖北大学' }]
    })
  })
})
