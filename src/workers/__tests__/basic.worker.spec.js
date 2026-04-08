import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalSelf = globalThis.self
const originalOffscreenCanvas = globalThis.OffscreenCanvas

class FakeCanvasContext {
  constructor() {
    this.font = '16px sans-serif'
  }

  measureText(text) {
    return { width: String(text).length * 8 }
  }
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
  }

  getContext() {
    return new FakeCanvasContext()
  }
}

async function loadWorkerModule() {
  vi.resetModules()
  await import('../basic.worker')
  return globalThis.self
}

beforeEach(() => {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas
  globalThis.self = {
    onmessage: null,
    postMessage: vi.fn()
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.self = originalSelf
  globalThis.OffscreenCanvas = originalOffscreenCanvas
  vi.restoreAllMocks()
})

describe('basic worker', () => {
  it('keeps placeable tags inside canvas bounds', async () => {
    const workerScope = await loadWorkerModule()

    await workerScope.onmessage({
      data: {
        tags: [
          { name: 'AAAAAA' },
          { name: 'BBBBBB' },
          { name: 'CCCCCC' },
          { name: 'DDDDDD' },
          { name: 'EEEEEE' }
        ],
        width: 120,
        height: 80,
        config: {
          fontMin: 18,
          fontMax: 22,
          padding: 2,
          spiralStep: 5
        }
      }
    })

    const placedTags = workerScope.postMessage.mock.calls.at(-1)?.[0] || []

    for (const tag of placedTags) {
      const halfWidth = tag.width / 2
      const halfHeight = tag.height / 2

      expect(tag.x - halfWidth).toBeGreaterThanOrEqual(0)
      expect(tag.x + halfWidth).toBeLessThanOrEqual(120)
      expect(tag.y - halfHeight).toBeGreaterThanOrEqual(0)
      expect(tag.y + halfHeight).toBeLessThanOrEqual(80)
    }
  })
})
